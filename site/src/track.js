// 지수 데이터 -> 롤러코스터 레일(월드 좌표, y는 위쪽이 +) + 물리
export const H = 1500; // 최저점~최고점 높이
const BASE_W = 17000; // 1거래일(390분) 레일 길이
const SESSION_MIN = 390;
const TUNNEL_MIN = 25; // 밤/주말 구간을 레일에서는 짧은 터널로
const STATION = 700; // 출발 승강장 길이
const BRAKE_RUN = 1100; // 도착 감속 구간 길이

export const PHYS = {
  g: 1500,
  vLift: 600, // 오르막 체인 리프트 기본 속도 (이보다 느려지지 않음). 레일마다 30초 안에 끝나도록 더 올릴 수 있습니다.
  vMax: 2700,
  drag: 0.00007,
  launch: 650,
};

export const RIDE_LIMIT = 30; // 일반 코스의 최대 탑승 시간(초). 역사 코스는 별도 duration을 사용합니다.
const RIDE_TARGET = 28; // 화면 프레임 차이를 감안한 여유
const DT = 1 / 120;

/** km/h 표시용 */
export const toKmh = (v) => Math.round(v * 0.09);

/**
 * @param {object} opts log: 로그 눈금 (5년·전체처럼 몇 배씩 오르내리는 기간)
 *                      series: 'minute'(1분봉, 밤은 터널) | 'hourly' | 'daily' | 'weekly' (봉 하나 = 한 칸)
 *                      length: 레일 길이(px). 없으면 1분봉 길이 공식을 씁니다.
 */
/** 가격 -> 0~1 높이. log=true면 로그 눈금(같은 % 움직임 = 같은 높이) */
export function heightScale(stats, log = false) {
  if (log) {
    const lo = Math.log(stats.min);
    const span = Math.log(stats.max) - lo || 1;
    return (p) => (Math.log(p) - lo) / span;
  }
  const span = stats.max - stats.min || 1;
  return (p) => (p - stats.min) / span;
}

export function buildTrack(points, stats, { series = 'minute', length, log = false, duration = RIDE_LIMIT } = {}) {
  const norm = heightScale(stats, log);
  const intraday = series === 'minute';
  // 1) 데이터 점마다 "레일 위 칸" 좌표를 매깁니다. 1분봉은 1칸 = 1분, 그 밖에는 봉 하나 = 1칸.
  const marks = [];
  const sessions = [];
  let m = 0;
  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    if (i > 0) {
      const prev = points[i - 1];
      if (!intraday) {
        m += 1;
      } else if (pt.date !== prev.date) {
        sessions.push({ m0: m, m1: m + TUNNEL_MIN, date: pt.date, t: pt.t, gap: pt.p - prev.p });
        m += TUNNEL_MIN;
      } else {
        m += Math.min(60, pt.t - prev.t);
      }
    }
    marks.push({ m, pt });
  }
  const M = Math.max(1, m);
  const pxPerMin = (length ?? BASE_W * Math.sqrt(Math.max(0.35, M / SESSION_MIN))) / M;

  // 2) 한 칸 간격으로 고르게 다시 뽑기 (선형 보간)
  const uni = [];
  let j = 0;
  for (let k = 0; k <= M; k++) {
    while (j < marks.length - 2 && marks[j + 1].m < k) j++;
    const a = marks[j];
    const b = marks[Math.min(j + 1, marks.length - 1)];
    const f = b.m === a.m ? 0 : Math.min(1, Math.max(0, (k - a.m) / (b.m - a.m)));
    const tunnel = sessions.some((s) => k > s.m0 && k < s.m1);
    uni.push({
      p: a.pt.p + (b.pt.p - a.pt.p) * f,
      t: tunnel ? null : a.pt.t + (b.pt.t - a.pt.t) * f,
      tunnel,
    });
  }

  // 3) 레일 모양은 살짝 다듬기 (이동평균). 가격 표시는 원래 값을 씁니다.
  //    반경을 화면 거리(약 260px)로 정해서, 기간이 길어도 골짜기가 너무 뾰족해지지 않게 합니다.
  const r = Math.max(2, Math.round(260 / pxPerMin));
  const blur = (arr) =>
    arr.map((_, i) => {
      let sum = 0;
      let w = 0;
      for (let d = -r; d <= r; d++) {
        const y = arr[Math.min(arr.length - 1, Math.max(0, i + d))];
        const wt = r + 1 - Math.abs(d);
        sum += y * wt;
        w += wt;
      }
      return sum / w;
    });
  const smooth = blur(blur(uni.map((u) => H * norm(u.p))));

  // 4) 승강장 + 본선 + 감속 구간
  const nodes = [];
  const y0 = smooth[0];
  const yEnd = smooth[smooth.length - 1];
  const stationStep = 40;
  for (let x = -STATION; x < 0; x += stationStep) nodes.push({ x, y: y0, p: uni[0].p, t: uni[0].t, zone: 'station' });
  uni.forEach((u, k) => nodes.push({ x: k * pxPerMin, y: smooth[k], p: u.p, t: u.t, zone: u.tunnel ? 'tunnel' : 'main' }));
  const xEnd = M * pxPerMin;
  for (let x = stationStep; x <= BRAKE_RUN; x += stationStep) {
    nodes.push({ x: xEnd + x, y: yEnd, p: uni.at(-1).p, t: uni.at(-1).t, zone: 'brake' });
  }

  // 5) 호 길이, 각도, 곡률
  let s = 0;
  for (let i = 0; i < nodes.length; i++) {
    if (i > 0) s += Math.hypot(nodes[i].x - nodes[i - 1].x, nodes[i].y - nodes[i - 1].y);
    nodes[i].s = s;
  }
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[Math.max(0, i - 1)];
    const b = nodes[Math.min(nodes.length - 1, i + 1)];
    nodes[i].ang = Math.atan2(b.y - a.y, b.x - a.x);
  }
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[Math.max(0, i - 1)];
    const b = nodes[Math.min(nodes.length - 1, i + 1)];
    const ds = b.s - a.s || 1;
    let da = b.ang - a.ang;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    nodes[i].kappa = da / ds;
  }

  const brakeStart = nodes.find((n) => n.zone === 'brake')?.s ?? s;
  const track = {
    nodes,
    length: s,
    mainStart: 0,
    brakeStart,
    sessions: sessions.map((ss) => ({ ...ss, x0: ss.m0 * pxPerMin, x1: ss.m1 * pxPerMin })),
    pxPerMin,
    xEnd,
    stats,
    norm,
    log,
    vLift: PHYS.vLift,
  };
  track.vLift = fitLift(track, duration - 2);
  return track;
}

/** 이 레일을 끝까지 타는 데 걸리는 시간(초)을 미리 계산합니다. */
export function rideTime(track, vLift = track.vLift, limit = 120) {
  const saved = track.vLift;
  track.vLift = vLift;
  const st = { s: 0, v: PHYS.launch };
  let t = 0;
  while (t < limit) {
    const { here } = step(track, st, DT);
    t += DT;
    if ((here.zone === 'brake' && st.v <= 45) || st.s >= track.length - 2) break;
  }
  track.vLift = saved;
  return t;
}

/** 코스의 목표 시간 안에 끝나도록 오르막 속도를 정합니다. */
function fitLift(track, target = RIDE_TARGET) {
  let lo = PHYS.vLift;
  if (rideTime(track, lo) <= target) return lo;
  let hi = PHYS.vMax;
  for (let k = 0; k < 12; k++) {
    const mid = (lo + hi) / 2;
    if (rideTime(track, mid) <= target) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** 호 길이 s 위치의 레일 정보 (이분 탐색 + 보간) */
export function sampleAt(track, s) {
  const ns = track.nodes;
  if (s <= 0) return { ...ns[0], s: Math.max(s, 0), i: 0 };
  if (s >= track.length) return { ...ns[ns.length - 1], i: ns.length - 1 };
  let lo = 0;
  let hi = ns.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ns[mid].s <= s) lo = mid;
    else hi = mid;
  }
  const a = ns[lo];
  const b = ns[hi];
  const f = (s - a.s) / (b.s - a.s || 1);
  const lerp = (u, v) => u + (v - u) * f;
  return {
    x: lerp(a.x, b.x),
    y: lerp(a.y, b.y),
    p: lerp(a.p, b.p),
    t: a.t == null || b.t == null ? (a.t ?? b.t) : lerp(a.t, b.t),
    ang: Math.atan2(b.y - a.y, b.x - a.x),
    kappa: lerp(a.kappa, b.kappa),
    zone: f < 0.5 ? a.zone : b.zone,
    s,
    i: lo,
  };
}

/** 물리 한 스텝. state = {s, v}. 반환: 그 순간의 레일 정보와 법선 가속도 */
export function step(track, state, dt) {
  const here = sampleAt(track, state.s);
  let a = -PHYS.g * Math.sin(here.ang) - PHYS.drag * state.v * state.v;
  if (here.zone === 'brake') a = -Math.max(900, state.v * 1.4);
  if (here.zone === 'station') a = 0;
  state.v += a * dt;
  if (here.zone === 'brake') state.v = Math.max(state.v, 40);
  else state.v = Math.min(PHYS.vMax, Math.max(track.vLift ?? PHYS.vLift, state.v));
  state.s += state.v * dt;
  const an = state.v * state.v * here.kappa; // + 방향이면 위로 휘는 곳(눌리는 G)
  return { here, a, an };
}
