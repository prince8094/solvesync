/**
 * SolveSync — shared helpers for every platform adapter (isolated world).
 * Exposes window.SolveSync = { now(), report(record) }.
 *
 * report(record) sends the record to the background worker, then shows a small
 * toast ("✅ Two Sum recorded") with an optional "Approach" box.
 */
(() => {
  if (window.SolveSync) return;

  const pad = (n) => String(n).padStart(2, '0');

  function now() {
    const d = new Date();
    return {
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`
    };
  }

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve(res || { ok: false, error: 'No response from SolveSync.' });
        });
      } catch (_) {
        resolve({ ok: false, error: 'SolveSync was updated or reloaded — refresh this page.' });
      }
    });
  }

  // ---------- tiny DOM helper ----------
  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid);
    return n;
  }

  // ---------- toast ----------
  const CSS = `
    :host { all: initial; }
    .card {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
      width: 320px; box-sizing: border-box; padding: 14px 16px;
      background: #111827; color: #f9fafb; border-radius: 12px;
      border: 1px solid #374151; box-shadow: 0 10px 30px rgba(0,0,0,.45);
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .row { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .title { font-weight: 600; font-size: 14px; word-break: break-word; }
    .sub { color: #9ca3af; margin-top: 2px; font-size: 12px; }
    .x { background: none; border: 0; color: #9ca3af; cursor: pointer; font-size: 16px; line-height: 1; padding: 0 2px; }
    .x:hover { color: #fff; }
    textarea {
      width: 100%; box-sizing: border-box; margin-top: 10px; min-height: 60px; resize: vertical;
      background: #1f2937; color: #f9fafb; border: 1px solid #4b5563; border-radius: 8px;
      padding: 8px; font: inherit; outline: none;
    }
    textarea:focus { border-color: #818cf8; }
    .btns { display: flex; gap: 8px; margin-top: 8px; justify-content: flex-end; }
    button.b {
      border: 0; border-radius: 8px; padding: 6px 12px; cursor: pointer; font: inherit; font-weight: 600;
      background: #4f46e5; color: #fff;
    }
    button.b:hover { background: #4338ca; }
    button.b.ghost { background: transparent; color: #9ca3af; font-weight: 500; }
    button.b.ghost:hover { color: #fff; }
    .ok { color: #34d399; } .warn { color: #fbbf24; } .err { color: #f87171; }
  `;

  let host = null;
  let card = null;
  let timer = null;

  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.id = 'solvesync-toast-host';
    const root = host.attachShadow({ mode: 'closed' });
    card = el('div', { class: 'card' });
    root.append(el('style', {}, CSS), card);
    document.documentElement.append(host);
  }

  function hide() {
    clearTimeout(timer);
    if (host) host.remove();
    host = null;
  }

  function render(nodes, autoCloseMs) {
    ensureHost();
    clearTimeout(timer);
    card.replaceChildren(...nodes);
    if (autoCloseMs) timer = setTimeout(hide, autoCloseMs);
  }

  const header = (icon, cls, title, sub) =>
    el(
      'div',
      { class: 'row' },
      el(
        'div',
        {},
        el('div', { class: 'title' }, el('span', { class: cls }, icon + ' '), title),
        sub ? el('div', { class: 'sub' }, sub) : null
      ),
      el('button', { class: 'x', title: 'Dismiss', onclick: hide }, '×')
    );

  function approachBox(key, url) {
    const ta = el('textarea', { placeholder: 'Approach / key insight (optional)…', maxlength: '500' });
    ta.addEventListener('focus', () => clearTimeout(timer));
    const save = el(
      'button',
      {
        class: 'b',
        onclick: async () => {
          const text = ta.value.trim();
          if (!text) return hide();
          save.disabled = true;
          save.textContent = 'Saving…';
          const r = await send({ type: 'APPROACH', key, url, approach: text });
          render(
            [header(r.ok ? '✓' : '⚠', r.ok ? 'ok' : 'err', r.ok ? 'Approach saved' : 'Could not save approach', r.ok ? null : r.error)],
            2500
          );
        }
      },
      'Save'
    );
    return [ta, el('div', { class: 'btns' }, el('button', { class: 'b ghost', onclick: hide }, 'Skip'), save)];
  }

  /** Small status toast: kind is 'ok' | 'warn' | 'err'. */
  function notice(kind, title, sub) {
    const icon = { ok: '✓', warn: '⚠', err: '✕' }[kind] || 'ℹ';
    render([header(icon, kind, title, sub)], 6000);
  }

  async function report(record, opts = {}) {
    render([header('⏳', '', 'SolveSync', `Recording ${record.problem}…`)]);
    const res = await send({ type: 'RECORD', record });

    if (!res.ok) {
      render([header('⚠', 'err', 'SolveSync could not record this', res.error || 'Unknown error')], 10000);
      return;
    }
    switch (res.status) {
      case 'duplicate':
        // Automatic detections stay silent; an explicit button click deserves an answer.
        if (opts.manual) render([header('✓', 'ok', `${record.problem} is already in your sheet`)], 3500);
        else hide();
        return;
      case 'duplicate_in_sheet':
        render([header('✓', 'ok', `${record.problem} is already in your sheet`, 'Each problem is only added once.')], 4000);
        return;
      case 'not_configured':
        render(
          [
            header('⚙', 'warn', 'SolveSync isn’t connected yet', 'Queued. Sign in with Google and choose your sheet to sync it.'),
            el('div', { class: 'btns' }, el('button', { class: 'b', onclick: () => send({ type: 'OPEN_OPTIONS' }) }, 'Set up'))
          ],
          15000
        );
        return;
      case 'queued':
        render(
          [
            header('🕒', 'warn', `${record.problem} saved`, res.error ? `Will retry sync: ${res.error}` : 'Offline — will sync automatically.'),
            ...(res.askApproach ? approachBox(res.key, record.url) : [])
          ],
          res.askApproach ? 20000 : 6000
        );
        return;
      default:
        render(
          [header('✅', 'ok', `${record.problem} recorded`, `${record.platform} · ${record.difficulty || 'Accepted'}`), ...(res.askApproach ? approachBox(res.key, record.url) : [])],
          res.askApproach ? 20000 : 4000
        );
    }
  }

  /** A small floating "Sync to Sheet" button (shadow DOM, so site CSS can't affect it). Returns { remove() }. */
  function floatingButton(label, onClick) {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:20px;bottom:20px;z-index:2147483646;';
    const root = host.attachShadow({ mode: 'closed' });
    const b = el('button', { title: 'Send this problem to your Google Sheet (SolveSync)' }, label);
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await onClick();
      } finally {
        b.disabled = false;
      }
    });
    root.append(
      el(
        'style',
        {},
        `button { all: unset; box-sizing: border-box; cursor: pointer; padding: 8px 14px; border-radius: 999px;
          background: #4f46e5; color: #fff; font: 600 13px/1.2 -apple-system, "Segoe UI", Roboto, sans-serif;
          box-shadow: 0 2px 10px rgba(0,0,0,.4); white-space: nowrap; }
         button:hover { background: #4338ca; } button[disabled] { opacity: .6; cursor: default; }`
      ),
      b
    );
    document.documentElement.append(host);
    return { remove: () => host.remove() };
  }

  window.SolveSync = { now, report, notice, send, floatingButton };
})();
