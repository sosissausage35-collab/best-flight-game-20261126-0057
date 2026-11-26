// Dev tooling (not part of the entry): takes the screenshots in shots.json with the
// cached headless Chromium over CDP, and reports console errors. Usage:
//   node take-shots.mjs [port]   (game must be served, e.g. `node serve.ts --port 8080`)
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] ?? 8080);
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`;
const SHOTS = JSON.parse(readFileSync(join(here, 'shots.json'), 'utf8'));
const DEBUG_PORT = 9333;

const chrome = spawn(CHROME, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  `--remote-debugging-port=${DEBUG_PORT}`,
  '--window-size=1280,720',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDebugger() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('chrome debugger did not come up');
}

async function getPageTarget() {
  const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const targets = await res.json();
  const page = targets.find((t) => t.type === 'page');
  return page.webSocketDebuggerUrl;
}

let id = 0;
const pending = new Map();
const consoleErrors = [];
let ws;

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (r.exceptionDetails) return { __error: r.exceptionDetails.text ?? 'exception' };
  return r.result?.value;
}

async function main() {
  await waitForDebugger();
  const wsUrl = await getPageTarget();
  ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id).resolve(msg.result ?? {});
      pending.delete(msg.id);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(`EXCEPTION: ${JSON.stringify(msg.params.exceptionDetails).slice(0, 400)}`);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(`CONSOLE ERROR: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400)}`);
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

  for (const shot of SHOTS) {
    const url = `http://127.0.0.1:${PORT}/${shot.query}`;
    await send('Page.navigate', { url });
    let ready = false;
    for (let i = 0; i < 120; i += 1) {
      await sleep(500);
      try {
        ready = (await evaluate('window.__shotReady === true')) === true;
      } catch { /* page still loading */ }
      if (ready) break;
    }
    if (!ready) {
      console.log(`SHOT ${shot.name}: NOT READY (timeout)`);
      continue;
    }
    const shot2 = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
    const buf = Buffer.from(shot2.data, 'base64');
    writeFileSync(join(here, 'screenshots', shot.name), buf);
    const state = await evaluate(`(() => { const s = window.__debugState ? window.__debugState() : null; return s; })()`);
    console.log(`SHOT ${shot.name}: ${buf.length} bytes ${JSON.stringify(state)}`);
  }

  // Plain load check: open the title screen, wait, report console errors.
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?seed=1` });
  await sleep(3000);
  console.log(`CONSOLE ERRORS: ${consoleErrors.length}`);
  for (const e of consoleErrors) console.log(`  ${e}`);
  ws.close();
  chrome.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  try { chrome.kill(); } catch { /* already dead */ }
  process.exit(1);
});
