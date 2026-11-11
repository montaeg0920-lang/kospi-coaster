import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRules } from '../site/src/rules.js';

const ride = (hands = false, nausea = 0) => ({ hands, nausea, score: 0, holdT: 0, combo: 1, fainted: false });
const DOWN = -0.6; // 약 34° 내리막
const UP = 0.4;
const at = (ang, extra = {}) => ({ ang, zone: 'main', v: 1200, g: 1, vLift: 600, vMax: 2700, ...extra });
const run = (r, here, secs) => {
  for (let t = 0; t < secs; t += 1 / 120) applyRules(r, here, 1 / 120);
  return r;
};

test('손을 안 들어도 내리막을 내려가면 멀미가 쌓인다', () => {
  assert.ok(run(ride(false), at(DOWN), 1).nausea > 20);
});

test('내리막에서 손을 들면 멀미가 더 많이 쌓인다', () => {
  const down = run(ride(false), at(DOWN), 1).nausea;
  const handsUp = run(ride(true), at(DOWN), 1).nausea;
  assert.ok(handsUp > down * 1.5, `${handsUp} vs ${down}`);
});

test('오르막에서 손을 내리면 멀미가 가라앉는다', () => {
  assert.ok(run(ride(false, 50), at(UP, { v: 600 }), 1).nausea < 40);
});

test('점수는 손을 들고 있을 때만 쌓인다', () => {
  assert.equal(run(ride(false), at(DOWN), 1).score, 0);
  assert.ok(run(ride(true), at(DOWN), 1).score > 0);
});

test('멀미 100%면 기절하고 그 뒤로 점수가 멈춘다', () => {
  const r = run(ride(true), at(DOWN), 10);
  assert.equal(r.fainted, true);
  assert.equal(r.nausea, 100);
  const score = r.score;
  run(r, at(DOWN), 1);
  assert.equal(r.score, score);
});

test('출발 승강장에서는 변화 없음', () => {
  const r = run(ride(true), at(DOWN, { zone: 'station' }), 1);
  assert.equal(r.nausea, 0);
  assert.equal(r.score, 0);
});
