import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packagePath = new URL("../package.json", import.meta.url);
const isDryRun = process.argv.includes("--dry-run");
const isPublishOnly = process.argv.includes("--publish-only");
const skipPublish = process.argv.includes("--no-publish");
const githubRepository = "ticnutai/deepfocus-zone";
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const buildLockPath = fileURLToPath(new URL("../release/.electron-build.lock", import.meta.url));
let activeChild = null;
let versionToRestore = null;
let buildLockOwned = false;

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Unsupported version format: ${version}`);
  return match.slice(1).map(Number);
}

function nextPatch(version) {
  const [major, minor, patch] = parseVersion(version);
  return `${major}.${minor}.${patch + 1}`;
}

function quoteForCmd(argument) {
  if (!/[\s"]/u.test(argument)) return argument;
  return `"${argument.replace(/"/g, '""')}"`;
}

function commandSpec(command, args) {
  // Node 24 on Windows rejects direct spawnSync calls to npm.cmd with EINVAL.
  // Invoke batch-based tools through cmd.exe while keeping executable tools
  // such as gh.exe direct and argument-safe.
  if (process.platform === "win32" && (command === "npm" || command === "npx")) {
    const commandLine = [command, ...args].map(quoteForCmd).join(" ");
    return { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", commandLine] };
  }
  return { command, args };
}

function spawnCrossPlatform(command, args, stdio) {
  const spec = commandSpec(command, args);
  return spawnSync(spec.command, spec.args, {
    cwd: projectRoot,
    stdio,
    shell: false,
  });
}

function run(command, args, label = command) {
  const spec = commandSpec(command, args);
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, { cwd: projectRoot, stdio: "inherit", shell: false });
    activeChild = child;
    const heartbeat = setInterval(() => {
      const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
      console.log(`\n... ${label} עדיין מתבצע (${elapsed} דקות). אין צורך להפעיל שוב.`);
    }, 30000);
    child.once("error", (error) => { clearInterval(heartbeat); activeChild = null; reject(error); });
    child.once("exit", (code, signal) => {
      clearInterval(heartbeat);
      activeChild = null;
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed (${signal || `exit code ${code}`})`));
    });
  });
}

function succeeds(command, args) {
  const result = spawnCrossPlatform(command, args, "ignore");
  return !result.error && result.status === 0;
}

function setVersion(version) {
  const result = spawnCrossPlatform("npm", ["version", version, "--no-git-tag-version", "--allow-same-version"], "inherit");
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm version failed with exit code ${result.status}`);
}

function acquireBuildLock() {
  mkdirSync(fileURLToPath(new URL("../release/", import.meta.url)), { recursive: true });
  if (existsSync(buildLockPath)) {
    const existingPid = Number(readFileSync(buildLockPath, "utf8").trim());
    try {
      if (existingPid > 0) process.kill(existingPid, 0);
      throw new Error(`Electron build is already running (PID ${existingPid}). Wait for it to finish.`);
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
      unlinkSync(buildLockPath);
    }
  }
  writeFileSync(buildLockPath, String(process.pid), "utf8");
  buildLockOwned = true;
}

function releaseBuildLock() {
  if (!buildLockOwned) return;
  try { unlinkSync(buildLockPath); } catch { /* already removed */ }
  buildLockOwned = false;
}

function handleInterruptedBuild(signal) {
  console.error(`\nBuild interrupted (${signal}). Cleaning up...`);
  try { activeChild?.kill("SIGTERM"); } catch { /* child already stopped */ }
  if (versionToRestore) {
    try { setVersion(versionToRestore); } catch (error) { console.error("Failed to restore version:", error); }
  }
  releaseBuildLock();
  process.exit(130);
}

function releaseAssetPaths(version) {
  return [
    `release/lemaan-setup-${version}.exe`,
    `release/lemaan-setup-${version}.exe.blockmap`,
    "release/latest.yml",
  ].map((relativePath) => ({
    relativePath,
    absolutePath: fileURLToPath(new URL(`../${relativePath}`, import.meta.url)),
  }));
}

function assertReleaseAssets(version) {
  const assets = releaseAssetPaths(version);
  for (const asset of assets) {
    if (!existsSync(asset.absolutePath) || statSync(asset.absolutePath).size === 0) {
      throw new Error(`Missing release asset: ${asset.relativePath}`);
    }
  }
  return assets.map((asset) => asset.absolutePath);
}

async function publishRelease(version) {
  const tag = `v${version}`;
  const title = `למען ${version}`;
  const notes = `עדכון אוטומטי לגרסה ${version}`;
  const assets = assertReleaseAssets(version);

  console.log("\n==> Verifying GitHub authentication");
  run("gh", ["auth", "status"]);

  if (succeeds("gh", ["release", "view", tag, "--repo", githubRepository])) {
    // Reusing an old release object keeps its historic `created_at` value.
    // GitHub's Atom feed can then place an older version before this one,
    // which makes desktop clients report that the old version is current.
    // Keep the tag, but recreate the release record with a fresh timestamp.
    console.log(`\n==> Replacing existing GitHub Release ${tag}`);
    await run("gh", ["release", "delete", tag, "--yes", "--repo", githubRepository], "מחיקת גרסת GitHub ישנה");
  }

  console.log(`\n==> Publishing GitHub Release ${tag}`);
  await run("gh", [
    "release", "create", tag, ...assets,
    "--repo", githubRepository,
    "--title", title,
    "--notes", notes,
    "--latest",
  ], "העלאת המתקין ל-GitHub");
}

const currentVersion = JSON.parse(readFileSync(packagePath, "utf8")).version;
const installerVersion = isPublishOnly ? currentVersion : nextPatch(currentVersion);

if (isDryRun) {
  console.log(`${currentVersion} -> ${installerVersion}`);
  process.exit(0);
}

if (isPublishOnly) {
  await publishRelease(currentVersion);
  console.log(`\nDone: GitHub Release v${currentVersion} is published.`);
  process.exit(0);
}

console.log(`\n==> Installer version: ${currentVersion} -> ${installerVersion}`);
acquireBuildLock();
versionToRestore = currentVersion;
process.once("SIGINT", () => handleInterruptedBuild("Ctrl+C"));
process.once("SIGTERM", () => handleInterruptedBuild("SIGTERM"));
setVersion(installerVersion);

try {
  console.log("\n==> Building Electron web bundle");
  await run("npm", ["run", "electron:build"], "בניית קובצי האפליקציה");

  console.log("\n==> Creating installer");
  await run("npm", ["exec", "electron-builder"], "אריזת מתקין Electron");
} catch (error) {
  console.error("\nInstaller build failed. Restoring the previous version.");
  try {
    setVersion(currentVersion);
  } catch (restoreError) {
    console.error("Failed to restore the previous version:", restoreError);
  }
  releaseBuildLock();
  throw error;
}

console.log(`\nInstaller ready: release/lemaan-setup-${installerVersion}.exe`);
// From this point the installer is valid, so a network/publishing failure must
// not roll the package version back.
versionToRestore = null;

try {
  if (skipPublish) {
    console.log("\nGitHub publishing skipped (--no-publish).");
  } else {
    // A publishing failure deliberately does not roll the version back: the
    // installer and latest.yml already exist and can be retried with
    // `npm run electron:publish` without rebuilding or reusing the version.
    await publishRelease(installerVersion);
  }
} finally {
  releaseBuildLock();
}

console.log(`\nDone: Electron version ${installerVersion}${skipPublish ? " was built" : " was built and published"}.`);
