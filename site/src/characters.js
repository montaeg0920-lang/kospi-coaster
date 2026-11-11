// 탑승 캐릭터 6종 (그림: site/characters/*.png)
export const CHARACTERS = [
  { id: 'boy', label: '노란 후드' },
  { id: 'girl', label: '초록 재킷' },
  { id: 'shiba', label: '시바견' },
  { id: 'bear', label: '곰' },
  { id: 'robot', label: '로봇' },
  { id: 'astronaut', label: '우주비행사' },
];

export const DEFAULT_CHARACTER = CHARACTERS[0].id;

export const characterSrc = (id) => `characters/${id}.png`;

/** 손을 번쩍 든 만세 그림 (scripts/prepare-cheer.py가 만세 시트에서 잘라 만듭니다) */
export const cheerSrc = (id) => `characters/${id}-cheer.png`;

/** 만세 그림은 원래 그림(256×256)보다 좌우로 PAD_X, 위로 PAD_TOP만큼 넓습니다. */
export const CHEER_PAD = { x: 40, top: 64, size: 256 };

export const isCharacter = (id) => CHARACTERS.some((c) => c.id === id);

/**
 * 열차 세 칸에 탈 캐릭터: 고른 캐릭터 세 명이 한 칸씩 탑니다.
 * @returns {string[]} 앞 칸부터 세 개의 id
 */
export function crew(selectedId) {
  const id = isCharacter(selectedId) ? selectedId : DEFAULT_CHARACTER;
  return [id, id, id];
}
