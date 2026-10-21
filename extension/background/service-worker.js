/**
 * SolveSync — background service worker (Manifest V3).
 *
 * - receives records from content scripts / the popup
 * - de-duplicates, keeps a local history for the dashboard
 * - writes rows to the user's Google Sheet (see sheets.js)
 * - if that fails (offline, not signed in) keeps the record in a queue and retries every minute
 */
importScripts('config.js', 'sheets.js');

const DEFAULTS = { sheetId: '', sheetTitle: '', sheetUrl: '', askApproach: true, notify: false };
const HISTORY_CAP = 3000;
const SEEN_CAP = 1000;
const QUEUE_CAP = 500;
const MAX_ATTEMPTS = 5;
const ALARM = 'solvesync-flush';

// ---------------------------------------------------------------- storage
let chain = Promise.resolve();
/** Serialise read-modify-write cycles on chrome.storage.local. `fn` mutates `data` in place. */
function mutate(keys, fn) {
  const run = async () => {
    const data = await chrome.storage.local.get(keys);
    const out = await fn(data);
    await chrome.storage.local.set(data);
    return out;
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

const getSettings = () => chrome.storage.sync.get(DEFAULTS);
const markSync = () => chrome.storage.local.set({ lastSync: Date.now(), lastError: '' });
const setError = (msg) => chrome.storage.local.set({ lastError: msg });

// ---------------------------------------------------------------- queue
async function enqueue(item) {
  await mutate(['queue'], (d) => {
    d.queue = d.queue || [];
    d.queue.push({ id: crypto.randomUUID(), attempts: 0, ...item });
    if (d.queue.length > QUEUE_CAP) d.queue.splice(0, d.queue.length - QUEUE_CAP);
  });
}

let flushPromise = null;
/** Concurrent callers share one in-flight flush and all wait for it to finish. */
function flushQueue() {
  if (!flushPromise) {
    flushPromise = doFlush().finally(() => {
      flushPromise = null;
    });
  }
  return flushPromise;
}

async function doFlush() {
  const settings = await getSettings();
  if (!settings.sheetId) return;

  for (;;) {
    const { queue = [] } = await chrome.storage.local.get('queue');
    if (!queue.length) break;
    const item = queue[0];
    try {
      if (item.type === 'append') await appendRecord(settings.sheetId, item.record);
      else await setApproach(settings.sheetId, item.url, item.approach);
      await mutate(['queue'], (d) => {
        d.queue = (d.queue || []).filter((q) => q.id !== item.id);
      });
      await markSync();
    } catch (e) {
      await setError(e.message);
      // A rejected (non-config) request is retried a few times, then dropped
      // so one poison item can never block everything behind it.
      if (e instanceof ApiError && !e.config) {
        const attempts = (item.attempts || 0) + 1;
        await mutate(['queue'], (d) => {
          d.queue = (d.queue || []).flatMap((q) =>
            q.id !== item.id ? [q] : attempts >= MAX_ATTEMPTS ? [] : [{ ...q, attempts }]
          );
        });
        if (attempts >= MAX_ATTEMPTS) continue;
      }
      break;
    }
  }
}

// ---------------------------------------------------------------- difficulty enrichment
async function cachedLookup(cacheKey, id, loader) {
  const store = (await chrome.storage.local.get(cacheKey))[cacheKey] || {};
  if (store[id]) return store[id];
  let info = null;
  try {
    info = await loader();
  } catch (_) {
    /* optional data */
  }
  if (info) {
    await mutate([cacheKey], (d) => {
      d[cacheKey] = d[cacheKey] || {};
      d[cacheKey][id] = info;
      const keys = Object.keys(d[cacheKey]);
      if (keys.length > 500) delete d[cacheKey][keys[0]];
    });
  }
  return info;
}

async function fetchJson(url, ms = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await (await fetch(url, { signal: ctrl.signal })).json();
  } finally {
    clearTimeout(t);
  }
}

async function enrich(record) {
  if (record.platform === 'Codeforces' && record.contestId && !record.gym) {
    const info = await cachedLookup('cfCache', `${record.contestId}${record.index}`, async () => {
      const json = await fetchJson('https://codeforces.com/api/problemset.problems');
      const p = json.result.problems.find((x) => String(x.contestId) === String(record.contestId) && x.index === record.index);
      return p ? { rating: p.rating || null, tags: p.tags || [] } : null;
    });
    if (info) return { ...record, difficulty: info.rating ? String(info.rating) : record.difficulty, topics: info.tags };
  }

  if (record.platform === 'AtCoder' && record.taskId) {
    // Community-estimated difficulty from AtCoder Problems (kenkoooo.com).
    const info = await cachedLookup('acCache', record.taskId, async () => {
      const models = await fetchJson('https://kenkoooo.com/atcoder/resources/problem-models.json', 30000);
      const m = models[record.taskId];
      if (!m || typeof m.difficulty !== 'number') return null;
      const d = m.difficulty;
      return { rating: Math.round(d >= 400 ? d : 400 / Math.exp(1.0 - d / 400)) };
    });
    if (info) return { ...record, difficulty: String(info.rating) };
  }
  return record;
}

// ---------------------------------------------------------------- handlers
async function handleRecord(raw) {
  if (!raw || !raw.platform || !raw.submissionId || !raw.problem || !raw.url) {
    return { ok: false, error: 'Malformed record.' };
  }
  const settings = await getSettings();
  const key = `${raw.platform}:${raw.submissionId}`.toLowerCase();
  const record = await enrich({ ...raw, key });

  const fresh = await mutate(['seen', 'history'], (d) => {
    d.seen = d.seen || [];
    d.history = d.history || [];
    if (d.seen.includes(key)) return false;
    d.seen.push(key);
    if (d.seen.length > SEEN_CAP) d.seen.splice(0, d.seen.length - SEEN_CAP);
    d.history.push({ k: key, d: record.date, p: record.platform, t: record.problem, df: record.difficulty || '', tp: record.topics || [] });
    if (d.history.length > HISTORY_CAP) d.history.splice(0, d.history.length - HISTORY_CAP);
    return true;
  });
  if (!fresh) return { ok: true, status: 'duplicate' };

  if (!settings.sheetId) {
    await enqueue({ type: 'append', record });
    return { ok: true, status: 'not_configured', key };
  }

  try {
    const res = await appendRecord(settings.sheetId, record);
    await markSync();
    if (res.duplicate) return { ok: true, status: 'duplicate_in_sheet', key };
    if (settings.notify) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: 'SolveSync',
        message: `${record.problem} recorded ✓`
      });
    }
    return { ok: true, status: 'saved', key, askApproach: settings.askApproach };
  } catch (e) {
    await setError(e.message);
    await enqueue({ type: 'append', record });
    return { ok: true, status: 'queued', key, askApproach: settings.askApproach, error: e.message };
  }
}

async function handleApproach({ key, url, approach }) {
  if (!key || !url || typeof approach !== 'string') return { ok: false, error: 'Malformed request.' };
  approach = approach.slice(0, 500);

  // Row not synced yet? Fold the approach into the queued append.
  const merged = await mutate(['queue'], (d) => {
    const it = (d.queue || []).find((q) => q.type === 'append' && q.record.key === key);
    if (it) it.record.approach = approach;
    return !!it;
  });
  if (merged) {
    flushQueue();
    return { ok: true, status: 'queued' };
  }

  try {
    const settings = await getSettings();
    if (!settings.sheetId) throw new ApiError('No sheet connected.', true);
    await setApproach(settings.sheetId, url, approach);
    return { ok: true, status: 'saved' };
  } catch (e) {
    await enqueue({ type: 'approach', key, url, approach });
    return { ok: true, status: 'queued', error: e.message };
  }
}

async function saveSheet(info) {
  await chrome.storage.sync.set({ sheetId: info.id, sheetTitle: info.title, sheetUrl: info.url });
  await chrome.storage.local.set({ lastError: '' });
  flushQueue(); // deliver anything solved before the sheet was connected
  return { ok: true, title: info.title, url: info.url };
}

async function refreshStats() {
  const settings = await getSettings();
  if (!settings.sheetId) throw new ApiError('No sheet connected.', true);
  const rows = await fetchRows(settings.sheetId);
  const history = rows.map((r, i) => ({
    k: `sheet:${i}`,
    d: r.d,
    p: r.p,
    t: r.t,
    df: r.df,
    tp: r.tp ? r.tp.split(',').map((s) => s.trim()).filter(Boolean) : []
  }));
  await mutate(['history'], (d) => {
    d.history = history.slice(-HISTORY_CAP);
  });
  await markSync();
  return { ok: true, count: history.length };
}

const devSetupNeeded = () => {
  const o = chrome.runtime.getManifest().oauth2;
  return !o || !o.client_id || /YOUR_CLIENT_ID/.test(o.client_id);
};

// ---------------------------------------------------------------- wiring
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg && msg.type) {
      case 'RECORD':
        return handleRecord(msg.record);
      case 'MANUAL_ADD':
        return handleRecord({ ...msg.record, submissionId: 'manual-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) });
      case 'APPROACH':
        return handleApproach(msg);
      case 'OPEN_OPTIONS':
        chrome.runtime.openOptionsPage();
        return { ok: true };

      case 'AUTH_STATUS': {
        let signedIn = false;
        try {
          await rawToken(false);
          signedIn = true;
        } catch (_) {}
        const oauth = chrome.runtime.getManifest().oauth2 || {};
        return {
          ok: true,
          signedIn,
          mode: await getAuthMode(),
          devSetupNeeded: devSetupNeeded(),
          webConfigured: !!WEB_CLIENT_ID,
          redirectUri: chrome.identity.getRedirectURL ? chrome.identity.getRedirectURL() : '',
          extensionId: chrome.runtime.id,
          clientId: oauth.client_id || ''
        };
      }
      case 'AUTH_SIGNIN': {
        // 'web' = browser-independent sign-in (Brave, Edge, Opera, Vivaldi, Chrome); default = Chrome's built-in one.
        const method = msg.method === 'web' ? 'web' : 'chrome';
        if (method === 'web' && !WEB_CLIENT_ID) return { ok: false, error: WEB_NOT_CONFIGURED };
        if (method === 'chrome' && devSetupNeeded()) return { ok: false, error: 'This build has no Google OAuth client ID yet. See docs/GOOGLE_SETUP.md.' };
        await signIn(method);
        return { ok: true };
      }
      case 'AUTH_SIGNOUT':
        await signOut();
        return { ok: true };

      case 'CONNECT_SHEET': {
        const id = parseSheetId(msg.url);
        if (!id) return { ok: false, error: 'That doesn’t look like a Google Sheets link or ID. Paste the full link from your browser’s address bar (it contains /spreadsheets/d/…).' };
        return saveSheet(await connectSheet(id, true));
      }
      case 'CREATE_SHEET':
        return saveSheet(await createSheet());

      case 'FLUSH':
        await flushQueue();
        return { ok: true };
      case 'REFRESH_STATS':
        return refreshStats();
      default:
        return { ok: false, error: 'Unknown message.' };
    }
  })()
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true; // async response
});

async function ensureAlarm() {
  const a = await chrome.alarms.get(ALARM);
  if (!a) chrome.alarms.create(ALARM, { periodInMinutes: 1 });
}
/**
 * Upgrade from the Apps Script version (v1.x): drop its settings and any queue items that
 * can't be replayed. Queued *appends* are kept (same record shape); queued approach notes
 * from v1 have no problem link, so they can't be matched to a row and are discarded.
 */
async function migrateFromAppsScript() {
  const old = await chrome.storage.sync.get(['scriptUrl', 'token']);
  const hadOld = 'scriptUrl' in old || 'token' in old;
  if (hadOld) await chrome.storage.sync.remove(['scriptUrl', 'token']);

  await mutate(['queue'], (d) => {
    if (!Array.isArray(d.queue)) return;
    d.queue = d.queue.filter((q) => (q.type === 'append' ? q.record && q.record.url : !!q.url));
  });
  if (hadOld) {
    await chrome.storage.local.set({ lastError: '' });
  }
  return hadOld;
}

chrome.runtime.onInstalled.addListener(async (details) => {
  ensureAlarm();
  let upgraded = false;
  try {
    upgraded = await migrateFromAppsScript();
  } catch (_) {
    /* migration is best-effort */
  }
  // Fresh installs and upgrades from the Apps Script version both need to sign in + pick a sheet.
  if (details.reason === 'install' || upgraded) chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  flushQueue();
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) flushQueue();
});
ensureAlarm();
