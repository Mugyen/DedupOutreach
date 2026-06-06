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
  var STATE = { contacts: [], settings: {}, me: '', active: true, enabled: true, stages: ['New'], sources: [], opacity: 1, pos: null };
  var F = {}, dirty = false, collapsed = false, checkSeq = 0, lastDetectKey = null, hooked = false, dragMoved = false;

  chrome.storage.local.get(['contacts', 'settings', 'me', 'activeMode', 'barEnabled', 'barCollapsed', 'barOpacity', 'barPos'], function (s) {
    apply(s); collapsed = !!s.barCollapsed;
    if (STATE.enabled) { build(); hook(); refreshFromPage(); }
  });
  chrome.storage.onChanged.addListener(function (ch) {
    var s = {};
    ['contacts', 'settings', 'me', 'activeMode', 'barEnabled', 'barOpacity', 'barPos'].forEach(function (k) { if (ch[k]) s[k] = ch[k].newValue; });
    apply(s);
    if (ch.barEnabled !== undefined) {                 // global on/off
      if (STATE.enabled) { build(); hook(); lastDetectKey = null; dirty = false; refreshFromPage(); }
      else remove();
      return;
    }
    if (!STATE.enabled) return;
    if (ch.barOpacity !== undefined || ch.barPos !== undefined) applyChrome();   // live opacity/position
    if (ch.settings && F.source) { fillSelect(F.source.el, [''].concat(STATE.sources), F.source.get(), true); fillSelect(F.status.el, STATE.stages, F.status.get(), false); }
    if (ch.activeMode !== undefined) { lastDetectKey = null; dirty = false; refreshFromPage(); }  // re-render on mode switch
    else if (ch.contacts) check();
  });
  function apply(s) {
    if (s.contacts !== undefined) STATE.contacts = s.contacts || [];
    if (s.settings !== undefined) STATE.settings = s.settings || {};
    if (s.me !== undefined) STATE.me = s.me || '';
    if (s.activeMode !== undefined) STATE.active = s.activeMode !== false;
    if (s.barEnabled !== undefined) STATE.enabled = s.barEnabled !== false;
    if (s.barOpacity !== undefined) STATE.opacity = (typeof s.barOpacity === 'number') ? s.barOpacity : 1;
    if (s.barPos !== undefined) STATE.pos = s.barPos || null;
    STATE.stages = list(STATE.settings.stages, 'New');
    STATE.sources = list(STATE.settings.sources, 'LinkedIn,Email,Phone,WhatsApp,Slack,Twitter/X,Reddit,Other');
  }
  function list(v, fb) { return String(v || fb).split(',').map(function (x) { return x.trim(); }).filter(Boolean); }

  // ── SPA navigation hook ────────────────────────────────────────────────
  function hook() {
    if (hooked) return; hooked = true;
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
  function remove() { var b = document.getElementById('dedup-panel'); if (b) b.remove(); F = {}; }

  function build() {
    if (!STATE.enabled) return;                       // never show while disabled
    if (document.getElementById('dedup-panel')) return;
    var p = elt('div', 'dm-panel' + (collapsed ? ' collapsed' : '')); p.id = 'dedup-panel';
    p.dataset.status = 'idle';
    F.panel = p;

    var head = elt('div', 'dm-h');
    head.appendChild(elt('span', 'dm-logo', 'D'));
    head.appendChild(elt('span', 'dm-name', 'DedupManager'));
    F.mode = elt('span', 'dm-mode'); head.appendChild(F.mode);
    head.title = 'Drag to move · click to ' + (collapsed ? 'expand' : 'minimize');
    p.appendChild(head);
    F.head = head;

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
    applyChrome();                 // opacity + saved position
    makeDraggable(p, head);        // drag header to move; tap header to minimize/expand
    [F.link, F.phone, F.email].forEach(function (f) {
      f.el.addEventListener('input', function () { dirty = true; if (STATE.active) debouncedCheck(); });
    });
    [F.name, F.company].forEach(function (f) {           // editing these must not be clobbered
      f.el.addEventListener('input', function () { dirty = true; });
    });
  }

  // ── Position, opacity, drag, collapse ───────────────────────────────────
  function clampX(x) { return Math.min(Math.max(0, x), Math.max(0, window.innerWidth - (F.panel.offsetWidth || 60))); }
  function clampY(y) { return Math.min(Math.max(0, y), Math.max(0, window.innerHeight - (F.panel.offsetHeight || 60))); }
  function applyChrome() {
    if (!F.panel) return;
    F.panel.style.opacity = String(STATE.opacity);
    if (STATE.pos && typeof STATE.pos.left === 'number') {
      F.panel.style.left = clampX(STATE.pos.left) + 'px';
      F.panel.style.top = clampY(STATE.pos.top) + 'px';
      F.panel.style.right = 'auto'; F.panel.style.bottom = 'auto';
    }
  }
  function toggleCollapse() {
    collapsed = !collapsed;
    F.panel.classList.toggle('collapsed', collapsed);
    if (F.head) F.head.title = 'Drag to move · click to ' + (collapsed ? 'expand' : 'minimize');
    chrome.storage.local.set({ barCollapsed: collapsed });
  }
  function makeDraggable(panel, handle) {
    handle.addEventListener('mousedown', function (e) {
      if (e.button !== 0 || e.target.closest('input,select,textarea,button,a,summary')) return;
      e.preventDefault();
      var r = panel.getBoundingClientRect(), ox = r.left, oy = r.top, sx = e.clientX, sy = e.clientY;
      dragMoved = false;
      panel.style.left = ox + 'px'; panel.style.top = oy + 'px'; panel.style.right = 'auto'; panel.style.bottom = 'auto';
      function mm(ev) {
        if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 4) dragMoved = true;
        panel.style.left = clampX(ox + ev.clientX - sx) + 'px';
        panel.style.top = clampY(oy + ev.clientY - sy) + 'px';
      }
      function mu() {
        document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu);
        if (dragMoved) {
          STATE.pos = { left: parseInt(panel.style.left, 10), top: parseInt(panel.style.top, 10) };
          chrome.storage.local.set({ barPos: STATE.pos });
        } else {
          toggleCollapse();          // a tap (no drag) on the header minimizes/expands
        }
      }
      document.addEventListener('mousemove', mm);
      document.addEventListener('mouseup', mu);
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
    if (!STATE.enabled) { remove(); return; }
    if (!F.mode || !document.getElementById('dedup-panel')) build();
    if (!F.mode) return;
    F.mode.textContent = STATE.active ? 'auto' : 'manual';
    F.mode.className = 'dm-mode ' + (STATE.active ? 'on' : 'off');
    F.checkRow.style.display = STATE.active ? 'none' : '';   // auto = continuous, no button
    if (!STATE.active) { setChip('idle', 'Manual — type & check'); return; }
    var d = detect();
    // Key the profile on its identifiers + path, NOT on name/company (those DOM
    // bits mutate constantly on LinkedIn and would otherwise re-trigger fills).
    var dk = d ? JSON.stringify([d.link, d.email, d.reddit, d.phone]) : 'none@' + location.pathname;
    if (dk === lastDetectKey) return;       // same profile already handled → never re-fill/clobber what you're editing
    lastDetectKey = dk;
    dirty = false;
    if (d) {
      F.link.set(d.link || '');
      F.email.set(d.email || '');
      F.name.set(d.name || '');
      F.company.set(d.company || '');
      if (d.source) F.source.set(d.source);
      check();                               // ONE live lookup per new profile
    } else {
      F.link.set(''); F.phone.set(''); F.email.set('');
      setChip('idle', 'No profile here — type to check');
    }
  }

  function candidate() {
    return { link: F.link.get(), phone: F.phone.get(), email: F.email.get(),
      name: F.name.get(), company: F.company.get(), source: F.source.get(), status: F.status.get() };
  }
  function hasId(c) { return c.link || c.phone || c.email; }

  var ct = null;
  function debouncedCheck() { clearTimeout(ct); ct = setTimeout(check, 400); }
  function check() {
    var c = candidate();
    if (!hasId(c)) { setChip('idle', 'Type a link / phone / email'); return; }
    setChip('idle', 'Checking…');
    var my = ++checkSeq;                                  // newer check supersedes an older one
    chrome.runtime.sendMessage({ type: 'check', fields: c }, function (r) {
      if (my !== checkSeq) return;                        // stale reply — ignore
      if (!r || r.ok !== true) { setChip('idle', 'Couldn’t reach CRM — saving still dedupes'); return; }
      renderChip(r.hits || []);
    });
  }
  function renderChip(hits) {
    if (hits.length) {
      var p = hits[0].contact;
      setChip('warn', 'In CRM: ' + (p.name || 'match') + ' · ' + (p.added_by || '?') + ' · ' + (p.status || ''));
      F.save.textContent = 'Merge & update as ' + (STATE.me || '—');
    } else {
      setChip('ok', 'Not in CRM yet'); F.save.textContent = 'Log contact as ' + (STATE.me || '—');
    }
  }
  function setChip(kind, text) {
    if (F.panel) F.panel.dataset.status = kind;     // drives the collapsed circle colour
    if (!F.chip) return;
    F.chip.className = 'dm-chip ' + kind; F.chip.textContent = text;
  }

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
