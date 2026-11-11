// 배포마다 HTML과 모든 모듈이 같은 커밋의 파일을 요청하도록 캐시 키를 붙입니다.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const revision = process.env.GITHUB_SHA;
if (!/^[a-f0-9]{40}$/.test(revision ?? '')) throw new Error('GITHUB_SHA must be a full commit SHA');
const root = process.argv[2] ? resolve(process.argv[2]) : resolve(dirname(fileURLToPath(import.meta.url)), '../site');
const stamp = path => `${path.split('?')[0]}?v=${revision}`;
const html = await readFile(join(root, 'index.html'), 'utf8');
await writeFile(join(root, 'index.html'), html.replace(/(src|href)="((?:src\/[^"?]+\.js|style\.css)(?:\?[^" ]*)?)"/g, (_, attr, path) => `${attr}="${stamp(path)}"`));
for (const name of await readdir(join(root, 'src'))) {
  if (!name.endsWith('.js')) continue;
  const file = join(root, 'src', name);
  const source = await readFile(file, 'utf8');
  await writeFile(file, source.replace(/(from\s+['"])(\.\.?\/[^'"?]+\.js)(?:\?[^'"]*)?(['"])/g, (_, prefix, path, suffix) => prefix + stamp(path) + suffix));
}
console.log(`Versioned assets: ${revision}`);
