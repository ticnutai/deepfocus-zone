import { existsSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packagePath = new URL("../package.json", import.meta.url);
const isDryRun = process.argv.includes("--dry-run");
const isPublishOnly = process.argv.includes("--publish-only");
const skipPublish = process.argv.includes("--no-publish");
const githubRepository = "ticnutai/deepfocus-zone";
const projectRoot = fileURLToPath(new URL("../", import.meta.url));

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

function spawnCrossPlatform(command, args, stdio) {
  // Node 24 on Windows rejects direct spawnSync calls to npm.cmd with EINVAL.
  // Invoke batch-based tools through cmd.exe while keeping executable tools
  // such as gh.exe direct and argument-safe.
  if (process.platform === "win32" && (command === "npm" || command === "npx")) {
    const commandLine = [command, ...args].map(quoteForCmd).join(" ");
    return spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", commandLine], {
      cwd: projectRoot,
      stdio,
      shell: false,
    });
  }

  return spawnSync(command, args, {
    cwd: projectRoot,
    stdio,
    shell: false,
  });
}

function run(command, args) {
  const result = spawnCrossPlatform(command, args, "inherit");
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
}

function succeeds(command, args) {
  const result = spawnCrossPlatform(command, args, "ignore");
  return !result.error && result.status === 0;
}

function setVersion(version) {
  run("npm", ["version", version, "--no-git-tag-version", "--allow-same-version"]);
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

function publishRelease(version) {
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
    run("gh", ["release", "delete", tag, "--yes", "--repo", githubRepository]);
  }

  console.log(`\n==> Publishing GitHub Release ${tag}`);
  run("gh", [
    "release", "create", tag, ...assets,
    "--repo", githubRepository,
    "--title", title,
    "--notes", notes,
    "--latest",
  ]);
}

const currentVersion = JSON.parse(readFileSync(packagePath, "utf8")).version;
const installerVersion = isPublishOnly ? currentVersion : nextPatch(currentVersion);

if (isDryRun) {
  console.log(`${currentVersion} -> ${installerVersion}`);
  process.exit(0);
}

if (isPublishOnly) {
  publishRelease(currentVersion);
  console.log(`\nDone: GitHub Release v${currentVersion} is published.`);
  process.exit(0);
}

console.log(`\n==> Installer version: ${currentVersion} -> ${installerVersion}`);
setVersion(installerVersion);

try {
  console.log("\n==> Building Electron web bundle");
  run("npm", ["run", "electron:build"]);

  console.log("\n==> Creating installer");
  run("npm", ["exec", "electron-builder"]);
} catch (error) {
  console.error("\nInstaller build failed. Restoring the previous version.");
  try {
    setVersion(currentVersion);
  } catch (restoreError) {
    console.error("Failed to restore the previous version:", restoreError);
  }
  throw error;
}

console.log(`\nInstaller ready: release/lemaan-setup-${installerVersion}.exe`);

if (skipPublish) {
  console.log("\nGitHub publishing skipped (--no-publish).");
} else {
  // A publishing failure deliberately does not roll the version back: the
  // installer and latest.yml already exist and can be retried with
  // `npm run electron:publish` without rebuilding or reusing the version.
  publishRelease(installerVersion);
}

console.log(`\nDone: Electron version ${installerVersion}${skipPublish ? " was built" : " was built and published"}.`);
