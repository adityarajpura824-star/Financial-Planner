'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/calc.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b}, got ${a}`);

test('cagr: doubling in 10 years is 7.177%', () => {
  near(C.cagr(100, 200, 10), Math.pow(2, 0.1) - 1, 1e-12);
});

test('cagr: rejects zero start, zero years and negative end', () => {
  assert.equal(C.cagr(0, 100, 5), null);
  assert.equal(C.cagr(100, 200, 0), null);
  assert.equal(C.cagr(100, -1, 5), null);
});

test('cagr: total loss is -100%', () => {
  near(C.cagr(100, 0, 3), -1, 1e-12);
});

test('project: lump sum equals closed form P(1+r)^t', () => {
  const p = C.project({ lump: 100000, sip: 0, months: 120, g: C.monthlyEffective(12) });
  near(p.balance, 100000 * Math.pow(1.12, 10), 1e-6);
  assert.equal(p.invested, 100000);
});

test('project: level SIP at start of month equals annuity-due formula', () => {
  const g = C.monthlyEffective(12);
  const i = g - 1;
  const n = 120;
  const expected = 10000 * ((Math.pow(1 + i, n) - 1) / i) * (1 + i);
  const p = C.project({ lump: 0, sip: 10000, months: n, g: g, sipAtStart: true });
  near(p.balance, expected, 1e-6);
  assert.equal(p.invested, 1200000);
});

test('project: SIP at end of month is smaller by exactly one month of growth', () => {
  const g = C.monthlyEffective(12);
  const a = C.project({ lump: 0, sip: 5000, months: 60, g: g, sipAtStart: true }).balance;
  const b = C.project({ lump: 0, sip: 5000, months: 60, g: g, sipAtStart: false }).balance;
  near(a / b, g, 1e-12);
});

test('project: step-up raises contributions at each anniversary', () => {
  const p = C.project({ lump: 0, sip: 1000, stepUp: 0.1, months: 24, g: 1 });
  near(p.invested, 12 * 1000 + 12 * 1100, 1e-9);
  near(p.balance, p.invested, 1e-9);
});

test('project: snapshots land on each year plus a final partial year', () => {
  const p = C.project({ lump: 1000, sip: 0, months: 30, g: 1 });
  assert.deepEqual(p.snaps.map((s) => s.t), [0, 1, 2, 2.5]);
});

test('project: yearly interest tax on a 1-year quarterly FD', () => {
  const g = C.monthlyNominal(8, 4);
  const pre = C.project({ lump: 100000, months: 12, g: g });
  near(pre.balance, 100000 * Math.pow(1.02, 4), 1e-6);
  const post = C.project({ lump: 100000, months: 12, g: g, interestTax: 0.3 });
  const interest = 100000 * (Math.pow(1.02, 4) - 1);
  near(post.balance, 100000 + interest * 0.7, 1e-6);
  near(post.taxPaid, interest * 0.3, 1e-6);
});

test('project: tax is charged on interest only, never on contributions', () => {
  const g = C.monthlyNominal(8, 4);
  const post = C.project({ lump: 0, sip: 10000, months: 12, g: g, interestTax: 0.3 });
  const pre = C.project({ lump: 0, sip: 10000, months: 12, g: g });
  const interest = pre.balance - pre.invested;
  near(post.balance, pre.balance - 0.3 * interest, 1e-6);
});

test('exitTax: equity applies exemption then LTCG rate', () => {
  near(C.exitTax(3000000, 1000000, 'equity', { exemption: 125000, ltcg: 0.125 }), (2000000 - 125000) * 0.125, 1e-9);
});

test('exitTax: no tax on a loss, slab on whole gain, none when off', () => {
  assert.equal(C.exitTax(900000, 1000000, 'equity', { exemption: 125000, ltcg: 0.125 }), 0);
  near(C.exitTax(1500000, 1000000, 'slab', { slab: 0.3 }), 150000, 1e-9);
  assert.equal(C.exitTax(1500000, 1000000, 'none', {}), 0);
});

test('exitTax: gain below the exemption is untaxed', () => {
  assert.equal(C.exitTax(1100000, 1000000, 'equity', { exemption: 125000, ltcg: 0.125 }), 0);
});

test('irr: lump sum recovers the CAGR', () => {
  const fv = 100000 * Math.pow(1.12, 10);
  near(C.irr({ lump: 100000, months: 120 }, fv), 0.12, 1e-9);
});

test('irr: SIP projected at 12% effective recovers 12%', () => {
  const o = { lump: 200000, sip: 15000, stepUp: 0.1, months: 180, sipAtStart: true };
  const p = C.project({ ...o, g: C.monthlyEffective(12) });
  near(C.irr(o, p.balance), 0.12, 1e-9);
});

test('irr: end-of-month SIP also recovers 12%', () => {
  const o = { sip: 8000, months: 96, sipAtStart: false };
  const p = C.project({ ...o, g: C.monthlyEffective(12) });
  near(C.irr(o, p.balance), 0.12, 1e-9);
});

test('irr: nothing invested gives null; zero terminal gives -100%', () => {
  assert.equal(C.irr({ months: 12 }, 100), null);
  assert.equal(C.irr({ lump: 1000, months: 12 }, 0), -1);
});

test('irr: handles a losing investment', () => {
  near(C.irr({ lump: 100, months: 12 }, 90), -0.1, 1e-9);
});

test('requiredSip: projecting the answer reaches the target', () => {
  const g = C.monthlyEffective(12);
  const o = { target: 10000000, lump: 500000, months: 180, g: g, stepUp: 0.1, sipAtStart: true };
  const r = C.requiredSip(o);
  const p = C.project({ lump: 500000, sip: r.sip, stepUp: 0.1, months: 180, g: g, sipAtStart: true });
  near(p.balance, 10000000, 1e-4);
  assert.equal(r.onTrack, false);
});

test('requiredSip: existing savings already above target means zero SIP', () => {
  const r = C.requiredSip({ target: 1000000, lump: 1000000, months: 60, g: C.monthlyEffective(10), stepUp: 0 });
  assert.equal(r.sip, 0);
  assert.equal(r.onTrack, true);
});

test('requiredLump: grows back to the target', () => {
  const g = C.monthlyEffective(10);
  const l = C.requiredLump({ target: 1000000, months: 84, g: g });
  near(l * Math.pow(g, 84), 1000000, 1e-6);
});

test('solveGrowth: each unknown round-trips', () => {
  const v = { start: 500000, end: 1200000, years: 7, rate: Math.pow(2.4, 1 / 7) - 1 };
  near(C.solveGrowth('rate', v), v.rate, 1e-12);
  near(C.solveGrowth('end', v), v.end, 1e-6);
  near(C.solveGrowth('start', v), v.start, 1e-6);
  near(C.solveGrowth('years', v), v.years, 1e-9);
});

test('solveGrowth: invalid inputs return null, never NaN', () => {
  assert.equal(C.solveGrowth('rate', { start: 0, end: 10, years: 5 }), null);
  assert.equal(C.solveGrowth('years', { start: 100, end: 200, rate: 0 }), null);
  assert.equal(C.solveGrowth('years', { start: 100, end: 50, rate: 0.1 }), null);
  assert.equal(C.solveGrowth('end', { start: 100, years: 3, rate: -1 }), null);
});

test('doublingYears and deflate behave', () => {
  near(C.doublingYears(0.12), Math.log(2) / Math.log(1.12), 1e-12);
  assert.equal(C.doublingYears(0), null);
  assert.equal(C.doublingYears(-0.05), null);
  near(C.deflate(1000, 6, 10), 1000 / Math.pow(1.06, 10), 1e-9);
});

test('effectiveFromNominal: 8% quarterly is 8.243%', () => {
  near(C.effectiveFromNominal(8, 4), 0.08243216, 1e-9);
});

test('performance: a 40-year step-up projection plus IRR stays well under 50 ms', () => {
  const o = { lump: 1000000, sip: 50000, stepUp: 0.1, months: 480, sipAtStart: true };
  const t0 = process.hrtime.bigint();
  for (let k = 0; k < 20; k++) {
    const p = C.project({ ...o, g: C.monthlyEffective(12) });
    C.irr(o, p.balance);
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 20;
  assert.ok(ms < 50, `took ${ms.toFixed(2)} ms per run`);
});
