// 실행 환경(웹 브라우저 / 토스 인앱)의 차이를 한곳에 모읍니다.
//
// 토스 번들에서는 toss/bridge.js가 게임보다 먼저 실행되어 globalThis.__kcPlatform에
// 토스 SDK 기능을 채워 둡니다. 웹에서는 그 값이 없어서 모두 "아무 일도 하지 않음"으로 동작합니다.

const ext = globalThis.__kcPlatform ?? null;
const STATE_PREFIX = 'kc.';
const SAVE_DELAY = 800; // 저장 요청을 모아서 보냅니다 (앱 기능을 너무 자주 부르지 않게)

let saveTimer = 0;

function snapshot() {
  const out = {};
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(STATE_PREFIX)) out[key] = localStorage.getItem(key);
    }
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
  return out;
}

async function quietly(fn, fallback) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export const platform = {
  /** 토스 인앱처럼 다른 앱 안에서 실행 중인지 */
  inApp: !!ext,

  /** 앱 저장소에 남겨 둔 설정·기록을 불러옵니다. 게임을 시작하기 전에 한 번 부릅니다. */
  async restore() {
    if (!ext?.loadState) return;
    // 앱이 대답하지 않아도 게임은 시작해야 하므로 1.5초만 기다립니다.
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 1500));
    const raw = await Promise.race([quietly(() => ext.loadState(), null), timeout]);
    if (!raw) return;
    try {
      for (const [key, value] of Object.entries(JSON.parse(raw))) {
        if (key.startsWith(STATE_PREFIX) && typeof value === 'string') localStorage.setItem(key, value);
      }
    } catch {
      /* 깨진 값은 무시 */
    }
  },

  /** 설정·기록이 바뀌었을 때 부릅니다. 잠시 뒤 한 번에 앱 저장소로 보냅니다. */
  persist() {
    if (!ext?.saveState) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => quietly(() => ext.saveState(JSON.stringify(snapshot()))), SAVE_DELAY);
  },

  /** 사용자 식별값을 확인합니다 (게임 로그인). */
  identify: () => (ext?.identify ? quietly(() => ext.identify(), null) : Promise.resolve(null)),

  /** @returns 앱의 진동 기능으로 처리했으면 true (false면 웹 진동을 씁니다) */
  haptic(kind) {
    if (!ext?.haptic) return false;
    quietly(() => ext.haptic(kind));
    return true;
  },

  /** 기기의 뒤로가기를 눌렀을 때 부를 함수를 등록합니다. */
  onBack(handler) {
    quietly(() => ext?.onBack?.(handler));
  },

  /** 미니앱을 닫습니다. */
  close: () => quietly(() => ext?.close?.()),

  /** 타는 동안 화면이 꺼지지 않게 합니다. */
  keepAwake(enabled) {
    quietly(() => ext?.keepAwake?.(enabled));
  },

  /** 순위표를 쓸 수 있는지 */
  get canRank() {
    try {
      return !!ext?.canRank?.();
    } catch {
      return false;
    }
  },
  submitScore: (score) => (ext?.submitScore ? quietly(() => ext.submitScore(score), null) : Promise.resolve(null)),
  openRanking: () => quietly(() => ext?.openRanking?.()),

  /** 앱의 공유 기능으로 글을 공유합니다. @returns 공유 창을 열었으면 true */
  share: (text) => (ext?.share ? quietly(async () => (await ext.share(text), true), false) : Promise.resolve(false)),
};
