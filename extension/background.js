/**
 * Service worker: syncs the shared log + settings into chrome.storage.local on
 * a timer, and proxies add/update writes to the Apps Script API. Content scripts
 * read the cached log for instant, offline-ish dedup.
 */
importScripts('matcher.js');

var SYNC_MINUTES = 4;

chrome.runtime.onInstalled.addListener(function () {
  chrome.alarms.create('sync', { periodInMinutes: SYNC_MINUTES });
  ensureMe(); sync();
});
chrome.runtime.onStartup.addListener(function () { ensureMe(); sync(); });
chrome.alarms.onAlarm.addListener(function (a) { if (a.name === 'sync') sync(); });

/** Default the logged-in name to the first teammate if none is set yet. */
async function ensureMe() {
  var s = await chrome.storage.local.get(['me', 'team']);
  if (Array.isArray(s.team) && s.team.length && (!s.me || s.team.indexOf(s.me) < 0))
    await chrome.storage.local.set({ me: s.team[0] });
}

async function cfg() {
  return await chrome.storage.local.get(['apiUrl', 'apiKey', 'me']);
}

async function sync() {
  var c = await cfg();
  if (!c.apiUrl || !c.apiKey) return;
  try {
    var url = c.apiUrl + '?action=bootstrap&apiKey=' + encodeURIComponent(c.apiKey);
    var res = await fetch(url, { method: 'GET' });
    var data = await res.json();
    if (data.ok) {
      var patch = { contacts: data.contacts, settings: data.settings, lastSync: Date.now() };
      if (data.sheetUrl) patch.sheetUrl = data.sheetUrl;
      await chrome.storage.local.set(patch);
    }
  } catch (e) { /* keep last good cache */ }
}

async function post(body) {
  var c = await cfg();
  if (!c.apiUrl || !c.apiKey) return { ok: false, error: 'not configured' };
  body.apiKey = c.apiKey;
  var res = await fetch(c.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight
    body: JSON.stringify(body)
  });
  return await res.json();
}

chrome.runtime.onMessage.addListener(function (msg, _sender, reply) {
  if (msg.type === 'sync') { sync().then(function () { reply({ ok: true }); }); return true; }
  if (msg.type === 'add') {
    var body = { action: 'add', added_by: msg.me };
    var f = msg.fields || {};
    for (var k in f) body[k] = f[k];
    post(body).then(function (r) { sync().then(function () { reply(r); }); });
    return true;
  }
  if (msg.type === 'update') {
    post({ action: 'update', id: msg.id, status: msg.status, notes: msg.notes, added_by: msg.me })
      .then(function (r) { sync().then(function () { reply(r); }); });
    return true;
  }
});
