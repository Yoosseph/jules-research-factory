import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';

function git(args) {
  const result = spawnSync('git', args, { maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.toString() || 'Git archive failed');
  return result.stdout;
}

// Package committed source only, never the local database or account settings.
const { version } = JSON.parse(git(['show', 'HEAD:package.json']));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Release version must be a stable version such as 0.2.0');
if (process.env.RELEASE_TAG && process.env.RELEASE_TAG !== `v${version}`) {
  throw new Error(`Tag ${process.env.RELEASE_TAG} does not match package version ${version}`);
}

const rootFiles = new Set([
  'package.json', 'package-lock.json', '.env.example', '.gitignore',
  'README.md', 'howtouse.md', 'CONTRIBUTING.md', 'CHANGELOG.md',
  'LICENSE', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md',
  'prompt-template.txt',
]);
const files = git(['ls-tree', '-r', '--name-only', '-z', 'HEAD']).toString().split('\0').filter(path => {
  if (rootFiles.has(path)) return true;
  return /^(src|public|prompts|LICENSES|assets|scripts|test)\//.test(path)
    && !path.split('/').some(part => part.startsWith('.env') || ['.data', '.git', 'node_modules'].includes(part));
});
for (const required of ['package.json', 'package-lock.json', 'src/server.mjs', 'LICENSE', 'prompt-template.txt']) {
  if (!files.includes(required)) throw new Error(`Missing release file: ${required}`);
}

const basename = `research-facility-${version}`;
const output = resolve('dist');
mkdirSync(output, { recursive: true });
const checksums = [];
for (const [extension, format] of [['zip', 'zip'], ['tar.gz', 'tar']]) {
  const archive = git(['archive', `--format=${format}`, `--prefix=${basename}/`, 'HEAD', '--', ...files]);
  const data = format === 'tar' ? gzipSync(archive) : archive;
  const filename = `${basename}.${extension}`;
  writeFileSync(resolve(output, filename), data);
  checksums.push(`${createHash('sha256').update(data).digest('hex')}  ${filename}`);
  console.log(`Created ${filename}`);
}
writeFileSync(resolve(output, 'SHA256SUMS.txt'), `${checksums.join('\n')}\n`);
