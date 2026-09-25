import assert from 'node:assert/strict';

const port = process.argv[2] ?? '9223';
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
const page = targets.find(target => target.type === 'page');
if (!page?.webSocketDebuggerUrl) throw new Error('No Android WebView target found');

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const handler = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) handler.reject(new Error(message.error.message));
  else handler.resolve(message.result);
});
const send = (method, params = {}) => {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
};
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const snapshot = () => evaluate(`(() => ({
  href: location.href,
  title: document.title,
  sidebarIds: [...document.querySelectorAll('[data-sidebar-id]')].map(node => node.dataset.sidebarId).filter(Boolean).sort(),
  denial: /אין הרשאה|חשבון חסום/.test(document.body.innerText),
  loadingMessage: /טוען את החשבון|טוען.{0,20}הרשאות|בודק הרשאות/.test(document.body.innerText),
  startupWait: Boolean(document.querySelector('[data-testid="silent-startup-wait"], [data-testid="silent-auth-wait"]')),
  hasAdminPanel: Boolean(document.querySelector('[aria-label="ניהול משתמשים"]')),
  bodyLength: document.body.innerText.length,
}))()`);
const navigateSection = section => evaluate(`(() => {
  const url = new URL(location.href);
  ${section ? `url.searchParams.set('section', ${JSON.stringify(section)});` : `url.searchParams.delete('section');`}
  history.pushState({}, '', url);
  dispatchEvent(new PopStateEvent('popstate'));
  return true;
})()`);
const waitSettled = async (timeout = 30000) => {
  const deadline = Date.now() + timeout;
  let value;
  do {
    value = await snapshot();
    if (!value.startupWait && value.sidebarIds.length > 0 && value.bodyLength > 100) return value;
    await sleep(350);
  } while (Date.now() < deadline);
  throw new Error(`Android UI did not settle: ${JSON.stringify(value)}`);
};

await send('Runtime.enable');
await send('Network.enable');
await send('Page.enable');

let report;
try {
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await navigateSection(null);
  const online = await waitSettled();
  assert.equal(online.denial, false, 'online UI rendered a denial');
  assert.equal(online.loadingMessage, false, 'online UI rendered a permission-loading message');

  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  // Keep the real Capacitor WebView alive while changing connectivity. Some
  // Android WebView builds replace the inspected target on Page.reload, which
  // makes a successful offline transition look like a QA transport failure.
  // Cold offline startup is covered separately by the Playwright/E2E suite;
  // this device test verifies the native app's live online→offline behavior.
  await evaluate(`(() => { dispatchEvent(new Event('offline')); return true; })()`);
  const offline = await waitSettled();
  assert.equal(offline.denial, false, 'offline UI rendered a denial');
  assert.equal(offline.loadingMessage, false, 'offline UI rendered a permission-loading message');
  assert.deepEqual(offline.sidebarIds, online.sidebarIds, 'visible presentation changed after going offline');

  await navigateSection('admin');
  const offlineAdmin = await waitSettled();
  assert.equal(offlineAdmin.denial, false, 'offline administrator was denied');
  assert.equal(offlineAdmin.hasAdminPanel, true, 'offline administrator panel did not open');
  report = { passed: true, online, offline, offlineAdmin: {
    title: offlineAdmin.title,
    hasAdminPanel: offlineAdmin.hasAdminPanel,
    denial: offlineAdmin.denial,
  }};
} finally {
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }).catch(() => {});
  await evaluate(`(() => { dispatchEvent(new Event('online')); return true; })()`).catch(() => {});
  await navigateSection(null).catch(() => {});
  socket.close();
}

console.log(JSON.stringify(report, null, 2));
