/**
 * Matcher — person-centric dedup engine (shared by extension + web app).
 * Kept algorithmically identical to the matcher block in apps-script/Code.gs.
 * Mirror any change to both.
 *
 * A person may have several identifiers (email, phone, linkedin, reddit). Two
 * records are the SAME person if ANY identifier matches after normalization,
 * or (optionally) if name+company are fuzzy-equal.
 */
(function (root) {
  // Order matters only for which reason is reported first.
  var IDENTIFIER_FIELDS = ['email', 'phone', 'linkedin', 'reddit'];

  function normalizeField(field, value, settings) {
    var raw = (value == null ? '' : String(value)).trim();
    if (!raw) return '';
    settings = settings || {};
    if (field === 'email') return normEmail(raw, settings);
    if (field === 'phone') return normPhone(raw, settings);
    if (field === 'linkedin') return normLinkedin(raw, settings);
    if (field === 'reddit') return normReddit(raw, settings);
    return stripUrl(raw);
  }

  function normEmail(raw, s) {
    raw = raw.replace(/^mailto:/i, '').replace(/\s+/g, '');
    var at = raw.indexOf('@');
    if (at === -1) return s.email_lowercase ? raw.toLowerCase() : raw;
    var local = raw.slice(0, at), domain = raw.slice(at + 1);
    if (s.email_lowercase !== false) { local = local.toLowerCase(); domain = domain.toLowerCase(); }
    if (s.email_strip_plus !== false) local = local.split('+')[0];
    if (s.email_ignore_dots) local = local.replace(/\./g, '');
    return local + '@' + domain;
  }

  function normPhone(raw, s) {
    var digits = raw.replace(/[^0-9]/g, '').replace(/^0+/, '');
    if (digits.length < 7) return '';                 // too short to trust
    if (s.phone_match_last10 !== false && digits.length > 10)
      digits = digits.slice(-10);                     // ignore country code
    return digits;
  }

  function normLinkedin(raw, s) {
    var m = raw.match(/\/in\/([^/?#]+)/i);
    if (m && s.linkedin_slug_only !== false) return 'in/' + m[1].toLowerCase();
    return stripUrl(raw);
  }

  function normReddit(raw, s) {
    var r = raw.match(/(?:u\/|user\/)([^/?#\s]+)/i);
    var handle = r ? r[1] : raw.replace(/^\/?(u\/|user\/)/i, '');
    return s.reddit_strip_prefix !== false ? handle.replace(/^@/, '').toLowerCase() : handle;
  }

  function stripUrl(str) {
    return str.replace(/^https?:\/\//i, '').replace(/^www\./i, '')
              .split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase();
  }

  /** Map of field -> normalized value, for non-empty identifiers only. */
  function keys(person, settings) {
    var k = {};
    IDENTIFIER_FIELDS.forEach(function (f) {
      var n = normalizeField(f, person[f], settings);
      if (n) k[f] = n;
    });
    return k;
  }

  /** Does candidate refer to the same person as entry? */
  function matchPerson(candidate, entry, settings) {
    var ck = keys(candidate, settings), ek = keys(entry, settings);
    for (var i = 0; i < IDENTIFIER_FIELDS.length; i++) {
      var f = IDENTIFIER_FIELDS[i];
      if (ck[f] && ek[f] && ck[f] === ek[f]) return { hit: true, reason: f };
    }
    if (settings && settings.fuzzy_name_company &&
        candidate.name && candidate.company && entry.name && entry.company) {
      var t = Number(settings.fuzzy_threshold) || 0.85;
      if (similarity(candidate.name, entry.name) >= t &&
          similarity(candidate.company, entry.company) >= t)
        return { hit: true, reason: 'name+company' };
    }
    return { hit: false, reason: '' };
  }

  /**
   * Clean a value for STORAGE/display (distinct from match-normalization):
   * trims, removes spaces from phones, lowercases emails, canonicalizes
   * LinkedIn URLs — so common entry mistakes don't create messy rows.
   */
  function canonicalize(field, value) {
    var raw = (value == null ? '' : String(value)).replace(/\s+/g, ' ').trim();
    if (!raw) return '';
    if (field === 'phone') {
      var plus = raw.charAt(0) === '+' ? '+' : '';
      return plus + raw.replace(/[^0-9]/g, '');
    }
    if (field === 'email') return raw.replace(/^mailto:/i, '').replace(/\s+/g, '').toLowerCase();
    if (field === 'linkedin') {
      var m = raw.match(/\/in\/([^/?#\s]+)/i);
      if (m) return 'https://www.linkedin.com/in/' + m[1].toLowerCase() + '/';
      if (/^[a-z0-9._-]+$/i.test(raw)) return 'https://www.linkedin.com/in/' + raw.toLowerCase() + '/';
      return raw.replace(/\s+/g, '');
    }
    if (field === 'reddit') {
      var r = raw.match(/(?:u\/|user\/)([^/?#\s]+)/i);
      return 'u/' + (r ? r[1] : raw.replace(/^@/, ''));
    }
    return raw; // name, company: trimmed + single-spaced
  }

  /** All existing people that are the same as candidate. */
  function findHits(candidate, contacts, settings) {
    var hits = [];
    (contacts || []).forEach(function (c) {
      var m = matchPerson(candidate, c, settings);
      if (m.hit) hits.push({ contact: c, reason: m.reason });
    });
    return { hits: hits, keys: keys(candidate, settings) };
  }

  function similarity(a, b) {
    a = (a || '').trim().toLowerCase(); b = (b || '').trim().toLowerCase();
    if (!a && !b) return 1;
    if (!a || !b) return 0;
    if (a === b) return 1;
    return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  }

  function levenshtein(a, b) {
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

  root.Matcher = {
    IDENTIFIER_FIELDS: IDENTIFIER_FIELDS,
    normalizeField: normalizeField,
    canonicalize: canonicalize,
    matchPerson: matchPerson,
    findHits: findHits,
    keys: keys,
    similarity: similarity
  };
})(typeof self !== 'undefined' ? self : this);
