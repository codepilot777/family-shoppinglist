// 逐個跑 e2e/*.test.mjs：每個測試之前清空 emulator 資料，測試完要冇頁面錯誤。
// 要先開 Firebase emulator（npm run emulated 會自動開）。會喺 :8080 開一個本機網頁伺服器（除非有 APP_URL）。
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import httpServer from 'http-server';
import { launch, session } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const only = process.argv[2];
const files = readdirSync(here)
  .filter((f) => f.endsWith('.test.mjs') && (!only || f.includes(only)))
  .sort();

let server;
if (!process.env.APP_URL) {
  server = httpServer.createServer({ root: join(here, '../../public'), cache: -1, silent: true });
  await new Promise((resolve) => server.listen(8080, '127.0.0.1', resolve));
}

async function clearEmulators() {
  await fetch('http://127.0.0.1:8085/emulator/v1/projects/demo-fsl/databases/(default)/documents', { method: 'DELETE' });
  await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-fsl/accounts', { method: 'DELETE' });
}

const browser = await launch();
let failed = 0;
for (const f of files) {
  const started = Date.now();
  await clearEmulators();
  const s = session(browser);
  const contexts = browser.contexts().length;
  try {
    const { default: test } = await import(join(here, f));
    await test(s);
    if (s.errors.length) throw new Error(`page errors:\n  ${s.errors.join('\n  ')}`);
    console.log(`✔ ${f} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } catch (err) {
    failed++;
    console.log(`✘ ${f}\n  ${err.stack || err}`);
  }
  for (const c of browser.contexts().slice(contexts)) await c.close().catch(() => {});
}
await browser.close();
server?.close();
console.log(failed ? `\n${failed} of ${files.length} e2e test file(s) failed` : `\nall ${files.length} e2e test files passed`);
process.exit(failed ? 1 : 0);
