// Screenshot + playtest driver for Ember Valley Air Mail (Node 22+ stdlib only).
// Drives a fresh Chrome for Testing headless shell over CDP with the built-in
// WebSocket client: no Playwright, no extra installs.
//
// Usage:
//   node tools/take-shots.mjs --chrome <path-to-chrome-headless-shell> [--port 8901]
//   node tools/take-shots.mjs --chrome <...> --playtest
//
// take-shots: serves game/ on 127.0.0.1, loads each ?shot= scene, waits for
// window.__shotReady, captures 1280x720 JPEGs into screenshots/, and asserts
// that no request leaves localhost (the game must make zero network requests).
// --playtest: clicks through title -> brief -> flying, holds the throttle,
// then runs the headless autopilot leg (window.__ember.game.debugFlyLeg) to
// prove the flight model and missions work end to end.
import { spawn } from 'node:child_process';
import { writeFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
}
const chromePath = arg('--chrome', '');
const port = Number(arg('--port', '8901'));
const playtest = args.includes('--playtest');
if (!chromePath) {
  console.error('usage: node tools/take-shots.mjs --chrome <chrome-headless-shell> [--port 8901] [--playtest]');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  return false;
}

/** Minimal CDP client over the built-in WebSocket. */
class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.requests = [];
    this.consoleErrors = [];
    this.ws.onmessage = (msg) => {
      let data;
      try { data = JSON.parse(msg.data); } catch { return; }
      if (data.id && this.pending.has(data.id)) {
        const { resolve: res, reject: rej } = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (data.error) rej(new Error(`${data.error.message} (${data.error.code})`));
        else res(data.result);
      } else if (data.method) {
        this.events.push(data);
        if (data.method === 'Network.requestWillBeSent') {
          this.requests.push(data.params.request.url);
        }
        if (data.method === 'Runtime.exceptionThrown') {
          this.consoleErrors.push(JSON.stringify(data.params.exceptionDetails).slice(0, 500));
        }
        if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') {
          this.consoleErrors.push(data.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 500));
        }
      }
    };
  }

  ready() {
    return new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = rej;
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 60000);
    });
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`page exception: ${JSON.stringify(r.exceptionDetails).slice(0, 500)}`);
    return r.result ? r.result.value : undefined;
  }

  async waitFor(fnSource, timeoutMs = 45000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await this.eval(`(${fnSource})()`)) return true;
      } catch { /* page not ready yet */ }
      await sleep(300);
    }
    return false;
  }
}

async function main() {
  // 1. Serve game/ on localhost.
  const server = spawn(process.execPath, ['serve.ts', '--port', String(port)], {
    cwd: repo, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });
  if (!await waitFor(`http://127.0.0.1:${port}/index.html`)) {
    console.error('server did not come up', serverLog);
    server.kill();
    process.exit(1);
  }
  console.log(`server up on :${port}`);

  // 2. Launch a fresh headless Chrome over CDP.
  const chrome = spawn(chromePath, [
    '--headless', '--no-sandbox', '--disable-dev-shm-usage',
    '--remote-debugging-port=9222', '--window-size=1280,720',
    '--hide-scrollbars', '--force-device-scale-factor=1',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let chromeLog = '';
  chrome.stdout.on('data', (d) => { chromeLog += d; });
  chrome.stderr.on('data', (d) => { chromeLog += d; });
  if (!await waitFor('http://127.0.0.1:9222/json/version')) {
    console.error('chrome did not come up', chromeLog.slice(-2000));
    server.kill();
    chrome.kill();
    process.exit(1);
  }
  const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const page = targets.find((t) => t.type === 'page');
  const cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.ready();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  console.log('chrome connected');

  const base = `http://127.0.0.1:${port}`;
  let failures = 0;

  async function load(url) {
    cdp.requests = [];
    cdp.consoleErrors = [];
    await cdp.send('Page.navigate', { url });
    await sleep(500);
  }

  function checkNetwork(label) {
    const bad = cdp.requests.filter((u) => !u.startsWith(`http://127.0.0.1:${port}`) && !u.startsWith('data:'));
    if (bad.length > 0) {
      console.error(`[${label}] NETWORK LEAK:`, bad);
      failures += 1;
    } else {
      console.log(`[${label}] network: ${cdp.requests.length} localhost requests, 0 external`);
    }
  }

  function checkConsole(label) {
    if (cdp.consoleErrors.length > 0) {
      console.error(`[${label}] CONSOLE ERRORS:`, cdp.consoleErrors);
      failures += 1;
    } else {
      console.log(`[${label}] console: clean`);
    }
  }

  if (playtest) {
    await load(`${base}/`);
    const hasGame = await cdp.waitFor(() => !!window.__ember, 20000);
    console.log('[playtest] game object present:', hasGame);
    if (!hasGame) { failures += 1; }
    else {
      // Click START on the title screen.
      const startRect = await cdp.eval(`(() => { const r = document.getElementById('start-btn').getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; })()`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startRect.x, y: startRect.y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startRect.x, y: startRect.y, button: 'left', clickCount: 1 });
      await sleep(400);
      console.log('[playtest] state after START:', await cdp.eval('window.__ember.game.state'));
      // Click FLY on the briefing.
      const flyRect = await cdp.eval(`(() => { const r = document.getElementById('fly-btn').getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; })()`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: flyRect.x, y: flyRect.y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: flyRect.x, y: flyRect.y, button: 'left', clickCount: 1 });
      await sleep(400);
      console.log('[playtest] state after FLY:', await cdp.eval('window.__ember.game.state'));
      // Hold W (throttle) and confirm the key reaches the flight model.
      // (Headless SwiftShader renders ~3 fps, so a wall-clock hold proves
      // little; step the real model directly instead.)
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
      await sleep(1500);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
      const keyPath = await cdp.eval(`(() => { const g = window.__ember.game; return {inputThrottle: Math.round(g.input.throttle * 100) / 100, planeThrottle: Math.round(g.plane.throttle * 100) / 100}; })()`);
      console.log('[playtest] W key reaches throttle:', JSON.stringify(keyPath));
      if (!(keyPath.inputThrottle > 0.05)) failures += 1;
      // Step the real flight model 3 sim-seconds at full throttle: the
      // plane must roll fast down the strip (or lift off).
      const rollTest = await cdp.eval(`(() => { const g = window.__ember.game; const input = {roll: 0, pitch: 0, rudder: 0, throttle: 1, flaps: false, brakes: false}; for (let i = 0; i < 180; i++) g.stepWorld(1 / 60, input); return {speed: Math.round(g.plane.speed), onGround: g.plane.onGround, state: g.state}; })()`);
      console.log('[playtest] 3 sim-seconds at full throttle:', JSON.stringify(rollTest));
      if (!(rollTest.speed > 20)) failures += 1;
      // Headless autopilot: fly every leg end to end with the real flight model.
      console.log('[playtest] running headless autopilot legs 0-2...');
      for (let legIndex = 0; legIndex < 3; legIndex += 1) {
        const leg = await cdp.eval(`window.__ember.game.debugFlyLeg(${legIndex})`);
        console.log(`[playtest] leg ${legIndex} autopilot:`, JSON.stringify(leg).slice(0, 1200));
        if (leg.outcome !== 'delivered') failures += 1;
      }
    }
    checkNetwork('playtest');
    checkConsole('playtest');
  } else {
    const shots = [
      { name: 'cover', file: '1-cover.jpg' },
      { name: 'approach', file: '2-approach.jpg' },
      { name: 'strip', file: '3-strip.jpg' },
      { name: 'title', file: '4-title.jpg' },
    ];
    for (const shot of shots) {
      await load(`${base}/?shot=${shot.name}&seed=1`);
      const ready = await cdp.waitFor(() => window.__shotReady === true, 45000);
      console.log(`[${shot.name}] shotReady:`, ready);
      if (!ready) {
        checkConsole(shot.name);
        failures += 1;
        continue;
      }
      await sleep(1200); // let toasts / DOM paint settle
      let quality = 82;
      let out;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const shotRes = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality });
        out = Buffer.from(shotRes.data, 'base64');
        if (out.length <= 262144) break;
        quality -= 12;
      }
      const path = join(repo, 'screenshots', shot.file);
      writeFileSync(path, out);
      console.log(`[${shot.name}] wrote ${shot.file}: ${out.length} bytes (quality ${quality})`);
      if (out.length > 262144) { console.error(`[${shot.name}] STILL OVER 256KiB`); failures += 1; }
      checkNetwork(shot.name);
      checkConsole(shot.name);
    }
    // Screenshot dimensions sanity: JPEG SOF0 marker.
    for (const shot of shots) {
      const path = join(repo, 'screenshots', shot.file);
      try {
        const buf = statSync(path);
        const data = await import('node:fs').then((fs) => fs.readFileSync(path));
        let w = 0; let h = 0;
        for (let i = 2; i < data.length - 9; i += 1) {
          if (data[i] === 0xff && (data[i + 1] === 0xc0 || data[i + 1] === 0xc2)) {
            h = data.readUInt16BE(i + 5);
            w = data.readUInt16BE(i + 7);
            break;
          }
        }
        console.log(`[${shot.file}] ${w}x${h}, ${buf.size} bytes`);
        if (w > 1280 || h < 480 || Math.max(w, h) > 1280 || Math.min(w, h) < 480) failures += 1;
      } catch (e) {
        console.error(`[${shot.file}] unreadable:`, e.message);
        failures += 1;
      }
    }
  }

  chrome.kill();
  server.kill();
  console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('driver error:', e);
  process.exit(1);
});
