import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const outputDir = path.join(root, "performance", "reports");
const baselinePath = path.join(root, "performance", "sidebar-baseline.json");
const reportPath = path.join(outputDir, "sidebar-latest.json");
const updateBaseline = process.argv.includes("--update-baseline");
const devUrl = process.env.ELECTRON_DEV_URL || "http://localhost:5000";
const electronExe = path.join(root, "node_modules", "electron", "dist", "electron.exe");

fs.mkdirSync(outputDir, { recursive: true });
for (const suffix of ["", ".startup"]) fs.rmSync(`${reportPath}${suffix}`, { force: true });

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

let viteProcess;
if (!(await waitForServer(devUrl, 1_000))) {
  console.log(`Starting Vite at ${devUrl} ...`);
  const url = new URL(devUrl);
  const command = `npm run dev -- --host ${url.hostname} --port ${url.port || 5000}`;
  viteProcess = spawn("cmd.exe", ["/d", "/s", "/c", command], {
    cwd: root,
    stdio: "ignore",
    windowsHide: true,
  });
  if (!(await waitForServer(devUrl))) throw new Error(`Vite did not become ready at ${devUrl}`);
}

if (!fs.existsSync(electronExe)) throw new Error(`Electron executable not found: ${electronExe}`);

const electronProcess = spawn(electronExe, [root], {
  cwd: root,
  stdio: "ignore",
  windowsHide: true,
  env: {
    ...process.env,
    ELECTRON_DEV: "1",
    ELECTRON_DEV_URL: devUrl,
    ELECTRON_NO_DEVTOOLS: "1",
    ELECTRON_E2E_EXIT: "1",
    ELECTRON_PERF_SIDEBAR_REPORT: reportPath,
  },
});

const exitCode = await new Promise((resolve, reject) => {
  electronProcess.once("error", reject);
  electronProcess.once("exit", resolve);
});
if (viteProcess) viteProcess.kill();
if (!fs.existsSync(reportPath)) {
  throw new Error(`Electron exited (${exitCode}) without producing a report. Close any other development instance and retry.`);
}

const raw = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const round = (value) => Math.round(value * 10) / 10;
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const summary = raw.tabs.map((tab) => ({
  id: tab.id,
  label: tab.label,
  coldPaintMs: round(tab.samples[0].firstPaintMs),
  warmPaintMedianMs: round(median(tab.samples.slice(1).map((sample) => sample.firstPaintMs))),
  warmSettledMedianMs: round(median(tab.samples.slice(1).map((sample) => sample.settledMs))),
  maxDispatchMs: round(Math.max(...tab.samples.map((sample) => sample.dispatchMs))),
  maxMutations: Math.max(...tab.samples.map((sample) => sample.mutations)),
}));

console.table(summary);

if (updateBaseline || !fs.existsSync(baselinePath)) {
  const baseline = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    regressionAllowance: { ratio: 1.35, fixedMs: 25 },
    hardLimits: { warmPaintMs: 2000, warmSettledMs: 3000, dispatchMs: 100 },
    tabs: Object.fromEntries(summary.map((tab) => [tab.id, tab])),
  };
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  console.log(`Baseline ${updateBaseline ? "updated" : "created"}: ${baselinePath}`);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const failures = [];
for (const current of summary) {
  const previous = baseline.tabs[current.id];
  if (!previous) {
    failures.push(`${current.label}: missing from baseline (run npm run perf:sidebar:update intentionally)`);
    continue;
  }
  for (const [metric, hardLimit] of [
    ["warmPaintMedianMs", baseline.hardLimits.warmPaintMs],
    ["warmSettledMedianMs", baseline.hardLimits.warmSettledMs],
    ["maxDispatchMs", baseline.hardLimits.dispatchMs],
  ]) {
    const regressionLimit = previous[metric] * baseline.regressionAllowance.ratio + baseline.regressionAllowance.fixedMs;
    const limit = Math.min(hardLimit, regressionLimit);
    if (current[metric] > limit) failures.push(`${current.label}: ${metric} ${current[metric]}ms > ${round(limit)}ms`);
  }
}

if (!raw.passed) failures.push(raw.error || "Electron navigation validation failed");
if (failures.length) {
  console.error("\nPerformance regressions:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`\nPASS: ${summary.length} visible sidebar tabs, no regression.`);
}
