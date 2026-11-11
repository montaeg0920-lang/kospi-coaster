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

export const isCharacter = (id) => CHARACTERS.some((c) => c.id === id);

/**
 * 열차 세 칸에 탈 캐릭터. 맨 앞 칸에 고른 캐릭터가 타고, 뒤 칸에는 목록에서 그다음 친구들이 탑니다.
 * @returns {string[]} 앞 칸부터 세 개의 id
 */
export function crew(selectedId) {
  const start = Math.max(0, CHARACTERS.findIndex((c) => c.id === selectedId));
  return [0, 1, 2].map((k) => CHARACTERS[(start + k) % CHARACTERS.length].id);
}
