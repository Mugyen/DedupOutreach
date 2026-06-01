/**
 * Plain-node tests for the person-centric dedup engine.
 * Run: node extension/matcher.test.js   (no deps)
 * Mirrors the matcher block in apps-script/Code.gs.
 */
global.self = global;
require('./matcher.js');
var M = global.Matcher;

var S = {
  email_lowercase: true, email_strip_plus: true, email_ignore_dots: false,
  linkedin_slug_only: true, reddit_strip_prefix: true, phone_match_last10: true,
  fuzzy_name_company: false, fuzzy_threshold: 0.85
};

var fails = 0;
function eq(a, b, msg) {
  var ok = JSON.stringify(a) === JSON.stringify(b);
  console.log((ok ? 'PASS ' : 'FAIL ') + msg + (ok ? '' : '  got=' + JSON.stringify(a)));
  if (!ok) fails++;
}

// ── field normalization ────────────────────────────────────────────────────
eq(M.normalizeField('email', 'Jane+sales@Acme.com', S), 'jane@acme.com', 'email lowercased + plus stripped');
eq(M.normalizeField('linkedin', 'https://www.linkedin.com/in/Jane-Doe/?utm=x', S), 'in/jane-doe', 'linkedin slug');
eq(M.normalizeField('phone', '+1 (415) 555-1234', S), '4155551234', 'phone digits, country code dropped');
eq(M.normalizeField('phone', '415.555.1234', S), '4155551234', 'phone punctuation stripped == same');
eq(M.normalizeField('phone', '123', S), '', 'too-short phone rejected');
eq(M.normalizeField('reddit', 'https://www.reddit.com/user/CoolGuy/', S), 'coolguy', 'reddit handle');

// ── canonicalization (storage cleanup) ──────────────────────────────────────
eq(M.canonicalize('phone', '+1 (415) 555-1234'), '+14155551234', 'canonical phone strips spaces/punct, keeps +');
eq(M.canonicalize('phone', ' 415 555 1234 '), '4155551234', 'canonical phone trims + strips spaces');
eq(M.canonicalize('email', '  MAILTO:Jane@Acme.com '), 'jane@acme.com', 'canonical email strips mailto + lowercases');
eq(M.canonicalize('linkedin', 'http://m.linkedin.com/in/Jane-Doe?x=1'), 'https://www.linkedin.com/in/jane-doe/', 'canonical linkedin → one form');
eq(M.canonicalize('linkedin', 'jane-doe'), 'https://www.linkedin.com/in/jane-doe/', 'bare slug → full linkedin url');
eq(M.canonicalize('name', '  Jane   Doe '), 'Jane Doe', 'canonical name collapses spaces');

// ── person-centric dedup: one person, many identifiers ──────────────────────
var people = [
  { id: '1', name: 'Jane Doe', company: 'Acme', linkedin: 'https://www.linkedin.com/in/jane-doe/',
    email: '', phone: '', reddit: '', status: 'Contacted', added_by: 'Aman' },
  { id: '2', name: 'Bob Lee', company: 'Globex', email: 'bob@globex.com',
    phone: '+44 20 7946 0958', linkedin: '', reddit: '', status: 'New', added_by: 'Vedant' }
];

// reached Jane by email now — should match her existing linkedin-only row
eq(M.findHits({ name: 'Jane', email: 'jane@acme.com' }, people, S).hits.length, 0, 'no false match (Jane has no email on file yet)');
// match Jane by her known linkedin despite url noise
var jr = M.findHits({ linkedin: 'linkedin.com/in/jane-doe?trk=x' }, people, S);
eq(jr.hits.length, 1, 'match person by linkedin across url noise');
eq(jr.hits[0].contact.id, '1', 'matched the right person');
eq(jr.hits[0].reason, 'linkedin', 'reason reported = linkedin');
// match Bob by phone with different formatting + country code
var br = M.findHits({ phone: '020 7946 0958' }, people, S);
eq(br.hits.length, 1, 'match person by phone (country code + formatting differ)');
eq(br.hits[0].contact.id, '2', 'matched Bob by phone');
// match Bob by email
eq(M.findHits({ email: 'BOB@globex.com' }, people, S).hits.length, 1, 'match person by email case-insensitively');
// genuinely new person
eq(M.findHits({ email: 'new@startup.io', phone: '5559990000' }, people, S).hits.length, 0, 'new person = no match');

// ── fuzzy name+company toggle ───────────────────────────────────────────────
var Sf = Object.assign({}, S, { fuzzy_name_company: true });
eq(M.findHits({ name: 'Jane Doe', company: 'Acme' }, people, Sf).hits.length, 1, 'fuzzy name+company matches w/o shared id');
eq(M.findHits({ name: 'Jane Doe', company: 'Acme' }, people, S).hits.length, 0, 'fuzzy OFF = no name/company match');

console.log(fails ? ('\n' + fails + ' FAILED') : '\nAll passed.');
process.exit(fails ? 1 : 0);
