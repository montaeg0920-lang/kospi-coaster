import { RANGES, SERIES_KEY, toPoints, withLatest, selectWindow, summarize, formatT, formatFor, tickOf } from './window.js';
import { H, PHYS, buildTrack, sampleAt, step, toKmh } from './track.js';

const DATA_URL = 'data/kospi.json';
const REFRESH_MS = 5 * 60 * 1000; // 데이터 파일은 1시간마다 바뀌고, 화면은 5분마다 확인합니다.
const GROUND = -160; // 땅 높이 (월드 좌표)
const DT = 1 / 120;

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
const mini = $('minimap');
const preview = $('preview');

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* 저장 못 해도 게임은 그대로 */
    }
  },
};

let data = null;
let points = [];
let pending = null;
let rangeId = RANGES.some((r) => r.id === store.get('kc.range')) ? store.get('kc.range') : '1d';
let mode = 'loading'; // menu | ride | result
let course = null;
let ride = null;
let miniCache = null;
let particles = [];
let camX = 0;
let shake = 0;
let night = 0;
let view = { w: 0, h: 0, dpr: 1 };

// ---------------------------------------------------------------- 데이터

async function loadData() {
  const res = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(res.status);
  const json = await res.json();
  if (!Array.isArray(json.points) || json.points.length < 2) throw new Error('empty');
  return json;
}

function applyData(json) {
  data = json;
  points = toPoints(json.points);
  pending = null;
  rebuildCourse();
  renderDataInfo();
}

async function checkUpdate() {
  try {
    const json = await loadData();
    if (data && json.updatedAt === data.updatedAt) return;
    const lastNew = json.points.at(-1)[0];
    const lastOld = data?.points.at(-1)[0];
    if (mode === 'ride') {
      pending = json;
      if (lastNew !== lastOld) toast('🛤️ 새 레일 도착! 다음 탑승부터 적용돼요');
    } else {
      applyData(json);
      if (lastNew !== lastOld) toast(`🛤️ 새 레일이 깔렸어요 (~${formatT(points.at(-1).t)})`);
    }
  } catch {
    /* 다음 확인 때 다시 */
  }
}

function renderDataInfo() {
  if (!data) return;
  const updated = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(data.updatedAt));
  $('data-info').textContent = `${updated} 갱신 · 장중 1시간마다 새 레일 · ${data.source} (약 15~20분 지연)`;
}

// ---------------------------------------------------------------- 코스

function rebuildCourse() {
  const range = RANGES.find((r) => r.id === rangeId) ?? RANGES[0];
  // 1일·1주는 1분봉, 3달은 시간봉, 1년·5년은 일봉, 전체는 주봉. 끝은 모두 1분봉의 최신 값(=지금)에 맞춥니다.
  const series = range.series === 'minute' ? points : withLatest(toPoints(data?.[SERIES_KEY[range.series]]), points.at(-1));
  const win = selectWindow(series, range);
  const stats = summarize(win, range);
  if (!stats) {
    course = null;
    renderMenu();
    return;
  }
  const track = buildTrack(win.points, stats, { series: range.series, length: range.length, log: !!range.log });
  course = { range, win, stats, track, key: `${range.id}:${win.endT}` };
  miniCache = null;
  if (mode !== 'ride') newRide(true);
  renderMenu();
}

function newRide(demo) {
  ride = {
    demo,
    s: 0,
    v: PHYS.launch,
    hands: false,
    nausea: 0,
    score: 0,
    holdT: 0,
    combo: 1,
    fainted: false,
    g: 1,
    maxV: 0,
    maxG: 1,
    here: course ? sampleAt(course.track, 0) : null,
    acc: 0,
    done: false,
  };
  particles = [];
  camX = course ? ride.here.x - viewWorldW() * 0.3 : 0;
}

// ---------------------------------------------------------------- 화면 상태

function setMode(next) {
  mode = next;
  $('menu').hidden = next !== 'menu';
  $('result').hidden = next !== 'result';
  $('hud').hidden = next !== 'ride';
  setHands(false);
  // 숨겨져 있던 캔버스는 크기가 0이라, 보일 때 다시 잽니다.
  if (next === 'ride') sizeCanvas(mini);
  if (next === 'menu') sizeCanvas(preview);
  miniCache = null;
}

function renderMenu() {
  const box = $('ranges');
  if (!box.childElementCount) {
    for (const r of RANGES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = r.label;
      b.dataset.id = r.id;
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => {
        rangeId = r.id;
        store.set('kc.range', r.id);
        rebuildCourse();
      });
      box.append(b);
    }
  }
  for (const b of box.children) b.setAttribute('aria-checked', String(b.dataset.id === rangeId));

  $('start').disabled = !course;
  if (!course) {
    $('win-span').textContent = data ? '탈 수 있는 데이터가 없어요' : '--';
    return;
  }
  const { win, stats } = course;
  const s = course.range.series;
  $('win-span').textContent = `${formatFor(win.points[0].t, s)} → ${formatFor(win.endT, s)}`;
  setChange($('win-change'), stats.changePct);
  $('win-stars').textContent = starText(stats.stars);
  const note = $('win-note');
  if (!win.complete) {
    note.hidden = false;
    note.textContent = `데이터가 모자라 ${formatFor(win.points[0].t, course.range.series)}부터 있는 만큼만 담았어요`;
  } else note.hidden = true;
  drawChart(preview, { marker: false });
}

function setChange(el, pct) {
  el.textContent = `${pct >= 0 ? '▲' : '▼'}${Math.abs(pct).toFixed(2)}%`;
  el.className = `chg ${pct >= 0 ? 'up' : 'down'}`;
}

const starText = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
const fmtNum = (n) => Math.round(n).toLocaleString('ko-KR');
const fmtPrice = (p) => p.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function startRide() {
  if (!course) return;
  newRide(false);
  setMode('ride');
  toast('출발! 🎢 누르고 있으면 만세');
}

function finishRide() {
  ride.done = true;
  const { stats, range, win } = course;
  const bestKey = `kc.best.${course.key}`;
  const prevBest = store.get(bestKey, 0);
  const score = Math.floor(ride.score);
  if (score > prevBest) store.set(bestKey, score);

  $('res-title').textContent = ride.fainted ? '기절! 😵' : score >= 3000 ? '완주! 🎉' : '도착!';
  $('res-score').textContent = fmtNum(score);
  $('res-best').textContent =
    score > prevBest && prevBest > 0
      ? `이 레일 최고 기록 경신! (이전 ${fmtNum(prevBest)}점)`
      : prevBest > 0
        ? `이 레일 최고 기록 ${fmtNum(Math.max(prevBest, score))}점`
        : `${range.label} 레일 · ${formatFor(win.endT, range.series)}까지`;
  setChange($('res-change'), stats.changePct);
  $('res-stars').textContent = starText(stats.stars);
  $('res-speed').textContent = `${toKmh(ride.maxV)} km/h`;
  $('res-g').textContent = `${ride.maxG.toFixed(1)} G`;
  setMode('result');
}

async function share() {
  const { stats, range, win } = course;
  const text = [
    `🎢 KOSPI 코스터 [${range.label}] ${formatFor(win.points[0].t, range.series)} → ${formatFor(win.endT, range.series)}`,
    `구간 ${stats.changePct >= 0 ? '▲' : '▼'}${Math.abs(stats.changePct).toFixed(2)}% · 스릴 ${starText(stats.stars)}`,
    `만세 점수 ${fmtNum(ride.score)}점 · 최고 ${toKmh(ride.maxV)}km/h · 최대 ${ride.maxG.toFixed(1)}G${ride.fainted ? ' · 기절 😵' : ''}`,
  ].join('\n');
  const url = location.href.split('#')[0];
  try {
    if (navigator.share) {
      await navigator.share({ text, url });
      return;
    }
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast('결과를 복사했어요');
  } catch {
    /* 사용자가 취소 */
  }
}

let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

// ---------------------------------------------------------------- 입력

function setHands(on) {
  if (ride) ride.hands = on && mode === 'ride' && !ride.fainted;
  $('hands').classList.toggle('on', !!ride?.hands);
}
canvas.addEventListener('pointerdown', () => mode === 'ride' && setHands(true));
$('hands').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  setHands(true);
});
for (const ev of ['pointerup', 'pointercancel', 'blur']) window.addEventListener(ev, () => setHands(false));
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && mode === 'ride') {
    e.preventDefault();
    setHands(true);
  } else if (e.code === 'Enter' && mode === 'menu') startRide();
});
window.addEventListener('keyup', (e) => e.code === 'Space' && setHands(false));
window.addEventListener('contextmenu', (e) => e.preventDefault());

$('start').addEventListener('click', startRide);
$('again').addEventListener('click', startRide);
$('share').addEventListener('click', share);
$('to-menu').addEventListener('click', () => {
  if (pending) applyData(pending);
  else newRide(true);
  setMode('menu');
});

// ---------------------------------------------------------------- 시뮬레이션

function update(dt) {
  if (!course || !ride) return;
  if (ride.done) return;
  ride.acc += Math.min(dt, 0.1);
  while (ride.acc >= DT) {
    ride.acc -= DT;
    tick(DT);
    if (ride.done) break;
  }
}

function tick(dt) {
  const { track } = course;
  const { here, an } = step(track, ride, dt);
  ride.here = sampleAt(track, ride.s);
  const gRaw = Math.max(-2, Math.min(7, Math.cos(here.ang) + an / PHYS.g));
  ride.g += (gRaw - ride.g) * Math.min(1, dt * 6);
  ride.maxV = Math.max(ride.maxV, ride.v);
  if (here.zone === 'main') ride.maxG = Math.max(ride.maxG, ride.g);

  if (!ride.demo && !ride.fainted && here.zone !== 'station') {
    const speed = Math.max(0, Math.min(1, (ride.v - course.track.vLift) / (PHYS.vMax * 0.5)));
    const force = Math.max(0, Math.min(1, Math.abs(ride.g - 1) / 2.2));
    const thrill = speed * 0.7 + force * 0.3;
    const harsh = Math.max(0, Math.abs(ride.g - 1) - 1.2);
    if (ride.hands && here.zone === 'main') {
      ride.holdT += dt;
      ride.combo = Math.min(3, 1 + ride.holdT / 4);
      ride.score += (4 + 260 * thrill * thrill) * ride.combo * dt;
      ride.nausea += (2 + 40 * thrill + 12 * harsh) * dt;
    } else {
      ride.holdT = 0;
      ride.combo = 1;
      ride.nausea += (6 * harsh - 15) * dt;
    }
    ride.nausea = Math.max(0, ride.nausea);
    if (ride.nausea >= 100) {
      ride.nausea = 100;
      ride.fainted = true;
      setHands(false);
      toast('😵 기절했어요… 끝까지 실려 갑니다');
    }
  }

  // 효과: 빠른 내리막 불꽃, 큰 G 흔들림
  if (ride.v > 1500 && here.ang < -0.25 && Math.random() < 0.6) particles.push(spark());
  shake = Math.max(shake * 0.9, Math.max(0, Math.abs(ride.g - 1) - 1.4) * 3);

  const end = ride.here.zone === 'brake' && (ride.v <= 45 || ride.s >= track.length - 2);
  if (end || ride.s >= track.length - 1) {
    if (ride.demo) newRide(true);
    else finishRide();
  }
}

function spark() {
  return { wx: ride.here.x, wy: ride.here.y, vx: -Math.random() * 260 - 60, vy: Math.random() * 240 + 40, life: 0.5 };
}

// ---------------------------------------------------------------- 그리기

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  view = { w: window.innerWidth, h: window.innerHeight, dpr };
  for (const c of [canvas]) {
    c.width = Math.round(view.w * dpr);
    c.height = Math.round(view.h * dpr);
  }
  sizeCanvas(mini);
  sizeCanvas(preview);
  miniCache = null;
  if (mode === 'menu' && course) drawChart(preview, { marker: false });
}

function sizeCanvas(c) {
  const r = c.getBoundingClientRect();
  c.width = Math.max(1, Math.round(r.width * view.dpr));
  c.height = Math.max(1, Math.round(r.height * view.dpr));
}

// 화면 위쪽(HUD)과 아래쪽(게이지) 사이에 최저~최고 높이를 맞춥니다.
const TOP_PAD = 150;
const BOTTOM_PAD = 150;
function scale() {
  return Math.max(0.06, Math.min((view.h - TOP_PAD - BOTTOM_PAD) / H, view.w / 900));
}
const baseY = () => view.h - BOTTOM_PAD;
const viewWorldW = () => view.w / scale();

function render(dt) {
  const { w, h, dpr } = view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!course || !ride) {
    ctx.fillStyle = '#0f1729';
    ctx.fillRect(0, 0, w, h);
    return;
  }
  const sc = scale();
  const target = ride.here.x - viewWorldW() * 0.3;
  camX += (target - camX) * Math.min(1, dt * 5);
  const sx = (Math.random() - 0.5) * shake;
  const sy = (Math.random() - 0.5) * shake;
  const X = (x) => (x - camX) * sc + sx;
  const Y = (y) => baseY() - y * sc + sy;

  if (course.range.series === 'minute') {
    night += ((ride.here.zone === 'tunnel' ? 1 : 0) - night) * Math.min(1, dt * 3);
  } else {
    night = 0;
  }
  drawSky(w, h);
  drawSkyline(w, h, sc);
  drawGrid(w, Y);
  drawGround(w, h, Y);

  const { track } = course;
  const ns = track.nodes;
  const x0 = camX - 200 / sc;
  const x1 = camX + (w + 200) / sc;
  const i0 = Math.max(0, lowerBound(ns, x0) - 2);
  const i1 = Math.min(ns.length - 1, lowerBound(ns, x1) + 2);

  drawTunnels(track, X, Y, x0, x1);
  drawSupports(ns, i0, i1, X, Y, track.pxPerMin);
  drawRail(ns, i0, i1, X, Y);
  drawLabels(track, ns, i0, i1, X, Y);
  drawParticles(dt, X, Y);
  drawTrain(sc, X, Y);
  if (ride.v > 1700) drawSpeedLines(w, h, (ride.v - 1700) / 1000);

  if (mode === 'ride') updateHud();
}

function lowerBound(ns, x) {
  let lo = 0;
  let hi = ns.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ns[mid].x < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const mix = (a, b, f) => a.map((v, i) => Math.round(v + (b[i] - v) * f));
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

function drawSky(w, h) {
  // 1일·1주만 시간에 따라 하늘이 변합니다. 장기 코스는 정오의 밝기로 고정합니다.
  const clock = course.range.series !== 'minute'
    ? 720
    : ride.here.t == null ? 900 : ((ride.here.t % 1440) + 1440) % 1440;
  const f = Math.max(0, Math.min(1, (clock - 540) / 390));
  let top = mix([70, 140, 230], [60, 70, 150], f);
  let bot = mix([175, 220, 255], [255, 180, 130], f);
  top = mix(top, [8, 10, 30], night);
  bot = mix(bot, [30, 30, 70], night);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, rgb(top));
  g.addColorStop(1, rgb(bot));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  if (night > 0.05) {
    ctx.fillStyle = `rgba(255,255,255,${0.8 * night})`;
    for (let i = 0; i < 60; i++) {
      const x = (hash(i) * w * 1.3 - camX * 0.02) % w;
      ctx.fillRect((x + w) % w, hash(i + 99) * h * 0.6, 2, 2);
    }
  }
}

function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function drawSkyline(w, h, sc) {
  const par = 0.25;
  const off = camX * sc * par;
  const spacing = 70;
  const first = Math.floor(off / spacing) - 1;
  const ground = baseY() - GROUND * sc;
  ctx.fillStyle = `rgba(20,30,60,${0.35 + 0.3 * night})`;
  for (let i = first; i < first + w / spacing + 3; i++) {
    const bw = 40 + hash(i) * 50;
    const bh = 60 + hash(i + 7) * Math.min(260, h * 0.35);
    const x = i * spacing - off;
    ctx.fillRect(x, ground - bh, bw, bh + 2);
    if (night > 0.3) {
      ctx.fillStyle = `rgba(255,220,120,${0.5 * night})`;
      for (let k = 0; k < 4; k++) ctx.fillRect(x + 8 + hash(i * 5 + k) * (bw - 16), ground - bh + 10 + hash(i * 3 + k) * (bh - 20), 4, 5);
      ctx.fillStyle = `rgba(20,30,60,${0.35 + 0.3 * night})`;
    }
  }
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
}

/** 가격 눈금: 보통은 같은 간격, 로그 눈금이면 1·2·5 배수 (500, 1,000, 2,000, 5,000 …) */
function gridPrices(min, max, log) {
  const out = [];
  if (log && max / min > 3) {
    for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++) {
      for (const m of [1, 2, 5]) {
        const p = m * 10 ** e;
        if (p >= min && p <= max) out.push(p);
      }
    }
    return out;
  }
  const stepP = niceStep((max - min || 1) / 4);
  for (let p = Math.ceil(min / stepP) * stepP; p <= max; p += stepP) out.push(p);
  return out;
}

function drawGrid(w, Y) {
  const { min, max } = course.stats;
  const { norm, log } = course.track;
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.setLineDash([4, 6]);
  for (const p of gridPrices(min, max, log)) {
    const y = Y(H * norm(p));
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(fmtNum(p), w - 8, y - 4);
  }
  ctx.setLineDash([]);
}

function drawGround(w, h, Y) {
  const gy = Y(GROUND);
  const g = ctx.createLinearGradient(0, gy, 0, h);
  g.addColorStop(0, rgb(mix([58, 120, 70], [20, 35, 40], night)));
  g.addColorStop(1, rgb(mix([30, 70, 45], [10, 15, 25], night)));
  ctx.fillStyle = g;
  ctx.fillRect(0, gy, w, h - gy);
}

function drawTunnels(track, X, Y, x0, x1) {
  ctx.textAlign = 'center';
  for (const s of track.sessions) {
    if (s.x1 < x0 || s.x0 > x1) continue;
    const left = X(s.x0) - 30;
    const right = X(s.x1) + 30;
    const top = Y(H + 120);
    ctx.fillStyle = 'rgba(12,14,34,0.88)';
    ctx.beginPath();
    ctx.moveTo(left, Y(GROUND));
    ctx.lineTo(left, top + 30);
    ctx.quadraticCurveTo((left + right) / 2, top - 30, right, top + 30);
    ctx.lineTo(right, Y(GROUND));
    ctx.fill();
    const cx = (left + right) / 2;
    ctx.fillStyle = '#fff';
    ctx.font = '800 15px system-ui, sans-serif';
    ctx.fillText(`🌙 ${formatT(s.t).split(' ')[0]} 개장`, cx, top + 30);
    const gapPct = (s.gap / course.stats.first) * 100;
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.fillStyle = gapPct >= 0 ? '#ff8a90' : '#8fb8ff';
    ctx.fillText(`밤사이 ${gapPct >= 0 ? '▲' : '▼'}${Math.abs(gapPct).toFixed(2)}%`, cx, top + 48);
  }
}

function drawSupports(ns, i0, i1, X, Y, pxPerMin) {
  const every = Math.max(1, Math.round(160 / pxPerMin));
  ctx.strokeStyle = 'rgba(235,240,255,0.28)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = i0; i <= i1; i++) {
    const n = ns[i];
    if (n.zone !== 'main' && n.zone !== 'tunnel') continue;
    if (Math.round(n.x / pxPerMin) % every) continue;
    ctx.moveTo(X(n.x), Y(n.y) + 4);
    ctx.lineTo(X(n.x), Y(GROUND));
  }
  ctx.stroke();
}

function railColor(n) {
  if (n.zone === 'station' || n.zone === 'brake') return '#c9cfdc';
  if (n.zone === 'tunnel') return '#8a90a8';
  return n.ang > 0.015 ? '#ff4d57' : n.ang < -0.015 ? '#3d8bff' : '#e8ebf2';
}

function drawRail(ns, i0, i1, X, Y) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(10,12,25,0.85)';
  ctx.lineWidth = 9;
  ctx.beginPath();
  for (let i = i0; i <= i1; i++) {
    const n = ns[i];
    if (i === i0) ctx.moveTo(X(n.x), Y(n.y));
    else ctx.lineTo(X(n.x), Y(n.y));
  }
  ctx.stroke();
  ctx.lineWidth = 4.5;
  let i = i0;
  while (i < i1) {
    const color = railColor(ns[i]);
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(X(ns[i].x), Y(ns[i].y));
    while (i < i1 && railColor(ns[i]) === color) {
      i++;
      ctx.lineTo(X(ns[i].x), Y(ns[i].y));
    }
    ctx.stroke();
  }
}

function drawLabels(track, ns, i0, i1, X, Y) {
  ctx.textAlign = 'center';
  ctx.font = '700 11px system-ui, sans-serif';
  const gy = Y(GROUND);
  const series = course.range.series;
  // 눈금이 바뀌는 곳(매시 / 매일 / 매달 / 매년)에 표시합니다.
  let prevKey = null;
  for (let i = Math.max(0, i0 - 1); i <= i1; i++) {
    const n = ns[i];
    if (n.zone !== 'main' || n.t == null) continue;
    const tick = tickOf(n.t, series);
    if (prevKey !== null && tick.key !== prevKey && i >= i0) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(X(n.x) - 1, gy, 2, 6);
      ctx.fillText(tick.label, X(n.x), gy + 18);
    }
    prevKey = tick.key;
  }
  // 출발 / 도착 표지
  const start = ns[0];
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '800 14px system-ui, sans-serif';
  ctx.fillRect(X(start.x), Y(start.y) + 8, X(0) - X(start.x), 6);
  ctx.fillText('🚉 출발', (X(start.x) + X(0)) / 2, Y(start.y) - 60);
  ctx.fillText('🏁 도착', X(track.xEnd + 500), Y(ns.at(-1).y) - 60);
}

function drawParticles(dt, X, Y) {
  const sc = scale();
  ctx.fillStyle = '#ffd23f';
  particles = particles.filter((p) => (p.life -= dt) > 0);
  for (const p of particles) {
    p.wx += (p.vx * dt) / sc;
    p.wy += (p.vy * dt) / sc;
    p.vy -= 600 * dt;
    ctx.globalAlpha = Math.max(0, p.life * 2);
    ctx.fillRect(X(p.wx), Y(p.wy), 3, 3);
  }
  ctx.globalAlpha = 1;
}

function drawTrain(sc, X, Y) {
  const u = Math.max(0.8, Math.min(1.35, Math.min(view.w, view.h) / 520));
  const carLen = 40 * u;
  const colors = ['#ffd23f', '#ff4d57', '#ff4d57'];
  for (let k = 2; k >= 0; k--) {
    const at = sampleAt(course.track, ride.s - (k * (carLen + 4)) / sc);
    ctx.save();
    ctx.translate(X(at.x), Y(at.y));
    ctx.rotate(-at.ang);
    ctx.scale(u, u);
    // 승객
    for (const hx of [-9, 9]) {
      const up = ride.hands;
      ctx.strokeStyle = '#ffe0bd';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (up) {
        ctx.moveTo(hx - 3, -20);
        ctx.lineTo(hx - 8, -36);
        ctx.moveTo(hx + 3, -20);
        ctx.lineTo(hx + 8, -36);
      } else {
        ctx.moveTo(hx - 4, -18);
        ctx.lineTo(hx - 7, -12);
        ctx.moveTo(hx + 4, -18);
        ctx.lineTo(hx + 7, -12);
      }
      ctx.stroke();
      ctx.fillStyle = ride.fainted ? '#b9c0cc' : '#ffe0bd';
      ctx.beginPath();
      ctx.arc(hx, -24, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2b2b2b';
      if (ride.fainted) {
        ctx.font = '700 7px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('x x', hx, -22);
      } else {
        ctx.fillRect(hx - 3, -26, 1.6, 1.6);
        ctx.fillRect(hx + 1.6, -26, 1.6, 1.6);
      }
    }
    // 차체
    ctx.fillStyle = colors[k];
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1.5;
    roundRect(-20, -18, 40, 15, 4);
    ctx.fill();
    ctx.stroke();
    if (k === 0) {
      ctx.fillStyle = '#1b2440';
      ctx.font = '900 8px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('KOSPI', 0, -7.5);
    }
    // 바퀴
    ctx.fillStyle = '#1b1f2e';
    for (const wx of [-12, 12]) {
      ctx.beginPath();
      ctx.arc(wx, -2, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawSpeedLines(w, h, f) {
  ctx.strokeStyle = `rgba(255,255,255,${Math.min(0.35, f * 0.4)})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 14; i++) {
    const y = Math.random() * h;
    const x = Math.random() * w;
    ctx.moveTo(x, y);
    ctx.lineTo(x - 60 - 120 * f, y);
  }
  ctx.stroke();
}

// 미니맵·미리보기: 탑승 구간 전체 그래프
function drawChart(c, { marker }) {
  if (!course) return;
  const cx = c.getContext('2d');
  const dpr = view.dpr;
  const w = c.width / dpr;
  const h = c.height / dpr;
  if (w < 2 || h < 2) return;
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const { track, stats } = course;
  const main = track.nodes.filter((n) => n.zone === 'main' || n.zone === 'tunnel');
  const px = (x) => 6 + (x / track.xEnd) * (w - 12);
  const py = (p) => h - 6 - track.norm(p) * (h - 12);
  const baseLine = py(stats.first);

  if (!marker || !miniCache) {
    cx.clearRect(0, 0, w, h);
    cx.setLineDash([3, 4]);
    cx.strokeStyle = 'rgba(255,255,255,0.3)';
    cx.lineWidth = 1;
    cx.beginPath();
    cx.moveTo(0, baseLine);
    cx.lineTo(w, baseLine);
    for (const s of track.sessions) {
      cx.moveTo(px((s.x0 + s.x1) / 2), 0);
      cx.lineTo(px((s.x0 + s.x1) / 2), h);
    }
    cx.stroke();
    cx.setLineDash([]);
    for (const [clip, color] of [
      [[0, baseLine], 'rgba(255,77,87,0.28)'],
      [[baseLine, h], 'rgba(61,139,255,0.28)'],
    ]) {
      cx.save();
      cx.beginPath();
      cx.rect(0, clip[0], w, clip[1] - clip[0]);
      cx.clip();
      cx.beginPath();
      cx.moveTo(px(main[0].x), baseLine);
      for (const n of main) cx.lineTo(px(n.x), py(n.p));
      cx.lineTo(px(main.at(-1).x), baseLine);
      cx.fillStyle = color;
      cx.fill();
      cx.restore();
    }
    cx.strokeStyle = '#fff';
    cx.lineWidth = 1.5;
    cx.beginPath();
    main.forEach((n, i) => (i ? cx.lineTo(px(n.x), py(n.p)) : cx.moveTo(px(n.x), py(n.p))));
    cx.stroke();
    if (marker) miniCache = cx.getImageData(0, 0, c.width, c.height);
  } else {
    cx.putImageData(miniCache, 0, 0);
  }
  if (marker && ride) {
    const x = Math.max(6, Math.min(w - 6, px(Math.max(0, Math.min(track.xEnd, ride.here.x)))));
    const y = py(ride.here.p);
    cx.fillStyle = '#ffd23f';
    cx.beginPath();
    cx.arc(x, y, 4.5, 0, Math.PI * 2);
    cx.fill();
    cx.strokeStyle = '#1b2440';
    cx.lineWidth = 1.5;
    cx.stroke();
  }
}

let hudFrame = 0;
function updateHud() {
  drawChart(mini, { marker: true });
  if (hudFrame++ % 3) return;
  const { here } = ride;
  $('hud-time').textContent =
    here.zone === 'tunnel' ? '🌙 장 마감 · 다음 장으로' : here.t == null
        ? '--'
        : course.range.series === 'minute'
          ? formatT(Math.round(here.t))
          : // 시간봉·일봉·주봉은 사이 값을 섞지 않고 지나온 봉의 날짜를 보여 줍니다 (주말 날짜가 나오지 않게).
            formatFor(course.track.nodes[here.i].t ?? here.t, course.range.series);
  $('hud-price').textContent = fmtPrice(here.p);
  setChange($('hud-change'), ((here.p - course.stats.first) / course.stats.first) * 100);
  $('hud-score').textContent = fmtNum(ride.score);
  $('hud-speed').textContent = toKmh(ride.v);
  $('hud-g').textContent = ride.g.toFixed(1);
  $('hud-combo').textContent = ride.hands && ride.combo > 1.2 ? ` ×${ride.combo.toFixed(1)}` : '';
  $('gauge-fill').style.width = `${ride.nausea}%`;
  $('gauge-text').textContent = ride.fainted ? '기절 😵' : `${Math.round(ride.nausea)}%`;
}

// ---------------------------------------------------------------- 루프

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  render(dt);
  requestAnimationFrame(frame);
}

async function boot() {
  resize();
  window.addEventListener('resize', resize);
  setMode('menu');
  renderMenu();
  requestAnimationFrame(frame);
  try {
    applyData(await loadData());
    resize();
    renderMenu();
  } catch {
    $('data-info').textContent = '데이터를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.';
  }
  setInterval(checkUpdate, REFRESH_MS);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && checkUpdate());
}

boot();
