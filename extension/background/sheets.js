/**
 * SolveSync — Google Sheets client (loaded into the service worker with importScripts).
 *
 * Talks to the Sheets REST API directly using the signed-in user's OAuth token
 * (chrome.identity). There is no server and no Apps Script.
 *
 * Sheet layout (tab "DSA Tracker"):
 *   A Date | B Platform | C Problem | D Link | E Topics | F Approach | G Difficulty
 * A problem is identified by its Link (column D), so the same problem is never added twice.
 */

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const TAB_NAME = 'DSA Tracker';
const HEADERS = ['Date', 'Platform', 'Problem', 'Link', 'Topics', 'Approach', 'Difficulty'];

/** `config` = the user has to fix something (sign in, sharing, link); retrying won't help. */
class ApiError extends Error {
  constructor(message, config = false) {
    super(message);
    this.config = config;
  }
}

// ---------------------------------------------------------------- auth
/*
 * Two sign-in methods; both end up as a plain OAuth access token for the Sheets scope.
 *
 *  'chrome'  chrome.identity.getAuthToken. Google Chrome only (it needs Chrome's built-in Google
 *            sign-in). Uses the "Chrome Extension" OAuth client from manifest.json.
 *  'web'     chrome.identity.launchWebAuthFlow. Works in Brave, Edge, Opera, Vivaldi and Chrome.
 *            Uses a "Web application" OAuth client (WEB_CLIENT_ID in config.js) whose redirect URI is
 *            chrome.identity.getRedirectURL(). Tokens last about an hour and are renewed silently when
 *            Google still has a session; otherwise the user signs in again from Settings.
 *
 * The method in use is remembered in chrome.storage.local ("authMode").
 */
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const WEB_NOT_CONFIGURED =
  'This build has no Web OAuth client ID yet (needed for Brave, Edge, Opera and Vivaldi). See docs/GOOGLE_SETUP.md, section 7.';
const WEB_EXPIRED = 'Google sign-in expired. Open SolveSync settings and sign in again.';

async function getAuthMode() {
  const { authMode } = await chrome.storage.local.get({ authMode: 'chrome' });
  return authMode === 'web' ? 'web' : 'chrome';
}

// ---- method 1: Chrome's built-in sign-in
function chromeToken(interactive) {
  return new Promise((resolve, reject) => {
    const fail = (m) => reject(new ApiError(m, true));
    try {
      chrome.identity.getAuthToken({ interactive }, (res) => {
        const err = chrome.runtime.lastError;
        const token = res && typeof res === 'object' ? res.token : res;
        if (err || !token) {
          fail(
            interactive
              ? (err && err.message) || 'Google sign-in was cancelled.'
              : 'Not signed in to Google. Open SolveSync settings and sign in.'
          );
        } else resolve(token);
      });
    } catch (e) {
      fail('Google sign-in is unavailable: ' + e.message);
    }
  });
}

// ---- method 2: browser-independent OAuth (implicit flow in an auth window)
function launchFlow(url, interactive) {
  return new Promise((resolve, reject) => {
    const fail = (m) => reject(new ApiError(m, true));
    try {
      chrome.identity.launchWebAuthFlow({ url, interactive }, (resp) => {
        const err = chrome.runtime.lastError;
        if (err || !resp) {
          fail(interactive ? (err && err.message) || 'Sign-in was cancelled.' : WEB_EXPIRED);
        } else resolve(resp);
      });
    } catch (e) {
      fail('Google sign-in is unavailable: ' + e.message);
    }
  });
}

let webSilent = null; // one shared silent renewal at a time
async function webToken(interactive) {
  const { webToken: cached } = await chrome.storage.local.get('webToken');
  if (cached && cached.token && cached.exp > Date.now()) return cached.token;
  if (!WEB_CLIENT_ID) throw new ApiError(WEB_NOT_CONFIGURED, true);
  if (!interactive && webSilent) return webSilent;

  const run = async () => {
    const state = crypto.randomUUID();
    const params = new URLSearchParams({
      client_id: WEB_CLIENT_ID,
      response_type: 'token',
      redirect_uri: chrome.identity.getRedirectURL(),
      scope: SHEETS_SCOPE,
      state,
      prompt: interactive ? 'select_account' : 'none'
    });
    const resp = await launchFlow('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString(), interactive);
    const q = new URLSearchParams(new URL(resp).hash.replace(/^#/, ''));

    const error = q.get('error');
    if (error) {
      throw new ApiError(
        interactive
          ? error === 'access_denied'
            ? 'Sign-in was cancelled or access was denied.'
            : `Google returned "${error}". Check the OAuth client and redirect URI (see Settings → Having trouble signing in?).`
          : WEB_EXPIRED,
        true
      );
    }
    if (q.get('state') !== state) throw new ApiError('Sign-in response did not match the request. Please try again.', true);
    const token = q.get('access_token');
    if (!token) throw new ApiError('Google did not return an access token.', true);

    const ttl = Number(q.get('expires_in')) || 3600;
    await chrome.storage.local.set({ webToken: { token, exp: Date.now() + ttl * 1000 - 120000 } });
    return token;
  };

  if (interactive) return run();
  webSilent = run().finally(() => {
    webSilent = null;
  });
  return webSilent;
}

// ---- public auth API used by the rest of the extension
async function rawToken(interactive) {
  return (await getAuthMode()) === 'web' ? webToken(interactive) : chromeToken(interactive);
}

async function removeToken(token) {
  if ((await getAuthMode()) === 'web') {
    await chrome.storage.local.remove('webToken');
    return;
  }
  await new Promise((r) => chrome.identity.removeCachedAuthToken({ token }, () => r()));
}

/** Interactive sign-in. method: 'chrome' | 'web'. The method is remembered only if sign-in succeeds. */
async function signIn(method) {
  if (method === 'web') {
    await chrome.storage.local.remove('webToken'); // explicit sign-in: always show Google's account picker
    await webToken(true);
    await chrome.storage.local.set({ authMode: 'web' });
  } else {
    await chromeToken(true);
    await chrome.storage.local.set({ authMode: 'chrome' });
    await chrome.storage.local.remove('webToken');
  }
}

async function signOut() {
  const mode = await getAuthMode();
  let token = '';
  if (mode === 'web') {
    const { webToken: cached } = await chrome.storage.local.get('webToken');
    token = (cached && cached.token) || '';
    await chrome.storage.local.remove('webToken');
  } else {
    try {
      token = await chromeToken(false);
    } catch (_) {
      return;
    }
    await new Promise((r) => chrome.identity.removeCachedAuthToken({ token }, () => r()));
  }
  if (!token) return;
  try {
    await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(token), { method: 'POST' });
  } catch (_) {
    /* best effort */
  }
}

// ---------------------------------------------------------------- low-level request
async function api(method, path, { query, body, interactive = false } = {}) {
  let token = await rawToken(interactive);
  const qs = query ? '?' + new URLSearchParams(query).toString() : '';
  const url = SHEETS_API + path + qs;

  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (e) {
      throw new Error('Network error: ' + e.message); // retryable
    }

    if (res.status === 401 && attempt === 0) {
      await removeToken(token); // stale token: get a fresh one and try once more
      token = await rawToken(interactive);
      continue;
    }

    const json = await res.json().catch(() => ({}));
    if (res.ok) return json;

    const msg = (json.error && json.error.message) || 'HTTP ' + res.status;
    if (res.status === 401) throw new ApiError('Google sign-in expired. Open SolveSync settings and sign in again.', true);
    if (res.status === 403) {
      if (/has not been used|is disabled|not enabled/i.test(msg)) {
        throw new ApiError('The Google Sheets API is not enabled for this extension’s Google Cloud project (developer setup).', true);
      }
      throw new ApiError('No edit access to this sheet. Sign in with an account that can edit it, or ask the owner to share it with you as Editor.', true);
    }
    if (res.status === 404) throw new ApiError('Spreadsheet not found. Check the link.', true);
    if (res.status === 429 || res.status >= 500) throw new Error('Google is busy (' + res.status + ') — will retry.'); // retryable
    const e = new ApiError(msg, false);
    e.badRange = /unable to parse range|not found/i.test(msg);
    throw e;
  }
}

const rangePath = (id, a1) => `/${id}/values/${encodeURIComponent(`'${TAB_NAME}'!${a1}`)}`;

/** Stops text like "=IMPORTXML(...)" from being executed as a formula. */
function cell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/** Accepts a full Google Sheets URL (any variant) or the bare spreadsheet ID. Returns '' if neither. */
function parseSheetId(text) {
  const s = String(text || '').trim();
  const m = /\/spreadsheets\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]{20,})/.exec(s);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : ''; // real IDs are ~44 chars
}

// ---------------------------------------------------------------- setup
async function ensureHeader(id, tabId, interactive) {
  const cur = await api('GET', rangePath(id, 'A1:G1'), { interactive });
  if (cur.values && cur.values[0] && cur.values[0].some(Boolean)) return; // user already has headers

  await api('PUT', rangePath(id, 'A1:G1'), { query: { valueInputOption: 'RAW' }, body: { values: [HEADERS] }, interactive });

  const width = (i, px) => ({
    updateDimensionProperties: {
      range: { sheetId: tabId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
      properties: { pixelSize: px },
      fields: 'pixelSize'
    }
  });
  await api('POST', `/${id}:batchUpdate`, {
    interactive,
    body: {
      requests: [
        {
          repeatCell: {
            range: { sheetId: tabId, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.12, green: 0.16, blue: 0.22 },
                textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)'
          }
        },
        { updateSheetProperties: { properties: { sheetId: tabId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
        width(2, 280), width(3, 260), width(4, 220), width(5, 360)
      ]
    }
  });
}

/** Verifies access, makes sure the "DSA Tracker" tab + header exist. */
async function connectSheet(id, interactive = false) {
  const meta = await api('GET', `/${id}`, {
    query: { fields: 'properties.title,sheets.properties(sheetId,title)' },
    interactive
  });
  let tab = (meta.sheets || []).find((s) => s.properties.title === TAB_NAME);
  if (!tab) {
    const r = await api('POST', `/${id}:batchUpdate`, {
      interactive,
      body: { requests: [{ addSheet: { properties: { title: TAB_NAME } } }] }
    });
    tab = { properties: r.replies[0].addSheet.properties };
  }
  await ensureHeader(id, tab.properties.sheetId, interactive);
  return { id, title: meta.properties.title, url: `https://docs.google.com/spreadsheets/d/${id}/edit` };
}

async function createSheet() {
  const r = await api('POST', '', {
    interactive: true,
    body: { properties: { title: 'SolveSync — DSA Tracker' }, sheets: [{ properties: { title: TAB_NAME } }] }
  });
  await ensureHeader(r.spreadsheetId, r.sheets[0].properties.sheetId, true);
  return { id: r.spreadsheetId, title: r.properties.title, url: `https://docs.google.com/spreadsheets/d/${r.spreadsheetId}/edit` };
}

// ---------------------------------------------------------------- data
let sheetChain = Promise.resolve();
/** Sheet writes run one at a time so the "already there?" check can't race an append. */
function serial(fn) {
  const p = sheetChain.then(fn, fn);
  sheetChain = p.catch(() => {});
  return p;
}

async function readLinks(id) {
  const r = await api('GET', rangePath(id, 'D2:D'));
  return (r.values || []).map((v) => String((v && v[0]) || '').trim());
}

function appendRecord(id, rec) {
  return serial(async () => {
    const run = async () => {
      const links = await readLinks(id);
      if (links.includes(rec.url)) return { duplicate: true };
      const row = [rec.date, rec.platform, rec.problem, rec.url, (rec.topics || []).join(', '), rec.approach || '', rec.difficulty || ''].map(cell);
      const r = await api('POST', rangePath(id, 'A:G') + ':append', {
        query: { valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS' },
        body: { values: [row] }
      });
      const m = /!A(\d+):/.exec((r.updates && r.updates.updatedRange) || '');
      return { row: m ? Number(m[1]) : 0 };
    };
    try {
      return await run();
    } catch (e) {
      if (e.badRange) {
        await connectSheet(id, false); // the tab was deleted or renamed: recreate it, retry once
        return run();
      }
      throw e;
    }
  });
}

function setApproach(id, url, approach) {
  return serial(async () => {
    const links = await readLinks(id);
    const idx = links.lastIndexOf(url);
    if (idx === -1) throw new ApiError('That problem is not in the sheet yet.', false);
    await api('PUT', rangePath(id, `F${idx + 2}`), {
      query: { valueInputOption: 'USER_ENTERED' },
      body: { values: [[cell(String(approach).slice(0, 500))]] }
    });
    return { row: idx + 2 };
  });
}

async function fetchRows(id) {
  const r = await api('GET', rangePath(id, 'A2:G'));
  return (r.values || []).map((v) => ({
    d: String(v[0] || ''),
    p: String(v[1] || ''),
    t: String(v[2] || ''),
    tp: String(v[4] || ''),
    df: String(v[6] || '')
  }));
}
