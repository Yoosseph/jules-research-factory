import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { openStore } from '../../src/db.mjs';

export function temporaryDirectory(prefix = 'research-facility-test-') {
  const root = resolve(tmpdir());
  const directory = mkdtempSync(join(root, prefix));
  return {
    directory,
    cleanup() {
      const target = resolve(directory);
      const path = relative(root, target);
      if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
        throw new Error('Refusing to remove a directory outside the temporary test workspace');
      }
      rmSync(target, { recursive: true, force: true });
    }
  };
}

export function storeFixture(prefix) {
  const fixture = temporaryDirectory(prefix);
  const store = openStore(fixture.directory);
  return {
    ...fixture,
    store,
    cleanup() {
      store.db.close();
      fixture.cleanup();
    }
  };
}

export function writePromptFixture(directory) {
  const path = join(directory, 'prompt.txt');
  writeFileSync(path, readFileSync(new URL('../../prompt-template.txt', import.meta.url)));
  return path;
}

export async function listen(app) {
  await new Promise((done, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', () => {
      app.server.off('error', reject);
      done();
    });
  });
  return `http://127.0.0.1:${app.server.address().port}`;
}

export async function closeApp(app) {
  const closed = app.server.listening ? new Promise(done => app.server.once('close', done)) : Promise.resolve();
  app.close();
  await Promise.all([closed, app.schedule()]);
}
