import fs from 'node:fs';
import path from 'node:path';

const cliArgs = process.argv.slice(2);
const targetUrl = cliArgs.find((argument) => !argument.startsWith('--')) ?? 'http://127.0.0.1:4321/admin/preview';
const fullPage = cliArgs.includes('--full');
const outputPath = path.join(process.env.TEMP ?? '.', `wj-blog-preview-cdp-mobile${fullPage ? '-full' : ''}.png`);
const targets = await fetch('http://127.0.0.1:9223/json/list').then((response) => response.json());
const target = targets.find((item) => item.type === 'page');

if (!target?.webSocketDebuggerUrl) {
  throw new Error('Chrome DevTools target를 찾지 못했습니다. Chrome을 --remote-debugging-port=9223로 실행하세요.');
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 0;
const pending = new Map();

socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  }
};

const waitForOpen = new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = () => reject(new Error('Chrome DevTools WebSocket 연결 실패'));
});

const command = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});

await waitForOpen;
await command('Page.enable');
await command('Runtime.enable');
await command('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 1,
  mobile: true,
});
await command('Page.navigate', { url: targetUrl });
await new Promise((resolve) => setTimeout(resolve, 1500));

const metricsResult = await command('Runtime.evaluate', {
  expression: `JSON.stringify({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
    keyRects: ['.draft-preview-page', '.draft-preview-article', '.post-quick-answer', '.post-facts']
      .flatMap((selector) => [...document.querySelectorAll(selector)].map((element) => {
        const rect = element.getBoundingClientRect();
        return { selector, left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) };
      })),
  })`,
  returnByValue: true,
});
const metrics = JSON.parse(metricsResult.result.value);
const screenshot = await command('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: fullPage,
});

fs.writeFileSync(outputPath, Buffer.from(screenshot.data, 'base64'));
console.log(JSON.stringify({ targetUrl, outputPath, metrics }, null, 2));
socket.close();
