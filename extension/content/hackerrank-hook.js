/**
 * SolveSync — HackerRank network hook (PAGE world; needs net-core.js loaded first).
 *
 * HackerRank creates a submission with POST .../challenges/<slug>/submissions and then
 * polls GET .../challenges/<slug>/submissions/<id> until its status is final.
 */
(() => {
  const net = window.__ssNet;
  if (!net) return;
  const emitted = new Set();

  net.watch(/\/rest\/contests\/([^/]+)\/challenges\/([^/]+)\/submissions\/(\d+)/, (_url, data, m) => {
    const s = data && data.model;
    if (!s || !(s.status === 'Accepted' || s.status_code === 2)) return;
    const id = m[3];
    if (emitted.has(id)) return;
    emitted.add(id);
    window.postMessage(
      {
        source: 'solvesync-hook',
        type: 'hr-accepted',
        payload: { submissionId: id, contest: m[1], slug: m[2], language: s.language || '' }
      },
      location.origin
    );
  });
})();
