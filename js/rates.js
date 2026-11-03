/*!
 * rates.js - bank benchmark rates with zero-latency fallback.
 *
 * Order of precedence: planner edits (localStorage) > data/rates.json > built-in defaults.
 * The built-in defaults are used immediately, so nothing ever waits on the network.
 * data/rates.json is fetched quietly in the background; if it is missing, blocked or the page
 * is opened from file://, the defaults simply stay in place.
 */
(function (root) {
  'use strict';

  var KEY = 'fp.rates.v1';

  var DEFAULTS = {
    asOf: '2026-10-12',
    note: 'SBI FD rows are SBI general-public domestic card rates as shown on BankBazaar (page updated 12 Oct 2026, rates stated as effective from 15 Dec 2025). The savings-account row is an unverified placeholder. Banks revise rates often, so confirm with the bank before quoting a client.',
    items: [
      { id: 'savings', label: 'Savings account (typical)', rate: 2.7, verified: false },
      { id: 'sbi1', label: 'SBI FD, 1 yr', rate: 6.25, verified: true },
      { id: 'sbi2', label: 'SBI FD, 2 yrs', rate: 6.4, verified: true },
      { id: 'sbi3', label: 'SBI FD, 3 yrs', rate: 6.3, verified: true },
      { id: 'sbi5', label: 'SBI FD, 5 yrs', rate: 6.05, verified: true }
    ]
  };

  var base = DEFAULTS;
  var over = loadOver();

  function loadOver() {
    try {
      var o = JSON.parse(localStorage.getItem(KEY) || '{}');
      return o && typeof o === 'object' ? o : {};
    } catch (e) { return {}; }
  }

  function saveOver() {
    try { localStorage.setItem(KEY, JSON.stringify(over)); } catch (e) { /* storage unavailable */ }
  }

  function validItem(i) {
    return i && typeof i.id === 'string' && typeof i.label === 'string' &&
      typeof i.rate === 'number' && isFinite(i.rate) && i.rate >= 0 && i.rate <= 50;
  }

  function list() {
    return base.items.map(function (i) {
      var edited = typeof over[i.id] === 'number';
      return { id: i.id, label: i.label, rate: edited ? over[i.id] : i.rate, verified: !!i.verified, edited: edited };
    });
  }

  function setRate(id, rate) {
    if (typeof rate === 'number' && isFinite(rate) && rate >= 0 && rate <= 50) {
      over[id] = rate;
      saveOver();
    }
  }

  function reset() {
    over = {};
    saveOver();
  }

  function info() {
    return { asOf: base.asOf, note: base.note };
  }

  /** Background refresh from data/rates.json. Calls cb() only if new valid data arrived. */
  function fetchRemote(cb) {
    if (typeof fetch !== 'function' || location.protocol === 'file:') return;
    fetch('data/rates.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && Array.isArray(j.items) && j.items.length && j.items.every(validItem)) {
          base = { asOf: String(j.asOf || ''), note: String(j.note || ''), items: j.items };
          if (cb) cb();
        }
      })
      .catch(function () { /* offline or file:// - keep defaults */ });
  }

  root.FPRates = { list: list, setRate: setRate, reset: reset, info: info, fetchRemote: fetchRemote };
})(window);
