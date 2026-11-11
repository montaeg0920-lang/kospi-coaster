import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPoints, selectWindow, RANGES, formatT } from '../site/src/window.js';

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
  // 첫 점(전날 종가) 다음은 바로 오늘 09:00
  assert.equal(formatT(win.points[1].t), '11/11(수) 09:00');
});

test('월요일 장 시작 전: 금요일 장을 탄다 (주말 건너뜀)', () => {
  const pts = toPoints(['20261104', '20261105', '20261106'].flatMap((d) => day(d)));
  const win = selectWindow(pts, range('1d'));
  assert.deepEqual(fmt(win), ['11/5(목) 15:30', '11/6(금) 15:30']);
});

test('N일 = N거래일 전 같은 시각', () => {
  const pts = toPoints([...DATES.flatMap((d) => day(d)), ...day('20261111', '1100')]);
  assert.deepEqual(fmt(selectWindow(pts, range('3d'))), ['11/6(금) 11:00', '11/11(수) 11:00']);
  assert.deepEqual(fmt(selectWindow(pts, range('5d'))), ['11/4(수) 11:00', '11/11(수) 11:00']);
});

test('1주 = 달력 기준 7일 전 같은 시각', () => {
  const pts = toPoints([...DATES.flatMap((d) => day(d)), ...day('20261111', '1100')]);
  assert.deepEqual(fmt(selectWindow(pts, range('1w'))), ['11/4(수) 11:00', '11/11(수) 11:00']);
});

test('데이터가 모자라면 있는 만큼만 (complete=false)', () => {
  const pts = toPoints(['20261110', '20261111'].flatMap((d) => day(d)));
  const win = selectWindow(pts, range('5d'));
  assert.equal(win.complete, false);
  assert.equal(formatT(win.points[0].t), '11/10(화) 09:00');
});
