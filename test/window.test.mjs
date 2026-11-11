import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPoints, selectWindow, withLatest, summarize, RANGES, formatT, formatFor } from '../site/src/window.js';

// 가짜 데이터: 지정한 날짜마다 09:00~14:59 1분봉 + 15:30 종가
function day(date, until = '1530') {
  const out = [];
  for (let m = 9 * 60; m < 15 * 60; m++) {
    const s = date + String(Math.floor(m / 60)).padStart(2, '0') + String(m % 60).padStart(2, '0');
    if (s.slice(8) > until) break;
    out.push([s, 5000 + m / 10]);
  }
  if (until >= '1530') out.push([date + '1530', 5100]);
  return out;
}
const range = (id) => RANGES.find((r) => r.id === id);
const fmt = (win) => [formatT(win.points[0].t), formatT(win.points.at(-1).t)];

// 11/3(화) ~ 11/11(수), 주말 11/7~8 제외
const DATES = ['20261103', '20261104', '20261105', '20261106', '20261109', '20261110'];

// 평일 일봉 (09:00에 찍힘) — from부터 to까지
function dailyBars(from, to) {
  const out = [];
  for (let t = Date.UTC(+from.slice(0, 4), +from.slice(4, 6) - 1, +from.slice(6, 8)); ; t += 86400000) {
    const d = new Date(t);
    const s = d.toISOString().slice(0, 10).replace(/-/g, '');
    if (s > to) break;
    if (d.getUTCDay() % 6) out.push([s + '0900', 3000 + out.length]);
  }
  return out;
}

test('기간은 1일·1주·3달·1년·5년·전체 6개', () => {
  assert.deepEqual(RANGES.map((r) => r.label), ['1일', '1주', '3달', '1년', '5년', '전체']);
});

test('장중(수 11:00): 1일 = 전 거래일 같은 시각부터 24시간', () => {
  const pts = toPoints([...DATES.flatMap((d) => day(d)), ...day('20261111', '1100')]);
  const win = selectWindow(pts, range('1d'));
  assert.deepEqual(fmt(win), ['11/10(화) 11:00', '11/11(수) 11:00']);
  assert.equal(win.complete, true);
});

test('장 마감 후: 1일 = 전 거래일 종가 ~ 오늘 장 마감', () => {
  const pts = toPoints([...DATES.flatMap((d) => day(d)), ...day('20261111')]);
  const win = selectWindow(pts, range('1d'));
  assert.deepEqual(fmt(win), ['11/10(화) 15:30', '11/11(수) 15:30']);
  assert.equal(formatT(win.points[1].t), '11/11(수) 09:00');
});

test('월요일 장 시작 전: 금요일 장을 탄다 (주말 건너뜀)', () => {
  const pts = toPoints(['20261104', '20261105', '20261106'].flatMap((d) => day(d)));
  const win = selectWindow(pts, range('1d'));
  assert.deepEqual(fmt(win), ['11/5(목) 15:30', '11/6(금) 15:30']);
});

test('1주 = 달력 기준 7일 전 같은 시각', () => {
  const pts = toPoints([...DATES.flatMap((d) => day(d)), ...day('20261111', '1100')]);
  assert.deepEqual(fmt(selectWindow(pts, range('1w'))), ['11/4(수) 11:00', '11/11(수) 11:00']);
});

test('3달 = 3달 전 같은 날짜·시각부터 (시간봉)', () => {
  const hourly = [];
  for (const [s] of dailyBars('20260701', '20261110')) {
    for (const h of ['09', '10', '11', '12', '13', '14', '15']) hourly.push([s.slice(0, 8) + h + '00', 5000]);
  }
  const latest = toPoints([['202611111100', 5300]]).at(-1);
  const win = selectWindow(withLatest(toPoints(hourly), latest), range('3m'));
  assert.equal(formatT(win.points[0].t), '8/11(화) 11:00');
  assert.equal(formatT(win.points.at(-1).t), '11/11(수) 11:00');
  assert.equal(win.points.at(-1).p, 5300);
});

test('1년·5년 = 같은 날짜부터 (일봉), 오늘 봉은 최신 값으로 교체', () => {
  const daily = toPoints(dailyBars('20210101', '20261111'));
  const latest = toPoints([['202611111500', 5355]]).at(-1);
  const series = withLatest(daily, latest);
  assert.equal(series.length, daily.length); // 같은 날짜라 교체
  const y1 = selectWindow(series, range('1y'));
  assert.equal(formatFor(y1.points[0].t, 'daily'), '2025.11.11');
  assert.equal(y1.points.at(-1).p, 5355);
  const y5 = selectWindow(series, range('5y'));
  assert.equal(formatFor(y5.points[0].t, 'daily'), '2021.11.11');
  assert.equal(y5.complete, true);
});

test('전체 = 데이터 처음부터', () => {
  const weekly = toPoints([['199612090000', 685], ['200001030000', 1000], ['202611090000', 5300]]);
  const win = selectWindow(weekly, range('all'));
  assert.equal(win.points.length, 3);
  assert.equal(win.complete, true);
  assert.ok(summarize(win, range('all')).changePct > 600);
});

test('데이터가 모자라면 있는 만큼만 (complete=false)', () => {
  const pts = toPoints(dailyBars('20260101', '20261111'));
  const win = selectWindow(pts, range('5y'));
  assert.equal(win.complete, false);
  assert.equal(formatFor(win.points[0].t, 'daily'), '2026.1.1');
});
