const port = process.argv[2] ?? "9223";
const section = process.argv.find((arg) => arg.startsWith("--section="))?.slice("--section=".length);
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const page = targets.find((target) => target.type === "page");
if (!page?.webSocketDebuggerUrl) throw new Error("No Android WebView target found");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const handler = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) handler.reject(new Error(message.error.message)); else handler.resolve(message.result);
});
const send = (method, params = {}) => {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
};

await send("Runtime.enable");
if (section) {
  await send("Runtime.evaluate", {
    expression: `(() => {
      const url = new URL(location.href);
      url.searchParams.set('section', ${JSON.stringify(section)});
      history.pushState({}, '', url);
      dispatchEvent(new PopStateEvent('popstate'));
      return new Promise(resolve => setTimeout(resolve, 1200));
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
}
const evaluation = await send("Runtime.evaluate", {
  expression: `(() => {
    const policies = Object.keys(localStorage).filter(key => key.startsWith('content-access-policy:')).map(key => {
      try {
        const value = JSON.parse(localStorage.getItem(key) || 'null');
        return {key, includeOwn:value?.include_own, includeSiteLibrary:value?.include_site_library,
          sourceTags:Array.isArray(value?.source_tags) ? value.source_tags : null,
          sourceUserCount:Array.isArray(value?.source_user_ids) ? value.source_user_ids.length : 0,
          isAdmin:value?.is_admin};
      } catch { return {key, invalid:true}; }
    });
    const readSetting = key => { try { return JSON.parse(localStorage.getItem('public-role-setting:' + key) || 'null'); } catch { return null; } };
    const profiles = readSetting('role_layout_profiles_v1');
    const assignments = readSetting('role_layout_profile_assignments_v1');
    const blockProfiles = readSetting('feature_blocklist_profiles_v1');
    const blockAssignments = readSetting('feature_blocklist_role_assignments_v1');
    return {
      title: document.title,
      href: location.href,
      bodyText: document.body.innerText.slice(0, 6000),
      sidebar: [...document.querySelectorAll('[data-sidebar-id]')].map(node => ({id:node.dataset.sidebarId,label:node.dataset.sidebarLabel})),
      policies,
      hasDevTools: Boolean(document.querySelector('[aria-label="עריכה חיה"]')),
      hasAdminPanel: Boolean(document.querySelector('[aria-label="ניהול משתמשים"]')),
      startupWait: Boolean(document.querySelector('[data-testid="silent-startup-wait"], [data-testid="silent-auth-wait"]')),
      viewProfiles: Array.isArray(profiles) ? profiles.map(item => ({id:item.id,name:item.name,visibleSidebar:(item.sidebarConfig || []).filter(row => row.visible).map(row => row.id)})) : [],
      viewAssignments: Array.isArray(assignments) ? assignments.map(item => ({roleId:item.roleId,profileId:item.profileId})) : [],
      blockProfiles: Array.isArray(blockProfiles) ? blockProfiles.map(item => ({id:item.id,name:item.name,hiddenSections:item.blocklist?.sections || []})) : [],
      blockAssignments: Array.isArray(blockAssignments) ? blockAssignments.map(item => ({roleId:item.roleId,profileId:item.profileId})) : [],
    };
  })()`,
  returnByValue: true,
});
console.log(JSON.stringify(evaluation.result.value, null, 2));
socket.close();
