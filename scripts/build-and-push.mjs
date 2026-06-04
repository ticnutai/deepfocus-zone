import { spawnSync } from "node:child_process";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
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
  const result = spawnSync(command, args, {
    stdio: "ignore",
    shell: false,
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
