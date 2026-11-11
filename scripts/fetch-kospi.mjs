// 코스피 분봉을 받아 site/data/kospi.json 으로 저장합니다. (API 키 필요 없음)
// 출처: 야후 파이낸스 ^KS11 1분봉(최근 8일, 약 15~20분 지연)
//   - 야후 분봉은 09:00~14:59까지만 있어서, 장이 끝난 날은 일봉 종가를 15:30 지점에 붙입니다.
// GitHub Actions가 장중 1시간마다 실행합니다.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../site/data/kospi.json');
const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/%5EKS11';
const KST_MS = 9 * 60 * 60 * 1000;
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
  return ts.map((t, i) => [kstStamp(new Date(t * 1000)), close[i]]).filter(([, p]) => p != null);
}

async function main() {
  const minutes = await chart('interval=1m&range=8d');
  const daily = await chart('interval=1d&range=1mo');
  const closeByDate = new Map(daily.map(([t, p]) => [t.slice(0, 8), p]));

  const map = new Map();
  for (const [t, p] of minutes) {
    if (/^\d{12}$/.test(t) && Number.isFinite(p) && p > 0) map.set(t, Math.round(p * 100) / 100);
  }

  // 장이 끝난 날(오늘이면 15:50 이후)에는 15:30 종가 지점을 붙입니다.
  const nowStamp = kstStamp(new Date());
  const dates = new Set([...map.keys()].map((t) => t.slice(0, 8)));
  for (const d of dates) {
    const close = closeByDate.get(d);
    const finished = d < nowStamp.slice(0, 8) || nowStamp.slice(8) >= '1550';
    if (finished && Number.isFinite(close)) map.set(d + CLOSE_STAMP, Math.round(close * 100) / 100);
  }

  const points = [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (points.length < 100) throw new Error(`too few points (${points.length})`);

  await mkdir(dirname(OUT), { recursive: true });
  const data = { updatedAt: new Date().toISOString(), source: 'Yahoo Finance ^KS11', points };
  await writeFile(OUT, JSON.stringify(data));
  console.log(`ok: ${points.length} points, ${dates.size} days, last ${points.at(-1)[0]}`);
}

main().catch((err) => {
  console.error(`데이터를 받지 못했습니다. 기존 배포를 유지합니다: ${err.message}`);
  process.exit(1);
});
