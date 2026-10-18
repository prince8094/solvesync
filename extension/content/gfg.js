/**
 * SolveSync — GeeksforGeeks adapter (EXPERIMENTAL, isolated world).
 *
 * GFG's practice site has no stable public submission endpoint, so this watches for the
 * on-screen "Problem Solved Successfully" message appearing after you press Submit.
 * A "Sync to Sheet" button on every problem page records the problem manually as a fallback.
 */
(() => {
  const SS = window.SolveSync;
  if (!SS) return;

  const PATH_RE = /\/problems\/([^/]+)(?:\/(\d+))?/;
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const prettify = (slug) => slug.split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

  function currentRecord() {
    const m = PATH_RE.exec(location.pathname);
    if (!m) return null;
    const slug = m[1];
    const h1 = document.querySelector('h1');
    const title = norm(h1 ? h1.textContent : document.title.replace(/\s*\|.*$/, '')) || prettify(slug);
    const text = document.body ? document.body.innerText : '';
    const diff = (/Difficulty:?\s*(School|Basic|Easy|Medium|Hard)/i.exec(text) || [])[1] || '';
    const now = SS.now();
    return {
      platform: 'GeeksforGeeks',
      submissionId: `${slug}-${now.date}`,
      problem: title,
      url: `https://www.geeksforgeeks.org/problems/${slug}/${m[2] || 1}`,
      difficulty: diff ? diff[0].toUpperCase() + diff.slice(1).toLowerCase() : '',
      status: 'Accepted',
      topics: [],
      ...now
    };
  }

  // ---- automatic: the success message appears on screen
  let baseline = null; // first tick only records the starting state
  let solved = false;
  setInterval(() => {
    if (!document.body) return;
    const now = /Problem Solved Successfully/i.test(document.body.innerText);
    if (baseline === null) {
      baseline = now;
      solved = now;
      return;
    }
    if (now && !solved) {
      solved = true;
      const rec = currentRecord();
      if (rec) SS.report(rec);
    } else if (!now) {
      solved = false;
    }
  }, 1500);

  // ---- manual fallback button
  let fab = null;
  setInterval(() => {
    if (!PATH_RE.test(location.pathname)) {
      if (fab) fab.remove();
      fab = null;
      return;
    }
    if (fab) return;
    fab = SS.floatingButton('⟳ Sync to Sheet', () => {
      const rec = currentRecord();
      if (rec) SS.report(rec, { manual: true });
    });
  }, 1000);
})();
