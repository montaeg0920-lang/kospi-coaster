import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { CHARACTERS, DEFAULT_CHARACTER, characterSrc, isCharacter, crew } from '../site/src/characters.js';

test('캐릭터는 6종이고 그림 파일이 모두 있다', () => {
  assert.equal(CHARACTERS.length, 6);
  for (const c of CHARACTERS) assert.ok(existsSync(new URL(`../site/${characterSrc(c.id)}`, import.meta.url)), c.id);
  assert.ok(isCharacter(DEFAULT_CHARACTER));
  assert.equal(isCharacter('cat'), false);
});

test('맨 앞 칸에 고른 캐릭터가 타고, 뒤 칸에는 서로 다른 친구들이 탄다', () => {
  for (const c of CHARACTERS) {
    const riders = crew(c.id);
    assert.equal(riders[0], c.id);
    assert.equal(new Set(riders).size, 3);
  }
  assert.equal(crew('없는캐릭터')[0], DEFAULT_CHARACTER);
});
