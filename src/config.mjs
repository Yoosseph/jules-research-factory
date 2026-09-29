import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadEnv(path = resolve('.env.local')) {
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match && process.env[match[1]] === undefined) {
        let value = match[2];
        if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
        process.env[match[1]] = value;
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
