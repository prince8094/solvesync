/**
 * SolveSync — HackerRank adapter (EXPERIMENTAL, isolated world).
 * Automatic: hackerrank-hook.js reports an Accepted submission.
 * Manual: a "Sync to Sheet" button on challenge pages records the current problem.
 */
(() => {
  const SS = window.SolveSync;
  if (!SS) return;

  const CHALLENGE_RE = /^\/(?:contests\/([^/]+)\/)?challenges\/([^/]+)/;
  const handled = new Set();
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const prettify = (slug) => slug.split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

  const LANGS = { cpp14: 'C++14', cpp: 'C++', cpp20: 'C++20', python3: 'Python 3', python: 'Python', java8: 'Java 8', java15: 'Java 15', java: 'Java', javascript: 'JavaScript', c: 'C', csharp: 'C#', golang: 'Go', rust: 'Rust', ruby: 'Ruby', kotlin: 'Kotlin', swift: 'Swift', php: 'PHP', mysql: 'MySQL' };

  async function fetchChallenge(contest, slug) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(`/rest/contests/${contest}/challenges/${slug}`, {
        credentials: 'include',
        signal: ctrl.signal,
        headers: { accept: 'application/json' }
      });
      const json = await res.json();
      return json && json.model ? json.model : null;
    } catch (_) {
      return null;
    } finally {
      clearTimeout(t);
    }
  }

  async function buildRecord(submissionId, contest, slug, language) {
    const m = await fetchChallenge(contest, slug);
    const domDifficulty = (document.body.innerText.match(/Difficulty:\s*(Easy|Medium|Hard)/i) || [])[1] || '';
    const track = m && m.track && m.track.name ? [m.track.name] : [];
    return {
      platform: 'HackerRank',
      submissionId: String(submissionId),
      problem: (m && m.name) || prettify(slug),
      url:
        contest === 'master'
          ? `https://www.hackerrank.com/challenges/${slug}/problem`
          : `https://www.hackerrank.com/contests/${contest}/challenges/${slug}`,
      difficulty: norm((m && (m.difficulty_name || (typeof m.difficulty === 'string' ? m.difficulty : ''))) || domDifficulty),
      language: LANGS[language] || language || '',
      status: 'Accepted',
      topics: track,
      ...SS.now()
    };
  }

  // ---- automatic
  window.addEventListener('message', async (ev) => {
    if (ev.source !== window || ev.origin !== location.origin) return;
    const m = ev.data;
    if (!m || m.source !== 'solvesync-hook' || m.type !== 'hr-accepted') return;
    const d = m.payload;
    if (!d || !d.submissionId || handled.has(String(d.submissionId))) return;
    handled.add(String(d.submissionId));
    SS.report(await buildRecord(d.submissionId, d.contest, d.slug, d.language));
  });

  // ---- manual button (only on challenge pages)
  let fab = null;
  setInterval(() => {
    const m = CHALLENGE_RE.exec(location.pathname);
    if (!m) {
      if (fab) fab.remove();
      fab = null;
      return;
    }
    if (fab) return;
    fab = SS.floatingButton('⟳ Sync to Sheet', async () => {
      const mm = CHALLENGE_RE.exec(location.pathname);
      if (!mm) return;
      const contest = mm[1] || 'master';
      const rec = await buildRecord(`manual-${mm[2]}-${SS.now().date}`, contest, mm[2], '');
      SS.report(rec, { manual: true });
    });
  }, 1000);
})();
