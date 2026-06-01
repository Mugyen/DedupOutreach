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
    appendRow(r) { this._d.push(r.slice()); },
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
        setValue(val) { sh._d[r - 1] = sh._d[r - 1] || []; sh._d[r - 1][c - 1] = val; }
      };
    }
  };
}

var sheets = {};
var ctx = {
  SpreadsheetApp: { getActive() { return { getSheetByName(n) { return sheets[n] || null; }, insertSheet(n) { return sheets[n] = makeSheet(); } }; } },
  LockService: { getScriptLock() { return { waitLock() {}, releaseLock() {} }; } },
  Utilities: { getUuid() { return 'id' + (counter++); } },
  Date: Date, JSON: JSON, Math: Math, String: String, Number: Number, Object: Object, isNaN: isNaN, console: console
};
var counter = 1;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), ctx);
vm.runInContext('this.upsertContact=upsertContact;this.readContacts=readContacts;this.apiSettings=apiSettings;', ctx);

var f = 0;
function ok(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) f++; }

var r = ctx.upsertContact({ added_by: 'Aman', name: 'Jane Doe', company: 'Acme', linkedin: 'https://www.linkedin.com/in/jane-doe/', status: 'Contacted' });
ok(r.ok && !r.merged, 'new person created via linkedin');
ok(ctx.readContacts().length === 1, 'one row');

r = ctx.upsertContact({ added_by: 'Vedant', linkedin: 'linkedin.com/in/jane-doe?trk=x', email: 'jane@acme.com', status: 'Replied' });
ok(r.merged && r.reason === 'linkedin', 'merged via shared linkedin (url noise ignored)');
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
r = ctx.upsertContact({ added_by: 'Aman', linkedin: 'linkedin.com/in/jane-doe', phone: '+1 415 555 9999' });
var jane = ctx.readContacts().find(function (x) { return x.name === 'Jane Doe'; });
ok(r.merged, 'merge on Jane by linkedin');
ok(jane.insight === 'warm intro via Sam', 'custom column preserved through merge');
ok(String(jane.phone).indexOf('9999') > -1, 'phone added to existing record');

ctx.apiSettings({ fuzzy_name_company: true });
r = ctx.upsertContact({ added_by: 'Vedant', name: 'Bob', company: 'Globex', linkedin: 'linkedin.com/in/bob-x' });
ok(r.merged && r.reason === 'name+company', 'fuzzy name+company merges despite no shared identifier');

console.log(f ? ('\n' + f + ' FAILED') : '\nAll passed.');
process.exit(f ? 1 : 0);
