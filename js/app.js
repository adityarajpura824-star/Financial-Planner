/*!
 * app.js - UI for Financial Planner.
 * Everything runs client-side and synchronously: every keystroke recomputes in well under a frame.
 * Text coming from inputs is only ever written with textContent; the chart SVG is built from numbers
 * and fixed labels (never from user text).
 */
(function () {
  'use strict';

  var C = window.FPCalc;
  var RT = window.FPRates;
  var NS = 'http://www.w3.org/2000/svg';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* =====================================================================
     Formatting
     ===================================================================== */
  var inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  var dec2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

  function fmtMoney(n) {
    if (!Number.isFinite(n)) return '—';
    var r = Math.round(n);
    return (r < 0 ? '−' : '') + inr.format(Math.abs(r));
  }

  function trimNum(n) { return String(+Number(n).toFixed(2)); }

  /** Compact words: 1,23,45,678 -> ₹1.23 Cr. */
  function fmtWords(n) {
    if (!Number.isFinite(n)) return '—';
    var a = Math.abs(n), s = n < 0 ? '−' : '';
    if (a >= 1e7) return s + '₹' + dec2.format(a / 1e7) + ' Cr';
    if (a >= 1e5) return s + '₹' + dec2.format(a / 1e5) + ' L';
    if (a >= 1e3) return s + '₹' + dec2.format(a / 1e3) + ' K';
    return s + '₹' + Math.round(a);
  }

  function fmtPct(frac, d) {
    if (!Number.isFinite(frac)) return '—';
    var x = frac * 100;
    var digits = d == null ? 2 : d;
    if (Math.abs(x) < Math.pow(10, -digits) / 2) return (0).toFixed(digits) + '%';
    var s = x.toFixed(digits);
    return (s.charAt(0) === '-' ? '−' + s.slice(1) : s) + '%';
  }

  function fmtYears(y) {
    if (!Number.isFinite(y)) return '—';
    var total = Math.round(y * 12);
    var Y = Math.floor(total / 12), M = total % 12, parts = [];
    if (Y) parts.push(Y + (Y === 1 ? ' yr' : ' yrs'));
    if (M) parts.push(M + ' mo');
    return parts.length ? parts.join(' ') : '0 mo';
  }

  /** Indian digit grouping for a string of digits: 1234567 -> 12,34,567. */
  function groupIN(d) {
    if (d.length <= 3) return d;
    return d.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + d.slice(-3);
  }

  function fmtIN(n) {
    var parts = (Math.round(n * 100) / 100).toFixed(2).split('.');
    var frac = parts[1].replace(/0+$/, '');
    return groupIN(parts[0]) + (frac ? '.' + frac : '');
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* =====================================================================
     Field definitions and state
     ===================================================================== */
  var FD_NAMES = { 1: 'yearly', 2: 'half-yearly', 4: 'quarterly', 12: 'monthly' };
  var TAX_NAMES = { equity: 'equity LTCG', slab: 'slab tax on gains', none: 'no tax' };

  var DEFS = [
    { id: 'lump', kind: 'money', label: { plan: 'Lump sum today', goal: 'Already saved', _: 'Lump sum' }, modes: ['plan', 'goal'], min: 0, max: 1e11, opt: true, def: 500000 },
    { id: 'sip', kind: 'money', label: 'Monthly SIP', modes: ['plan'], min: 0, max: 1e9, opt: true, def: 25000 },
    { id: 'gTarget', kind: 'money', label: 'Goal amount', modes: ['goal'], min: 1, max: 1e12, def: 10000000 },
    { id: 'gReal', kind: 'check', label: 'Goal is in today’s money (inflate it)', modes: ['goal'], def: true },
    { id: 'cStart', kind: 'money', label: 'Start value', modes: ['cagr'], min: 0, max: 1e13, def: 500000, solves: 'start' },
    { id: 'cEnd', kind: 'money', label: 'End value', modes: ['cagr'], min: 0, max: 1e14, def: 1200000, solves: 'end' },
    { id: 'cYears', kind: 'num', label: 'Years', modes: ['cagr'], min: 0, max: 200, def: 7, half: true, step: 1, solves: 'years' },
    { id: 'cMonths', kind: 'num', label: 'Months', modes: ['cagr'], min: 0, max: 2400, def: 0, half: true, step: 1, int: true, opt: true, solves: 'years' },
    { id: 'cRate', kind: 'pct', label: 'CAGR', modes: ['cagr'], min: -99.9, max: 10000, def: 12, step: 0.5, neg: true, solves: 'rate' },
    { id: 'years', kind: 'num', label: 'Tenure', suffix: 'yrs', modes: ['plan', 'goal'], min: 0.1, max: 60, def: 15, slider: [1, 40, 1], half: true, step: 1 },
    { id: 'stepUp', kind: 'pct', label: 'Step-up / yr', modes: ['plan', 'goal'], min: 0, max: 100, def: 10, slider: [0, 25, 1], half: true, opt: true, step: 1 },
    { id: 'ret', kind: 'pct', label: 'Expected return', modes: ['plan', 'goal'], min: -50, max: 100, def: 12, slider: [1, 30, 0.5], half: true, step: 0.5, neg: true },
    { id: 'fd', kind: 'pct', label: { plan: 'Bank FD rate', goal: 'Bank FD rate', cagr: 'Bank FD rate (to compare)' }, modes: ['plan', 'goal', 'cagr'], min: 0, max: 50, def: 6.3, slider: [0, 12, 0.05], half: true, step: 0.1 },
    { id: 'infl', kind: 'pct', label: 'Inflation', modes: ['plan', 'goal'], min: 0, max: 50, def: 6, slider: [0, 12, 0.5], half: true, step: 0.5 },
    { id: 'slab', kind: 'pct', label: 'Tax slab (FD interest)', modes: ['plan'], min: 0, max: 50, def: 30, slider: [0, 30, 5], half: true, step: 1 },
    { id: 'ltcg', kind: 'pct', adv: true, label: 'LTCG tax rate', modes: ['plan'], min: 0, max: 50, def: 12.5, half: true, step: 0.5 },
    { id: 'exempt', kind: 'money', adv: true, label: 'LTCG exemption / yr', modes: ['plan'], min: 0, max: 1e9, def: 125000, half: true, opt: true }
  ];

  var S = {
    mode: 'plan', basis: 'real', solve: 'rate', theme: 'dark',
    v: {}, err: {},
    o: { secTax: 'equity', fdComp: 4, sipStart: true }
  };
  var LAST = { text: '', live: '' };

  function labelFor(def, mode) {
    if (typeof def.label === 'string') return def.label;
    return def.label[mode] || def.label._ || def.label.plan;
  }

  function defText(def) {
    if (def.kind === 'check') return '';
    return def.kind === 'money' ? fmtIN(def.def) : trimNum(def.def);
  }

  /* =====================================================================
     Building the input fields
     ===================================================================== */
  function buildField(def) {
    var wrap, input;

    if (def.kind === 'check') {
      wrap = el('label', 'check field');
      input = el('input');
      input.type = 'checkbox';
      input.id = 'f-' + def.id;
      input.checked = !!def.def;
      wrap.append(input, el('span', null, def.label));
      wrap.dataset.id = def.id;
      wrap.dataset.modes = def.modes.join(' ');
      input.addEventListener('change', function () { readField(def); schedule(); });
      return wrap;
    }

    wrap = el('div', 'field' + (def.half ? ' half' : ''));
    wrap.dataset.id = def.id;
    wrap.dataset.modes = def.modes.join(' ');

    var head = el('div', 'field-head');
    var label = el('label', null, labelFor(def, S.mode));
    label.htmlFor = 'f-' + def.id;
    label.id = 'l-' + def.id;
    head.append(label);
    if (def.opt) head.append(el('span', 'opt', 'optional'));
    if (def.solves) { var calc = el('span', 'opt calc', 'calculated'); calc.hidden = true; head.append(calc); }
    wrap.append(head);

    var ctl = el('div', 'control');
    if (def.kind === 'money') ctl.append(el('span', 'affix', '₹'));
    input = el('input');
    input.id = 'f-' + def.id;
    input.type = 'text';
    input.setAttribute('inputmode', 'decimal');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('enterkeyhint', 'done');
    input.setAttribute('aria-describedby', 'e-' + def.id + (def.kind === 'money' ? ' w-' + def.id : ''));
    ctl.append(input);
    var suffix = def.kind === 'pct' ? '%' : def.suffix;
    if (suffix) ctl.append(el('span', 'affix post', suffix));
    if (def.neg) {
      var sg = el('button', 'sign', '±');
      sg.type = 'button';
      sg.setAttribute('aria-label', 'Flip sign of ' + labelFor(def, 'plan'));
      sg.addEventListener('mousedown', function (e) { e.preventDefault(); });
      sg.addEventListener('click', function () {
        var cur = S.v[def.id];
        if (Number.isFinite(cur)) setFieldValue(def, -cur);
      });
      ctl.append(sg);
    }
    wrap.append(ctl);

    if (def.slider) {
      var sl = el('input', 'slider');
      sl.type = 'range';
      sl.id = 's-' + def.id;
      sl.min = def.slider[0]; sl.max = def.slider[1]; sl.step = def.slider[2];
      sl.value = def.def;
      sl.tabIndex = -1; /* the text box is the keyboard route; the slider is for touch and mouse */
      sl.setAttribute('aria-label', labelFor(def, 'plan') + ' slider');
      sl.addEventListener('input', function () {
        var n = +Number(sl.value).toFixed(2);
        input.value = trimNum(n);
        readField(def);
        schedule();
      });
      wrap.append(sl);
    }

    if (def.kind === 'money') {
      var row = el('div', 'words-row');
      var words = el('span', 'words', '');
      words.id = 'w-' + def.id;
      var chips = el('div', 'chips');
      if (def.kind === 'money') {
        [['K', 1e3, 'thousand'], ['L', 1e5, 'lakh'], ['Cr', 1e7, 'crore']].forEach(function (c) {
          var b = el('button', 'chip', '×' + c[0]);
          b.type = 'button';
          b.setAttribute('aria-label', 'Multiply ' + labelFor(def, 'plan') + ' by one ' + c[2]);
          b.addEventListener('mousedown', function (e) { e.preventDefault(); });
          b.addEventListener('click', function () {
            var cur = S.v[def.id];
            setFieldValue(def, (Number.isFinite(cur) && cur > 0 ? cur : 1) * c[1]);
          });
          chips.append(b);
        });
      }
      row.append(words, chips);
      wrap.append(row);
    }

    var err = el('p', 'err');
    err.id = 'e-' + def.id;
    err.hidden = true;
    wrap.append(err);

    input.addEventListener('input', function () { onInput(def, input); });
    input.addEventListener('keydown', function (e) {
      if (e.isComposing) return;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        nudge(def, e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      }
    });
    input.addEventListener('blur', function () { tidy(def, input); });
    return wrap;
  }

  function buildSolve() {
    var wrap = el('div', 'field solve');
    wrap.dataset.id = 'solve';
    wrap.dataset.modes = 'cagr';
    var head = el('div', 'field-head');
    var l = el('span', 'lbl', 'Solve for');
    l.id = 'solve-l';
    head.append(l);
    var seg = el('div', 'seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-labelledby', 'solve-l');
    [['rate', 'CAGR'], ['end', 'End value'], ['start', 'Start value'], ['years', 'Years']].forEach(function (p) {
      var b = el('button', null, p[1]);
      b.type = 'button';
      b.dataset.solve = p[0];
      b.setAttribute('aria-pressed', String(p[0] === S.solve));
      b.addEventListener('click', function () { setSolve(p[0]); });
      seg.append(b);
    });
    wrap.append(head, seg);
    return wrap;
  }

  /* =====================================================================
     Reading and sanitising input
     ===================================================================== */
  function setCaret(input, pos) {
    try { input.setSelectionRange(pos, pos); } catch (e) { /* not focusable yet */ }
  }

  function formatMoneyInput(input) {
    var raw = input.value;
    var caret = input.selectionStart == null ? raw.length : input.selectionStart;
    var s = raw.replace(/[,\s₹]/g, '');

    /* shorthand: 5l -> 5,00,000   2.5cr -> 2,50,00,000   50k -> 50,000 */
    var m = /^(\d*\.?\d*)([klc])/i.exec(s);
    if (m && /\d/.test(m[1])) {
      var mult = { k: 1e3, l: 1e5, c: 1e7 }[m[2].toLowerCase()];
      input.value = fmtIN(parseFloat(m[1]) * mult);
      setCaret(input, input.value.length);
      return;
    }

    var before = raw.slice(0, caret).replace(/[^\d.]/g, '').length;
    var clean = s.replace(/[^\d.]/g, '');
    var dot = clean.indexOf('.');
    var intPart = dot < 0 ? clean : clean.slice(0, dot);
    var frac = dot < 0 ? null : clean.slice(dot + 1).replace(/\./g, '').slice(0, 2);
    intPart = intPart.replace(/^0+(?=\d)/, '');
    var out = groupIN(intPart || (frac !== null ? '0' : '')) + (frac !== null ? '.' + frac : '');
    if (out !== raw) {
      input.value = out;
      var pos = 0, seen = 0;
      while (pos < out.length && seen < before) { if (/[\d.]/.test(out.charAt(pos))) seen++; pos++; }
      setCaret(input, pos);
    }
  }

  function sanitizeNumInput(input, def) {
    var raw = input.value;
    var caret = input.selectionStart == null ? raw.length : input.selectionStart;
    var s = raw.replace(def.neg ? /[^\d.\-]/g : /[^\d.]/g, '');
    var neg = !!def.neg && s.charAt(0) === '-';
    s = s.replace(/-/g, '');
    var dot = s.indexOf('.');
    if (dot >= 0) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '').slice(0, 2);
    if (def.int) s = s.replace(/\./g, '');
    s = (neg ? '-' : '') + s;
    if (s !== raw) {
      input.value = s;
      setCaret(input, Math.max(0, caret - (raw.length - s.length)));
    }
  }

  function rangeMsg(def) {
    if (def.kind === 'money') return 'Use an amount between ' + fmtWords(def.min) + ' and ' + fmtWords(def.max);
    if (def.kind === 'pct') return 'Use a rate between ' + def.min + '% and ' + def.max + '%';
    return 'Use a value between ' + def.min + ' and ' + def.max + (def.suffix ? ' ' + def.suffix : '');
  }

  /** Parse the field's text into S.v[id] (number or null) and S.err[id]. */
  function readField(def) {
    var input = $('#f-' + def.id);
    if (def.kind === 'check') { S.v[def.id] = input.checked; S.err[def.id] = ''; return; }
    var t = input.value.replace(/[,\s₹]/g, '');
    var n = null, err = '';
    if (t === '') {
      if (def.opt) n = 0; else err = 'Required';
    } else if (!/^-?\d*\.?\d*$/.test(t) || !/\d/.test(t)) {
      err = 'Enter a number';
    } else {
      n = Number(t);
      if (!Number.isFinite(n)) { n = null; err = 'Enter a number'; }
      else if (n < def.min || n > def.max) err = rangeMsg(def);
    }
    S.v[def.id] = n;
    S.err[def.id] = err;
    var w = $('#w-' + def.id);
    if (w && def.kind === 'money') w.textContent = Number.isFinite(n) && n > 0 ? fmtWords(n) : '';
    var sl = $('#s-' + def.id);
    if (sl && Number.isFinite(n)) sl.value = n;
  }

  function onInput(def, input) {
    if (def.kind === 'money') formatMoneyInput(input); else sanitizeNumInput(input, def);
    readField(def);
    schedule();
  }

  function tidy(def, input) {
    if (input.disabled) return;
    var n = S.v[def.id];
    if (Number.isFinite(n) && input.value.trim() !== '' && !S.err[def.id]) {
      input.value = def.kind === 'money' ? fmtIN(n) : trimNum(n);
    }
  }

  function setFieldValue(def, n) {
    var input = $('#f-' + def.id);
    n = Math.round(n * 100) / 100;
    input.value = def.kind === 'money' ? fmtIN(n) : trimNum(n);
    readField(def);
    schedule();
  }

  function moneyStep(v) {
    if (!(v > 0)) return 1000;
    return Math.max(100, Math.pow(10, Math.floor(Math.log10(v)) - 1));
  }

  function nudge(def, dir, big) {
    var input = $('#f-' + def.id);
    if (input.disabled) return;
    var cur = S.v[def.id];
    var base = Number.isFinite(cur) ? cur : def.def;
    var step = def.kind === 'money' ? moneyStep(base) : (def.step || 1);
    if (big) step *= 10;
    var nv = Math.min(def.max, Math.max(def.min, base + dir * step));
    setFieldValue(def, nv);
  }

  /* =====================================================================
     Modes, solve target, basis, theme
     ===================================================================== */
  function applyMode() {
    $$('[data-modes]').forEach(function (n) {
      n.hidden = n.dataset.modes.split(' ').indexOf(S.mode) < 0;
    });
    DEFS.forEach(function (d) {
      if (d.kind === 'check') return;
      var l = $('#l-' + d.id);
      if (l) l.textContent = labelFor(d, S.mode);
    });
    $$('.view').forEach(function (v) { v.hidden = v.dataset.view !== S.mode; });
    $$('.mode').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode)); });
    applySolveUI();
  }

  function applySolveUI() {
    $$('.solve .seg button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.solve === S.solve)); });
    DEFS.forEach(function (d) {
      if (!d.solves) return;
      var solved = S.mode === 'cagr' && d.solves === S.solve;
      var input = $('#f-' + d.id);
      var wrap = input.closest('.field');
      input.disabled = solved;
      wrap.classList.toggle('solved', solved);
      var tag = $('.calc', wrap);
      if (tag) tag.hidden = !solved;
    });
  }

  function setMode(m) {
    if (S.mode === m) return;
    S.mode = m;
    applyMode();
    schedule(true);
  }

  function setSolve(s) {
    S.solve = s;
    applySolveUI();
    schedule(true);
  }

  function setBasis(b) {
    S.basis = b;
    $$('[data-basis]').forEach(function (n) { n.setAttribute('aria-pressed', String(n.dataset.basis === b)); });
    schedule(true);
  }

  function setTheme(t) {
    S.theme = t;
    document.documentElement.setAttribute('data-theme', t);
    var btn = $('#btn-theme');
    btn.setAttribute('aria-label', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    var meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#0a1020' : '#f1f5fb');
    queueSave();
  }

  /* =====================================================================
     Scheduling, persistence
     ===================================================================== */
  var raf = 0;
  function schedule() {
    if (!raf) raf = requestAnimationFrame(render);
  }

  var SKEY = 'fp.state.v1';
  var saveTimer = 0;
  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 250);
  }

  function save() {
    try {
      var text = {};
      DEFS.forEach(function (d) {
        var i = $('#f-' + d.id);
        text[d.id] = d.kind === 'check' ? i.checked : i.value;
      });
      localStorage.setItem(SKEY, JSON.stringify({
        v: 1, theme: S.theme, mode: S.mode, basis: S.basis, solve: S.solve,
        o: { secTax: S.o.secTax, fdComp: S.o.fdComp, sipStart: S.o.sipStart }, text: text
      }));
    } catch (e) { /* storage blocked: the app still works, it just will not remember */ }
  }

  function restore() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch (e) { saved = null; }
    if (!saved || saved.v !== 1) return;
    if (saved.theme === 'light' || saved.theme === 'dark') S.theme = saved.theme;
    if (['plan', 'cagr', 'goal'].indexOf(saved.mode) >= 0) S.mode = saved.mode;
    if (['pre', 'post', 'real'].indexOf(saved.basis) >= 0) S.basis = saved.basis;
    if (['rate', 'end', 'start', 'years'].indexOf(saved.solve) >= 0) S.solve = saved.solve;
    if (saved.o) {
      if (['equity', 'slab', 'none'].indexOf(saved.o.secTax) >= 0) S.o.secTax = saved.o.secTax;
      if ([1, 2, 4, 12].indexOf(saved.o.fdComp) >= 0) S.o.fdComp = saved.o.fdComp;
      if (typeof saved.o.sipStart === 'boolean') S.o.sipStart = saved.o.sipStart;
    }
    if (saved.text && typeof saved.text === 'object') {
      DEFS.forEach(function (d) {
        var t = saved.text[d.id];
        var i = $('#f-' + d.id);
        if (d.kind === 'check') { if (typeof t === 'boolean') i.checked = t; }
        else if (typeof t === 'string' && t.length < 30 && /^[-\d.,]*$/.test(t)) i.value = t;
      });
    }
  }

  /* =====================================================================
     Computation
     ===================================================================== */
  function visibleDefs() {
    return DEFS.filter(function (d) {
      return d.modes.indexOf(S.mode) >= 0 && !(S.mode === 'cagr' && d.solves === S.solve);
    });
  }

  function fail(msg) { return { error: msg }; }

  function computePlan() {
    var v = S.v, o = S.o;
    if (!(v.lump > 0) && !(v.sip > 0)) return fail('Enter a lump sum or a monthly SIP to project.');
    var months = Math.max(1, Math.round(v.years * 12));
    var infl = v.infl / 100;
    var gSec = C.monthlyEffective(v.ret);
    var gFd = C.monthlyNominal(v.fd, o.fdComp);
    var sched = { lump: v.lump, sip: v.sip, stepUp: v.stepUp / 100, months: months, sipAtStart: o.sipStart };
    var sec = C.project({ lump: v.lump, sip: v.sip, stepUp: sched.stepUp, months: months, sipAtStart: o.sipStart, g: gSec });
    var fdPre = C.project({ lump: v.lump, sip: v.sip, stepUp: sched.stepUp, months: months, sipAtStart: o.sipStart, g: gFd });
    var fdPost = C.project({ lump: v.lump, sip: v.sip, stepUp: sched.stepUp, months: months, sipAtStart: o.sipStart, g: gFd, interestTax: v.slab / 100 });
    var taxP = { exemption: v.exempt, ltcg: v.ltcg / 100, slab: v.slab / 100 };

    var rows = sec.snaps.map(function (s, i) {
      var secPost = s.balance - C.exitTax(s.balance, s.invested, o.secTax, taxP);
      var defl = Math.pow(1 + infl, s.t);
      var fp = fdPost.snaps[i].balance;
      return {
        t: s.t, inv: s.invested,
        secPre: s.balance, secPost: secPost, secReal: secPost / defl,
        fdPre: fdPre.snaps[i].balance, fdPost: fp, fdReal: fp / defl
      };
    });
    var last = rows[rows.length - 1];
    var years = months / 12;
    var irr = {
      secPre: C.irr(sched, last.secPre), secPost: C.irr(sched, last.secPost),
      fdPre: C.irr(sched, last.fdPre), fdPost: C.irr(sched, last.fdPost)
    };
    function real(nom) { return nom == null ? null : (1 + nom) / (1 + infl) - 1; }
    return { months: months, years: years, rows: rows, last: last, irr: irr, real: { sec: real(irr.secPost), fd: real(irr.fdPost) }, taxP: taxP };
  }

  function computeCagr() {
    var v = S.v, solve = S.solve;
    var years = (v.cYears || 0) + (v.cMonths || 0) / 12;
    var start = v.cStart, end = v.cEnd;
    var rate = v.cRate == null ? null : v.cRate / 100;

    if (solve === 'rate') {
      if (!(start > 0)) return fail('Start value must be above zero to work out a growth rate.');
      if (!(years > 0)) return fail('Enter a period in years and/or months.');
      rate = C.solveGrowth('rate', { start: start, end: end, years: years });
    } else if (solve === 'end') {
      if (!(years > 0)) return fail('Enter a period in years and/or months.');
      end = C.solveGrowth('end', { start: start, years: years, rate: rate });
    } else if (solve === 'start') {
      if (!(years > 0)) return fail('Enter a period in years and/or months.');
      start = C.solveGrowth('start', { end: end, years: years, rate: rate });
    } else {
      if (!(start > 0) || !(end > 0)) return fail('Start and end values must both be above zero to work out the time needed.');
      if (rate === 0) return fail('At a 0% rate the value never changes, so there is no time to solve for.');
      years = C.solveGrowth('years', { start: start, end: end, rate: rate });
      if (years == null) return fail('At this rate the value moves away from the end value. Check the rate’s sign.');
    }
    if (!Number.isFinite(rate) || !Number.isFinite(end) || !Number.isFinite(start) || !Number.isFinite(years)) {
      return fail('Those inputs do not give a valid result. Check the values.');
    }
    return { start: start, end: end, years: years, rate: rate, fdEff: C.effectiveFromNominal(S.v.fd, S.o.fdComp) };
  }

  function computeGoal() {
    var v = S.v, o = S.o;
    var months = Math.max(1, Math.round(v.years * 12));
    var years = months / 12;
    var infl = v.infl / 100;
    var target = v.gReal ? v.gTarget * Math.pow(1 + infl, years) : v.gTarget;
    var step = v.stepUp / 100;
    function side(g) {
      var q = C.requiredSip({ target: target, lump: v.lump, months: months, g: g, stepUp: step, sipAtStart: o.sipStart });
      var path = C.project({ lump: v.lump, sip: q.sip, stepUp: step, months: months, g: g, sipAtStart: o.sipStart });
      var topUp = Math.max(0, C.requiredLump({ target: target, months: months, g: g }) - v.lump);
      return { sip: q.sip, onTrack: q.onTrack, path: path, topUp: topUp, finalSip: q.sip * Math.pow(1 + step, Math.floor((months - 1) / 12)) };
    }
    return {
      months: months, years: years, target: target, infl: infl,
      sec: side(C.monthlyEffective(v.ret)), fd: side(C.monthlyNominal(v.fd, o.fdComp))
    };
  }

  /* =====================================================================
     Painting helpers
     ===================================================================== */
  /** Write mixed plain/bold text. parts: strings or {b:'bold', c:'class'}. */
  function say(node, parts) {
    node.textContent = '';
    parts.forEach(function (p) {
      if (typeof p === 'string') node.append(document.createTextNode(p));
      else node.append(el('strong', p.c || null, p.b));
    });
  }

  function fillStats(dl, rows) {
    dl.textContent = '';
    rows.forEach(function (r) {
      var d = el('div', 'stat' + (r[2] ? ' ' + r[2] : ''));
      d.append(el('dt', null, r[0]), el('dd', null, r[1]));
      dl.append(d);
    });
  }

  /** Write a headline number; very long figures get a smaller type size so they never break mid-digit. */
  function fitHero(node, text) {
    node.textContent = text;
    node.dataset.long = text.length > 16 ? '1' : '';
  }

  function setHero(prefix, value) {
    fitHero($('#' + prefix + '-hero'), fmtMoney(value));
    $('#' + prefix + '-words').textContent = Number.isFinite(value) && Math.abs(value) >= 1000 ? fmtWords(value) : ' ';
  }

  function fillTable(table, rows) {
    var tb = $('tbody', table);
    tb.textContent = '';
    rows.forEach(function (r) {
      var tr = el('tr');
      r.forEach(function (c) { tr.append(el('td', c[1] || null, c[0])); });
      tb.append(tr);
    });
  }

  function setDock(items) {
    for (var i = 0; i < 3; i++) {
      $('#dock-k' + (i + 1)).textContent = items[i] ? items[i][0] : '';
      $('#dock-v' + (i + 1)).textContent = items[i] ? items[i][1] : '—';
    }
  }

  /* ---------- chart ---------- */
  function niceTicks(max, n) {
    var raw = max / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    var nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    var step = nf * mag, out = [];
    for (var k = 0; k * step < max + step * 0.999 && k < 14; k++) out.push(k * step);
    return out;
  }

  function drawLegend(node, series) {
    node.textContent = '';
    series.forEach(function (s) {
      var item = el('span', 'lg');
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('width', '30'); svg.setAttribute('height', '10'); svg.setAttribute('aria-hidden', 'true');
      var ln = document.createElementNS(NS, 'line');
      ln.setAttribute('x1', '1'); ln.setAttribute('x2', '29'); ln.setAttribute('y1', '5'); ln.setAttribute('y2', '5');
      ln.setAttribute('class', 'lg-' + s.cls);
      ln.setAttribute('stroke-linecap', 'round');
      svg.append(ln);
      item.append(svg, document.createTextNode(s.name));
      node.append(item);
    });
  }

  function bindChart(host) {
    function pos(e) {
      var g = host._geom, cfg = host._cfg, svg = $('svg', host);
      if (!g || !cfg || !svg) return;
      var rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      var px = (e.clientX - rect.left) * (g.W / rect.width);
      if (px < g.m.l - 8 || px > g.W - g.m.r + 8) { hideHover(host); return; }
      var t = Math.min(g.maxT, Math.max(0, (px - g.m.l) / g.iw * g.maxT));
      var ref = cfg.series[0].data, idx = 0, best = Infinity;
      for (var i = 0; i < ref.length; i++) {
        var d = Math.abs(ref[i].t - t);
        if (d < best) { best = d; idx = i; }
      }
      showHover(host, idx, rect.width / g.W);
    }
    host.addEventListener('pointermove', pos);
    host.addEventListener('pointerdown', pos);
    host.addEventListener('pointerleave', function () { hideHover(host); });
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(function () {
        var w = Math.round(host.clientWidth);
        if (host._cfg && Math.abs(w - (host._w || 0)) > 1) drawChart(host, host._cfg);
      }).observe(host);
    } else {
      window.addEventListener('resize', function () { if (host._cfg) drawChart(host, host._cfg); });
    }
  }

  function hideHover(host) {
    var hv = $('.hv', host), tip = $('.tip', host);
    if (hv) hv.textContent = '';
    if (tip) tip.hidden = true;
  }

  function showHover(host, idx, scale) {
    var g = host._geom, cfg = host._cfg;
    var hv = $('.hv', host), tip = $('.tip', host);
    if (!hv || !tip) return;
    var t = cfg.series[0].data[idx].t, x = g.X(t);
    var html = '<line class="hv-l" x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="' + g.m.t + '" y2="' + (g.m.t + g.ih) + '"/>';
    tip.textContent = '';
    tip.append(el('div', 'tip-h', t % 1 === 0 ? 'Year ' + t : fmtYears(t)));
    cfg.series.forEach(function (s) {
      var p = s.data[idx];
      if (!p) return;
      html += '<circle class="dot ' + s.cls + '" cx="' + x.toFixed(1) + '" cy="' + g.Y(p.v).toFixed(1) + '" r="5"/>';
      var r = el('div', 'tip-r');
      var name = el('span');
      name.append(el('i', 'sw ' + s.cls), document.createTextNode(s.name));
      r.append(name, el('b', null, fmtMoney(p.v)));
      tip.append(r);
    });
    if (cfg.target) {
      var r2 = el('div', 'tip-r');
      r2.append(el('span', null, 'Goal'), el('b', null, fmtMoney(cfg.target)));
      tip.append(r2);
    }
    hv.innerHTML = html; /* numbers and fixed class names only */
    tip.hidden = false;
    var px = x * scale, w = tip.offsetWidth, hostW = host.clientWidth;
    tip.style.left = (px + 14 + w > hostW ? Math.max(0, px - 14 - w) : px + 14) + 'px';
    tip.style.top = '6px';
  }

  /** cfg: { series:[{name, cls, data:[{t,v}]}], target?, aria }  (series[0] is the lead line) */
  function drawChart(host, cfg) {
    host._cfg = cfg;
    var inner = $('.chart-in', host), tip = $('.tip', host);
    if (!inner) {
      inner = el('div', 'chart-in');
      tip = el('div', 'tip');
      tip.hidden = true;
      host.append(inner, tip);
      bindChart(host);
    }
    var W = Math.max(280, Math.round(host.clientWidth || 640));
    var H = Math.round(Math.min(380, Math.max(220, W * 0.46)));
    var m = { l: 66, r: 14, t: 14, b: 30 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    host._w = W;

    var maxT = 0, maxV = cfg.target || 0;
    cfg.series.forEach(function (s) {
      s.data.forEach(function (p) { if (p.t > maxT) maxT = p.t; if (p.v > maxV) maxV = p.v; });
    });
    if (!(maxV > 0)) maxV = 1;
    if (!(maxT > 0)) maxT = 1;
    var ticks = niceTicks(maxV, 5), top = ticks[ticks.length - 1];
    function X(t) { return m.l + (t / maxT) * iw; }
    function Y(v) { return m.t + ih - (v / top) * ih; }
    host._geom = { W: W, H: H, m: m, iw: iw, ih: ih, maxT: maxT, X: X, Y: Y };

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(cfg.aria) + '">';
    ticks.forEach(function (v) {
      var y = Y(v);
      svg += '<line class="grid-l" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/>' +
        '<text x="' + (m.l - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end">' + esc(fmtWords(v)) + '</text>';
    });
    var xs = [1, 2, 5, 10, 20, 50].filter(function (s) { return maxT / s <= 8; })[0] || 50;
    svg += '<line class="axis-l" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + (m.t + ih) + '" y2="' + (m.t + ih) + '"/>';
    for (var t = 0; t <= maxT + 1e-9; t += xs) {
      svg += '<text x="' + X(t).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + (t === 0 ? '0' : t + 'y') + '</text>';
    }
    if (cfg.target) {
      var ty = Y(cfg.target).toFixed(1);
      svg += '<line class="target-l" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + ty + '" y2="' + ty + '"/>' +
        '<text class="target-t" x="' + (m.l + 6) + '" y="' + (+ty - 6) + '">Goal ' + esc(fmtWords(cfg.target)) + '</text>';
    }
    cfg.series.slice().reverse().forEach(function (s) {
      var d = s.data.map(function (p, i) { return (i ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.v).toFixed(1); }).join('');
      var lp = s.data[s.data.length - 1];
      svg += '<path class="ln ' + s.cls + '" d="' + d + '"/>' +
        '<circle class="dot ' + s.cls + '" cx="' + X(lp.t).toFixed(1) + '" cy="' + Y(lp.v).toFixed(1) + '" r="4.5"/>';
    });
    svg += '<g class="hv"></g><rect x="' + m.l + '" y="' + m.t + '" width="' + iw + '" height="' + ih + '" fill="transparent"/></svg>';
    inner.innerHTML = svg; /* numbers and fixed labels only: no user-typed text is interpolated */
  }

  function clearChart(host) {
    host._cfg = null;
    var inner = $('.chart-in', host);
    if (inner) inner.textContent = '';
    hideHover(host);
  }

  /* ---------- Plan & Compare ---------- */
  function paintPlan(r) {
    var v = S.v, o = S.o, b = S.basis;
    var key = { pre: 'Pre', post: 'Post', real: 'Real' }[b];
    var L = r.last;
    var secV = L['sec' + key], fdV = L['fd' + key];
    var secGain = (b === 'pre' ? L.secPre : L.secPost) - L.inv;
    var fdGain = (b === 'pre' ? L.fdPre : L.fdPost) - L.inv;
    var secRet = b === 'pre' ? r.irr.secPre : b === 'post' ? r.irr.secPost : r.real.sec;
    var fdRet = b === 'pre' ? r.irr.fdPre : b === 'post' ? r.irr.fdPost : r.real.fd;
    var bLabel = { pre: 'before tax', post: 'after tax', real: 'after tax, in today’s money' }[b];
    var retLabel = 'Return p.a. ' + { pre: '(pre-tax)', post: '(after tax)', real: '(real)' }[b];

    $('#p-sec-sub').textContent = dec2.format(v.ret) + '% p.a. · ' + TAX_NAMES[o.secTax];
    $('#p-fd-sub').textContent = dec2.format(v.fd) + '% p.a. · ' + FD_NAMES[o.fdComp] + ' · ' + dec2.format(v.slab) + '% tax';
    $('#p-sec-hl').textContent = 'Final corpus, ' + bLabel;
    $('#p-fd-hl').textContent = 'Final corpus, ' + bLabel;
    setHero('p-sec', secV);
    setHero('p-fd', fdV);

    function stats(side, gain, ret) {
      return [
        ['Invested', fmtMoney(L.inv)],
        ['Gain', fmtMoney(gain), gain >= 0 ? 'good' : 'bad'],
        [retLabel, fmtPct(ret), ret != null && ret < 0 ? 'bad' : ''],
        ['Pre-tax value', fmtMoney(L[side + 'Pre']), b === 'pre' ? 'hl' : ''],
        ['After-tax value', fmtMoney(L[side + 'Post']), b === 'post' ? 'hl' : ''],
        ['In today’s money', fmtMoney(L[side + 'Real']), b === 'real' ? 'hl' : '']
      ];
    }
    fillStats($('#p-sec-stats'), stats('sec', secGain, secRet));
    fillStats($('#p-fd-stats'), stats('fd', fdGain, fdRet));

    var diff = secV - fdV, vNode = $('#p-verdict');
    if (Math.abs(diff) < 1) say(vNode, ['Security and the FD finish level.']);
    else {
      var lead = diff > 0 ? 'Security' : 'The FD', behind = diff > 0 ? 'the FD' : 'the security';
      var hi = Math.max(secV, fdV), lo = Math.min(secV, fdV);
      var parts = [lead + ' finishes ', { b: fmtMoney(Math.abs(diff)), c: diff > 0 ? 'pos' : 'neg' }, ' ahead of ' + behind];
      if (lo > 0) parts.push(' (' + (hi / lo).toFixed(2) + '× as much).');
      else parts.push('.');
      say(vNode, parts);
    }

    var iNode = $('#p-insight');
    if (r.real.sec != null && r.real.fd != null) {
      iNode.textContent = 'After tax and inflation, the security grows ' + fmtPct(r.real.sec) + ' a year and the FD ' + fmtPct(r.real.fd) + '.' +
        (r.real.fd < 0 ? ' The FD loses purchasing power.' : '');
    } else iNode.textContent = '';

    var series = [
      { name: 'Security', cls: 'sec', data: r.rows.map(function (x) { return { t: x.t, v: x['sec' + key] }; }) },
      { name: 'Bank FD', cls: 'fd', data: r.rows.map(function (x) { return { t: x.t, v: x['fd' + key] }; }) },
      { name: 'Invested', cls: 'inv', data: r.rows.map(function (x) { return { t: x.t, v: x.inv }; }) }
    ];
    drawLegend($('#p-legend'), series);
    drawChart($('#p-chart'), {
      series: series,
      aria: 'Growth over ' + fmtYears(r.years) + ', ' + bLabel + '. Security ends at ' + fmtMoney(secV) + ', the bank FD at ' + fmtMoney(fdV) + ', against ' + fmtMoney(L.inv) + ' invested.'
    });
    $('#p-chart-note').textContent = {
      pre: 'Values before any tax. Hover or touch the chart for year-by-year figures.',
      post: 'Security shown after the tax due if sold that year; FD after yearly tax on its interest.',
      real: 'Values are in today’s money after tax. The Invested line is the cash actually paid in, not inflation-adjusted.'
    }[b];

    fillTable($('#p-table'), r.rows.slice(1).map(function (x) {
      var s = x['sec' + key], f = x['fd' + key], d = s - f;
      return [[x.t % 1 === 0 ? String(x.t) : x.t.toFixed(1)], [fmtMoney(x.inv)], [fmtMoney(f)], [fmtMoney(s)], [fmtMoney(d), d >= 0 ? 'pos' : 'neg']];
    }));

    var sched = (v.lump > 0 ? fmtMoney(v.lump) + ' lump sum' : '') + (v.lump > 0 && v.sip > 0 ? ' + ' : '') +
      (v.sip > 0 ? fmtMoney(v.sip) + '/month' + (v.stepUp > 0 ? ' rising ' + dec2.format(v.stepUp) + '% a year' : '') : '');
    var assump = 'Assumes ' + sched + ' over ' + fmtYears(r.years) + '; SIP paid at the ' + (o.sipStart ? 'start' : 'end') + ' of each month. ' +
      'Security: ' + dec2.format(v.ret) + '% effective annual return, ' + TAX_NAMES[o.secTax] +
      (o.secTax === 'equity' ? ' (' + dec2.format(v.ltcg) + '% above ' + fmtWords(v.exempt) + ' a year, taken once at the end)' : '') + '. ' +
      'FD: ' + dec2.format(v.fd) + '% a year compounded ' + FD_NAMES[o.fdComp] + ', interest taxed each year at ' + dec2.format(v.slab) + '%. ' +
      'Inflation ' + dec2.format(v.infl) + '%. Projections are illustrations, not guarantees.';
    $('#p-assump').textContent = assump;

    setDock([
      ['Security', fmtWords(secV)], ['Bank FD', fmtWords(fdV)],
      [diff >= 0 ? 'Security lead' : 'FD lead', fmtWords(Math.abs(diff))]
    ]);

    LAST.text = [
      'Security vs bank FD over ' + fmtYears(r.years),
      'Investing: ' + sched + ' (total ' + fmtMoney(L.inv) + ')',
      '',
      'Security @ ' + dec2.format(v.ret) + '%: ' + fmtMoney(L.secPre) + ' pre-tax | ' + fmtMoney(L.secPost) + ' after tax | ' + fmtMoney(L.secReal) + ' in today’s money',
      'Bank FD @ ' + dec2.format(v.fd) + '%: ' + fmtMoney(L.fdPre) + ' pre-tax | ' + fmtMoney(L.fdPost) + ' after tax | ' + fmtMoney(L.fdReal) + ' in today’s money',
      '',
      (diff >= 0 ? 'Security' : 'FD') + ' ahead by ' + fmtMoney(Math.abs(diff)) + ' (' + bLabel + ').',
      'Real return p.a.: security ' + fmtPct(r.real.sec) + ', FD ' + fmtPct(r.real.fd) + '.',
      '',
      assump
    ].join('\n');
    LAST.live = 'Security ends at ' + fmtWords(secV) + ' and the bank FD at ' + fmtWords(fdV) + ', ' + bLabel + '. ' +
      (diff >= 0 ? 'Security' : 'The FD') + ' is ahead by ' + fmtWords(Math.abs(diff)) + '.';
  }

  /* ---------- CAGR ---------- */
  function writeSolved(def, n) {
    var input = $('#f-' + def.id);
    input.value = def.kind === 'money' ? fmtIN(n) : trimNum(n);
    S.v[def.id] = n;
    S.err[def.id] = '';
    var w = $('#w-' + def.id);
    if (w && def.kind === 'money') w.textContent = n > 0 ? fmtWords(n) : '';
  }

  function paintCagr(r) {
    var solve = S.solve;
    var byId = {};
    DEFS.forEach(function (d) { byId[d.id] = d; });

    if (solve === 'rate') writeSolved(byId.cRate, +(r.rate * 100).toFixed(2));
    else if (solve === 'end') writeSolved(byId.cEnd, Math.round(r.end * 100) / 100);
    else if (solve === 'start') writeSolved(byId.cStart, Math.round(r.start * 100) / 100);
    else {
      var y = Math.floor(r.years + 1e-9), mo = Math.round((r.years - y) * 12);
      if (mo >= 12) { y += 1; mo = 0; }
      writeSolved(byId.cYears, y);
      writeSolved(byId.cMonths, mo);
    }

    var titles = { rate: 'CAGR', end: 'End value', start: 'Start value', years: 'Time needed' };
    var subs = {
      rate: 'per year, compounded',
      end: 'after ' + fmtYears(r.years) + ' at ' + fmtPct(r.rate),
      start: 'to reach ' + fmtMoney(r.end) + ' in ' + fmtYears(r.years) + ' at ' + fmtPct(r.rate),
      years: 'to grow ' + fmtMoney(r.start) + ' into ' + fmtMoney(r.end) + ' at ' + fmtPct(r.rate)
    };
    $('#c-title').textContent = titles[solve];
    $('#c-sub').textContent = subs[solve];
    var hero = solve === 'rate' ? fmtPct(r.rate) : solve === 'years' ? fmtYears(r.years) : fmtMoney(solve === 'end' ? r.end : r.start);
    fitHero($('#c-hero'), hero);
    $('#c-words').textContent = solve === 'end' || solve === 'start' ? fmtWords(solve === 'end' ? r.end : r.start) : ' ';

    var mult = r.start > 0 ? r.end / r.start : null;
    var dbl = C.doublingYears(r.rate);
    fillStats($('#c-stats'), [
      ['Total return', mult == null ? '—' : fmtPct(mult - 1), mult != null && mult < 1 ? 'bad' : ''],
      ['Growth multiple', mult == null ? '—' : mult.toFixed(2) + '×'],
      ['Gain', fmtMoney(r.end - r.start), r.end - r.start >= 0 ? 'good' : 'bad'],
      ['Doubling time', dbl == null ? 'Never' : fmtYears(dbl)],
      ['Period', fmtYears(r.years)],
      ['Bank FD yield', fmtPct(r.fdEff) + ' effective']
    ]);

    var pp = (r.rate - r.fdEff) * 100;
    var vNode = $('#c-verdict');
    if (Math.abs(pp) < 0.005) say(vNode, ['Level with the bank FD (' + fmtPct(r.fdEff) + ' effective).']);
    else say(vNode, [
      pp > 0 ? 'Beats' : 'Trails', ' the bank FD (' + fmtPct(r.fdEff) + ' effective) by ',
      { b: Math.abs(pp).toFixed(2) + ' percentage points', c: pp > 0 ? 'pos' : 'neg' }, ' a year.'
    ]);

    fillTable($('#c-table'), [5, 10, 15, 20].map(function (k) {
      return [[k + ' yrs'], [fmtMoney(r.end * Math.pow(1 + r.rate, k))], [fmtMoney(r.end * Math.pow(1 + r.fdEff, k))]];
    }));
    var assump = 'CAGR = (end ÷ start)^(1 ÷ years) − 1. The FD yield uses the FD rate from the inputs compounded ' + FD_NAMES[S.o.fdComp] + '. Past growth does not guarantee future returns.';
    $('#c-assump').textContent = assump;

    setDock([
      [titles[solve], hero],
      ['Multiple', mult == null ? '—' : mult.toFixed(2) + '×'],
      ['vs FD', (pp >= 0 ? '+' : '−') + Math.abs(pp).toFixed(2) + ' pts']
    ]);

    LAST.text = [
      titles[solve] + ': ' + hero + ' (' + subs[solve] + ')',
      'Start ' + fmtMoney(r.start) + ' → End ' + fmtMoney(r.end) + ' over ' + fmtYears(r.years) + ' at ' + fmtPct(r.rate) + ' a year',
      mult == null ? '' : 'Total return ' + fmtPct(mult - 1) + ', ' + mult.toFixed(2) + '× growth',
      (pp >= 0 ? 'Beats' : 'Trails') + ' the bank FD (' + fmtPct(r.fdEff) + ' effective) by ' + Math.abs(pp).toFixed(2) + ' percentage points a year.'
    ].filter(Boolean).join('\n');
    LAST.live = titles[solve] + ' is ' + hero + '. ' + (pp >= 0 ? 'Beats' : 'Trails') + ' the bank FD by ' + Math.abs(pp).toFixed(2) + ' percentage points.';
  }

  /* ---------- Goal ---------- */
  function paintGoal(r) {
    var v = S.v, o = S.o;
    function paintSide(prefix, s, g, name) {
      $('#' + prefix + '-sub').textContent = dec2.format(g) + '% p.a.';
      setHero(prefix, s.sip);
      var rows = [];
      if (s.onTrack) rows.push(['Status', 'Savings already reach the goal', 'good']);
      if (v.stepUp > 0 && !s.onTrack) rows.push(['SIP in the final year', fmtMoney(s.finalSip)]);
      rows.push(['Total invested', fmtMoney(s.path.invested)]);
      rows.push(['Growth earned', fmtMoney(s.path.balance - s.path.invested), 'good']);
      rows.push(['Or one top-up today', fmtMoney(s.topUp)]);
      fillStats($('#' + prefix + '-stats'), rows);
    }
    paintSide('g-sec', r.sec, v.ret);
    paintSide('g-fd', r.fd, v.fd);

    var vNode = $('#g-verdict');
    if (r.sec.onTrack && r.fd.onTrack) say(vNode, ['Existing savings already reach the goal either way.']);
    else if (r.sec.onTrack) say(vNode, ['The security needs no SIP; the FD still needs ', { b: fmtMoney(r.fd.sip) + ' a month', c: 'neg' }, '.']);
    else if (r.fd.onTrack) say(vNode, ['The FD needs no SIP; the security still needs ', { b: fmtMoney(r.sec.sip) + ' a month', c: 'neg' }, '.']);
    else {
      var diff = r.fd.sip - r.sec.sip, pct = r.sec.sip > 0 ? diff / r.sec.sip : 0;
      var extraTotal = r.fd.path.invested - r.sec.path.invested;
      say(vNode, [
        diff >= 0 ? 'An FD needs ' : 'The security needs ',
        { b: fmtMoney(Math.abs(diff)) + ' more', c: diff >= 0 ? 'neg' : 'pos' },
        ' every month (' + (diff >= 0 ? '+' : '−') + Math.abs(pct * 100).toFixed(0) + '%), ',
        'and ' + fmtMoney(Math.abs(extraTotal)) + ' more paid in overall.'
      ]);
    }
    $('#g-insight').textContent = 'Goal in future money: ' + fmtMoney(r.target) +
      (v.gReal ? ' (' + fmtMoney(v.gTarget) + ' in today’s money at ' + dec2.format(v.infl) + '% inflation)' : '') + '.';

    var series = [
      { name: 'Security', cls: 'sec', data: r.sec.path.snaps.map(function (s) { return { t: s.t, v: s.balance }; }) },
      { name: 'Bank FD', cls: 'fd', data: r.fd.path.snaps.map(function (s) { return { t: s.t, v: s.balance }; }) }
    ];
    drawLegend($('#g-legend'), series);
    drawChart($('#g-chart'), {
      series: series, target: r.target,
      aria: 'Savings growing to the goal of ' + fmtMoney(r.target) + ' over ' + fmtYears(r.years) + ' with a monthly SIP of ' + fmtMoney(r.sec.sip) + ' in the security or ' + fmtMoney(r.fd.sip) + ' in a bank FD.'
    });
    $('#g-chart-note').textContent = 'Both lines reach the goal; the FD line needs the larger SIP. Hover or touch for year-by-year balances.';

    var assump = 'Pre-tax. Security at ' + dec2.format(v.ret) + '% effective annual return; FD at ' + dec2.format(v.fd) + '% compounded ' + FD_NAMES[o.fdComp] +
      '. SIP rises ' + dec2.format(v.stepUp) + '% a year and is paid at the ' + (o.sipStart ? 'start' : 'end') + ' of each month. Savings already made: ' + fmtMoney(v.lump) + '.';
    $('#g-assump').textContent = assump;

    setDock([
      ['SIP (security)', fmtWords(r.sec.sip)], ['SIP (FD)', fmtWords(r.fd.sip)],
      ['FD extra', fmtWords(Math.max(0, r.fd.sip - r.sec.sip))]
    ]);

    LAST.text = [
      'Goal: ' + fmtMoney(r.target) + ' in ' + fmtYears(r.years) + (v.gReal ? ' (' + fmtMoney(v.gTarget) + ' in today’s money)' : ''),
      'Already saved: ' + fmtMoney(v.lump),
      'Monthly SIP needed (starting): ' + fmtMoney(r.sec.sip) + ' in the security @ ' + dec2.format(v.ret) + '% vs ' + fmtMoney(r.fd.sip) + ' in a bank FD @ ' + dec2.format(v.fd) + '%',
      'Total paid in: ' + fmtMoney(r.sec.path.invested) + ' vs ' + fmtMoney(r.fd.path.invested),
      '',
      assump
    ].join('\n');
    LAST.live = 'Monthly SIP needed: ' + fmtWords(r.sec.sip) + ' in the security, ' + fmtWords(r.fd.sip) + ' in a bank FD.';
  }

  /* =====================================================================
     Render loop
     ===================================================================== */
  function showFieldErrors(visibleIds) {
    DEFS.forEach(function (d) {
      if (d.kind === 'check') return;
      var msg = visibleIds[d.id] ? S.err[d.id] : '';
      var e = $('#e-' + d.id), input = $('#f-' + d.id), wrap = input.closest('.field');
      e.textContent = msg;
      e.hidden = !msg;
      wrap.classList.toggle('invalid', !!msg);
      input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    });
  }

  function clearOutputs() {
    ['p-sec', 'p-fd', 'g-sec', 'g-fd'].forEach(function (p) {
      $('#' + p + '-hero').textContent = '—';
      $('#' + p + '-words').textContent = ' ';
      $('#' + p + '-stats').textContent = '';
    });
    $('#c-hero').textContent = '—';
    $('#c-words').textContent = ' ';
    $('#c-stats').textContent = '';
    ['p-verdict', 'p-insight', 'c-verdict', 'g-verdict', 'g-insight', 'p-assump', 'c-assump', 'g-assump', 'p-chart-note', 'g-chart-note'].forEach(function (id) {
      $('#' + id).textContent = '';
    });
    ['p-table', 'c-table'].forEach(function (id) { fillTable($('#' + id), []); });
    clearChart($('#p-chart'));
    clearChart($('#g-chart'));
    $('#p-legend').textContent = '';
    $('#g-legend').textContent = '';
    setDock([]);
    LAST.text = '';
    LAST.live = '';
  }

  var liveTimer = 0;
  function announce(text) {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(function () { $('#live').textContent = text; }, 800);
  }

  function render() {
    raf = 0;
    var vis = {};
    visibleDefs().forEach(function (d) { vis[d.id] = true; });
    showFieldErrors(vis);

    var bad = visibleDefs().filter(function (d) { return d.kind !== 'check' && S.err[d.id]; });
    var banner = $('#status');
    var result = null, message = '';

    if (bad.length) {
      message = 'Check the highlighted input' + (bad.length > 1 ? 's' : '') + ': ' + labelFor(bad[0], S.mode) + '. ' + S.err[bad[0].id] + '.';
    } else {
      result = S.mode === 'plan' ? computePlan() : S.mode === 'cagr' ? computeCagr() : computeGoal();
      if (result.error) { message = result.error; result = null; }
    }

    if (!result) {
      banner.textContent = message;
      banner.hidden = false;
      clearOutputs();
    } else {
      banner.hidden = true;
      banner.textContent = '';
      if (S.mode === 'plan') paintPlan(result);
      else if (S.mode === 'cagr') paintCagr(result);
      else paintGoal(result);
      announce(LAST.live);
    }
    queueSave();
  }

  /* =====================================================================
     Actions: copy, reset, toast
     ===================================================================== */
  var toastTimer = 0;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2200);
  }

  function copySummary() {
    if (!LAST.text) { toast('Nothing to copy yet. Fix the highlighted inputs first.'); return; }
    var text = 'Financial Planner\n' + LAST.text;
    function fallback() {
      var ta = el('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      toast(ok ? 'Summary copied' : 'Copy blocked by the browser');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('Summary copied'); }, fallback);
    } else fallback();
  }

  var resetTimer = 0;
  function onReset() {
    var btn = $('#btn-reset');
    if (!btn.classList.contains('danger')) {
      btn.classList.add('danger');
      btn.textContent = 'Tap again to reset';
      resetTimer = setTimeout(function () { btn.classList.remove('danger'); btn.textContent = 'Reset'; }, 3000);
      return;
    }
    clearTimeout(resetTimer);
    btn.classList.remove('danger');
    btn.textContent = 'Reset';
    resetInputs();
    toast('Inputs reset');
  }

  function resetInputs() {
    DEFS.forEach(function (d) {
      var i = $('#f-' + d.id);
      if (d.kind === 'check') i.checked = !!d.def; else i.value = defText(d);
    });
    S.o = { secTax: 'equity', fdComp: 4, sipStart: true };
    $('#secTax').value = 'equity';
    $('#fdComp').value = '4';
    $('#sipStart').checked = true;
    S.basis = 'real';
    S.solve = 'rate';
    $$('[data-basis]').forEach(function (n) { n.setAttribute('aria-pressed', String(n.dataset.basis === 'real')); });
    DEFS.forEach(readField);
    applySolveUI();
    schedule();
  }

  /* =====================================================================
     Bank benchmark rates panel
     ===================================================================== */
  function renderRates() {
    var ul = $('#rates-list');
    if (ul.contains(document.activeElement)) return; /* do not disturb typing */
    ul.textContent = '';
    RT.list().forEach(function (item) {
      var li = el('li');
      var lab = el('span', 'r-label', item.label);
      if (!item.verified) lab.append(document.createTextNode(' '), el('small', null, '(placeholder)'));
      var inp = el('input', 'r-input' + (item.edited ? ' edited' : ''));
      inp.type = 'text';
      inp.setAttribute('inputmode', 'decimal');
      inp.value = trimNum(item.rate);
      inp.setAttribute('aria-label', item.label + ' rate, percent per year');
      inp.addEventListener('input', function () {
        inp.value = inp.value.replace(/[^\d.]/g, '');
        var n = parseFloat(inp.value);
        if (Number.isFinite(n) && n <= 50) { RT.setRate(item.id, n); inp.classList.add('edited'); }
      });
      var use = el('button', 'btn small', 'Use');
      use.type = 'button';
      use.setAttribute('aria-label', 'Use ' + item.label + ' as the bank FD rate');
      use.addEventListener('click', function () {
        var n = parseFloat(inp.value);
        if (Number.isFinite(n)) setFieldValue(DEFS.filter(function (d) { return d.id === 'fd'; })[0], n);
      });
      li.append(lab, inp, use);
      ul.append(li);
    });
    var info = RT.info();
    $('#rates-note').textContent = 'Indicative rates as of ' + info.asOf + '. ' + info.note + ' Edit any rate to override it on this device.';
  }

  /* =====================================================================
     Init
     ===================================================================== */
  function init() {
    var main = $('#fields-main'), adv = $('#fields-adv');
    main.append(buildSolve());
    DEFS.forEach(function (d) { (d.adv ? adv : main).append(buildField(d)); });
    DEFS.forEach(function (d) { if (d.kind !== 'check') $('#f-' + d.id).value = defText(d); });

    restore();

    $('#secTax').value = S.o.secTax;
    $('#fdComp').value = String(S.o.fdComp);
    $('#sipStart').checked = S.o.sipStart;
    DEFS.forEach(readField);

    $('#secTax').addEventListener('change', function (e) { S.o.secTax = e.target.value; schedule(); });
    $('#fdComp').addEventListener('change', function (e) { S.o.fdComp = parseInt(e.target.value, 10); schedule(); });
    $('#sipStart').addEventListener('change', function (e) { S.o.sipStart = e.target.checked; schedule(); });
    $('#inputs-form').addEventListener('submit', function (e) { e.preventDefault(); });

    $$('.mode').forEach(function (b) { b.addEventListener('click', function () { setMode(b.dataset.mode); }); });
    $$('[data-basis]').forEach(function (b) { b.addEventListener('click', function () { setBasis(b.dataset.basis); }); });
    $('#btn-theme').addEventListener('click', function () { setTheme(S.theme === 'dark' ? 'light' : 'dark'); });
    $('#btn-copy').addEventListener('click', copySummary);
    $('#btn-reset').addEventListener('click', onReset);
    $('#rates-reset').addEventListener('click', function () { RT.reset(); renderRates(); toast('Rates reset'); });

    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target, tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
      var m = { '1': 'plan', '2': 'cagr', '3': 'goal' }[e.key];
      if (m) setMode(m);
    });
    window.addEventListener('pagehide', save);

    setTheme(S.theme);
    $$('[data-basis]').forEach(function (n) { n.setAttribute('aria-pressed', String(n.dataset.basis === S.basis)); });
    applyMode();
    renderRates();
    RT.fetchRemote(renderRates);
    render();
  }

  init();
})();
