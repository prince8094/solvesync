/**
 * SolveSync — LeetCode network hook (PAGE world; needs net-core.js loaded first).
 *
 * LeetCode polls  /submissions/detail/<id>/check/  after you press Submit.
 * When the response says state=SUCCESS and status_msg="Accepted" we tell the
 * content script (isolated world) via window.postMessage.
 *
 * "Run" (sample tests) uses ids like "runcode_..." which don't match \d+,
 * so only real submissions are ever reported.
 */
(() => {
  const net = window.__ssNet;
  if (!net) return;
  const emitted = new Set();

  net.watch(/\/submissions\/detail\/(\d+)\/check\/?/, (_url, data, m) => {
    if (!data || data.state !== 'SUCCESS' || data.status_msg !== 'Accepted') return;
    const id = m[1];
    if (emitted.has(id)) return;
    emitted.add(id);
    window.postMessage(
      {
        source: 'solvesync-hook',
        type: 'lc-accepted',
        payload: {
          submissionId: id,
          lang: data.lang || '',
          prettyLang: data.pretty_lang || '',
          runtime: data.status_runtime || '',
          memory: data.status_memory || ''
        }
      },
      location.origin
    );
  });
})();
