import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  }))).flat();
}

const paths = (await files('dist')).filter(path => !path.endsWith('sw.js'));
const hash = createHash('sha256');
for (const path of paths.sort()) hash.update(await readFile(path));
const cacheName = `connections-app-${hash.digest('hex').slice(0, 12)}`;
const urls = ['./', ...paths.map(path => `./${relative('dist', path).replaceAll('\\', '/')}`)];
const template = await readFile('dist/sw.js', 'utf8');
await writeFile('dist/sw.js', template.replace('__CACHE_NAME__', cacheName).replace('__PRECACHE_FILES__', JSON.stringify(urls)));
