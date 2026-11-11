// 토스 인앱용 번들 폴더(dist-toss)를 만듭니다: npm run toss:bundle
//  1) site/ 를 그대로 복사
//  2) toss/bridge.js 를 토스 SDK와 함께 한 파일(toss-bridge.js)로 묶음
//  3) index.html 에서 게임보다 먼저 그 파일을 읽게 함
// 그다음 `ait build`가 이 폴더를 .ait 파일로 포장합니다 (npm run toss:build).
import { cp, rm, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist-toss');

await rm(out, { recursive: true, force: true });
await cp(resolve(root, 'site'), out, { recursive: true });

await build({
  entryPoints: [resolve(root, 'toss/bridge.js')],
  outfile: resolve(out, 'toss-bridge.js'),
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
});

const MAIN = '<script type="module" src="src/main.js"></script>';
const file = resolve(out, 'index.html');
const html = await readFile(file, 'utf8');
if (!html.includes(MAIN)) throw new Error('index.html에서 게임 스크립트 줄을 찾지 못했습니다');
await writeFile(file, html.replace(MAIN, `<script src="toss-bridge.js"></script>\n  ${MAIN}`));

console.log('dist-toss 준비 완료');
