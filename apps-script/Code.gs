/**
 * DedupManager — Apps Script backend + web app host (person-centric CRM).
 *
 * One row per PERSON. A person can carry name/company/phone/linkedin/email/reddit
 * plus a status (stage). You may add ANY extra columns in the Sheet (call notes,
 * insights, stage detail…) — the app never reorders or overwrites them; it only
 * touches the columns it manages, and shows the rest read-only in the dashboard.
 *
 * Deploy with deploy.sh, or manually (see USAGE.md). The team secret lives in
 * Config.gs as `var TEAM_API_KEY = '...'`.
 */

function getApiKey() {
  return (typeof TEAM_API_KEY !== 'undefined' && TEAM_API_KEY)
    ? TEAM_API_KEY : 'CHANGE_ME_set_in_Config_gs';
}

var SHEET_ID = '';                 // blank = the Sheet this script is bound to
var CONTACTS_SHEET = 'Contacts';
var SETTINGS_SHEET = 'Settings';

// Columns the app manages. Anything else in the sheet is user-owned & preserved.
var MANAGED_HEADERS = [
  'id', 'name', 'company', 'phone', 'email', 'link', 'source',
  'status', 'added_by', 'added_at', 'updated_at', 'updated_by', 'notes'
];
// Fields a write request is allowed to set on a managed row.
var EDITABLE_FIELDS = ['name', 'company', 'phone', 'email', 'link', 'source', 'status', 'notes'];
// Fields that dedupe a person ('link' covers any profile URL / @handle).
var ID_FIELDS = ['phone', 'email', 'link'];

var DEFAULT_SETTINGS = {
  email_lowercase: true, email_strip_plus: true, email_ignore_dots: false,
  linkedin_slug_only: true, reddit_strip_prefix: true, phone_match_last10: true,
  fuzzy_name_company: false, fuzzy_threshold: 0.85,
  stages: 'New,Contacted,Replied,Meeting,Won,Lost',
  sources: 'LinkedIn,Email,Phone,WhatsApp,Slack,Twitter/X,Reddit,Other',
  team: 'Vedant,Rahul,Saksham'
};

// ── Entry points ────────────────────────────────────────────────────────────

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'app';
  if (action === 'app') return serveApp();
  if (!authed(e)) return json({ ok: false, error: 'unauthorized' });
  if (action === 'log') return json({ ok: true, contacts: readContacts() });
  if (action === 'settings') return json({ ok: true, settings: readSettings() });
  if (action === 'bootstrap')
    return json({ ok: true, contacts: readContacts(), settings: readSettings(), sheetUrl: sheetUrl_() });
  return json({ ok: false, error: 'unknown action: ' + action });
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) {}
  if (!authed({ parameter: body })) return json({ ok: false, error: 'unauthorized' });
  if (body.action === 'check') return json(apiCheck(body));   // read-only, live — no lock needed
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (body.action === 'add' || body.action === 'upsert') return json(upsertContact(body));
    if (body.action === 'update') return json(updateContact(body));
    if (body.action === 'delete') return json(deleteContact(body));
    if (body.action === 'settings') return json(writeSettings(body.settings || {}));
    return json({ ok: false, error: 'unknown action: ' + body.action });
  } finally { lock.releaseLock(); }
}

function authed(e) {
  var key = e && e.parameter && e.parameter.apiKey;
  return key && key === getApiKey();
}

// ── Sheet access ────────────────────────────────────────────────────────────

function book() {
  return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActive();
}

function sheetUrl_() { try { return book().getUrl(); } catch (e) { return ''; } }

function sheet(name) {
  var ss = book();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

/** Ensure managed columns exist without disturbing user columns. Returns headers. */
function ensureHeaders(sh) {
  var lastCol = sh.getLastColumn();
  var headers = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  if (!headers.length || headers.join('') === '') {
    sh.getRange(1, 1, 1, MANAGED_HEADERS.length).setValues([MANAGED_HEADERS]);
    return MANAGED_HEADERS.slice();
  }
  cleanupDefaultSheet();
  headers = dropDeprecated(sh, headers);
  var missing = MANAGED_HEADERS.filter(function (h) { return headers.indexOf(h) === -1; });
  if (missing.length) {
    sh.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
    headers = headers.concat(missing);
  }
  ensureTextFormat(sh, headers.length);
  return headers;
}

/** One-time: delete the empty default "Sheet1" clasp created. */
function cleanupDefaultSheet() {
  var props = PropertiesService.getDocumentProperties();
  if (props.getProperty('rm_sheet1')) return;
  try {
    var ss = book();
    var s1 = ss.getSheetByName('Sheet1') || ss.getSheetByName('Sheet 1');
    if (s1 && ss.getSheets().length > 1) ss.deleteSheet(s1);
  } catch (e) {}
  props.setProperty('rm_sheet1', '1');
}

/** One-time: remove pre-merge columns (linkedin/reddit/handle) folded into `link`. */
function dropDeprecated(sh, headers) {
  var props = PropertiesService.getDocumentProperties();
  if (props.getProperty('migr_link')) return headers;
  var dep = ['linkedin', 'reddit', 'handle'], removed = false;
  for (var i = headers.length - 1; i >= 0; i--) {
    if (dep.indexOf(headers[i]) > -1) { sh.deleteColumn(i + 1); removed = true; }
  }
  props.setProperty('migr_link', '1');
  if (!removed) return headers;
  var lc = sh.getLastColumn();
  return lc > 0 ? sh.getRange(1, 1, 1, lc).getValues()[0] : [];
}

/** Force the data area to plain text so "+1..." phones aren't read as formulas. */
function ensureTextFormat(sh, ncols) {
  var props = PropertiesService.getDocumentProperties();
  if (props.getProperty('txtfmt2')) return;
  sh.getRange(1, 1, sh.getMaxRows(), Math.max(ncols, MANAGED_HEADERS.length)).setNumberFormat('@');
  props.setProperty('txtfmt2', '1');
}

function readWithRows(sh, headers) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, headers.length).getValues();
  return values.map(function (row, i) {
    var o = { _row: i + 2 };
    headers.forEach(function (h, j) {
      var v = row[j];
      if (v instanceof Date) v = v.toISOString();
      o[h] = v;
    });
    return o;
  });
}

function readContacts() {
  var sh = sheet(CONTACTS_SHEET);
  var headers = ensureHeaders(sh);
  return readWithRows(sh, headers).map(function (o) {
    var c = {}; for (var k in o) if (k !== '_row') c[k] = o[k]; return c;
  });
}

function appendRecord(sh, headers, record) {
  var row = headers.map(function (h) { return record[h] !== undefined ? record[h] : ''; });
  var n = sh.getLastRow() + 1;
  var range = sh.getRange(n, 1, 1, headers.length);
  range.setNumberFormat('@');        // text first, so "+1..." phones aren't coerced
  range.setValues([row]);
}

function applyPatch(sh, headers, rowNum, patch) {
  Object.keys(patch).forEach(function (k) {
    var col = headers.indexOf(k);
    if (col > -1) {
      var cell = sh.getRange(rowNum, col + 1);
      cell.setNumberFormat('@');
      cell.setValue(patch[k]);
    }
  });
}

function appendNote(existing, who, text) {
  if (!text) return existing;
  var stamp = '[' + (who || '?') + '] ' + text;
  return existing ? (existing + '\n' + stamp) : stamp;
}

// ── Settings ────────────────────────────────────────────────────────────────

function readSettings() {
  var sh = sheet(SETTINGS_SHEET);
  if (sh.getLastRow() < 1) seedSettings(sh);
  var values = sh.getDataRange().getValues();
  var out = {}; for (var k in DEFAULT_SETTINGS) out[k] = DEFAULT_SETTINGS[k];
  values.forEach(function (row) {
    if (row[0] === 'key' && row[1] === 'value') return;
    if (row[0]) out[row[0]] = coerce(row[1]);
  });
  return out;
}

function coerce(v) {
  if (v === 'true' || v === true) return true;
  if (v === 'false' || v === false) return false;
  if (v !== '' && v !== null && !isNaN(v) && typeof v !== 'boolean') return Number(v);
  return v;
}

function seedSettings(sh) {
  sh.appendRow(['key', 'value']);
  for (var k in DEFAULT_SETTINGS) sh.appendRow([k, DEFAULT_SETTINGS[k]]);
}

function writeSettings(patch) {
  var sh = sheet(SETTINGS_SHEET);
  if (sh.getLastRow() < 1) seedSettings(sh);
  var values = sh.getDataRange().getValues();
  var rowFor = {};
  values.forEach(function (row, i) { if (row[0]) rowFor[row[0]] = i + 1; });
  for (var key in patch) {
    if (rowFor[key]) sh.getRange(rowFor[key], 2).setValue(patch[key]);
    else sh.appendRow([key, patch[key]]);
  }
  return { ok: true, settings: readSettings() };
}

function firstStage(settings) {
  var s = String(settings.stages || DEFAULT_SETTINGS.stages).split(',')[0];
  return (s || 'New').trim();
}

// ── Upsert (the core merge) ─────────────────────────────────────────────────

function upsertContact(body) {
  cleanBody(body);
  var hasIdentifier = ID_FIELDS.some(function (f) { return body[f]; });
  if (!hasIdentifier && !body.source && !body.match_id)
    return { ok: false, error: 'Add at least one identifier (phone / LinkedIn / email / handle) or a source.' };

  var settings = readSettings();
  var sh = sheet(CONTACTS_SHEET);
  var headers = ensureHeaders(sh);
  var rows = readWithRows(sh, headers);

  var cand = candidateFrom(body);
  var matchIdx = -1, reason = '';
  // If the caller already knows the person (live check returned an id), merge into
  // that exact row — robust even if the identifier text normalizes slightly differently.
  if (body.match_id) {
    for (var j = 0; j < rows.length; j++) {
      if (String(rows[j].id) === String(body.match_id)) { matchIdx = j; reason = 'id'; break; }
    }
  }
  if (matchIdx < 0) {
    for (var i = 0; i < rows.length; i++) {
      var m = matchPerson(cand, rows[i], settings);
      if (m.hit) { matchIdx = i; reason = m.reason; break; }
    }
  }

  if (matchIdx > -1) {
    var row = rows[matchIdx];
    var patch = {};
    ['phone', 'email', 'link'].forEach(function (f) {                 // identifiers: fill blanks, never clobber
      if (!String(row[f] || '').trim() && body[f]) patch[f] = body[f];
    });
    ['name', 'company'].forEach(function (f) {                        // descriptive: update when provided
      if (body[f] && String(body[f]) !== String(row[f] || '')) patch[f] = body[f];
    });
    if (body.status) patch.status = body.status;
    if (body.source) patch.source = body.source;     // reflect latest channel
    if (body.notes) patch.notes = appendNote(row.notes, body.added_by, body.notes);
    patch.updated_at = new Date().toISOString();
    patch.updated_by = body.added_by || '';
    applyPatch(sh, headers, row._row, patch);
    return { ok: true, merged: true, reason: reason, id: row.id };
  }

  var id = Utilities.getUuid().slice(0, 8);
  var now = new Date().toISOString();
  appendRecord(sh, headers, {
    id: id, name: body.name || '', company: body.company || '',
    phone: body.phone || '', email: body.email || '', link: body.link || '',
    source: body.source || '', status: body.status || firstStage(settings),
    added_by: body.added_by || 'unknown', added_at: now, updated_at: now,
    updated_by: body.added_by || '', notes: body.notes || ''
  });
  return { ok: true, merged: false, id: id };
}

function deleteContact(body) {
  var sh = sheet(CONTACTS_SHEET);
  var headers = ensureHeaders(sh);
  var last = sh.getLastRow();
  if (last < 2) return { ok: false, error: 'no rows' };
  var idCol = headers.indexOf('id') + 1;
  var ids = sh.getRange(2, idCol, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(body.id)) { sh.deleteRow(i + 2); return { ok: true, id: body.id }; }
  }
  return { ok: false, error: 'id not found: ' + body.id };
}

function candidateFrom(body) {
  return {
    name: body.name || '', company: body.company || '', phone: body.phone || '',
    email: body.email || '', link: body.link || '', source: body.source || ''
  };
}

function updateContact(body) {
  cleanBody(body);
  var sh = sheet(CONTACTS_SHEET);
  var headers = ensureHeaders(sh);
  var rows = readWithRows(sh, headers);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].id) === String(body.id)) {
      var patch = {};
      EDITABLE_FIELDS.forEach(function (f) { if (body[f] !== undefined) patch[f] = body[f]; });
      patch.updated_at = new Date().toISOString();
      patch.updated_by = body.updated_by || body.added_by || '';
      applyPatch(sh, headers, rows[i]._row, patch);
      return { ok: true, id: body.id };
    }
  }
  return { ok: false, error: 'id not found: ' + body.id };
}

// ── Web-UI server calls (google.script.run; inside an authed Google session) ─

function apiBootstrap() { return { contacts: readContacts(), settings: readSettings() }; }
/** Web-app URL + team key, so the dashboard can show a ready-to-share invite. */
function apiCreds() {
  var url = '';
  try { url = ScriptApp.getService().getUrl(); } catch (e) {}
  // Normalize the Workspace domain-scoped URL (/a/<domain>/macros/…) to the
  // generic /macros/s/<id>/exec form, which works anonymously for everyone.
  url = url.replace(/\/a\/[^/]+\/macros\//, '/macros/');
  return { ok: true, url: url, key: getApiKey() };
}
function apiUpsert(body) { return upsertContact(body); }
function apiUpdate(body) { return updateContact(body); }
function apiDelete(body) { return deleteContact(body); }
function apiSettings(s) { return writeSettings(s); }

function apiCheck(candidate) {
  cleanBody(candidate);
  var settings = readSettings();
  var cand = candidateFrom(candidate);
  var hits = [];
  readContacts().forEach(function (c) {
    var m = matchPerson(cand, c, settings);
    if (m.hit) hits.push({ contact: c, reason: m.reason });
  });
  return { ok: true, hits: hits };
}

function apiSearch(query) {
  var q = (query || '').trim().toLowerCase();
  var rows = readContacts();
  if (!q) return { ok: true, contacts: rows.slice(-300).reverse() };
  var hits = rows.filter(function (c) {
    return Object.keys(c).some(function (k) {
      return String(c[k] == null ? '' : c[k]).toLowerCase().indexOf(q) !== -1;
    });
  });
  return { ok: true, contacts: hits.reverse() };
}

function apiStats() {
  var rows = readContacts();
  var byPerson = {}, byStage = {};
  rows.forEach(function (c) {
    byPerson[c.added_by] = (byPerson[c.added_by] || 0) + 1;
    var st = c.status || '(none)';
    byStage[st] = (byStage[st] || 0) + 1;
  });
  return { ok: true, total: rows.length, byPerson: byPerson, byStage: byStage };
}

/** Custom (user-added) column names, for read-only display in the dashboard. */
function customColumns() {
  var sh = sheet(CONTACTS_SHEET);
  var headers = ensureHeaders(sh);
  return headers.filter(function (h) { return MANAGED_HEADERS.indexOf(h) === -1 && h !== ''; });
}

// ── Host ─────────────────────────────────────────────────────────────────────

function serveApp() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('DedupManager')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Optional: run once from the editor to create tabs (also lazy-created). */
function setup() {
  ensureHeaders(sheet(CONTACTS_SHEET));
  var s = sheet(SETTINGS_SHEET);
  if (s.getLastRow() < 1) seedSettings(s);
  return 'ready';
}

// ── Matching engine ─────────────────────────────────────────────────────────
// Kept algorithmically identical to extension/matcher.js. Mirror any change.

var IDENTIFIER_FIELDS = ['email', 'phone', 'link'];

function normalizeField(field, value, settings) {
  var raw = (value == null ? '' : String(value)).trim();
  if (!raw) return '';
  settings = settings || {};
  if (field === 'email') return normEmail_(raw, settings);
  if (field === 'phone') return normPhone_(raw, settings);
  if (field === 'link') return linkParts(raw).key;
  return stripUrl_(raw);
}

/** See extension/matcher.js linkParts — kept identical. */
function linkParts(raw) {
  var s = (raw == null ? '' : String(raw)).trim();
  if (!s) return { key: '', canonical: '', platform: '' };
  var low = s.toLowerCase(), m;
  function grab(re) { var x = low.match(re); return x ? x[1].replace(/^@/, '') : null; }
  if ((m = grab(/linkedin\.com\/in\/([^/?#\s]+)/))) return { platform: 'LinkedIn', key: 'li:' + m, canonical: 'https://www.linkedin.com/in/' + m + '/' };
  if ((m = grab(/(?:twitter|x)\.com\/([^/?#\s]+)/)) && ['home', 'search', 'i', 'explore'].indexOf(m) < 0) return { platform: 'Twitter/X', key: 'x:' + m, canonical: 'https://x.com/' + m };
  if ((m = grab(/instagram\.com\/([^/?#\s]+)/))) return { platform: 'Instagram', key: 'ig:' + m, canonical: 'https://instagram.com/' + m };
  if ((m = grab(/reddit\.com\/(?:user|u)\/([^/?#\s]+)/)) || (m = grab(/^(?:user|u)\/([^/?#\s]+)$/))) return { platform: 'Reddit', key: 'rd:' + m, canonical: 'https://reddit.com/user/' + m };
  if ((m = grab(/github\.com\/([^/?#\s]+)/))) return { platform: 'GitHub', key: 'gh:' + m, canonical: 'https://github.com/' + m };
  if ((m = grab(/(?:facebook|fb)\.com\/([^/?#\s]+)/))) return { platform: 'Facebook', key: 'fb:' + m, canonical: 'https://facebook.com/' + m };
  if (/^@?[a-z0-9._-]+$/i.test(s)) { var h = s.replace(/^@/, '').toLowerCase(); return { platform: '', key: 'h:' + h, canonical: '@' + h }; }
  return { platform: '', key: 'url:' + stripUrl_(s), canonical: s };
}

function canonicalize(field, value) {
  var raw = (value == null ? '' : String(value)).replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  if (field === 'phone') {
    var plus = raw.charAt(0) === '+' ? '+' : '';
    return plus + raw.replace(/[^0-9]/g, '');
  }
  if (field === 'email') return raw.replace(/^mailto:/i, '').replace(/\s+/g, '').toLowerCase();
  if (field === 'link') return linkParts(raw).canonical;
  return raw;
}

function cleanBody(body) {
  ['name', 'company', 'phone', 'email', 'link', 'source'].forEach(function (f) {
    if (body[f] !== undefined && body[f] !== null) body[f] = canonicalize(f, body[f]);
  });
  return body;
}

function normEmail_(raw, s) {
  raw = raw.replace(/^mailto:/i, '').replace(/\s+/g, '');
  var at = raw.indexOf('@');
  if (at === -1) return s.email_lowercase ? raw.toLowerCase() : raw;
  var local = raw.slice(0, at), domain = raw.slice(at + 1);
  if (s.email_lowercase !== false) { local = local.toLowerCase(); domain = domain.toLowerCase(); }
  if (s.email_strip_plus !== false) local = local.split('+')[0];
  if (s.email_ignore_dots) local = local.replace(/\./g, '');
  return local + '@' + domain;
}
function normPhone_(raw, s) {
  var digits = raw.replace(/[^0-9]/g, '').replace(/^0+/, '');
  if (digits.length < 7) return '';
  if (s.phone_match_last10 !== false && digits.length > 10) digits = digits.slice(-10);
  return digits;
}
function normLinkedin_(raw, s) {
  var m = raw.match(/\/in\/([^/?#]+)/i);
  if (m && s.linkedin_slug_only !== false) return 'in/' + m[1].toLowerCase();
  return stripUrl_(raw);
}
function normReddit_(raw, s) {
  var r = raw.match(/(?:u\/|user\/)([^/?#\s]+)/i);
  var handle = r ? r[1] : raw.replace(/^\/?(u\/|user\/)/i, '');
  return s.reddit_strip_prefix !== false ? handle.replace(/^@/, '').toLowerCase() : handle;
}
function stripUrl_(str) {
  return str.replace(/^https?:\/\//i, '').replace(/^www\./i, '')
            .split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase();
}

function keysOf_(person, settings) {
  var k = {};
  IDENTIFIER_FIELDS.forEach(function (f) {
    var n = normalizeField(f, person[f], settings);
    if (n) k[f] = n;
  });
  return k;
}

function matchPerson(candidate, entry, settings) {
  var ck = keysOf_(candidate, settings), ek = keysOf_(entry, settings);
  for (var i = 0; i < IDENTIFIER_FIELDS.length; i++) {
    var f = IDENTIFIER_FIELDS[i];
    if (ck[f] && ek[f] && ck[f] === ek[f]) return { hit: true, reason: f };
  }
  if (settings && settings.fuzzy_name_company &&
      candidate.name && candidate.company && entry.name && entry.company) {
    var t = Number(settings.fuzzy_threshold) || 0.85;
    if (similarity_(candidate.name, entry.name) >= t &&
        similarity_(candidate.company, entry.company) >= t)
      return { hit: true, reason: 'name+company' };
  }
  return { hit: false, reason: '' };
}

function similarity_(a, b) {
  a = (a || '').trim().toLowerCase(); b = (b || '').trim().toLowerCase();
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  return 1 - levenshtein_(a, b) / Math.max(a.length, b.length);
}
function levenshtein_(a, b) {
  var m = a.length, n = b.length, prev = [], curr = [], i, k, z;
  for (var j = 0; j <= n; j++) prev[j] = j;
  for (i = 1; i <= m; i++) {
    curr[0] = i;
    for (k = 1; k <= n; k++) {
      var cost = a.charAt(i - 1) === b.charAt(k - 1) ? 0 : 1;
      curr[k] = Math.min(prev[k] + 1, curr[k - 1] + 1, prev[k - 1] + cost);
    }
    for (z = 0; z <= n; z++) prev[z] = curr[z];
  }
  return prev[n];
}
