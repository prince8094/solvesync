/**
 * SolveSync — Codeforces adapter (EXPERIMENTAL).
 *
 * Codeforces has no submit API we can hook, so this watches the submissions
 * tables (/contest/N/my, /problemset/status, /submissions/<handle>). A row is
 * recorded only when it was seen "In queue / Running" on this page and then
 * flipped to "Accepted" — i.e. you actually watched it finish. That avoids
 * importing your old accepted submissions every time you open the page.
 */
(() => {
  const SS = window.SolveSync;
  if (!SS) return;

  const pending = new Set(); // submission ids seen in a non-final state
  const done = new Set(); // ids already reported from this page

  const myHandle = () => {
    const a = document.querySelector('#header .lang-chooser a[href^="/profile/"]');
    return a ? a.textContent.trim().toLowerCase() : '';
  };

  function headerIndex(table, re) {
    const ths = [...table.querySelectorAll('tr:first-child th')];
    return ths.findIndex((th) => re.test(th.textContent));
  }

  function parseProblemHref(href) {
    let m = /\/problemset\/problem\/(\d+)\/(\w+)/.exec(href);
    if (m) return { contestId: m[1], index: m[2], gym: false };
    m = /\/(contest|gym)\/(\d+)\/problem\/(\w+)/.exec(href);
    if (m) return { contestId: m[2], index: m[3], gym: m[1] === 'gym' };
    return null;
  }

  function scan() {
    const handle = myHandle();
    if (!handle) return; // not logged in -> nothing is "mine"

    for (const table of document.querySelectorAll('table.status-frame-datatable')) {
      const langIdx = headerIndex(table, /lang/i);
      const timeIdx = headerIndex(table, /^\s*time\s*$/i);
      const memIdx = headerIndex(table, /memory/i);

      for (const tr of table.querySelectorAll('tr[data-submission-id]')) {
        const id = tr.getAttribute('data-submission-id');
        if (!id || done.has(id)) continue;

        const who = tr.querySelector('a[href^="/profile/"]');
        if (!who || who.textContent.trim().toLowerCase() !== handle) continue;

        const cell = tr.querySelector('.status-verdict-cell');
        if (!cell) continue;
        const span = cell.querySelector('[submissionverdict]');
        const verdict = span ? span.getAttribute('submissionverdict') : '';
        const waiting = cell.getAttribute('waiting') === 'true' || !verdict;

        if (waiting) {
          pending.add(id);
          continue;
        }
        if (!pending.has(id)) continue; // finished before we were watching
        pending.delete(id);
        done.add(id);
        if (verdict !== 'OK') continue; // only Accepted is recorded

        const link = tr.querySelector('a[href*="/problem/"]');
        if (!link) continue;
        const p = parseProblemHref(link.getAttribute('href'));
        if (!p) continue;

        const cells = tr.querySelectorAll('td');
        const cellText = (i) => (i >= 0 && cells[i] ? cells[i].textContent.trim().replace(/\s+/g, ' ') : '');

        const url = p.gym
          ? `https://codeforces.com/gym/${p.contestId}/problem/${p.index}`
          : `https://codeforces.com/contest/${p.contestId}/problem/${p.index}`;

        SS.report({
          platform: 'Codeforces',
          submissionId: id,
          problem: link.textContent.trim().replace(/\s+/g, ' '),
          url,
          difficulty: '', // filled in by the background worker from the Codeforces API
          language: cellText(langIdx),
          status: 'Accepted',
          topics: [],
          runtime: cellText(timeIdx),
          memory: cellText(memIdx),
          contestId: p.contestId,
          index: p.index,
          gym: p.gym,
          ...SS.now()
        });
      }
    }
  }

  let t = null;
  const schedule = () => {
    clearTimeout(t);
    t = setTimeout(scan, 400);
  };

  scan();
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['waiting', 'submissionverdict'] });
})();
