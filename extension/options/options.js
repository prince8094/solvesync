const $ = (id) => document.getElementById(id);
const DEFAULTS = { sheetId: '', sheetTitle: '', sheetUrl: '', askApproach: true, notify: false };
const ask = (m) => chrome.runtime.sendMessage(m);

// The ID that manifest.json's "key" produces. If the extension shows a different ID, the key isn't in effect.
const PINNED_EXTENSION_ID = 'piciopmfaoeheehnlnoomkgfdbcgoijb';

let browserName = ''; // 'Brave' | 'Edge' | 'Opera' | 'Vivaldi' | '' (Chrome or unknown)
let webPreferred = false; // true => use the browser-independent sign-in

function say(id, text, ok) {
  const n = $(id);
  n.textContent = text;
  n.className = 'result' + (id !== 'authStatus' ? ' block' : '') + (text ? (ok ? ' ok' : ' err') : '');
}

/** Chrome's built-in Google sign-in does not exist in these browsers. */
async function detectBrowser() {
  try {
    if (navigator.brave && typeof navigator.brave.isBrave === 'function' && (await navigator.brave.isBrave())) return 'Brave';
  } catch (_) {}
  const ua = navigator.userAgent || '';
  if (/\bEdg\//.test(ua)) return 'Edge';
  if (/\bOPR\//.test(ua)) return 'Opera';
  if (/Vivaldi/i.test(ua)) return 'Vivaldi';
  return '';
}

function showDiagnostics(auth) {
  if (!auth) return;
  $('diagExt').textContent = auth.extensionId || '(unknown)';
  $('diagClient').textContent = auth.clientId || '(none)';
  $('diagRedirect').textContent = auth.redirectUri || '(unavailable in this browser)';
  $('diagWeb').textContent = auth.webConfigured ? 'yes' : 'no — add WEB_CLIENT_ID (docs/GOOGLE_SETUP.md, section 7)';
  $('diagMode').textContent =
    auth.mode === 'web' ? 'browser-independent sign-in' : webPreferred ? 'browser-independent sign-in (will be used on next sign-in)' : 'Chrome built-in sign-in';
  const note = $('diagExtNote');
  if (auth.extensionId && auth.extensionId !== PINNED_EXTENSION_ID) {
    note.hidden = false;
    note.textContent = `⚠ This is not the development ID (${PINNED_EXTENSION_ID}). That is only fine if your OAuth client's Item ID is exactly the ID above; otherwise the "key" line in manifest.json is missing or was changed.`;
  } else {
    note.hidden = true;
  }
}

async function refresh() {
  const [auth, s] = await Promise.all([ask({ type: 'AUTH_STATUS' }), chrome.storage.sync.get(DEFAULTS)]);
  const signedIn = !!(auth && auth.signedIn);
  webPreferred = !!browserName || !!(auth && auth.mode === 'web');
  showDiagnostics(auth);

  $('braveNote').hidden = !browserName;
  if (browserName) $('braveNote').textContent = `${browserName} detected — SolveSync will use the browser-independent Google sign-in.`;

  $('devWarn').hidden = webPreferred || !(auth && auth.devSetupNeeded);
  $('webWarn').hidden = !(webPreferred && auth && auth.webConfigured === false);

  $('signin').hidden = signedIn;
  $('signinAlt').hidden = signedIn || webPreferred;
  $('signout').hidden = !signedIn;
  say('authStatus', signedIn ? '✅ Signed in' : '', true);

  $('connected').hidden = !s.sheetId;
  if (s.sheetId) {
    $('connectedTitle').textContent = s.sheetTitle || 'your sheet';
    $('connectedLink').href = s.sheetUrl || '#';
  }
  $('askApproach').checked = s.askApproach;
  $('notify').checked = s.notify;
}

async function busy(btn, label, fn) {
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  try {
    await fn();
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

async function doSignIn(method) {
  const r = await ask({ type: 'AUTH_SIGNIN', method });
  await refresh(); // first, so it can't wipe the error message below
  if (!r || !r.ok) {
    say('authStatus', '❌ ' + ((r && r.error) || 'Sign-in failed'), false);
    $('diag').open = true; // show the checklist right where the error happened
  }
}

$('signin').addEventListener('click', () => busy($('signin'), 'Opening Google…', () => doSignIn(webPreferred ? 'web' : 'chrome')));
$('signinAlt').addEventListener('click', () => busy($('signinAlt'), 'Opening Google…', () => doSignIn('web')));

$('signout').addEventListener('click', () =>
  busy($('signout'), 'Disconnecting…', async () => {
    await ask({ type: 'AUTH_SIGNOUT' });
    await refresh();
  })
);

$('connect').addEventListener('click', () =>
  busy($('connect'), 'Connecting…', async () => {
    const url = $('sheetLink').value.trim();
    if (!url) return say('sheetResult', 'Paste your Google Sheets link (or spreadsheet ID) first.', false);
    const r = await ask({ type: 'CONNECT_SHEET', url });
    if (r && r.ok) {
      say('sheetResult', `✅ Connected to “${r.title}”. Solve a problem and it will appear in the DSA Tracker tab.`, true);
      $('sheetLink').value = '';
    } else {
      say('sheetResult', '❌ ' + ((r && r.error) || 'Could not connect'), false);
    }
    await refresh();
  })
);

$('create').addEventListener('click', () =>
  busy($('create'), 'Creating…', async () => {
    const r = await ask({ type: 'CREATE_SHEET' });
    if (r && r.ok) say('sheetResult', `✅ Created “${r.title}” in your Google Drive and connected it.`, true);
    else say('sheetResult', '❌ ' + ((r && r.error) || 'Could not create the sheet'), false);
    await refresh();
  })
);

function copyButton(btnId, sourceId) {
  $(btnId).addEventListener('click', async () => {
    const btn = $(btnId);
    try {
      await navigator.clipboard.writeText($(sourceId).textContent);
      btn.textContent = 'Copied ✓';
    } catch (_) {
      btn.textContent = 'Select & copy';
    }
    setTimeout(() => (btn.textContent = 'Copy'), 1500);
  });
}
copyButton('copyExt', 'diagExt');
copyButton('copyRedirect', 'diagRedirect');

for (const id of ['askApproach', 'notify']) {
  $(id).addEventListener('change', async () => {
    await chrome.storage.sync.set({ [id]: $(id).checked });
    say('prefResult', 'Saved ✓', true);
    setTimeout(() => say('prefResult', '', true), 1500);
  });
}

(async () => {
  browserName = await detectBrowser();
  await refresh();
})();
