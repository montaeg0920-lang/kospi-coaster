import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HISTORY, historicalWindow, historicalStats } from '../site/src/history.js';
import { buildTrack, rideTime } from '../site/src/track.js';
const data = JSON.parse(readFileSync(new URL('../site/data/history.json', import.meta.url)));
for (const range of HISTORY) test(`${range.label}: 실제 날짜·일반 눈금·낮·주행 시간`, () => {
  const win = historicalWindow(data, range);
  assert.equal(win.points[0].date, range.start);
  assert.equal(win.points.at(-1).date, range.end);
  for (let i = 1; i < win.points.length; i++) {
    assert.ok(win.points[i].t > win.points[i - 1].t);
    assert.ok(win.points[i].p > 0);
  }
  const stats = historicalStats(win, range);
  assert.ok(stats.drawdown <= 0);
  const track = buildTrack(win.points, stats, range);
  assert.equal(track.sessions.length, 0);
  assert.ok(Math.abs(track.norm((stats.min + stats.max) / 2) - 0.5) < 1e-12);
  const seconds = rideTime(track);
  assert.ok(seconds <= range.duration && seconds >= range.duration - 5, String(seconds));
});
test('2025 연간 상승률은 2024년 마지막 종가 대비 계산', () => {
  const range = HISTORY.find(r => r.id === 'rise2025');
  const stats = historicalStats(historicalWindow(data, range), range);
  assert.equal(stats.first, 2399.49);
  assert.equal(stats.last, 4214.17);
  assert.equal(stats.changePct.toFixed(2), '75.63');
});
test('누락된 역사 데이터로 코스를 만들지 않는다', () => {
  assert.throws(() => historicalWindow({ points: [] }, HISTORY[0]));
});
