import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { CHARACTERS, DEFAULT_CHARACTER, characterSrc, cheerSrc, isCharacter, crew } from '../site/src/characters.js';

test('캐릭터는 9종이고 그림 파일이 모두 있다', () => {
  assert.equal(CHARACTERS.length, 9);
  for (const c of CHARACTERS) assert.ok(existsSync(new URL(`../site/${characterSrc(c.id)}`, import.meta.url)), c.id);
  assert.ok(isCharacter(DEFAULT_CHARACTER));
  assert.equal(isCharacter('cat'), true);
});

test('고른 캐릭터 세 명이 세 칸에 모두 탄다', () => {
  for (const c of CHARACTERS) assert.deepEqual(crew(c.id), [c.id, c.id, c.id]);
  assert.deepEqual(crew('없는캐릭터'), [DEFAULT_CHARACTER, DEFAULT_CHARACTER, DEFAULT_CHARACTER]);
});

test('캐릭터마다 만세 그림이 있다', () => {
  for (const c of CHARACTERS) assert.ok(existsSync(new URL(`../site/${cheerSrc(c.id)}`, import.meta.url)), c.id);
});
