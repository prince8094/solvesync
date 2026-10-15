const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ---------------------------------------------------------------- stats helpers
const distinct = (items) => {
  const seen = new Set();
  return items.filter((h) => {
    const k = `${h.p}|${h.t}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

function computeStreak(history) {
  const days = new Set(history.map((h) => h.d));
  const cur = new Date();
  if (!days.has(fmtDate(cur))) cur.setDate(cur.getDate() - 1); // today not solved yet: streak can still be alive
  let n = 0;
  while (days.has(fmtDate(cur))) {
    n++;
    cur.setDate(cur.getDate() - 1);
  }
  return n;
}

function bars(container, rows, cssByName) {
  container.replaceChildren();
  const max = Math.max(0, ...rows.map(([, v]) => v));
  if (!rows.length || max === 0) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = 'Nothing yet — go solve something!';
    container.append(e);
    return;
  }
  for (const [name, count] of rows) {
    const row = document.createElement('div');
    row.className = 'bar';
    const n = document.createElement('span');
    n.className = 'name';
    n.textContent = name;
    n.title = name;
    const track = document.createElement('div');
    track.className = 'track';
    const fill = document.createElement('div');
    fill.className = 'fill' + (cssByName ? ' ' + name : '');
    fill.style.width = `${Math.max(4, Math.round((count / max) * 100))}%`;
    track.append(fill);
    const c = document.createElement('span');
    c.className = 'count';
    c.textContent = count;
    row.append(n, track, c);
    container.append(row);
  }
}

function weekChart(history) {
  const box = $('week');
  box.replaceChildren();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({ key: fmtDate(d), label: 'SMTWTFS'[d.getDay()], isToday: i === 0 });
  }
  const counts = days.map((d) => distinct(history.filter((h) => h.d === d.key)).length);
  const max = Math.max(1, ...counts);
  days.forEach((d, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'day';
    wrap.title = `${d.key}: ${counts[i]} solved`;
    const num = document.createElement('b');
    num.textContent = counts[i] || '';
    const col = document.createElement('div');
    col.className = 'col';
    const fill = document.createElement('div');
    fill.style.height = counts[i] ? `${Math.max(12, Math.round((counts[i] / max) * 100))}%` : '0';
    if (d.isToday) fill.className = 'today';
    col.append(fill);
    const lab = document.createElement('span');
    lab.textContent = d.label;
    wrap.append(num, col, lab);
    box.append(wrap);
  });
}

const ago = (ts) => {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

// ---------------------------------------------------------------- dashboard
async function render() {
  const settings = await chrome.storage.sync.get({ sheetId: '', sheetUrl: '' });
  const { history = [], queue = [], lastSync = 0, lastError = '' } = await chrome.storage.local.get([
    'history', 'queue', 'lastSync', 'lastError'
  ]);

  const badge = $('badge');
  const notice = $('notice');
  notice.hidden = true;
  notice.className = 'notice';
  if (!settings.sheetId) {
    badge.textContent = 'Not connected';
    badge.className = 'badge warn';
    notice.hidden = false;
    notice.textContent = 'Open Settings, sign in with Google and choose your sheet to start syncing.';
  } else if (lastError) {
    badge.textContent = 'Sync issue';
    badge.className = 'badge err';
    notice.hidden = false;
    notice.className = 'notice err';
    notice.textContent = lastError + (queue.length ? ` (${queue.length} waiting to sync)` : '');
  } else {
    badge.textContent = lastSync ? `Connected · ${ago(lastSync)}` : 'Connected';
    badge.className = 'badge ok';
    if (queue.length) {
      notice.hidden = false;
      notice.textContent = `${queue.length} problem(s) waiting to sync — retrying automatically.`;
    }
  }

  const today = fmtDate(new Date());
  const month = today.slice(0, 7);
  const all = distinct(history);
  $('today').textContent = distinct(history.filter((h) => h.d === today)).length;
  $('month').textContent = distinct(history.filter((h) => (h.d || '').startsWith(month))).length;
  $('streak').textContent = computeStreak(history);
  $('total').textContent = all.length;

  weekChart(history);

  const diff = { Easy: 0, Medium: 0, Hard: 0, Other: 0 };
  for (const h of all) diff[h.df in diff && h.df !== 'Other' ? h.df : 'Other']++;
  bars($('difficulty'), Object.entries(diff).filter(([k, v]) => v > 0 || k !== 'Other'), true);

  const plat = {};
  for (const h of all) plat[h.p || 'Other'] = (plat[h.p || 'Other'] || 0) + 1;
  bars($('platforms'), Object.entries(plat).sort((a, b) => b[1] - a[1]).slice(0, 6), false);

  const topics = {};
  for (const h of all) for (const t of h.tp || []) topics[t] = (topics[t] || 0) + 1;
  bars($('topics'), Object.entries(topics).sort((a, b) => b[1] - a[1]).slice(0, 5), false);

  const last = history[history.length - 1];
  const lastEl = $('last');
  lastEl.replaceChildren();
  if (last) {
    const t = document.createElement('div');
    t.textContent = last.t;
    const m = document.createElement('div');
    m.className = 'meta';
    m.textContent = [last.p, last.df, last.d].filter(Boolean).join(' · ');
    lastEl.append(t, m);
  } else {
    lastEl.textContent = '—';
  }

  $('openSheet').disabled = !settings.sheetUrl;
  $('openSheet').title = settings.sheetUrl ? '' : 'Connect a sheet in Settings first';
}

$('openSheet').addEventListener('click', async () => {
  const { sheetUrl } = await chrome.storage.sync.get({ sheetUrl: '' });
  if (sheetUrl) chrome.tabs.create({ url: sheetUrl });
});
$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('refresh').addEventListener('click', async () => {
  const btn = $('refresh');
  btn.disabled = true;
  btn.textContent = '…';
  await chrome.runtime.sendMessage({ type: 'FLUSH' });
  const r = await chrome.runtime.sendMessage({ type: 'REFRESH_STATS' });
  if (!r || !r.ok) await chrome.storage.local.set({ lastError: (r && r.error) || 'Could not refresh stats.' });
  btn.textContent = '↻';
  btn.disabled = false;
  render();
});

// ---------------------------------------------------------------- add any problem
const PLATFORMS = {
  'leetcode.com': 'LeetCode', 'geeksforgeeks.org': 'GeeksforGeeks', 'codeforces.com': 'Codeforces', 'atcoder.jp': 'AtCoder',
  'hackerearth.com': 'HackerEarth', 'hackerrank.com': 'HackerRank', 'codechef.com': 'CodeChef', 'spoj.com': 'SPOJ',
  'interviewbit.com': 'InterviewBit', 'codingninjas.com': 'Coding Ninjas', 'naukri.com': 'Coding Ninjas', 'cses.fi': 'CSES',
  'codewars.com': 'Codewars', 'exercism.org': 'Exercism', 'projecteuler.net': 'Project Euler', 'kattis.com': 'Kattis'
};

function platformFor(hostname) {
  const h = hostname.replace(/^www\./, '');
  const hit = Object.keys(PLATFORMS).find((d) => h === d || h.endsWith('.' + d));
  if (hit) return PLATFORMS[hit];
  const parts = h.split('.');
  const base = parts.length > 1 ? parts[parts.length - 2] : h;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function cleanTitle(t) {
  return String(t || '')
    .replace(/\s*[|\-–—]\s*(LeetCode|GeeksforGeeks|HackerEarth|HackerRank|AtCoder|Codeforces|CodeChef|Coding Ninjas|InterviewBit|SPOJ|CSES)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanUrl(u) {
  try {
    const url = new URL(u);
    url.hash = '';
    for (const k of [...url.searchParams.keys()]) if (/^utm_/i.test(k)) url.searchParams.delete(k);
    return url.toString();
  } catch (_) {
    return u;
  }
}

function showView(which) {
  $('viewMain').hidden = which !== 'main';
  $('viewAdd').hidden = which !== 'add';
}

function setAddResult(text, kind) {
  const n = $('addResult');
  n.textContent = text;
  n.className = 'addResult' + (kind ? ' ' + kind : '');
}

$('addBtn').addEventListener('click', async () => {
  setAddResult('', '');
  $('fApproach').value = '';
  $('fTopics').value = '';
  $('fDifficulty').value = '';
  $('addSave').disabled = false;
  showView('add');

  let tab = null;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (_) {}
  const url = tab && /^https?:/i.test(tab.url || '') ? tab.url : '';
  if (!url) {
    $('fProblem').value = '';
    $('fLink').value = '';
    $('fPlatform').value = '';
    setAddResult('Open a problem page in this window first (or fill the fields in by hand).', 'warn');
    return;
  }
  $('fProblem').value = cleanTitle(tab.title);
  $('fLink').value = cleanUrl(url);
  $('fPlatform').value = platformFor(new URL(url).hostname);
});

$('addCancel').addEventListener('click', () => showView('main'));

$('addSave').addEventListener('click', async () => {
  const problem = $('fProblem').value.trim();
  const link = $('fLink').value.trim();
  const platform = $('fPlatform').value.trim();
  if (!problem || !/^https?:\/\//i.test(link) || !platform) {
    return setAddResult('Problem, link (http…) and platform are required.', 'err');
  }
  const now = new Date();
  const record = {
    platform,
    problem,
    url: cleanUrl(link),
    difficulty: $('fDifficulty').value.trim(),
    topics: $('fTopics').value.split(',').map((s) => s.trim()).filter(Boolean),
    approach: $('fApproach').value.trim(),
    date: fmtDate(now),
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`
  };
  $('addSave').disabled = true;
  setAddResult('Saving…', '');
  const r = await chrome.runtime.sendMessage({ type: 'MANUAL_ADD', record });

  if (!r || !r.ok) {
    $('addSave').disabled = false;
    return setAddResult(((r && r.error) || 'Could not save.'), 'err');
  }
  const msg = {
    saved: ['✅ Added to your sheet.', 'ok'],
    duplicate_in_sheet: ['✓ That problem is already in your sheet.', 'ok'],
    queued: ['🕒 Saved — will sync as soon as Google is reachable.', 'warn'],
    not_configured: ['⚙ Queued. Connect your sheet in Settings to send it.', 'warn']
  }[r.status] || ['Done.', 'ok'];
  setAddResult(msg[0], msg[1]);
  setTimeout(() => {
    showView('main');
    render();
  }, 1300);
});

render();
chrome.storage.onChanged.addListener(render);
