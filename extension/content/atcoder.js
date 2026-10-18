/**
 * SolveSync — AtCoder adapter (EXPERIMENTAL, isolated world).
 *
 * Works on  /contests/<c>/submissions/me  (the page AtCoder sends you to after you submit)
 * and on a single submission page  /contests/<c>/submissions/<id>.
 *
 * Like Codeforces: a submission is recorded automatically only if you watched it go from
 * "judging" to AC on this page, so old accepted submissions are never re-imported.
 * On the detail page a "Sync to Sheet" button records any AC submission manually.
 */
(() => {
  const SS = window.SolveSync;
  if (!SS) return;

  const FINAL = /^(AC|WA|TLE|MLE|OLE|RE|CE|IE|QLE)$/;
  const LIST_RE = /\/submissions\/me\/?$/;
  const DETAIL_RE = /\/submissions\/(\d+)\/?$/;
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  const pending = new Set();
  const done = new Set();

  function problemFrom(link) {
    const m = /\/contests\/([^/]+)\/tasks\/([^/?#]+)/.exec(link.getAttribute('href') || '');
    if (!m) return null;
    return {
      taskId: m[2],
      url: `https://atcoder.jp/contests/${m[1]}/tasks/${m[2]}`,
      title: `${m[1].toUpperCase()} ${norm(link.textContent)}`
    };
  }

  function recordFrom(id, link, language) {
    const p = problemFrom(link);
    if (!p) return null;
    return {
      platform: 'AtCoder',
      submissionId: String(id),
      problem: p.title,
      url: p.url,
      difficulty: '', // filled in by the background worker (AtCoder Problems estimate)
      language: language || '',
      status: 'Accepted',
      topics: [],
      taskId: p.taskId,
      ...SS.now()
    };
  }

  /** Called with one observation of a submission: updates the pending -> AC state machine. */
  function observe(id, status, build) {
    if (!id || done.has(id) || !status) return;
    if (!FINAL.test(status)) {
      pending.add(id);
      return;
    }
    if (!pending.has(id)) return; // it was already finished when we arrived
    pending.delete(id);
    done.add(id);
    if (status !== 'AC') return;
    const rec = build();
    if (rec) SS.report(rec);
  }

  // ---------------------------------------------------------- list page
  function colIndex(table, name, fallback) {
    const i = [...table.querySelectorAll('thead th')].findIndex((th) => norm(th.textContent).toLowerCase().startsWith(name));
    return i >= 0 ? i : fallback;
  }

  function scanList() {
    for (const table of document.querySelectorAll('table')) {
      const taskIdx = colIndex(table, 'task', 1);
      const langIdx = colIndex(table, 'language', 3);
      const statusIdx = colIndex(table, 'status', 6);
      for (const tr of table.querySelectorAll('tbody tr')) {
        const cells = tr.children;
        const sc = cells[statusIdx];
        const link = cells[taskIdx] && cells[taskIdx].querySelector('a[href*="/tasks/"]');
        if (!sc || !link) continue;
        const label = sc.querySelector('.label');
        const status = norm((label || sc).textContent);
        const detail = tr.querySelector('a[href*="/submissions/"]');
        const id = sc.getAttribute('data-id') || ((detail && /submissions\/(\d+)/.exec(detail.getAttribute('href'))) || [])[1];
        observe(id, status, () => recordFrom(id, link, norm((cells[langIdx] || {}).textContent)));
      }
    }
  }

  // ---------------------------------------------------------- detail page
  function readDetail() {
    const map = {};
    for (const tr of document.querySelectorAll('table tr')) {
      const th = tr.querySelector('th');
      const td = tr.querySelector('td');
      if (th && td) map[norm(th.textContent).toLowerCase()] = td;
    }
    const taskCell = map['task'];
    const link = taskCell && taskCell.querySelector('a[href*="/tasks/"]');
    const sCell = map['status'];
    if (!link || !sCell) return null;
    const label = sCell.querySelector('.label');
    return { link, status: norm((label || sCell).textContent), language: norm((map['language'] || {}).textContent) };
  }

  let fab = null;
  function scanDetail(id) {
    const d = readDetail();
    if (!d) return;
    observe(id, d.status, () => recordFrom(id, d.link, d.language));
    if (!fab) {
      fab = SS.floatingButton('⟳ Sync to Sheet', () => {
        const cur = readDetail();
        if (!cur) return SS.notice('err', 'Couldn’t read this page', 'Reload and try again.');
        if (cur.status !== 'AC') return SS.notice('warn', 'Not synced', 'Only accepted (AC) submissions are sent to your sheet.');
        const rec = recordFrom(id, cur.link, cur.language);
        if (rec) SS.report(rec, { manual: true });
      });
    }
  }

  function scan() {
    const d = DETAIL_RE.exec(location.pathname);
    if (d) scanDetail(d[1]);
    else if (LIST_RE.test(location.pathname)) scanList();
  }

  let t = null;
  const schedule = () => {
    clearTimeout(t);
    t = setTimeout(scan, 400);
  };
  scan();
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
})();
