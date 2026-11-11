import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestKey, staleBestKeys, kstToday } from '../site/src/records.js';
import { resultTitle } from '../site/src/rules.js';

test('실시간 코스 기록은 기간 + 레일 끝 날짜별로 저장한다', () => {
  const morning = bestKey({ historical: false, id: '1d', endDate: '20261111' });
  const afternoon = bestKey({ historical: false, id: '1d', endDate: '20261111' });
  assert.equal(morning, 'kc.best.1d:20261111');
  assert.equal(morning, afternoon); // 같은 날 레일이 갱신돼도 기록이 이어짐
  assert.notEqual(morning, bestKey({ historical: false, id: '1d', endDate: '20261112' }));
  assert.notEqual(morning, bestKey({ historical: false, id: '1w', endDate: '20261111' }));
});

test('역사 코스 기록은 코스별로 계속 남는다', () => {
  assert.equal(bestKey({ historical: true, id: 'imf', endDate: '19980616' }), 'kc.best.history:imf');
});

test('오래된 기록과 예전 방식 기록만 정리한다', () => {
  const keys = [
    'kc.best.1d:20261111', // 오늘
    'kc.best.1w:20261030', // 12일 전 → 유지
    'kc.best.1d:20261020', // 22일 전 → 정리
    'kc.best.1d:29906820', // 예전 방식(레일 끝 시각) → 정리
    'kc.best.history:imf', // 유지
    'kc.best.history:imf:14937480', // 예전 방식 → 정리
    'kc.range', // 다른 설정은 건드리지 않음
    'kc.sound',
  ];
  assert.deepEqual(staleBestKeys(keys, '20261111'), ['kc.best.1d:20261020', 'kc.best.1d:29906820', 'kc.best.history:imf:14937480']);
});

test('오늘 날짜는 한국 시간 기준', () => {
  assert.equal(kstToday(Date.UTC(2026, 10, 10, 15, 30)), '20261111'); // UTC 15:30 = KST 다음 날 00:30
});

test('결과 제목: 기절하지 않고 끝까지 타면 완주', () => {
  assert.equal(resultTitle({ fainted: true, score: 500 }), '기절! 😵');
  assert.equal(resultTitle({ fainted: false, score: 120 }), '완주! 🎉');
  assert.equal(resultTitle({ fainted: false, score: 0 }), '무사 도착!');
});
