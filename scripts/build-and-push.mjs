import { spawnSync } from "node:child_process";

function quoteForCmd(arg) {
  if (!/[\s"]/u.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

function spawnCrossPlatform(command, args, options = {}) {
  if (process.platform === "win32" && (command === "npm" || command === "npx")) {
    const cmdLine = [command, ...args].map(quoteForCmd).join(" ");
    return spawnSync("cmd.exe", ["/d", "/s", "/c", cmdLine], {
      shell: false,
      ...options,
    });
  }

  return spawnSync(command, args, {
    shell: false,
    ...options,
  });
}

function run(command, args, options = {}) {
  const result = spawnCrossPlatform(command, args, {
    stdio: "inherit",
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }
}

function runQuiet(command, args) {
  const result = spawnCrossPlatform(command, args, {
    stdio: "ignore",
  });

  if (result.error) {
    throw result.error;
  }

  return typeof result.status === "number" ? result.status : 1;
}

function isoStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

try {
  console.log("\n==> Building project");
  run("npm", ["run", "build"]);

  console.log("\n==> Staging changes");
  run("git", ["add", "-A"]);

  const stagedDiffStatus = runQuiet("git", ["diff", "--cached", "--quiet"]);

  if (stagedDiffStatus !== 0) {
    const message = `chore: build and push ${isoStamp()}`;
    console.log(`\n==> Committing changes: ${message}`);
    run("git", ["commit", "-m", message]);
  } else {
    console.log("\n==> No staged changes after build; skipping commit");
  }

  console.log("\n==> Pushing to remote");
  run("git", ["push"]);

  console.log("\nDone: build + push completed successfully.");
} catch (error) {
  console.error("\nShip failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}
