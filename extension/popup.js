var DEFAULT_TEAM = ['Vedant', 'Rahul', 'Saksham']; // fallback if no team in config

var $ = function (id) { return document.getElementById(id); };

// Only assign http(s) URLs to a link href (guards against javascript: etc.).
function setLink(id, url) {
  var ok = false;
  try { var u = new URL(url); ok = (u.protocol === 'https:' || u.protocol === 'http:'); } catch (e) {}
  if (ok) { $(id).href = url; $(id).style.display = ''; } else { $(id).style.display = 'none'; }
}

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
    ['me', 'apiUrl', 'apiKey', 'activeMode', 'barEnabled', 'barOpacity', 'lastSync', 'contacts', 'team', 'sheetUrl'],
    function (s) {
      var team = getTeam(s.team);
      // Default "me" to the first teammate and PERSIST it, so the content
      // script always has a name (the dropdown defaulting visually isn't enough).
      var me = (s.me && team.indexOf(s.me) >= 0) ? s.me : team[0];
      fillTeam(team, me);
      if (s.me !== me) chrome.storage.local.set({ me: me });
      $('enabled').checked = s.barEnabled !== false;
      $('activeRow').style.opacity = $('enabled').checked ? '1' : '.45';
      $('opacity').value = Math.round((typeof s.barOpacity === 'number' ? s.barOpacity : 1) * 100);
      setLink('openDash', s.apiUrl);
      setLink('openSheet', s.sheetUrl);
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

$('enabled').addEventListener('change', function () {
  chrome.storage.local.set({ barEnabled: $('enabled').checked });
  $('activeRow').style.opacity = $('enabled').checked ? '1' : '.45';
  msg($('enabled').checked ? 'Bar shown' : 'Bar hidden everywhere');
});

$('active').addEventListener('change', function () {
  chrome.storage.local.set({ activeMode: $('active').checked });
  msg($('active').checked ? 'Auto mode on' : 'Manual mode');
});

$('opacity').addEventListener('input', function () {
  chrome.storage.local.set({ barOpacity: Number($('opacity').value) / 100 });
  msg('Bar opacity ' + $('opacity').value + '%');
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
