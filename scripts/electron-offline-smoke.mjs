const port = process.argv[2] ?? "9223";
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
const page = targets.find((target) => target.type === "page");
if (!page?.webSocketDebuggerUrl) throw new Error("No Electron page target found");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 1;
const pending = new Map();
const runtimeErrors = [];
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
    return;
  }
  if (message.method === "Runtime.exceptionThrown") {
    runtimeErrors.push(message.params?.exceptionDetails?.text ?? "runtime exception");
  }
});

function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

await send("Runtime.enable");
await send("Page.enable");
await send("Network.enable");
await send("Network.emulateNetworkConditions", {
  offline: true,
  latency: 0,
  downloadThroughput: 0,
  uploadThroughput: 0,
});
await send("Page.reload", { ignoreCache: true });
await new Promise((resolve) => setTimeout(resolve, 5000));

const authState = await send("Runtime.evaluate", {
  expression: `(() => ({
    title: document.title,
    href: location.href,
    rootChildren: document.querySelector('#root')?.childElementCount ?? 0,
    text: document.body.innerText.slice(0, 2000),
    buttons: [...document.querySelectorAll('button')].map((b) => b.innerText.trim())
  }))()`,
  returnByValue: true,
});
const auth = authState.result.value;
if (!auth.rootChildren) throw new Error("Offline reload rendered an empty root");

const guestButton = auth.buttons.find((label) => label.includes("כניסה כאורח"));
if (guestButton) {
  await send("Runtime.evaluate", {
    expression: `(() => {
      const button = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('כניסה כאורח'));
      if (!button || button.disabled) return false;
      button.click();
      return true;
    })()`,
    returnByValue: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 4000));
}

const finalState = await send("Runtime.evaluate", {
  expression: `(async () => ({
    title: document.title,
    href: location.href,
    rootChildren: document.querySelector('#root')?.childElementCount ?? 0,
    bodyLength: document.body.innerText.length,
    networkBlocked: await fetch('https://example.invalid/offline-probe')
      .then(() => false)
      .catch(() => true)
  }))()`,
  awaitPromise: true,
  returnByValue: true,
});
const result = finalState.result.value;
if (!result.rootChildren || result.bodyLength < 20) throw new Error("Offline app content did not render");
if (!result.networkBlocked) throw new Error("Chromium network was not blocked");

console.log(JSON.stringify({ ok: true, auth, result, runtimeErrors }, null, 2));
socket.close();
