#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function parseArgs(argv) {
  const args = {
    source: "all",
    dryRun: false,
    joshuaFrom: 2,
    joshuaTo: 11,
    joshuaCount: 10,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const val = argv[i + 1];

    if (key === "--source" && val) args.source = val;
    if (key === "--dry-run") args.dryRun = true;
    if (key === "--joshua-from" && val) args.joshuaFrom = Number(val);
    if (key === "--joshua-to" && val) args.joshuaTo = Number(val);
    if (key === "--joshua-count" && val) args.joshuaCount = Number(val);
  }

  return args;
}

function runStep(name, command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`\n==> ${name}`);
    console.log(`$ ${command} ${args.join(" ")}`);

    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: { ...process.env, ...(options.env || {}) },
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${name} failed with exit code ${code}`));
    });
  });
}

function hasAnthropicKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim());
}

async function runJoshua(args, dryRun) {
  const stepName = "Generate Joshua builtins (AI + Sefaria)";
  const cmd = "node";
  const cmdArgs = [
    "scripts/generate-joshua-builtins.mjs",
    "--from",
    String(args.joshuaFrom),
    "--to",
    String(args.joshuaTo),
    "--count",
    String(args.joshuaCount),
  ];

  if (dryRun) {
    console.log(`\n==> ${stepName}`);
    console.log(`[dry-run] $ ${cmd} ${cmdArgs.join(" ")}`);
    return;
  }

  if (!hasAnthropicKey()) {
    console.log(`\n==> ${stepName}`);
    console.log("Skipped: ANTHROPIC_API_KEY is not set.");
    return;
  }

  await runStep(stepName, cmd, cmdArgs);
}

async function runYeshiva(dryRun) {
  const cmd = "python";
  const cmdArgs = [
    "export_yeshiva/scripts/scrape_yeshiva_questions.py",
    "--output",
    "output/yeshiva_questions.json",
  ];

  if (dryRun) {
    console.log("\n==> Scrape Yeshiva questions");
    console.log(`[dry-run] $ ${cmd} ${cmdArgs.join(" ")}`);
    return;
  }

  await runStep("Scrape Yeshiva questions", cmd, cmdArgs);
}

async function runShemesh(dryRun) {
  const cmd = "python";
  const cmdArgs = ["export_for_friend/scripts/scrape_shemesh_questions.py"];

  if (dryRun) {
    console.log("\n==> Scrape Shemesh questions");
    console.log(`[dry-run] $ ${cmd} ${cmdArgs.join(" ")}`);
    return;
  }

  await runStep("Scrape Shemesh questions", cmd, cmdArgs);
}

async function runNeviim(dryRun) {
  const cmd = "python";
  const cmdArgs = [
    "scripts/scrape_neviim_questions.py",
    "--sources",
    "scripts/neviim_sources.json",
    "--out",
    "output/neviim_questions/questions.json",
    "--csv-out",
    "output/neviim_questions/questions.csv",
    "--resources-out",
    "output/neviim_questions/resource_links.json",
    "--report",
    "output/neviim_questions/report.json",
  ];

  if (dryRun) {
    console.log("\n==> Scrape Neviim questions");
    console.log(`[dry-run] $ ${cmd} ${cmdArgs.join(" ")}`);
    return;
  }

  await runStep("Scrape Neviim questions", cmd, cmdArgs);
}

function ensureOutputDirs() {
  const dirs = [
    path.join(ROOT, "output"),
    path.join(ROOT, "output", "neviim_questions"),
  ];
  dirs.forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

function parseSources(value) {
  if (!value || value === "all") return ["joshua", "yeshiva", "shemesh", "neviim"];
  const allowed = new Set(["joshua", "yeshiva", "shemesh", "neviim"]);
  const picks = value
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

  for (const pick of picks) {
    if (!allowed.has(pick)) {
      throw new Error(`Unknown source: ${pick}. Allowed: all|joshua|yeshiva|shemesh|neviim`);
    }
  }

  return picks;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const selectedSources = parseSources(args.source);

  ensureOutputDirs();

  console.log("Community quiz pipeline");
  console.log(`sources: ${selectedSources.join(", ")}`);
  console.log(`dry-run: ${args.dryRun ? "yes" : "no"}`);

  for (const source of selectedSources) {
    if (source === "joshua") await runJoshua(args, args.dryRun);
    if (source === "yeshiva") await runYeshiva(args.dryRun);
    if (source === "shemesh") await runShemesh(args.dryRun);
    if (source === "neviim") await runNeviim(args.dryRun);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
