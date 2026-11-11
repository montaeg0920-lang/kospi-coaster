// 최고 기록 저장 규칙 (순수 함수 — 테스트: test/records.test.mjs)
//
//  - 실시간 코스(1일~전체): 기간 + 레일이 끝나는 날짜별로 저장합니다. 레일이 매시간 조금씩 길어져도
//    같은 날의 기록은 이어지고, 날이 바뀌면 새 기록으로 시작합니다 ("오늘 최고 기록").
//  - 역사 코스: 레일이 변하지 않으므로 코스별로 계속 남깁니다.

const LIVE_KEY = /^kc\.best\.[a-z0-9]+:((?:19|20)\d{6})$/;
const HISTORY_KEY = /^kc\.best\.history:[a-z0-9-]+$/;
const KST_MS = 9 * 60 * 60 * 1000;

/** @param {{historical: boolean, id: string, endDate?: string}} course endDate는 'YYYYMMDD' */
export function bestKey({ historical, id, endDate }) {
  return historical ? `kc.best.history:${id}` : `kc.best.${id}:${endDate}`;
}

/** 한국 시간 기준 오늘 'YYYYMMDD' */
export function kstToday(now = Date.now()) {
  return new Date(now + KST_MS).toISOString().slice(0, 10).replace(/-/g, '');
}

function daysBefore(stamp, days) {
  const t = Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8)) - days * 86400000;
  return new Date(t).toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * 지워도 되는 기록 키: 오래된 날짜의 실시간 기록과, 예전 방식(레일 끝 시각별)으로 저장된 기록.
 * @param {string[]} keys 저장소의 모든 키
 */
export function staleBestKeys(keys, today = kstToday(), keepDays = 14) {
  const cutoff = daysBefore(today, keepDays);
  return keys.filter((key) => {
    if (!key.startsWith('kc.best.')) return false;
    if (HISTORY_KEY.test(key)) return false;
    const m = LIVE_KEY.exec(key);
    return !m || m[1] < cutoff;
  });
}

// ---------------------------------------------------------------- 누적 점수
//  - 매 탑승 점수를 모두 더해 계속 쌓습니다 (기절한 판은 기절할 때까지의 점수).
//  - 위 그래프로 구간을 건너뛴 판은 더하지 않습니다.
//  - 기기 안에만 저장하므로 휴대폰을 바꾸면 0부터 다시 시작합니다.
//  - 앱 안에서는 이 누적 점수를 토스 순위표에 올립니다.

export const TOTAL_KEY = 'kc.total';

/** 이번 탑승을 더한 누적 점수. 잘못된 값은 0으로 봅니다. */
export function addToTotal(total, score, { seeked = false } = {}) {
  const base = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  if (seeked || !Number.isFinite(score) || score <= 0) return base;
  return base + Math.floor(score);
}
