/**
 * DedupManager on-page bar. Persistent (bottom-right) on every page.
 *
 *  • Active mode ON  → auto-grabs the profile link on recognized sites
 *    (LinkedIn, X/Twitter, Instagram, Reddit, GitHub, Gmail) and auto-checks.
 *  • Active mode OFF → the same bar, but you type the link/handle/phone/email
 *    yourself and press Check, then Log.
 *  • Logging is always available in both modes. One unified "Profile link /
 *    handle" field (LinkedIn + any handle merged).
 *
 * All DOM via createElement/textContent — scraped values can't inject markup.
 */
(function () {
  if (window.top !== window) return;                 // don't run in iframes
  var STATE = { contacts: [], settings: {}, me: '', active: true, stages: ['New'], sources: [] };
  var F = {}, dirty = false, collapsed = false, checkSeq = 0, lastDetectKey = null;

  chrome.storage.local.get(['contacts', 'settings', 'me', 'activeMode', 'barCollapsed'], function (s) {
    apply(s); collapsed = !!s.barCollapsed; build(); hook(); refreshFromPage();
  });
  chrome.storage.onChanged.addListener(function (ch) {
    var s = {};
    ['contacts', 'settings', 'me', 'activeMode'].forEach(function (k) { if (ch[k]) s[k] = ch[k].newValue; });
    apply(s);
    if (ch.settings && F.source) { fillSelect(F.source.el, [''].concat(STATE.sources), F.source.get(), true); fillSelect(F.status.el, STATE.stages, F.status.get(), false); }
    if (ch.activeMode !== undefined) { lastDetectKey = null; dirty = false; refreshFromPage(); }  // re-render on mode switch
    else if (ch.contacts) check();
  });
  function apply(s) {
    if (s.contacts !== undefined) STATE.contacts = s.contacts || [];
    if (s.settings !== undefined) STATE.settings = s.settings || {};
    if (s.me !== undefined) STATE.me = s.me || '';
    if (s.activeMode !== undefined) STATE.active = s.activeMode !== false;
    STATE.stages = list(STATE.settings.stages, 'New');
    STATE.sources = list(STATE.settings.sources, 'LinkedIn,Email,Phone,WhatsApp,Slack,Twitter/X,Reddit,Other');
  }
  function list(v, fb) { return String(v || fb).split(',').map(function (x) { return x.trim(); }).filter(Boolean); }

  // ── SPA navigation hook ────────────────────────────────────────────────
  function hook() {
    ['pushState', 'replaceState'].forEach(function (m) {
      var o = history[m]; history[m] = function () { var r = o.apply(this, arguments); fire(); return r; };
    });
    window.addEventListener('popstate', fire);
    new MutationObserver(debounce(function () { if (!dirty) refreshFromPage(); }, 900))
      .observe(document.documentElement, { childList: true, subtree: true });
  }
  var nt = null;
  function fire() { clearTimeout(nt); nt = setTimeout(function () { dirty = false; refreshFromPage(); }, 450); }
  function debounce(fn, ms) { var d; return function () { clearTimeout(d); d = setTimeout(fn, ms); }; }

  // ── Detection per site → partial candidate ──────────────────────────────
  function detect() {
    var host = location.hostname, path = location.pathname, seg = path.split('/').filter(Boolean);
    var bad = function (w, l) { return l.indexOf((w || '').toLowerCase()) > -1; };
    if (host.indexOf('linkedin.com') > -1) {
      var m = path.match(/\/in\/([^/?#]+)/); if (!m) return null;
      return { link: 'https://www.linkedin.com/in/' + m[1] + '/', source: 'LinkedIn',
        name: txt(document.querySelector('h1')),
        company: txt(document.querySelector('.pv-text-details__right-panel, [data-field="experience_company_logo"] span')) };
    }
    if (/(?:^|\.)(?:x|twitter)\.com$/.test(host)) {
      if (seg.length === 1 && !bad(seg[0], ['home', 'explore', 'notifications', 'messages', 'i', 'search', 'settings', 'compose', 'tos', 'privacy']))
        return { link: 'https://x.com/' + seg[0], source: 'Twitter/X', name: txt(document.querySelector('[data-testid="UserName"] span, h1')) };
      return null;
    }
    if (host.indexOf('instagram.com') > -1) {
      if (seg.length === 1 && !bad(seg[0], ['explore', 'reels', 'direct', 'accounts', 'p', 'stories']))
        return { link: 'https://instagram.com/' + seg[0], source: 'Instagram', name: seg[0] };
      return null;
    }
    if (host.indexOf('reddit.com') > -1) {
      var r = path.match(/\/(?:user|u)\/([^/?#]+)/); if (!r) return null;
      return { link: 'https://reddit.com/user/' + r[1], source: 'Reddit', name: r[1] };
    }
    if (host.indexOf('github.com') > -1) {
      if (seg.length === 1 && !bad(seg[0], ['settings', 'notifications', 'explore', 'marketplace', 'pulls', 'issues', 'search', 'about', 'features']))
        return { link: 'https://github.com/' + seg[0], source: 'GitHub', name: seg[0] };
      return null;
    }
    if (host.indexOf('mail.google.com') > -1) {
      var el = document.querySelector('.gE [email], .gD[email], .go[email]') || document.querySelector('[email]');
      if (!el) return null;
      return { email: el.getAttribute('email') || '', source: 'Email', name: el.getAttribute('name') || txt(el) };
    }
    return null;
  }
  function txt(el) { return el ? (el.textContent || '').trim().slice(0, 120) : ''; }

  // ── Panel ───────────────────────────────────────────────────────────────
  function elt(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function build() {
    if (document.getElementById('dedup-panel')) return;
    var p = elt('div', 'dm-panel' + (collapsed ? ' collapsed' : '')); p.id = 'dedup-panel';

    var head = elt('div', 'dm-h');
    head.appendChild(elt('span', 'dm-logo', 'D'));
    head.appendChild(elt('span', 'dm-name', 'DedupManager'));
    F.mode = elt('span', 'dm-mode'); head.appendChild(F.mode);
    var toggle = elt('span', 'dm-min', collapsed ? '+' : '–');
    toggle.onclick = function () { collapsed = !collapsed; p.classList.toggle('collapsed', collapsed); toggle.textContent = collapsed ? '+' : '–'; chrome.storage.local.set({ barCollapsed: collapsed }); };
    head.appendChild(toggle);
    head.onclick = function (e) { if (collapsed && e.target !== toggle) { collapsed = false; p.classList.remove('collapsed'); toggle.textContent = '–'; chrome.storage.local.set({ barCollapsed: false }); } };
    p.appendChild(head);

    var body = elt('div', 'dm-b'); p.appendChild(body);
    F.chip = elt('div', 'dm-chip'); body.appendChild(F.chip);

    // Primary identifiers — all visible, each auto-checks (check by any of them).
    F.link = field(body, 'Profile link / @handle', 'linkedin · x.com · @handle…', true);
    F.phone = field(body, 'Phone', '+1 415 555 1234');
    F.email = field(body, 'Email', 'jane@acme.com');

    F.checkRow = elt('div', 'dm-actions');
    F.check = elt('button', 'dm-btn ghost', 'Check'); F.check.onclick = function () { check(); };
    F.checkRow.appendChild(F.check);
    body.appendChild(F.checkRow);

    var det = elt('details', 'dm-more'); var sum = elt('summary', null, 'Name, company, source, stage'); det.appendChild(sum);
    F.name = field(det, 'Name', 'Jane Doe');
    F.company = field(det, 'Company', 'Acme');
    F.source = selField(det, 'Source', [''].concat(STATE.sources), '', true);
    F.status = selField(det, 'Stage', STATE.stages, STATE.stages[0], false);
    body.appendChild(det);

    F.save = elt('button', 'dm-btn', 'Log contact'); F.save.onclick = save; body.appendChild(F.save);
    F.msg = elt('div', 'dm-msg'); body.appendChild(F.msg);

    document.body.appendChild(p);
    [F.link, F.phone, F.email].forEach(function (f) {
      f.el.addEventListener('input', function () { dirty = true; if (STATE.active) debouncedCheck(); });
    });
  }
  function field(parent, label, ph, big) {
    var w = elt('label', 'dm-f'); w.appendChild(elt('span', 'dm-l', label));
    var i = document.createElement('input'); i.placeholder = ph || ''; if (big) i.className = 'big';
    w.appendChild(i); parent.appendChild(w); return { wrap: w, el: i,
      get: function () { return i.value.trim(); }, set: function (v) { i.value = v || ''; } };
  }
  function selField(parent, label, opts, val, blankFirst) {
    var w = elt('label', 'dm-f'); w.appendChild(elt('span', 'dm-l', label));
    var s = document.createElement('select'); w.appendChild(s); parent.appendChild(w);
    fillSelect(s, opts, val, blankFirst);
    return { wrap: w, el: s, get: function () { return s.value; }, set: function (v) { s.value = v || ''; } };
  }
  function fillSelect(sel, opts, val, blankFirst) {
    sel.textContent = '';
    if (blankFirst) { var o0 = document.createElement('option'); o0.value = ''; o0.textContent = '— none —'; sel.appendChild(o0); }
    opts.forEach(function (o) { if (o === '' && blankFirst) return; var op = elt('option', null, o); op.value = o; if (o === val) op.selected = true; sel.appendChild(op); });
    if (val) sel.value = val;
  }

  // ── Behaviour ─────────────────────────────────────────────────────────
  function refreshFromPage() {
    if (!F.mode) return;
    F.mode.textContent = STATE.active ? 'auto' : 'manual';
    F.mode.className = 'dm-mode ' + (STATE.active ? 'on' : 'off');
    F.checkRow.style.display = STATE.active ? 'none' : '';   // auto = continuous, no button
    if (!STATE.active) { setChip('idle', 'Manual — type & check'); return; }
    var d = detect();
    var dk = d ? JSON.stringify(d) : 'none@' + location.href;
    if (dirty && dk === lastDetectKey) return;
    lastDetectKey = dk;
    if (d) {
      dirty = false;
      F.link.set(d.link || '');
      F.email.set(d.email || '');
      F.name.set(d.name || '');
      F.company.set(d.company || '');
      if (d.source) F.source.set(d.source);
      check();
    } else {
      setChip('idle', 'No profile here — type to check');
    }
  }

  function candidate() {
    return { link: F.link.get(), phone: F.phone.get(), email: F.email.get(),
      name: F.name.get(), company: F.company.get(), source: F.source.get(), status: F.status.get() };
  }
  function hasId(c) { return c.link || c.phone || c.email; }

  var ct = null;
  function debouncedCheck() { clearTimeout(ct); ct = setTimeout(function () { check(); }, 400); }
  function check() {
    var c = candidate();
    if (!hasId(c)) { setChip('idle', 'Type a link / phone / email'); return; }
    setChip('idle', 'Checking…');
    var res = Matcher.findHits(c, STATE.contacts, STATE.settings);
    if (res.hits.length) {
      var h = res.hits[0];
      setChip('warn', 'In CRM: ' + (h.contact.name || 'match') + ' · ' + (h.contact.added_by || '?') + ' · ' + (h.contact.status || ''));
      F.save.textContent = 'Merge & update as ' + (STATE.me || '—');
    } else {
      setChip('ok', 'Not in CRM yet'); F.save.textContent = 'Log contact as ' + (STATE.me || '—');
    }
  }
  function setChip(kind, text) { if (!F.chip) return; F.chip.className = 'dm-chip ' + kind; F.chip.textContent = text; }

  function save() {
    if (!STATE.me) { F.msg.textContent = 'Pick your name in the popup first.'; return; }
    var c = candidate();
    if (!hasId(c) && !c.source) { F.msg.textContent = 'Add a link/phone/email or a source.'; return; }
    F.save.disabled = true; F.msg.textContent = 'Saving…';
    chrome.runtime.sendMessage({ type: 'add', me: STATE.me, fields: c }, function (r) {
      F.save.disabled = false;
      if (r && r.ok) {
        F.msg.textContent = r.merged ? 'Merged ✓' : 'Logged ✓';
        ['link', 'phone', 'email', 'name', 'company'].forEach(function (k) { F[k].set(''); });
        dirty = false; setTimeout(function () { F.msg.textContent = ''; refreshFromPage(); }, 1200);
      } else { F.msg.textContent = 'Error: ' + ((r && r.error) || 'failed'); }
    });
  }
})();
