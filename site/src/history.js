import { toPoints, summarize } from './window.js';

export const HISTORY = [
  {
    "id": "imf",
    "label": "IMF — 끝이 보이지 않는 추락",
    "start": "19970701",
    "end": "19980616",
    "duration": 45,
    "description": "외환위기 속에서 반등과 추락이 반복되던 시간",
    "series": "daily",
    "length": 45000
  },
  {
    "id": "recovery",
    "label": "위기 뒤의 대반등",
    "start": "19980616",
    "end": "19991228",
    "duration": 45,
    "description": "외환위기 이후 회복과 IT 열풍을 따라 올라갑니다",
    "series": "daily",
    "length": 45000
  },
  {
    "id": "dotcom",
    "label": "닷컴 버블 — 무너지는 기대",
    "start": "20000104",
    "end": "20001226",
    "duration": 45,
    "description": "IT 열풍 뒤에 찾아온 긴 하락을 체험합니다",
    "series": "daily",
    "length": 45000
  },
  {
    "id": "financial",
    "label": "금융위기 — 공포와 반등",
    "start": "20080701",
    "end": "20090630",
    "duration": 60,
    "description": "글로벌 금융위기의 급락부터 초기 회복까지",
    "series": "daily",
    "length": 60000
  },
  {
    "id": "covid",
    "label": "코로나 — 세상이 멈춘 순간",
    "start": "20200203",
    "end": "20200319",
    "duration": 30,
    "description": "코로나 충격이 시장을 덮친 짧고 가파른 하강",
    "series": "daily",
    "length": 30000
  },
  {
    "id": "covid-recovery",
    "label": "코로나 이후 — 다시 정상으로",
    "start": "20200319",
    "end": "20210625",
    "duration": 45,
    "description": "깊은 저점에서 시작해 새로운 고점으로 향합니다",
    "series": "daily",
    "length": 45000
  },
  {
    "id": "rise2025",
    "label": "2025 — 역사적 대상승",
    "start": "20241230",
    "end": "20251230",
    "duration": 45,
    "description": "처음으로 4,000을 넘어선 코스피를 타다",
    "series": "daily",
    "length": 45000
  }
];

export function historicalWindow(data, range) {
  const points = toPoints(data.points).filter(p => p.date >= range.start && p.date <= range.end);
  if (points.length < 2 || points[0].date !== range.start || points.at(-1).date !== range.end) throw new Error('역사 데이터 누락');
  return { points, startT: points[0].t, endT: points.at(-1).t, complete: true };
}

export function historicalStats(win, range) {
  const stats = summarize(win, range);
  let peak = win.points[0].p, drawdown = 0;
  for (const p of win.points) { peak = Math.max(peak, p.p); drawdown = Math.min(drawdown, (p.p / peak - 1) * 100); }
  return { ...stats, drawdown };
}
