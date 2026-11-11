// 토스 인앱에서만 실리는 파일입니다. 게임(site/src/main.js)보다 먼저 실행되어
// 토스 SDK 기능을 globalThis.__kcPlatform에 채워 둡니다. 게임은 site/src/platform.js를 통해 이것을 씁니다.
import { SafeArea, Storage, Device, Screen, Game, Share, graniteEvent, getUserKeyForGame } from '@apps-in-toss/web-framework';
import { APP_NAME } from './app.mjs';

const STATE_KEY = 'kc.state';
const TOP_BUTTONS = 44; // 토스가 화면 오른쪽 위에 띄우는 더보기·닫기 버튼 높이만큼 더 비웁니다

// 진동 종류 → 토스 햅틱 이름
const HAPTIC = { start: 'tap', hands: 'tickWeak', bump: 'tickMedium', faint: 'error', finish: 'success' };

// ---- 화면 가장자리 여백: 토스가 알려 주는 값(px)으로 CSS 변수를 바꿉니다.
function applyInsets(insets) {
  if (!insets) return;
  const root = document.documentElement.style;
  root.setProperty('--safe-top', `${Math.max(0, insets.top ?? 0)}px`);
  root.setProperty('--safe-bottom', `${Math.max(0, insets.bottom ?? 0)}px`);
  root.setProperty('--top-extra', `${TOP_BUTTONS}px`);
}
try {
  applyInsets(SafeArea.get());
  SafeArea.subscribe({ onEvent: applyInsets });
} catch {
  document.documentElement.style.setProperty('--top-extra', `${TOP_BUTTONS}px`);
}
document.documentElement.classList.add('in-app');

globalThis.__kcPlatform = {
  // 설정·기록: 토스 저장소에 한 덩어리로 보관합니다.
  loadState: () => Storage.getItem(STATE_KEY),
  saveState: (json) => Storage.setItem(STATE_KEY, json),

  // 게임 로그인: 사용자마다 고유한 값
  async identify() {
    if (!getUserKeyForGame.isSupported()) return null;
    const result = await getUserKeyForGame();
    return result && result !== 'ERROR' && result.type === 'HASH' ? result.hash : null;
  },

  haptic: (kind) => Device.triggerHaptic({ type: HAPTIC[kind] ?? 'tap' }),

  // 기기의 뒤로가기를 게임이 처리합니다 (등록하면 토스의 기본 뒤로가기는 막힙니다).
  onBack: (handler) => graniteEvent.addEventListener('backEvent', { onEvent: handler }),
  close: () => Screen.close(),

  keepAwake: (enabled) => Screen.setAwakeMode({ enabled }),

  // 순위표 (토스 게임센터)
  canRank: () => Game.setLeaderboardScore.isSupported() && Game.openLeaderboard.isSupported(),
  submitScore: (score) => Game.setLeaderboardScore({ score: String(Math.floor(score)) }),
  openRanking: () => Game.openLeaderboard(),

  // 공유: 토스에서 바로 열리는 링크를 붙입니다.
  async share(text) {
    let link = '';
    try {
      link = await Share.createLink({ path: `intoss://${APP_NAME}` });
    } catch {
      /* 링크를 못 만들면 글만 공유 */
    }
    await Share.sendMessage({ message: link ? `${text}\n${link}` : text });
  },
};
