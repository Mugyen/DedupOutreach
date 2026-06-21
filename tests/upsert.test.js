/**
 * End-to-end test of the person-centric upsert/merge logic in Code.gs, using an
 * in-memory fake of the Apps Script Sheet APIs. No deps, no Google account.
 * Run: node tests/upsert.test.js
 *
 * Proves: merge on any shared identifier, blank-fill of new identifiers,
 * original-owner preservation, updated_by tracking, custom-column survival,
 * and optional fuzzy name+company merge.
 */
var fs = require('fs'), vm = require('vm'), path = require('path');

function makeSheet() {
  return {
    _d: [],
    getLastRow() { return this._d.length; },
    getLastColumn() { return this._d.reduce(function (m, r) { return Math.max(m, r.length); }, 0); },
    getMaxRows() { return Math.max(1000, this._d.length); },
    appendRow(r) { this._d.push(r.slice()); },
    deleteRow(n) { this._d.splice(n - 1, 1); },
    deleteColumn(n) { this._d.forEach(function (row) { row.splice(n - 1, 1); }); },
    getDataRange() { return this.getRange(1, 1, Math.max(1, this._d.length), Math.max(1, this.getLastColumn())); },
    getRange(r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1; var sh = this;
      return {
        getValues() {
          var o = [];
          for (var i = 0; i < nr; i++) { var row = []; for (var j = 0; j < nc; j++) { var rr = sh._d[r - 1 + i] || []; row.push(rr[c - 1 + j] !== undefined ? rr[c - 1 + j] : ''); } o.push(row); }
          return o;
        },
        setValues(v) { for (var i = 0; i < v.length; i++) { sh._d[r - 1 + i] = sh._d[r - 1 + i] || []; for (var j = 0; j < v[i].length; j++) sh._d[r - 1 + i][c - 1 + j] = v[i][j]; } },
        setValue(val) { sh._d[r - 1] = sh._d[r - 1] || []; sh._d[r - 1][c - 1] = val; },
        setNumberFormat() { return this; }
      };
    }
  };
}

var sheets = {};
var ctx = {
  SpreadsheetApp: { getActive() { return { getSheetByName(n) { return sheets[n] || null; }, insertSheet(n) { return sheets[n] = makeSheet(); } }; } },
  LockService: { getScriptLock() { return { waitLock() {}, releaseLock() {} }; } },
  PropertiesService: { getDocumentProperties() { var s = {}; return { getProperty: function (k) { return s[k] || null; }, setProperty: function (k, v) { s[k] = v; } }; } },
  Utilities: { getUuid() { return 'id' + (counter++); } },
  Date: Date, JSON: JSON, Math: Math, String: String, Number: Number, Object: Object, isNaN: isNaN, console: console
};
var counter = 1;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), ctx);
vm.runInContext('this.upsertContact=upsertContact;this.readContacts=readContacts;this.apiSettings=apiSettings;this.deleteContact=deleteContact;', ctx);

var f = 0;
function ok(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) f++; }

var r = ctx.upsertContact({ added_by: 'Aman', name: 'Jane Doe', company: 'Acme', link: 'https://www.linkedin.com/in/jane-doe/', status: 'Contacted' });
ok(r.ok && !r.merged, 'new person created via linkedin');
ok(ctx.readContacts().length === 1, 'one row');

r = ctx.upsertContact({ added_by: 'Vedant', link: 'linkedin.com/in/jane-doe?trk=x', email: 'jane@acme.com', status: 'Replied' });
ok(r.merged && r.reason === 'link', 'merged via shared linkedin (url noise ignored)');
var p = ctx.readContacts();
ok(p.length === 1, 'still one row');
ok(p[0].email === 'jane@acme.com', 'new identifier (email) filled into existing row');
ok(p[0].status === 'Replied', 'status updated on merge');
ok(p[0].added_by === 'Aman' && p[0].updated_by === 'Vedant', 'original owner kept, updater recorded');

r = ctx.upsertContact({ added_by: 'Aman', email: 'JANE@acme.com', status: 'Meeting' });
ok(r.merged && r.reason === 'email', 'later email-only touch merges (email now on file)');
ok(ctx.readContacts().length === 1, 'still one row');

r = ctx.upsertContact({ added_by: 'Aman', name: 'Bob', company: 'Globex', email: 'bob@globex.com' });
ok(!r.merged && ctx.readContacts().length === 2, 'distinct person = new row');

var cs = sheets['Contacts'];
cs._d[0].push('insight'); cs._d[1].push('warm intro via Sam');   // user adds a column in the Sheet
r = ctx.upsertContact({ added_by: 'Aman', link: 'linkedin.com/in/jane-doe', phone: '+1 415 555 9999' });
var jane = ctx.readContacts().find(function (x) { return x.name === 'Jane Doe'; });
ok(r.merged, 'merge on Jane by linkedin');
ok(jane.insight === 'warm intro via Sam', 'custom column preserved through merge');
ok(String(jane.phone).indexOf('9999') > -1, 'phone added to existing record');

ctx.apiSettings({ fuzzy_name_company: true });
r = ctx.upsertContact({ added_by: 'Vedant', name: 'Bob', company: 'Globex', link: 'linkedin.com/in/bob-x' });
ok(r.merged && r.reason === 'name+company', 'fuzzy name+company merges despite no shared identifier');

// handle dedupe (Slack/Twitter/etc.) + source validation
var hr = ctx.upsertContact({ added_by: 'Rahul', name: 'Sam Slack', link: '@sam_k', source: 'Slack' });
ok(hr.ok && !hr.merged, 'source+handle person created');
var hr2 = ctx.upsertContact({ added_by: 'Saksham', link: 'sam_k', email: 'sam@x.com' });
ok(hr2.merged && hr2.reason === 'link', 'merged by handle (@ and case ignored)');
var nope = ctx.upsertContact({ added_by: 'Rahul', name: 'No Identifiers' });
ok(!nope.ok, 'reject person with no identifier and no source');
var srcOnly = ctx.upsertContact({ added_by: 'Rahul', name: 'Phone Friend', source: 'WhatsApp' });
ok(srcOnly.ok, 'allow source-only person (e.g. met on WhatsApp)');

// editing a descriptive field (name/company) on merge actually updates it
ctx.apiSettings({ fuzzy_name_company: false });
var er = ctx.upsertContact({ added_by: 'Vedant', link: 'linkedin.com/in/jane-doe', name: 'Jane D. Updated', company: 'NewCo' });
var janeU = ctx.readContacts().find(function (x) { return String(x.link).indexOf('jane-doe') > -1; });
ok(er.merged && janeU.name === 'Jane D. Updated' && janeU.company === 'NewCo', 'merge updates name/company when provided');

// match_id merges into that exact person even with a blank identifier
var mr = ctx.upsertContact({ added_by: 'Saksham', match_id: janeU.id, status: 'Won', source: 'SPC' });
ok(mr.merged && mr.reason === 'id', 'match_id merges into the known person (no duplicate)');
var janeW = ctx.readContacts().find(function (x) { return x.id === janeU.id; });
ok(janeW.status === 'Won' && janeW.source === 'SPC', 'match_id merge applied status/source');
ok(ctx.readContacts().filter(function (x) { return String(x.link).indexOf('jane-doe') > -1; }).length === 1, 'match_id did not create an orphan row');

// delete a person by id
var before = ctx.readContacts().length;
var bobId = ctx.readContacts().find(function (x) { return x.name === 'Bob'; }).id;
var dr = ctx.deleteContact({ id: bobId });
ok(dr.ok && ctx.readContacts().length === before - 1, 'deleteContact removes the row');
ok(!ctx.readContacts().some(function (x) { return x.id === bobId; }), 'deleted person is gone');
ok(!ctx.deleteContact({ id: 'nope' }).ok, 'deleting unknown id fails cleanly');

console.log(f ? ('\n' + f + ' FAILED') : '\nAll passed.');
process.exit(f ? 1 : 0);
