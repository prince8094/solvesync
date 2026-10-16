/**
 * SolveSync — LeetCode adapter (isolated world).
 *
 * Three ways a submission reaches your sheet, all sharing one de-duplicated path:
 *   1. leetcode-hook.js sees the "Accepted" network response   (automatic)
 *   2. The page navigates to /problems/<slug>/submissions/<id>  (automatic, only if the
 *      submission is less than 5 minutes old, so browsing old history never re-imports it)
 *   3. The "Sync to Sheet" button on that submission page       (manual, works for any
 *      Accepted submission, old or new)
 */
(() => {
  const SS = window.SolveSync;
  if (!SS) return;

  const FRESH_MS = 5 * 60 * 1000;
  const SUB_RE = /\/problems\/([^/]+)\/submissions\/(\d+)/;
  const log = (...a) => console.debug('[SolveSync]', ...a);

  const handled = new Set(); // submission ids already reported from this page

  const LANGS = {
    cpp: 'C++', python3: 'Python3', python: 'Python', java: 'Java', javascript: 'JavaScript', typescript: 'TypeScript',
    c: 'C', csharp: 'C#', golang: 'Go', rust: 'Rust', kotlin: 'Kotlin', swift: 'Swift', ruby: 'Ruby', scala: 'Scala',
    php: 'PHP', mysql: 'MySQL', dart: 'Dart'
  };

  const prettify = (slug) =>
    String(slug || '')
      .split('-')
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(' ');

  // ------------------------------------------------------------ LeetCode data
  async function gql(query, variables) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch('/graphql', {
        method: 'POST',
        credentials: 'include',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables })
      });
      const json = await res.json();
      return json && json.data ? json.data : null;
    } catch (_) {
      return null;
    } finally {
      clearTimeout(t);
    }
  }

  async function fetchQuestion(slug) {
    const data = await gql(
      'query q($titleSlug: String!) { question(titleSlug: $titleSlug) { questionFrontendId title difficulty topicTags { name } } }',
      { titleSlug: slug }
    );
    return data && data.question ? data.question : null;
  }

  /** Reads one submission's verdict/runtime/memory/language. GraphQL first, REST list as fallback. */
  async function fetchSubmission(id, slug) {
    const data = await gql(
      'query submissionDetails($submissionId: Int!) { submissionDetails(submissionId: $submissionId) { runtimeDisplay memoryDisplay timestamp statusCode lang { name verboseName } } }',
      { submissionId: Number(id) }
    );
    const s = data && data.submissionDetails;
    if (s) {
      return {
        accepted: s.statusCode === 10,
        runtime: s.runtimeDisplay || '',
        memory: s.memoryDisplay || '',
        language: (s.lang && (s.lang.verboseName || LANGS[s.lang.name] || s.lang.name)) || '',
        ts: Number(s.timestamp) || 0
      };
    }
    try {
      const res = await fetch(`/api/submissions/${slug}/?offset=0&limit=40`, { credentials: 'include' });
      const json = await res.json();
      const row = (json.submissions_dump || []).find((x) => String(x.id) === String(id));
      if (row) {
        return {
          accepted: row.status_display === 'Accepted',
          runtime: row.runtime || '',
          memory: row.memory || '',
          language: LANGS[row.lang] || row.lang || '',
          ts: Number(row.timestamp) || 0
        };
      }
    } catch (_) {}
    return null;
  }

  async function buildRecord(id, slug, sub) {
    const q = slug ? await fetchQuestion(slug) : null;
    const fallbackTitle = document.title.replace(/\s*-\s*LeetCode.*$/i, '').trim();
    return {
      platform: 'LeetCode',
      submissionId: String(id),
      problem: q ? `${q.questionFrontendId}. ${q.title}` : slug ? prettify(slug) : fallbackTitle || 'Unknown problem',
      url: slug ? `https://leetcode.com/problems/${slug}/` : location.href,
      difficulty: q ? q.difficulty : '',
      language: sub.language || '',
      status: 'Accepted',
      topics: q ? q.topicTags.map((t) => t.name) : [],
      runtime: sub.runtime || '',
      memory: sub.memory || '',
      ...SS.now()
    };
  }

  // ------------------------------------------------------------ 1. network hook
  window.addEventListener('message', async (ev) => {
    if (ev.source !== window || ev.origin !== location.origin) return;
    const m = ev.data;
    if (!m || m.source !== 'solvesync-hook' || m.type !== 'lc-accepted') return;
    const d = m.payload;
    if (!d || !d.submissionId || handled.has(String(d.submissionId))) return;
    handled.add(String(d.submissionId));
    log('accepted via network hook', d.submissionId);

    const slug = (location.pathname.match(/\/problems\/([^/]+)/) || [])[1];
    SS.report(
      await buildRecord(d.submissionId, slug, {
        language: d.prettyLang || LANGS[d.lang] || d.lang,
        runtime: d.runtime,
        memory: d.memory
      })
    );
  });

  // ------------------------------------------------------------ 2 + 3. submission page
  async function syncSubmission(id, slug, { manual }) {
    let sub = await fetchSubmission(id, slug);
    // Right after pressing Submit the verdict can still be pending; give the automatic path a few tries.
    for (let i = 0; !sub && !manual && i < 3; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      sub = await fetchSubmission(id, slug);
    }
    if (!sub) {
      if (manual) SS.notice('err', 'Couldn’t read this submission', 'LeetCode didn’t return its details. Reload the page and try again.');
      return;
    }
    if (!sub.accepted) {
      if (manual) SS.notice('warn', 'Not synced', 'Only Accepted submissions are sent to your sheet.');
      return;
    }
    if (!manual) {
      const age = sub.ts ? Date.now() - sub.ts * 1000 : Infinity;
      if (age > FRESH_MS) return; // an old submission you're just looking at
    }
    if (handled.has(String(id)) && !manual) return;
    handled.add(String(id));
    log(manual ? 'manual sync' : 'accepted via submission page', id);
    SS.report(await buildRecord(id, slug, sub), { manual });
  }

  // The "Sync to Sheet" button (in a shadow root so LeetCode's CSS can't touch it).
  let btnHost = null;
  function mountButton(info) {
    if (!info) {
      if (btnHost) btnHost.remove();
      btnHost = null;
      return;
    }
    if (btnHost && btnHost.isConnected && btnHost.dataset.id === info.id) return;
    if (btnHost) btnHost.remove();

    const anchor = document.querySelector('[data-e2e-locator="submission-result"]');
    btnHost = document.createElement('div');
    btnHost.dataset.id = info.id;
    btnHost.style.cssText = anchor
      ? 'display:inline-block;margin-left:14px;vertical-align:middle;'
      : 'position:fixed;left:24px;bottom:24px;z-index:2147483646;';

    const root = btnHost.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      button { all: unset; box-sizing: border-box; cursor: pointer; padding: 7px 14px; border-radius: 8px;
        background: #4f46e5; color: #fff; font: 600 13px/1.2 -apple-system, "Segoe UI", Roboto, sans-serif;
        box-shadow: 0 2px 8px rgba(0,0,0,.35); white-space: nowrap; }
      button:hover { background: #4338ca; }
      button[disabled] { opacity: .6; cursor: default; }`;
    const b = document.createElement('button');
    b.textContent = '⟳ Sync to Sheet';
    b.title = 'Send this submission to your Google Sheet (SolveSync)';
    b.addEventListener('click', async () => {
      b.disabled = true;
      b.textContent = 'Syncing…';
      try {
        await syncSubmission(info.id, info.slug, { manual: true });
      } finally {
        b.disabled = false;
        b.textContent = '⟳ Sync to Sheet';
      }
    });
    root.append(style, b);

    if (anchor && anchor.parentElement) anchor.parentElement.insertAdjacentElement('afterend', btnHost);
    else document.documentElement.append(btnHost);
  }

  // LeetCode is a single-page app: watch the URL instead of waiting for page loads.
  let lastHref = '';
  function tick() {
    const m = location.pathname.match(SUB_RE);
    const info = m ? { slug: m[1], id: m[2] } : null;
    mountButton(info); // re-mounts if React re-rendered it away

    if (location.href === lastHref) return;
    lastHref = location.href;
    if (info && !handled.has(info.id)) syncSubmission(info.id, info.slug, { manual: false });
  }
  setInterval(tick, 800);
  tick();
})();
