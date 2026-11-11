import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weatherTarget, easeWeather } from '../site/src/atmosphere.js';
test('날씨는 누적 수익이 아닌 현재 진행 방향을 따른다', () => {
  assert.ok(weatherTarget({ang:-0.3,changePct:2,rangePct:50,zone:'main'}).storm>0);
  assert.equal(weatherTarget({ang:-0.3,changePct:2,rangePct:50,zone:'main'}).sun,0);
  assert.ok(weatherTarget({ang:0.3,changePct:-2,rangePct:50,zone:'main'}).sun>0);
});
test('같은 화면 기울기라도 실제 큰 변동에서 연출이 강해진다', () => {
  const mild=weatherTarget({ang:-0.3,changePct:-0.1,rangePct:1,zone:'main'});
  const crash=weatherTarget({ang:-0.3,changePct:-5,rangePct:50,zone:'main'});
  assert.ok(crash.storm>mild.storm);
  assert.ok(crash.storm<=1);
});
test('승강장·터널·도착·평지는 날씨가 중립으로 전환된다', () => {
  for(const zone of ['station','tunnel','brake']) assert.deepEqual(weatherTarget({ang:-0.5,changePct:-5,rangePct:80,zone}),{storm:0,sun:0});
  assert.deepEqual(weatherTarget({ang:0,changePct:0,rangePct:80,zone:'main'}),{storm:0,sun:0});
});
test('급격한 방향 전환도 점멸 없이 부드럽게 적용된다', () => {
  const state={storm:1,sun:0};easeWeather(state,{storm:0,sun:1},1/60);
  assert.ok(state.storm>0.9 && state.sun<0.1);
  for(let i=0;i<180;i++)easeWeather(state,{storm:0,sun:1},1/60);
  assert.ok(state.storm<0.01 && state.sun>0.99);
});
