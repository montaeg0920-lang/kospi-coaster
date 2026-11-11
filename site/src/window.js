// 탑승 구간 계산 (순수 함수 — 테스트: test/window.test.mjs)
//
// 규칙
//  - 레일의 끝 = 가장 최근 데이터 시점(장중이면 "지금", 장 마감 후면 그날 종가).
//  - N일 = 끝 시점에서 N거래일 전의 "같은 시각"부터 시작.
//      장중 11:00 → 전 거래일 11:00 ~ 오늘 11:00 (정확히 24시간)
//      장 마감 후·다음 장 시작 전 → 전 거래일 종가 ~ 마지막 거래일 장 마감
//      (밤·주말·휴일에는 지수가 없으므로 그 시간은 레일에서 빠집니다)
//  - 1주 = 끝 시점에서 달력 기준 7일 전의 같은 시각부터.

export const RANGES = [
  { id: '1d', label: '1일', days: 1 },
  { id: '2d', label: '2일', days: 2 },
  { id: '3d', label: '3일', days: 3 },
  { id: '4d', label: '4일', days: 4 },
  { id: '5d', label: '5일', days: 5 },
  { id: '1w', label: '1주', week: true },
];

const DAY_MIN = 24 * 60;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 'YYYYMMDDHHmm'(한국 시간) -> 점. t는 한국 벽시계 기준 분 단위 값입니다. */
export function parseStamp(stamp) {
  const y = +stamp.slice(0, 4);
  const mo = +stamp.slice(4, 6);
  const d = +stamp.slice(6, 8);
  const h = +stamp.slice(8, 10);
  const mi = +stamp.slice(10, 12);
  return { t: Date.UTC(y, mo - 1, d, h, mi) / 60000, date: stamp.slice(0, 8), clock: h * 60 + mi };
}

/** [[stamp, price], ...] -> 시간순으로 정렬된 점 배열 */
export function toPoints(raw) {
  return raw
    .map(([stamp, p]) => ({ ...parseStamp(stamp), p }))
    .filter((pt) => Number.isFinite(pt.p))
    .sort((a, b) => a.t - b.t);
}

/** 날짜 'YYYYMMDD' + 시각(분) -> t */
function at(date, clock) {
  return parseStamp(date + String(Math.floor(clock / 60)).padStart(2, '0') + String(clock % 60).padStart(2, '0')).t;
}

/**
 * 탑승 구간을 고릅니다.
 * @returns {{points, startT, endT, complete}} complete=false면 데이터가 모자라 가능한 만큼만 담았다는 뜻
 */
export function selectWindow(points, range) {
  if (!points.length) return { points: [], startT: 0, endT: 0, complete: false };
  const end = points[points.length - 1];
  let startT;
  if (range.week) {
    startT = end.t - 7 * DAY_MIN;
  } else {
    const dates = [...new Set(points.map((p) => p.date))];
    const idx = dates.indexOf(end.date);
    const from = dates[idx - range.days];
    startT = from ? at(from, end.clock) : -Infinity;
  }
  const picked = points.filter((p) => p.t >= startT);
  const complete = Number.isFinite(startT) && points[0].t <= startT;
  return { points: picked, startT, endT: end.t, complete };
}

/** 구간 요약: 등락률, 최고/최저, 스릴 등급(1~5) */
export function summarize(win) {
  const ps = win.points;
  if (ps.length < 2) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const p of ps) {
    if (p.p < min) min = p.p;
    if (p.p > max) max = p.p;
  }
  const first = ps[0].p;
  const last = ps[ps.length - 1].p;
  const changePct = ((last - first) / first) * 100;
  const rangePct = ((max - min) / first) * 100;
  const sessions = new Set(ps.map((p) => p.date)).size;
  // 하루 기준으로 환산한 변동폭으로 등급을 매깁니다 (기간이 길수록 원래 폭이 커지므로).
  const perDay = rangePct / Math.sqrt(Math.max(1, sessions - (ps[0].clock >= 15 * 60 ? 1 : 0)));
  const stars = perDay < 1 ? 1 : perDay < 1.8 ? 2 : perDay < 2.8 ? 3 : perDay < 4.5 ? 4 : 5;
  return { first, last, min, max, changePct, rangePct, stars, sessions };
}

/** t -> '11/10(화) 15:07' */
export function formatT(t, { withDate = true } = {}) {
  const d = new Date(t * 60000);
  const hm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  if (!withDate) return hm;
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAYS[d.getUTCDay()]}) ${hm}`;
}
