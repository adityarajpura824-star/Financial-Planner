/*!
 * calc.js - pure financial maths for Financial Planner.
 * No DOM, no network. Loads as a plain <script> (window.FPCalc) or via require() in Node.
 *
 * Conventions
 *  - Annual rates arrive as percentages (12 means 12%) unless the name says "frac".
 *  - Results that are rates come back as fractions (0.12 means 12%).
 *  - A "security" return is treated as an effective annual rate (the same idea as CAGR).
 *  - Bank/FD rates are nominal and compound n times a year (quarterly by default).
 *  - Money flows are simulated month by month, so step-up SIPs and yearly tax are exact.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FPCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Growth factor per month for an effective annual rate given in percent. */
  function monthlyEffective(annualPct) {
    return Math.pow(1 + annualPct / 100, 1 / 12);
  }

  /** Growth factor per month for a nominal annual rate compounding `perYear` times. */
  function monthlyNominal(annualPct, perYear) {
    return Math.pow(1 + annualPct / 100 / perYear, perYear / 12);
  }

  /** Effective annual yield (fraction) of a nominal rate compounding `perYear` times. */
  function effectiveFromNominal(annualPct, perYear) {
    return Math.pow(1 + annualPct / 100 / perYear, perYear) - 1;
  }

  /** CAGR as a fraction. Returns null when the inputs cannot define one. */
  function cagr(start, end, years) {
    if (!(start > 0) || !(end >= 0) || !(years > 0)) return null;
    return Math.pow(end / start, 1 / years) - 1;
  }

  /** Years for money to double at a fractional annual rate; null if it never will. */
  function doublingYears(rateFrac) {
    if (!(rateFrac > 0)) return null;
    return Math.log(2) / Math.log(1 + rateFrac);
  }

  /** Value in today's money after `years` of inflation (percent). */
  function deflate(value, inflPct, years) {
    return value / Math.pow(1 + inflPct / 100, years);
  }

  /**
   * Month-by-month projection of a lump sum plus a (stepped-up) monthly SIP.
   * o.lump, o.sip         money
   * o.stepUp              fraction; SIP rises by this at each anniversary
   * o.months              whole months (>= 1)
   * o.g                   growth factor per month (e.g. from monthlyEffective)
   * o.sipAtStart          true = SIP goes in at the start of each month (default)
   * o.interestTax         fraction of interest taxed at each year end (0 = none)
   * Returns { balance, invested, taxPaid, snaps:[{t, invested, balance}] } with a snapshot
   * at t = 0 and at every anniversary plus the final month.
   */
  function project(o) {
    const months = o.months | 0;
    const g = o.g;
    const step = o.stepUp || 0;
    const atStart = o.sipAtStart !== false;
    const tax = o.interestTax || 0;
    const sip0 = o.sip || 0;

    let bal = o.lump || 0;
    let invested = bal;
    let yearStart = bal;
    let contrib = 0;
    let taxPaid = 0;
    const snaps = [{ t: 0, invested: invested, balance: bal }];

    for (let m = 0; m < months; m++) {
      const sip = sip0 * Math.pow(1 + step, Math.floor(m / 12));
      if (atStart) { bal += sip; bal *= g; } else { bal *= g; bal += sip; }
      invested += sip;
      contrib += sip;

      const yearEnd = (m + 1) % 12 === 0;
      if (yearEnd || m === months - 1) {
        if (tax > 0) {
          const interest = bal - yearStart - contrib;
          if (interest > 0) {
            const t = interest * tax;
            bal -= t;
            taxPaid += t;
          }
        }
        yearStart = bal;
        contrib = 0;
        snaps.push({ t: (m + 1) / 12, invested: invested, balance: bal });
      }
    }
    return { balance: bal, invested: invested, taxPaid: taxPaid, snaps: snaps };
  }

  /**
   * Tax if a holding were sold now.
   * mode 'equity' : p.ltcg on gains above p.exemption   (fractions / money)
   * mode 'slab'   : p.slab on the whole gain
   * mode 'none'   : zero
   */
  function exitTax(balance, invested, mode, p) {
    const gain = balance - invested;
    if (!(gain > 0)) return 0;
    if (mode === 'equity') return Math.max(0, gain - (p.exemption || 0)) * p.ltcg;
    if (mode === 'slab') return gain * p.slab;
    return 0;
  }

  /**
   * Annual effective return (fraction) that turns the contribution schedule in `o`
   * (same fields as project: lump, sip, stepUp, months, sipAtStart) into `terminal`.
   * Solved by bisection on the monthly rate. Returns null if there is nothing invested.
   */
  function irr(o, terminal) {
    const n = o.months | 0;
    const atStart = o.sipAtStart !== false;
    const step = o.stepUp || 0;
    const cf = new Array(n + 1).fill(0);
    cf[0] += o.lump || 0;
    for (let m = 0; m < n; m++) {
      cf[atStart ? m : m + 1] += (o.sip || 0) * Math.pow(1 + step, Math.floor(m / 12));
    }
    let invested = 0;
    for (let t = 0; t <= n; t++) invested += cf[t];
    if (!(invested > 0) || !Number.isFinite(terminal) || terminal < 0) return null;
    if (terminal === 0) return -1;

    // f(i) = sum cf[t] * (1+i)^(n-t) - terminal, evaluated by Horner's rule
    const f = function (i) {
      const x = 1 + i;
      let acc = 0;
      for (let t = 0; t <= n; t++) acc = acc * x + cf[t];
      return acc - terminal;
    };

    let lo = -0.99;
    let hi = 1;
    if (f(lo) > 0) return -1;
    while (f(hi) < 0 && hi < 1e6) hi *= 2;
    for (let k = 0; k < 200 && hi - lo > 1e-15; k++) {
      const mid = (lo + hi) / 2;
      if (f(mid) > 0) hi = mid; else lo = mid;
    }
    return Math.pow(1 + (lo + hi) / 2, 12) - 1;
  }

  /**
   * Monthly SIP (first-year amount) needed so that existing savings plus the SIP reach `target`.
   * Returns { sip, lumpFV, onTrack }. onTrack means savings alone already get there.
   */
  function requiredSip(o) {
    const lumpFV = (o.lump || 0) * Math.pow(o.g, o.months);
    const unit = project({ lump: 0, sip: 1, stepUp: o.stepUp, months: o.months, g: o.g, sipAtStart: o.sipAtStart }).balance;
    const need = o.target - lumpFV;
    return { sip: need > 0 ? need / unit : 0, lumpFV: lumpFV, onTrack: need <= 0 };
  }

  /** One-off amount to invest today so it grows to `target`. */
  function requiredLump(o) {
    return o.target / Math.pow(o.g, o.months);
  }

  /**
   * Solve the growth identity end = start * (1+rate)^years for one unknown.
   * unknown: 'rate' | 'end' | 'start' | 'years'; v = { start, end, years, rate(fraction) }.
   * Returns a number or null when the inputs cannot define the answer.
   */
  function solveGrowth(unknown, v) {
    switch (unknown) {
      case 'rate':
        return cagr(v.start, v.end, v.years);
      case 'end':
        if (!(v.start >= 0) || !(v.years >= 0) || !(v.rate > -1)) return null;
        return v.start * Math.pow(1 + v.rate, v.years);
      case 'start':
        if (!(v.end >= 0) || !(v.years >= 0) || !(v.rate > -1)) return null;
        return v.end / Math.pow(1 + v.rate, v.years);
      case 'years': {
        if (!(v.start > 0) || !(v.end > 0) || !(v.rate > -1) || v.rate === 0) return null;
        const n = Math.log(v.end / v.start) / Math.log(1 + v.rate);
        return Number.isFinite(n) && n >= 0 ? n : null;
      }
      default:
        return null;
    }
  }

  return {
    monthlyEffective: monthlyEffective,
    monthlyNominal: monthlyNominal,
    effectiveFromNominal: effectiveFromNominal,
    cagr: cagr,
    doublingYears: doublingYears,
    deflate: deflate,
    project: project,
    exitTax: exitTax,
    irr: irr,
    requiredSip: requiredSip,
    requiredLump: requiredLump,
    solveGrowth: solveGrowth
  };
});
