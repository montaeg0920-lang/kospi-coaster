// 코스피 지수를 받아 site/data/kospi.json 으로 저장합니다. (API 키 필요 없음)
// 출처: 야후 파이낸스 ^KS11 (약 15~20분 지연)
//   points  1분봉, 최근 8일   → 1일·1주
//           야후 분봉은 14:59까지만 있어서, 장이 끝난 날은 일봉 종가를 15:30 지점에 붙입니다.
//   hourly  1시간봉, 약 110일 → 3달
//   daily   일봉, 약 5년      → 1년·5년
//   weekly  주봉, 1996년~     → 전체
// GitHub Actions가 장중 1시간마다 실행합니다.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../site/data/kospi.json');
const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/%5EKS11';
const KST_MS = 9 * 60 * 60 * 1000;
const DAY_S = 86400;
const CLOSE_STAMP = '1530';

/** Date -> 'YYYYMMDDHHmm' (한국 시간) */
function kstStamp(date) {
  return new Date(date.getTime() + KST_MS).toISOString().slice(0, 16).replace(/[-T:]/g, '');
}

async function chart(query) {
  const res = await fetch(`${BASE}?${query}`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`yahoo ${res.status} ${res.statusText}`);
  const json = await res.json();
  const r = json?.chart?.result?.[0];
  if (!r) throw new Error(`yahoo: ${JSON.stringify(json?.chart?.error)}`);
  const ts = r.timestamp ?? [];
  const close = r.indicators?.quote?.[0]?.close ?? [];
  return ts.map((t, i) => [kstStamp(new Date(t * 1000)), close[i]]);
}

/** 빈 값 제거, 같은 시각 중복 제거, 시간순 정렬, 소수 둘째 자리 */
function clean(rows, sinceStamp = '') {
  const map = new Map();
  for (const [t, p] of rows) {
    if (/^\d{12}$/.test(t) && t >= sinceStamp && Number.isFinite(p) && p > 0) map.set(t, Math.round(p * 100) / 100);
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

async function main() {
  const now = Math.floor(Date.now() / 1000);
  const nowStamp = kstStamp(new Date());
  const ago = (days) => kstStamp(new Date((now - days * DAY_S) * 1000));

  const [minutes, hourly, daily, weekly] = await Promise.all([
    chart('interval=1m&range=8d'),
    chart('interval=60m&range=6mo'),
    chart(`interval=1d&period1=${now - Math.round(5.1 * 365 * DAY_S)}&period2=${now}`),
    chart(`interval=1wk&period1=0&period2=${now}`),
  ]);

  // 1분봉 + 장 마감 종가(오늘이면 15:50 이후)
  const closeByDate = new Map(clean(daily).map(([t, p]) => [t.slice(0, 8), p]));
  const points = clean(minutes);
  const dates = new Set(points.map(([t]) => t.slice(0, 8)));
  for (const d of dates) {
    const close = closeByDate.get(d);
    const finished = d < nowStamp.slice(0, 8) || nowStamp.slice(8) >= '1550';
    if (finished && close) points.push([d + CLOSE_STAMP, close]);
  }
  points.sort((a, b) => (a[0] < b[0] ? -1 : 1));

  const data = {
    updatedAt: new Date().toISOString(),
    source: 'Yahoo Finance ^KS11',
    points,
    hourly: clean(hourly, ago(110)),
    daily: clean(daily),
    weekly: clean(weekly),
  };
  for (const key of ['points', 'hourly', 'daily', 'weekly']) {
    if (data[key].length < 50) throw new Error(`${key}: too few points (${data[key].length})`);
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(data));
  const span = (k) => `${k} ${data[k].length} (${data[k][0][0].slice(0, 8)}~${data[k].at(-1)[0]})`;
  console.log(`ok: ${['points', 'hourly', 'daily', 'weekly'].map(span).join(', ')}`);
}

main().catch((err) => {
  console.error(`데이터를 받지 못했습니다. 기존 배포를 유지합니다: ${err.message}`);
  process.exit(1);
});
