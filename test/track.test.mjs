import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RANGES, toPoints, summarize, selectWindow } from '../site/src/window.js';
import { buildTrack, rideTime, RIDE_LIMIT, PHYS } from '../site/src/track.js';

// 기간마다 가장 느린 경우(계속 오르기만 하는 레일)와 출렁이는 레일을 만들어 봅니다.
function series(range, shape) {
  const out = [];
  const add = (stamp, i, n) => {
    const f = i / n;
    const p = shape === 'up' ? 1000 + 4000 * f : 3000 + 1500 * Math.sin(f * Math.PI * 14) + 800 * Math.sin(f * 97);
    out.push([stamp, p]);
  };
  if (range.series === 'minute') {
    const days = ['20261103', '20261104', '20261105', '20261106', '20261109', '20261110', '20261111'];
    const n = days.length * 360;
    let i = 0;
    for (const d of days) {
      for (let m = 540; m < 900; m++) add(d + String(Math.floor(m / 60)).padStart(2, '0') + String(m % 60).padStart(2, '0'), i++, n);
    }
  } else {
    const step = { hourly: 3600e3 * 3.4, daily: 86400e3 * 1.4, weekly: 86400e3 * 7 }[range.series];
    const span = { hourly: 100, daily: 5.1 * 365, weekly: 30 * 365 }[range.series] * 86400e3;
    const end = Date.UTC(2026, 10, 11, 6);
    const n = Math.floor(span / step);
    for (let i = 0; i <= n; i++) {
      const s = new Date(end - span + i * step).toISOString().slice(0, 16).replace(/[-T:]/g, '');
      add(s, i, n);
    }
  }
  return toPoints(out);
}

for (const range of RANGES) {
  for (const shape of ['up', 'wave']) {
    test(`${range.label} (${shape === 'up' ? '오르기만' : '출렁임'}) 탑승은 ${RIDE_LIMIT}초 안에 끝난다`, () => {
      const win = selectWindow(series(range, shape), range);
      const stats = summarize(win, range);
      const track = buildTrack(win.points, stats, { series: range.series, length: range.length, log: !!range.log });
      const t = rideTime(track);
      assert.ok(t <= RIDE_LIMIT, `${t.toFixed(1)}초`);
      assert.ok(track.vLift >= PHYS.vLift && track.vLift <= PHYS.vMax);
    });
  }
}
