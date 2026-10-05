import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';

const script = fileURLToPath(new URL('../scripts/package-release.mjs', import.meta.url));

function fixture(t, version = '0.2.0') {
  const directory = mkdtempSync(join(tmpdir(), 'research-facility-release-'));
  t.after(() => {
    if (resolve(directory).startsWith(resolve(tmpdir()) + sep)) rmSync(directory, { recursive: true, force: true });
  });
  function write(path, contents) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), contents);
  }
  write('package.json', JSON.stringify({ name: 'research-facility', version }));
  for (const path of ['package-lock.json', 'LICENSE', 'prompt-template.txt', '.env.example', 'src/server.mjs', 'public/style.css', 'prompts/research.txt', 'LICENSES/Apache-2.0.txt']) {
    write(path, 'committed release content');
  }
  // Track synthetic private files to exercise packaging's own exclusion rules.
  for (const path of ['.env', '.env.local', '.data/store.sqlite', 'src/.env', 'public/.data/store.sqlite', 'src/node_modules/private.js', '.github/workflows/ci.yml']) {
    write(path, 'synthetic private content');
  }
  for (const args of [['init'], ['add', '.'], ['commit', '-m', 'Synthetic release fixture']]) {
    const result = spawnSync('git', ['-c', 'user.name=Release test', '-c', 'user.email=release-test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  return { directory, write };
}

function build(directory, tag = '') {
  return spawnSync(process.execPath, [script], { cwd: directory, encoding: 'utf8', env: { ...process.env, RELEASE_TAG: tag } });
}

function tarEntries(buffer) {
  const entries = new Map();
  for (let offset = 0; offset + 512 <= buffer.length;) {
    const name = buffer.subarray(offset, offset + 100).toString().split('\0')[0];
    if (!name) break;
    const size = parseInt(buffer.subarray(offset + 124, offset + 136).toString().replace(/\0/g, '').trim(), 8) || 0;
    entries.set(name, buffer.subarray(offset + 512, offset + 512 + size).toString());
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function zipEntries(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= 0, 'ZIP end-of-directory record exists');
  const entries = [];
  let offset = buffer.readUInt32LE(end + 16);
  const count = buffer.readUInt16LE(end + 10);
  for (let index = 0; index < count; index++) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
    const length = buffer.readUInt16LE(offset + 28);
    entries.push(buffer.subarray(offset + 46, offset + 46 + length).toString());
    offset += 46 + length + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  return entries;
}

test('release archives include committed app files and licenses, exclude private files, and have valid checksums', t => {
  const { directory, write } = fixture(t);
  write('src/server.mjs', 'uncommitted changes must not ship');
  write('src/untracked.mjs', 'untracked changes must not ship');
  const result = build(directory, 'v0.2.0');
  assert.equal(result.status, 0, result.stderr);
  const prefix = 'research-facility-0.2.0/';
  const tar = tarEntries(gunzipSync(readFileSync(join(directory, 'dist/research-facility-0.2.0.tar.gz'))));
  const zip = zipEntries(readFileSync(join(directory, 'dist/research-facility-0.2.0.zip')));
  for (const entries of [[...tar.keys()], zip]) {
    for (const path of ['package.json', 'package-lock.json', 'src/server.mjs', 'public/style.css', 'LICENSE', 'LICENSES/Apache-2.0.txt', '.env.example', 'prompts/research.txt']) {
      assert.ok(entries.includes(prefix + path), `${path} is included`);
    }
    assert.ok(entries.every(path => !/\.env\.local|\/\.env$|\/\.data\/|\/node_modules\/|\/\.github\/|untracked/.test(path)));
  }
  assert.equal(tar.get(prefix + 'src/server.mjs'), 'committed release content');
  const checksums = readFileSync(join(directory, 'dist/SHA256SUMS.txt'), 'utf8').trim().split('\n');
  assert.equal(checksums.length, 2);
  for (const line of checksums) {
    const [hash, filename] = line.split('  ');
    const expected = createHash('sha256').update(readFileSync(join(directory, 'dist', filename))).digest('hex');
    assert.equal(hash, expected);
  }
});

test('release packaging rejects a tag that differs from the committed package version', t => {
  const { directory } = fixture(t);
  const result = build(directory, 'v9.9.9');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not match package version/);
  assert.equal(existsSync(join(directory, 'dist')), false);
});

test('release packaging rejects prerelease versions instead of publishing them as stable releases', t => {
  const { directory } = fixture(t, '0.2.0-beta.1');
  const result = build(directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be a stable version/);
  assert.equal(existsSync(join(directory, 'dist')), false);
});
