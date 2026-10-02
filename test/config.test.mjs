import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { loadEnv } from '../src/config.mjs';

test('loads .env and local overrides while keeping process values and ignoring blank placeholders', () => {
  const directory = mkdtempSync(join(tmpdir(), 'researchforge-env-'));
  const originalDirectory = process.cwd();
  try {
    writeFileSync(join(directory, '.env'), 'JULES_API_KEY="file-jules"\nNVIDIA_API_KEY=file-nvidia\nGITHUB_TOKEN=file-github\n');
    writeFileSync(join(directory, '.env.local'), "JULES_API_KEY='local-jules'\nNVIDIA_API_KEY=\n");
    process.chdir(directory);
    const env = { GITHUB_TOKEN: 'process-github' };
    loadEnv(undefined, env);
    assert.deepEqual(env, { GITHUB_TOKEN: 'process-github', JULES_API_KEY: 'local-jules', NVIDIA_API_KEY: 'file-nvidia' });
    const onlyFile = {};
    loadEnv(join(directory, '.env'), onlyFile);
    assert.equal(onlyFile.JULES_API_KEY, 'file-jules');
  } finally {
    process.chdir(originalDirectory);
    if (resolve(directory).startsWith(resolve(tmpdir()) + sep)) rmSync(directory, { recursive: true, force: true });
  }
});
