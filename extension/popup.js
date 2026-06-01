var DEFAULT_TEAM = ['Vedant', 'Rahul', 'Saksham']; // fallback if no team in config

var $ = function (id) { return document.getElementById(id); };

function getTeam(stored) {
  return (Array.isArray(stored) && stored.length) ? stored : DEFAULT_TEAM;
}

function fillTeam(team, selected) {
  var sel = $('me');
  sel.textContent = '';
  team.forEach(function (n) {
    var o = document.createElement('option');
    o.value = n; o.textContent = n;
    if (n === selected) o.selected = true;
    sel.appendChild(o);
  });
}

function load() {
  chrome.storage.local.get(
    ['me', 'apiUrl', 'apiKey', 'activeMode', 'lastSync', 'contacts', 'team'],
    function (s) {
      fillTeam(getTeam(s.team), s.me);
      $('apiUrl').value = s.apiUrl || '';
      $('apiKey').value = s.apiKey || '';
      $('active').checked = s.activeMode !== false;
      var n = (s.contacts || []).length;
      $('sync').textContent = s.lastSync
        ? n + ' contacts · synced ' + new Date(s.lastSync).toLocaleTimeString()
        : 'not synced yet';
      // open the connection panel automatically until configured
      if (!s.apiUrl || !s.apiKey) $('connDetails').open = true;
    }
  );
}

// ── Config string: base64( JSON{ apiUrl, apiKey, team } ) ──────────────────
function encodeCfg(o) { return btoa(unescape(encodeURIComponent(JSON.stringify(o)))); }
function decodeCfg(s) { return JSON.parse(decodeURIComponent(escape(atob(s.replace(/\s+/g, ''))))); }

$('importBtn').addEventListener('click', function () {
  var raw = $('importStr').value.trim();
  if (!raw) { msg('Paste a config string first'); return; }
  var cfg;
  try { cfg = decodeCfg(raw); } catch (e) { msg('That config string looks invalid'); return; }
  if (!cfg.apiUrl || !cfg.apiKey) { msg('Config missing url or key'); return; }
  var set = { apiUrl: cfg.apiUrl, apiKey: cfg.apiKey };
  if (Array.isArray(cfg.team) && cfg.team.length) set.team = cfg.team;
  chrome.storage.local.set(set, function () {
    msg('Imported ✓ — syncing…'); load(); doSync();
  });
});

$('exportBtn').addEventListener('click', function () {
  chrome.storage.local.get(['apiUrl', 'apiKey', 'team'], function (s) {
    if (!s.apiUrl || !s.apiKey) { msg('Set url + key first'); return; }
    var str = encodeCfg({ apiUrl: s.apiUrl, apiKey: s.apiKey, team: getTeam(s.team) });
    navigator.clipboard.writeText(str).then(
      function () { msg('Config copied — share it with your team'); },
      function () { $('importStr').value = str; msg('Copy failed; selected it above instead'); }
    );
  });
});

$('me').addEventListener('change', function () {
  chrome.storage.local.set({ me: $('me').value });
  msg('Saved as ' + $('me').value);
});

$('active').addEventListener('change', function () {
  chrome.storage.local.set({ activeMode: $('active').checked });
  msg($('active').checked ? 'Active mode on' : 'Active mode off');
});

$('saveCfg').addEventListener('click', function () {
  chrome.storage.local.set(
    { apiUrl: $('apiUrl').value.trim(), apiKey: $('apiKey').value.trim() },
    function () { msg('Connection saved — syncing…'); doSync(); }
  );
});

$('syncBtn').addEventListener('click', doSync);

function doSync() {
  msg('Syncing…');
  chrome.runtime.sendMessage({ type: 'sync' }, function () {
    setTimeout(load, 400); msg('Synced ✓');
  });
}

function msg(m) { $('msg').textContent = m; }

load();
