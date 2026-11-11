// 점수·멀미 규칙 (순수 함수 — 테스트: test/rules.test.mjs)
//
// 멀미
//  - 내리막을 내려가기만 해도 멀미가 쌓입니다. 가파르고 빠를수록 더 많이.
//  - 손을 들면(만세) 멀미가 더해집니다. 내리막에서 들면 더 크게.
//  - 오르막·평지에서 손을 내리고 있으면 멀미가 가라앉습니다.
//  - 100%가 되면 기절 (점수는 거기서 멈춤).
// 점수
//  - 손을 들고 있는 동안만 쌓입니다. 빠르고 아찔할수록, 오래 들고 있을수록(콤보 최대 ×3) 많이.

export const NAUSEA = {
  downhill: 42, // 내리막 자체 (가장 가파를 때, 초당)
  harsh: 10, // 큰 G (초당, 1G 넘는 만큼)
  handsBase: 3, // 손 들기 기본
  handsThrill: 34, // 손 들기 × 스릴
  handsDownhill: 22, // 내리막에서 손 들기 추가
  recover: 16, // 오르막·평지에서 손 내리면 회복 (초당)
};

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** 내리막 정도: 평지 0 ~ 약 35° 이상 내리막 1 */
export const descentOf = (ang) => clamp01(-Math.sin(ang) / 0.58);

/**
 * 한 스텝 동안의 점수·멀미 변화. ride를 직접 바꿉니다.
 * @param ride {hands, nausea, score, holdT, combo, fainted}
 * @param here {ang, zone, v, g, vLift, vMax}
 * @returns 이번 스텝에 기절했으면 true
 */
export function applyRules(ride, { ang, zone, v, g, vLift, vMax }, dt) {
  if (ride.fainted || zone === 'station') return false;
  const speed = clamp01((v - vLift) / (vMax * 0.5));
  const force = clamp01(Math.abs(g - 1) / 2.2);
  const thrill = speed * 0.7 + force * 0.3;
  const harsh = Math.max(0, Math.abs(g - 1) - 1.2);
  const descent = zone === 'main' ? descentOf(ang) : 0;
  const hands = ride.hands && zone === 'main';

  let rate = NAUSEA.downhill * descent * (0.6 + speed) + NAUSEA.harsh * harsh;
  if (hands) {
    ride.holdT += dt;
    ride.combo = Math.min(3, 1 + ride.holdT / 4);
    ride.score += (4 + 260 * thrill * thrill) * ride.combo * dt;
    rate += NAUSEA.handsBase + NAUSEA.handsThrill * thrill + NAUSEA.handsDownhill * descent;
  } else {
    ride.holdT = 0;
    ride.combo = 1;
    if (descent < 0.05) rate -= NAUSEA.recover;
  }

  ride.nausea = Math.max(0, Math.min(100, ride.nausea + rate * dt));
  if (ride.nausea >= 100) {
    ride.fainted = true;
    return true;
  }
  return false;
}

/** 결과 화면 제목: 기절하지 않고 끝까지 타면 완주입니다. */
export function resultTitle({ fainted, score }) {
  if (fainted) return '기절! 😵';
  return score > 0 ? '완주! 🎉' : '무사 도착!';
}
