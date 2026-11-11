// 탑승 기간 계산 (순수 함수 — 테스트: test/window.test.mjs)
//
// 규칙 (모든 기간의 끝 = 가장 최근 지수: 장중이면 "지금", 장 마감 뒤면 그날 종가)
//  - 1일 = 전 거래일의 "같은 시각"부터
//      장중 11:00 → 전 거래일 11:00 ~ 오늘 11:00 (정확히 24시간)
//      장 마감 뒤·다음 장 시작 전 → 전 거래일 종가 ~ 마지막 거래일 장 마감
//      (밤·주말·휴일에는 지수가 없으므로 그 시간은 레일에서 빠집니다)
//  - 1주 = 달력 기준 7일 전 같은 시각부터            (1분봉)
//  - 3달 = 3달 전 같은 날짜·시각부터                 (1시간봉)
//  - 1년·5년 = 1년·5년 전 같은 날짜부터              (일봉)
//  - 전체 = 데이터가 있는 처음(1996년 12월)부터      (주봉)
//  - 5년·전체는 로그 눈금: 같은 % 움직임이 같은 높이가 되어 옛날 폭락·급등도 잘 보입니다.

export const RANGES = [
  { id: '1d', label: '1일', days: 1, series: 'minute' },
  { id: '1w', label: '1주', week: true, series: 'minute' },
  { id: '3m', label: '3달', months: 3, series: 'hourly', length: 46000 },
  { id: '1y', label: '1년', months: 12, series: 'daily', length: 40000 },
  { id: '5y', label: '5년', months: 60, series: 'daily', length: 44000, log: true },
  { id: 'all', label: '전체', all: true, series: 'weekly', length: 46000, log: true },
];

/** 데이터 파일의 키 */
export const SERIES_KEY = { minute: 'points', hourly: 'hourly', daily: 'daily', weekly: 'weekly' };

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
export function toPoints(raw = []) {
  return raw
    .map(([stamp, p]) => ({ ...parseStamp(stamp), p }))
    .filter((pt) => Number.isFinite(pt.p))
    .sort((a, b) => a.t - b.t);
}

/**
 * 시간봉·일봉·주봉의 끝을 1분봉의 최신 값(=지금)에 맞춥니다.
 * 같은 날짜의 마지막 봉은 최신 값으로 바꾸고, 더 최신이면 뒤에 붙입니다.
 */
export function withLatest(series, latest) {
  if (!latest || !series.length) return series;
  const last = series[series.length - 1];
  if (latest.date === last.date) return [...series.slice(0, -1), latest];
  if (latest.t > last.t) return [...series, latest];
  return series;
}

/** 날짜 'YYYYMMDD' + 시각(분) -> t */
function at(date, clock) {
  return parseStamp(date + String(Math.floor(clock / 60)).padStart(2, '0') + String(clock % 60).padStart(2, '0')).t;
}

/** t에서 달력 기준 n달 이동 (말일은 그 달 마지막 날로) */
function shiftMonths(t, n) {
  const d = new Date(t * 60000);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.getTime() / 60000;
}

/**
 * 탑승 구간을 고릅니다.
 * @returns {{points, startT, endT, complete}} complete=false면 데이터가 모자라 가능한 만큼만 담았다는 뜻
 */
export function selectWindow(points, range) {
  if (!points.length) return { points: [], startT: 0, endT: 0, complete: false };
  const end = points[points.length - 1];
  let startT;
  if (range.all) {
    startT = points[0].t;
  } else if (range.week) {
    startT = end.t - 7 * DAY_MIN;
  } else if (range.months) {
    startT = shiftMonths(end.t, -range.months);
    // 일봉·주봉은 날짜 단위로 자릅니다 (그날 봉이 09:00에 찍혀 있어도 포함).
    if (range.series === 'daily' || range.series === 'weekly') startT -= startT % DAY_MIN;
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
export function summarize(win, range = RANGES[0]) {
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
  const sessions = new Set(ps.map((p) => p.date)).size;
  // 하루 기준으로 환산한 변동폭으로 등급을 매깁니다 (기간이 길수록 원래 폭이 커지므로).
  const tradingDays =
    range.series === 'minute'
      ? sessions - (ps[0].clock >= 15 * 60 ? 1 : 0)
      : ((ps[ps.length - 1].t - ps[0].t) / DAY_MIN) * (5 / 7);
  const perDay = (Math.log(max / min) * 100) / Math.sqrt(Math.max(1, tradingDays));
  const stars = perDay < 1 ? 1 : perDay < 1.8 ? 2 : perDay < 2.8 ? 3 : perDay < 4.5 ? 4 : 5;
  return { first, last, min, max, changePct, stars, sessions };
}

/** t -> '11/10(화) 15:07' */
export function formatT(t, { withDate = true } = {}) {
  const d = new Date(t * 60000);
  const hm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  if (!withDate) return hm;
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAYS[d.getUTCDay()]}) ${hm}`;
}

/** 기간에 맞는 날짜 표기: 1분봉·시간봉은 '11/10(화) 15:07', 일봉·주봉은 '2026.11.10' */
export function formatFor(t, series) {
  if (series === 'minute' || series === 'hourly') return formatT(t);
  const d = new Date(t * 60000);
  return `${d.getUTCFullYear()}.${d.getUTCMonth() + 1}.${d.getUTCDate()}`;
}

/** 땅에 찍을 눈금: 1분봉은 매시, 시간봉은 매일, 일봉은 매달, 주봉은 매년 */
export function tickOf(t, series) {
  const d = new Date(t * 60000);
  if (series === 'minute') return { key: Math.floor(t / 60), label: formatT(Math.floor(t / 60) * 60, { withDate: false }) };
  if (series === 'hourly') return { key: Math.floor(t / DAY_MIN), label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}` };
  if (series === 'daily') {
    const m = d.getUTCMonth() + 1;
    return { key: d.getUTCFullYear() * 12 + m, label: m === 1 ? `${d.getUTCFullYear()}년` : `${m}월` };
  }
  return { key: d.getUTCFullYear(), label: `${d.getUTCFullYear()}` };
}
