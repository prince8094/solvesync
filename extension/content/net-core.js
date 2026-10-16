/**
 * SolveSync — shared network watcher (runs in the PAGE's JS world).
 *
 * Patches fetch/XMLHttpRequest once and lets site-specific hook files register
 * "when a request whose URL matches /regex/ returns JSON, call me" callbacks:
 *
 *   window.__ssNet.watch(/\/some\/endpoint\/(\d+)/, (url, json, match) => { ... });
 *
 * It never alters requests or responses.
 */
(() => {
  if (window.__ssNet) return;
  const watchers = [];

  function dispatch(url, getJson) {
    for (const w of watchers) {
      const m = w.re.exec(url);
      if (!m) continue;
      Promise.resolve()
        .then(getJson)
        .then((data) => w.fn(url, data, m))
        .catch(() => {});
    }
  }
  const interested = (url) => watchers.some((w) => w.re.test(url));

  // --- fetch ---
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const p = origFetch.apply(this, args);
    try {
      const a = args[0];
      const url = typeof a === 'string' ? a : a && a.url ? a.url : String(a);
      if (interested(url)) p.then((res) => dispatch(url, () => res.clone().json())).catch(() => {});
    } catch (_) {
      /* never break the page */
    }
    return p;
  };

  // --- XMLHttpRequest ---
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__ssUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...a) {
    try {
      const url = String(this.__ssUrl || '');
      if (interested(url)) this.addEventListener('load', () => dispatch(url, () => JSON.parse(this.responseText)));
    } catch (_) {}
    return origSend.apply(this, a);
  };

  Object.defineProperty(window, '__ssNet', {
    value: { watch: (re, fn) => watchers.push({ re, fn }) },
    enumerable: false
  });
})();
