import { weatherTarget, easeWeather, drawWeatherSky, drawWeatherFront } from './atmosphere.js';
import { HISTORY, historicalWindow, historicalStats } from './history.js';
import { RANGES, SERIES_KEY, toPoints, withLatest, selectWindow, summarize, formatT, formatFor, tickOf } from './window.js';
import { H, PHYS, buildTrack, sampleAt, step, toKmh } from './track.js';
import { applyRules, resultTitle } from './rules.js';
import { createFeedback } from './feedback.js';
import { bestKey, staleBestKeys, addToTotal, TOTAL_KEY } from './records.js';
import { shareResult } from './share.js';
import { LIVE_DATA_URLS, ON_SITE, SHARE_URL } from './config.js';
import { CHARACTERS, DEFAULT_CHARACTER, characterSrc, cheerSrc, CHEER_PAD, isCharacter, crew } from './characters.js';
import { platform } from './platform.js';

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
    platform.persist();
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* 무시 */
    }
    platform.persist();
  },
  keys() {
    try {
      return Object.keys(localStorage);
    } catch {
      return [];
    }
  },
};

// 앱 안에서는 앱 저장소에 남겨 둔 설정·기록을 먼저 불러옵니다 (웹에서는 바로 지나갑니다).
await platform.restore();

// 소리·진동 (사용자가 끄면 기억합니다)
const feedback = createFeedback({ enabled: store.get('kc.sound', true) !== false });

let historyData = null;
let selectedHistory = null;
let data = null;
let points = [];
let pending = null;
let rangeId = RANGES.some((r) => r.id === store.get('kc.range')) ? store.get('kc.range') : '1d';
let mode = 'loading'; // menu | history | guide | ride | result

// 탑승 캐릭터
let characterId = isCharacter(store.get('kc.character')) ? store.get('kc.character') : DEFAULT_CHARACTER;
const loadImage = (src) => {
  const img = new Image();
  img.src = src;
  return img;
};
const sprites = Object.fromEntries(CHARACTERS.map((c) => [c.id, loadImage(characterSrc(c.id))]));
const cheers = Object.fromEntries(CHARACTERS.map((c) => [c.id, loadImage(cheerSrc(c.id))]));
let course = null;
let ride = null;
let miniCache = null;
let particles = [];
let camX = 0;
let snapCam = false; // 구간 이동 직후에는 카메라를 바로 옮깁니다
let shake = 0;
let night = 0;
const weather = { storm: 0, sun: 0, time: 0 };
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let view = { w: 0, h: 0, dpr: 1 };

// ---------------------------------------------------------------- 데이터

async function loadData() {
  let lastError;
  for (const url of LIVE_DATA_URLS) {
    try {
      const res = await fetch(`${url}?v=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      const json = await res.json();
      if (!Array.isArray(json.points) || json.points.length < 2) throw new Error('empty');
      return json;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function applyData(json) {
  data = json;
  points = toPoints(json.points);
  pending = null;
  if (!selectedHistory) rebuildCourse();
  renderDataInfo();
}

async function checkUpdate() {
  try {
    const json = await loadData();
    if (data && json.updatedAt === data.updatedAt) return;
    if (selectedHistory) {
      data = json;
      points = toPoints(json.points);
      pending = null;
      return;
    }
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
  if (selectedHistory) {
    $('data-info').textContent = `${historyData?.source ?? ''} · 일봉 · 일반 눈금 · 등락에 따른 날씨`;
    return;
  }
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
  const range = selectedHistory ?? RANGES.find((r) => r.id === rangeId) ?? RANGES[0];
  // 1일·1주는 1분봉, 3달은 시간봉, 1년·5년은 일봉, 전체는 주봉. 끝은 모두 1분봉의 최신 값(=지금)에 맞춥니다.
  const series = range.series === 'minute' ? points : withLatest(toPoints(data?.[SERIES_KEY[range.series]]), points.at(-1));
  const win = selectedHistory ? historicalWindow(historyData, range) : selectWindow(series, range);
  const stats = selectedHistory ? historicalStats(win, range) : summarize(win, range);
  if (!stats) {
    course = null;
    renderMenu();
    return;
  }
  const track = buildTrack(win.points, stats, { series: range.series, length: range.length, log: !!range.log, duration: range.duration });
  // 최고 기록은 실시간 코스는 날짜별, 역사 코스는 코스별로 남깁니다.
  const key = bestKey({ historical: !!selectedHistory, id: range.id, endDate: win.points.at(-1).date });
  course = { range, win, stats, track, key };
  miniCache = null;
  if (mode !== 'ride') newRide(true);
  renderMenu();
}

function newRide(demo) {
  weather.storm = 0; weather.sun = 0; weather.time = 0;
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
    seeked: false,
  };
  particles = [];
  camX = course ? ride.here.x - viewWorldW() * 0.3 : 0;
}

// ---------------------------------------------------------------- 화면 상태

let awake = false;
function setMode(next) {
  mode = next;
  $('menu').hidden = next !== 'menu';
  $('history-menu').hidden = next !== 'history';
  $('result').hidden = next !== 'result';
  $('hud').hidden = next !== 'ride';
  $('guide').hidden = next !== 'guide';
  setHands(false);
  // 타는 동안에는 화면이 꺼지지 않게 합니다 (앱 안에서만 동작).
  if ((next === 'ride') !== awake) {
    awake = next === 'ride';
    platform.keepAwake(awake);
  }
  // 숨겨져 있던 캔버스는 크기가 0이라, 보일 때 다시 잽니다.
  if (next === 'ride') sizeCanvas(mini);
  if (next === 'menu') sizeCanvas(preview);
  miniCache = null;
}

/** 버튼 묶음(기간·배속)을 한 번 만들고, 고른 값을 표시합니다. */
function renderChoices(box, items, current, onPick) {
  const signature = items.map(i => i.id).join(',');
  if (box.dataset.choices !== signature) { box.replaceChildren(); box.dataset.choices = signature; }
  if (!box.childElementCount) {
    for (const item of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = item.label;
      b.dataset.id = item.id;
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => onPick(item.id));
      box.append(b);
    }
  }
  for (const b of box.children) b.setAttribute('aria-checked', String(b.dataset.id === String(current)));
}

/** 기간 바꾸기 — 메뉴에서는 미리보기만, 탑승 중이면 새 기간으로 바로 다시 출발 */
function pickRange(id) {
  rangeId = id;
  store.set('kc.range', id);
  if (pending) applyData(pending);
  else rebuildCourse();
  if (mode === 'ride') startRide();
}

function renderCharacters() {
  const box = $('characters');
  if (!box.childElementCount) {
    for (const c of CHARACTERS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.id = c.id;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', c.label);
      const img = document.createElement('img');
      img.src = characterSrc(c.id);
      img.alt = '';
      img.draggable = false;
      b.append(img);
      b.addEventListener('click', () => {
        characterId = c.id;
        store.set('kc.character', c.id);
        renderCharacters();
      });
      box.append(b);
    }
  }
  for (const b of box.children) {
    const picked = b.dataset.id === characterId;
    b.setAttribute('aria-checked', String(picked));
    // 첫 화면에서는 9명 모두 손을 든 모습으로 보여 줍니다.
    b.firstChild.src = cheerSrc(b.dataset.id);
  }
}

/** 메뉴의 누적 점수 표시 */
function renderTotal() {
  const total = store.get(TOTAL_KEY, 0);
  $('menu-total-value').textContent = fmtNum(total);
}

function renderMenu() {
  const historical = !!selectedHistory;
  $('open-history').hidden = historical;
  $('back-history').hidden = !historical;
  $('ranges').hidden = historical;
  $('course-title').hidden = !historical;
  $('course-description').hidden = !historical;
  $('history-stats').hidden = !historical;
  $('course-title').textContent = selectedHistory?.label ?? '';
  $('course-description').textContent = selectedHistory?.description ?? '';
  $('to-menu').textContent = historical ? '다른 역사 코스 타기' : '기간 바꾸기';
  renderDataInfo();
  renderChoices($('ranges'), RANGES, rangeId, pickRange);
  const choices = historical ? HISTORY.map((r, i) => ({ ...r, label: ['IMF', '반등', '닷컴', '금융', '코로나', '회복', '2025'][i] })) : RANGES;
  renderChoices($('hud-ranges'), choices, selectedHistory?.id ?? rangeId, historical ? pickHistory : pickRange);
  $('hud-ranges').setAttribute('aria-label', historical ? '역사 코스' : '탑승 기간');

  $('start').disabled = !course;
  if (!course) {
    $('win-span').textContent = data ? '탈 수 있는 데이터가 없어요' : '--';
    return;
  }
  const { win, stats } = course;
  if (historical) $('history-stats').textContent = `최대 낙폭 ${stats.drawdown.toFixed(2)}% · ${selectedHistory.duration}초 이내 탑승`;
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
  feedback.unlock(); // 버튼을 누른 순간에만 소리를 켤 수 있습니다
  if (!store.get('kc.guide', false)) return openGuide(true); // 첫 탑승 전에 한 번 안내
  newRide(false);
  setMode('ride');
  renderChoices($('speeds'), SPEEDS, speed, pickSpeed);
  feedback.event('start');
  toast('출발! 🎢 누르고 있으면 만세');
}

// ---------------------------------------------------------------- 타는 법 안내

let guideStartsRide = false;

/** @param thenRide true면 확인을 누를 때 바로 출발, false면 메뉴로 돌아갑니다 */
function openGuide(thenRide) {
  guideStartsRide = thenRide;
  $('guide-ok').textContent = thenRide ? '출발! 🎢' : '확인';
  setMode('guide');
  $('guide').scrollTop = 0;
}

function closeGuide() {
  store.set('kc.guide', true);
  if (guideStartsRide) startRide();
  else setMode('menu');
}

// ---------------------------------------------------------------- 소리·진동 켜기/끄기

function renderSound() {
  const on = feedback.enabled;
  $('menu-sound').textContent = on ? '🔊 소리 켬' : '🔇 소리 끔';
  $('hud-sound').textContent = on ? '🔊' : '🔇';
  for (const id of ['menu-sound', 'hud-sound']) {
    $(id).setAttribute('aria-pressed', String(on));
    $(id).setAttribute('aria-label', on ? '소리·진동 끄기' : '소리·진동 켜기');
  }
}

function toggleSound() {
  feedback.setEnabled(!feedback.enabled);
  store.set('kc.sound', feedback.enabled);
  renderSound();
  toast(feedback.enabled ? '🔊 소리·진동을 켰어요' : '🔇 소리·진동을 껐어요');
}

function exitRide() {
  dragging = false;
  if (selectedHistory) { newRide(true); setMode('history'); return; }
  if (pending) applyData(pending);
  else newRide(true);
  setMode('menu');
}

// ---------------------------------------------------------------- 배속

const SPEEDS = [1, 1.5, 2, 4].map((v) => ({ id: String(v), label: `×${v}` }));
let speed = SPEEDS.some((s) => s.id === String(store.get('kc.speed'))) ? Number(store.get('kc.speed')) : 1;

function pickSpeed(id) {
  speed = Number(id);
  store.set('kc.speed', speed);
  renderChoices($('speeds'), SPEEDS, speed, pickSpeed);
}

// ---------------------------------------------------------------- 위 그래프로 이동

let dragging = false;

/** 미니맵의 화면 x 위치로 기차를 옮깁니다. */
function seekTo(clientX) {
  if (!course || !ride || mode !== 'ride') return;
  const { track } = course;
  const rect = mini.getBoundingClientRect();
  const f = Math.max(0, Math.min(1, (clientX - rect.left - 6) / Math.max(1, rect.width - 12)));
  const x = Math.min(track.xEnd - 1, f * track.xEnd);
  const node = track.nodes[Math.min(track.nodes.length - 1, lowerBound(track.nodes, x))];
  ride.s = node.s;
  ride.v = track.vLift;
  ride.here = sampleAt(track, ride.s);
  ride.seeked = true;
  particles = [];
  snapCam = true;
}

mini.addEventListener('pointerdown', (e) => {
  if (mode !== 'ride') return;
  e.preventDefault();
  e.stopPropagation();
  dragging = true;
  mini.setPointerCapture(e.pointerId);
  setHands(false);
  seekTo(e.clientX);
});
mini.addEventListener('pointermove', (e) => dragging && seekTo(e.clientX));
for (const ev of ['pointerup', 'pointercancel']) mini.addEventListener(ev, () => (dragging = false));

function finishRide() {
  ride.done = true;
  const { stats, range, win } = course;
  const prevBest = store.get(course.key, 0);
  const score = Math.floor(ride.score);
  // 위 그래프로 구간을 건너뛴 탑승은 최고 기록에 넣지 않습니다.
  if (score > prevBest && !ride.seeked) store.set(course.key, score);
  if (!ride.fainted) feedback.event('finish');
  // 누적 점수: 매 탑승 점수를 더해 계속 쌓고, 앱 안에서는 토스 순위표에 누적 점수를 올립니다.
  const prevTotal = store.get(TOTAL_KEY, 0);
  const total = addToTotal(prevTotal, score, { seeked: ride.seeked });
  if (total !== prevTotal) {
    store.set(TOTAL_KEY, total);
    platform.submitScore(total);
  }
  renderTotal();
  $('res-total').textContent = ride.seeked
    ? `누적 ${fmtNum(total)}점 · 구간을 건너뛴 판은 더하지 않아요`
    : score > 0
      ? `누적 ${fmtNum(total)}점 (+${fmtNum(score)})`
      : `누적 ${fmtNum(total)}점`;
  const mine = selectedHistory ? '이 코스 최고 기록' : '오늘 최고 기록';

  $('res-course').textContent = range.label;
  $('res-title').textContent = resultTitle({ fainted: ride.fainted, score });
  $('res-score').textContent = fmtNum(score);
  $('res-best').textContent = ride.seeked
    ? '구간을 건너뛰어서 최고 기록에는 넣지 않았어요'
    : score > prevBest && prevBest > 0
      ? `${mine} 경신! (이전 ${fmtNum(prevBest)}점)`
      : prevBest > 0
        ? `${mine} ${fmtNum(prevBest)}점`
        : score > 0
          ? `첫 기록! ${mine}으로 저장했어요`
          : `${range.label} 레일 · ${formatFor(win.endT, range.series)}까지`;
  setChange($('res-change'), stats.changePct);
  $('res-stars').textContent = starText(stats.stars);
  $('res-speed').textContent = `${toKmh(ride.maxV)} km/h`;
  $('res-g').textContent = `${ride.maxG.toFixed(1)} G`;
  setMode('result');
}

let sharing = false;
async function share() {
  if (sharing || !course || !ride) return;
  sharing = true;
  const { stats, range, win, track } = course;
  const span = `${formatFor(win.points[0].t, range.series)} → ${formatFor(win.endT, range.series)}`;
  const change = `${stats.changePct >= 0 ? '▲' : '▼'}${Math.abs(stats.changePct).toFixed(2)}%`;
  const score = Math.floor(ride.score);
  const text = [
    `🎢 KOSPI 코스터 [${range.label}] ${span}`,
    `구간 ${change} · 스릴 ${starText(stats.stars)}`,
    `만세 점수 ${fmtNum(score)}점 · 최고 ${toKmh(ride.maxV)}km/h · 최대 ${ride.maxG.toFixed(1)}G${ride.fainted ? ' · 기절 😵' : ''}`,
  ].join('\n');
  // 카드에 그릴 레일 모양 (240점 안팎으로 간추림)
  const main = track.nodes.filter((n) => n.zone === 'main' || n.zone === 'tunnel');
  const every = Math.max(1, Math.floor(main.length / 240));
  const chart = main.filter((_, i) => i % every === 0 || i === main.length - 1).map((n) => ({ x: n.x / track.xEnd, y: n.y / H }));
  const card = {
    label: selectedHistory ? range.label : `${range.label} 코스`,
    span,
    title: resultTitle({ fainted: ride.fainted, score }),
    score: fmtNum(score),
    change,
    changeUp: stats.changePct >= 0,
    stars: starText(stats.stars),
    speed: `${toKmh(ride.maxV)} km/h`,
    g: `${ride.maxG.toFixed(1)} G`,
    note: '실제 코스피 지수로 만든 오락용 게임 · 투자 조언이 아니에요',
    chart,
    base: main[0].y / H,
  };
  if (platform.inApp && (await platform.share(text))) {
    sharing = false;
    return;
  }
  const outcome = await shareResult({ card, text, url: SHARE_URL, allowSave: ON_SITE });
  sharing = false;
  if (outcome === 'copied') toast(ON_SITE ? '결과 글을 복사하고 이미지를 저장했어요' : '결과를 복사했어요');
  else if (outcome === 'saved') toast('결과 이미지를 저장했어요');
  else if (outcome === 'failed') toast('여기서는 공유할 수 없어요');
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
  const was = !!ride?.hands;
  if (ride) ride.hands = on && mode === 'ride' && !ride.fainted;
  if (ride?.hands && !was) feedback.event('hands');
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
  else if (e.code === 'Enter' && mode === 'guide') closeGuide();
});
window.addEventListener('keyup', (e) => e.code === 'Space' && setHands(false));
window.addEventListener('contextmenu', (e) => e.preventDefault());

$('start').addEventListener('click', startRide);
$('again').addEventListener('click', startRide);
$('share').addEventListener('click', share);
$('to-menu').addEventListener('click', exitRide);
$('hud-exit').addEventListener('click', exitRide);
$('open-guide').addEventListener('click', () => openGuide(false));
for (const id of ['menu-rank', 'res-rank']) $(id).addEventListener('click', () => platform.openRanking());

// ---------------------------------------------------------------- 뒤로가기 · 종료 확인 (앱 안에서)

function backToLive() {
  selectedHistory = null;
  setMode('menu');
  if (pending) applyData(pending);
  else rebuildCourse();
  resize();
}

/** 기기의 뒤로가기: 한 단계씩 앞 화면으로 돌아가고, 첫 화면에서는 종료할지 묻습니다. */
function handleBack() {
  if (!$('exit-confirm').hidden) $('exit-confirm').hidden = true;
  else if (mode === 'ride' || mode === 'result') exitRide();
  else if (mode === 'guide') setMode('menu');
  else if (mode === 'history') backToLive();
  else if (mode === 'menu' && selectedHistory) setMode('history');
  else $('exit-confirm').hidden = false;
}
platform.onBack(handleBack);
$('exit-stay').addEventListener('click', () => ($('exit-confirm').hidden = true));
$('exit-leave').addEventListener('click', () => platform.close());
$('guide-ok').addEventListener('click', closeGuide);
$('menu-sound').addEventListener('click', toggleSound);
$('hud-sound').addEventListener('click', toggleSound);
window.addEventListener('keydown', (e) => e.code === 'Escape' && mode === 'ride' && exitRide());

function pickHistory(id) {
  const wasRiding = mode === 'ride';
  selectedHistory = HISTORY.find(r => r.id === id);
  if (!wasRiding) setMode('menu');
  rebuildCourse();
  if (wasRiding) startRide();
  resize();
  $('menu').scrollTop = 0;
}

async function loadHistory() {
  $('history-status').hidden = false;
  $('history-status').textContent = '역사 코스 불러오는 중…';
  $('retry-history').hidden = true;
  try {
    const res = await fetch('data/history.json');
    if (!res.ok) throw new Error('history');
    const json = await res.json();
    const cards = HISTORY.map(range => {
      const win = historicalWindow(json, range);
      const stats = historicalStats(win, range);
      const button = document.createElement('button');
      button.className = 'history-card';
      button.type = 'button';
      const title = document.createElement('strong'); title.textContent = range.label;
      const desc = document.createElement('small'); desc.textContent = range.description;
      const dates = document.createElement('small'); dates.textContent = `${formatFor(win.startT, 'daily')} → ${formatFor(win.endT, 'daily')}`;
      const meta = document.createElement('span'); meta.className = 'history-meta';
      const change = document.createElement('span'); setChange(change, stats.changePct);
      const duration = document.createElement('span'); duration.textContent = `${range.duration}초 이내 · 선택하기 →`;
      meta.append(change, duration); button.append(title, desc, dates, meta);
      button.addEventListener('click', () => {
        pickHistory(range.id);
      });
      return button;
    });
    historyData = json;
    $('history-list').replaceChildren(...cards);
    $('history-status').hidden = true;
  } catch {
    $('history-status').textContent = '역사 데이터를 불러오지 못했어요. 다시 시도해 주세요.';
    $('retry-history').hidden = false;
  }
}
$('open-history').addEventListener('click', () => { setMode('history'); $('history-menu').scrollTop = 0; });
$('back-history').addEventListener('click', () => setMode('history'));
$('retry-history').addEventListener('click', loadHistory);
$('back-live').addEventListener('click', backToLive);

// ---------------------------------------------------------------- 시뮬레이션

function update(dt) {
  if (!course || !ride) return;
  if (ride.done || dragging) return; // 위 그래프를 끄는 동안은 멈춤
  ride.acc += Math.min(dt, 0.1) * (ride.demo ? 1 : speed);
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

  if (!ride.demo) {
    const info = { ang: here.ang, zone: here.zone, v: ride.v, g: ride.g, vLift: track.vLift, vMax: PHYS.vMax };
    if (applyRules(ride, info, dt)) {
      setHands(false);
      feedback.event('faint');
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
  // 노치·앱 상단 버튼 등으로 가려지는 높이 (CSS의 --safe-top 등과 같은 값)
  inset = { top: $('safe-probe-top').offsetHeight, bottom: $('safe-probe-bottom').offsetHeight };
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
let inset = { top: 0, bottom: 0 };
function scale() {
  return Math.max(0.06, Math.min((view.h - TOP_PAD - BOTTOM_PAD - inset.top - inset.bottom) / H, view.w / 900));
}
const baseY = () => view.h - BOTTOM_PAD - inset.bottom;
const viewWorldW = () => view.w / scale();

function render(dt) {
  const { w, h, dpr } = view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!course || !ride) {
    ctx.fillStyle = '#0f1729';
    ctx.fillRect(0, 0, w, h);
    return;
  }
  const behind = sampleAt(course.track, Math.max(0, ride.s - Math.max(250, course.track.xEnd * 0.015)));
  const targetWeather = weatherTarget({
    ang: ride.here.ang,
    zone: ride.here.zone,
    changePct: (ride.here.p / behind.p - 1) * 100,
    rangePct: (course.stats.max - course.stats.min) / course.stats.first * 100,
  });
  easeWeather(weather, targetWeather, dt);
  weather.time += dt;
  const sc = scale();
  const target = ride.here.x - viewWorldW() * 0.3;
  camX = snapCam ? target : camX + (target - camX) * Math.min(1, dt * 5 * (mode === 'ride' ? Math.sqrt(speed) : 1));
  snapCam = false;
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
  drawWeatherSky(ctx, w, h, weather, night, reducedMotion.matches);
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

  drawWeatherFront(ctx, w, h, weather, reducedMotion.matches);
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
  top = mix(top, [32, 158, 244], weather.sun);
  bot = mix(bot, [255, 235, 170], weather.sun);
  top = mix(top, [39, 53, 74], weather.storm);
  bot = mix(bot, [117, 135, 151], weather.storm);
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
  g.addColorStop(0, rgb(mix(mix([58, 120, 70], [65, 155, 83], weather.sun), [36, 53, 58], Math.max(night, weather.storm))));
  g.addColorStop(1, rgb(mix([30, 70, 45], [10, 15, 25], Math.max(night, weather.storm))));
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
  ctx.save();
  ctx.shadowColor = weather.sun > weather.storm ? '#ffd45f' : '#76a8d9';
  ctx.shadowBlur = reducedMotion.matches ? 0 : weather.sun * 10 + weather.storm * 3;
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
  ctx.restore();
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
  const riders = crew(characterId); // 세 칸 모두 고른 캐릭터
  const now = performance.now() / 1000;
  for (let k = 2; k >= 0; k--) {
    const at = sampleAt(course.track, ride.s - (k * (carLen + 4)) / sc);
    ctx.save();
    ctx.translate(X(at.x), Y(at.y));
    ctx.rotate(-at.ang);
    ctx.scale(u, u);
    // 승객: 고른 캐릭터가 칸마다 한 명씩. 만세를 하면 세 명 모두 손을 번쩍 든 그림으로 바뀝니다.
    // (차체가 아래쪽을 가려서 자리에 앉은 것처럼 보입니다)
    const id = riders[k];
    const base = sprites[id];
    const cheer = cheers[id];
    const SIZE = 38; // 원래 그림이 그려지는 크기
    const cheering = ride.hands && !ride.fainted && cheer?.complete && cheer.naturalWidth;
    if (cheering) {
      ctx.save();
      // 자리에 앉은 채로 좌우로 살짝 흔들 (엉덩이를 축으로, 칸마다 박자를 조금씩 다르게).
      // 위로 들어 올리면 그림 아래 잘린 부분이 칸 위로 드러나므로 들어 올리지 않습니다.
      ctx.translate(0, -12);
      ctx.rotate(0.06 * Math.sin(now * 10 + k * 1.7));
      ctx.translate(0, 12);
      const f = SIZE / CHEER_PAD.size;
      ctx.drawImage(cheer, -SIZE / 2 - CHEER_PAD.x * f, -47 - CHEER_PAD.top * f, cheer.naturalWidth * f, cheer.naturalHeight * f);
      ctx.restore();
    } else if (base?.complete && base.naturalWidth) {
      ctx.save();
      if (ride.fainted) {
        ctx.translate(0, -14);
        ctx.rotate(-0.38);
        ctx.translate(0, 14);
        ctx.globalAlpha = 0.8;
      }
      ctx.drawImage(base, -SIZE / 2, -47, SIZE, SIZE);
      ctx.restore();
      if (ride.fainted) {
        ctx.font = '12px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('💫', -8, -50);
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
    // 손가락으로 잡기 쉽게 세로 줄 + 큰 점
    cx.strokeStyle = 'rgba(255,210,63,0.6)';
    cx.lineWidth = 2;
    cx.beginPath();
    cx.moveTo(x, 0);
    cx.lineTo(x, h);
    cx.stroke();
    cx.fillStyle = '#ffd23f';
    cx.beginPath();
    cx.arc(x, y, dragging ? 8 : 6.5, 0, Math.PI * 2);
    cx.fill();
    cx.strokeStyle = '#1b2440';
    cx.lineWidth = 2;
    cx.stroke();
  }
}

let hudFrame = 0;
function updateHud() {
  const stormy = weather.storm > 0.18 && weather.storm > weather.sun;
  const sunny = weather.sun > 0.18 && weather.sun > weather.storm;
  $('weather-mood').textContent = stormy ? '🌧 하락 구간' : sunny ? '☀ 상승 구간' : '☁ 잠시 숨 고르기';
  $('weather-mood').dataset.mood = stormy ? 'down' : sunny ? 'up' : 'calm';
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
  const riding = mode === 'ride' && ride && !ride.demo && !ride.done && !dragging;
  feedback.frame(riding ? { s: ride.s, v: ride.v, vMax: PHYS.vMax, g: ride.g, zone: ride.here.zone } : null);
  requestAnimationFrame(frame);
}

async function boot() {
  for (const key of staleBestKeys(store.keys())) store.remove(key); // 오래된 기록 정리
  renderSound();
  renderTotal();
  renderCharacters();
  document.documentElement.classList.toggle('can-rank', platform.canRank);
  platform.identify(); // 앱 안에서 사용자 식별값 확인 (게임 로그인)
  new ResizeObserver(resize).observe($('safe-probe-top')); // 가려지는 높이가 바뀌면 다시 맞춤
  resize();
  window.addEventListener('resize', resize);
  setMode('menu');
  renderMenu();
  requestAnimationFrame(frame);
  loadHistory();
  try {
    applyData(await loadData());
    resize();
    renderMenu();
  } catch {
    $('data-info').textContent = '데이터를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.';
  }
  setInterval(checkUpdate, REFRESH_MS);
  // 화면을 벗어나면 소리를 바로 멈추고, 돌아오면 다시 켭니다.
  document.addEventListener('visibilitychange', () => {
    feedback.setBackground(document.hidden);
    if (!document.hidden) checkUpdate();
  });
  window.addEventListener('pagehide', () => feedback.setBackground(true));
  window.addEventListener('pageshow', () => feedback.setBackground(document.hidden));
}

boot();
