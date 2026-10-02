import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadEnv(path, env = process.env) {
  // Local overrides win, followed by .env; existing process variables win over both.
  for (const file of path ? [path] : [resolve('.env.local'), resolve('.env')]) {
    try {
      for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (match && env[match[1]] === undefined) {
          let value = match[2];
          if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
          // Empty template fields should not hide a filled field in the fallback file.
          if (value.trim()) env[match[1]] = value;
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}
