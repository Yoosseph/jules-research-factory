import { resolve } from 'node:path';
import { loadEnv } from './config.mjs';
import { openStore } from './db.mjs';
import { createApp } from './app.mjs';
import { bootstrapFromEnv, applyApiKeysFromEnv } from './bootstrap.mjs';

loadEnv();
const store = openStore(resolve('.data'));
try { await bootstrapFromEnv(store); }
catch (error) { console.error(`Environment setup could not be verified: ${error.message}`); }
applyApiKeysFromEnv(store);
const app = createApp(store);
const port = Number(process.env.PORT ?? 3000);
app.server.listen(port, '127.0.0.1', () => console.log(`Research Facility: http://localhost:${port}`));
