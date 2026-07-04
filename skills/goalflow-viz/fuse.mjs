#!/usr/bin/env node
import fs from "fs";
import path from "path";
import childProcess from "child_process";
import { fileURLToPath } from "url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const rootDir = path.resolve(scriptDir, "../..");

function usage() {
  return "Usage: node skills/goalflow-viz/fuse.mjs <slug> [--out <path>] [--open] [--since <ISO8601>]";
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    slugArg: null,
    out: null,
    open: false,
    since: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--open") {
      options.open = true;
      continue;
    }

    if (arg === "--out" || arg === "--since") {
      const value = argv[i + 1];
      if (!value) fail(`${arg} requires a value\n${usage()}`);
      if (arg === "--out") options.out = value;
      if (arg === "--since") options.since = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("--out=")) {
      options.out = arg.slice("--out=".length);
      continue;
    }

    if (arg.startsWith("--since=")) {
      options.since = arg.slice("--since=".length);
      continue;
    }

    if (arg.startsWith("-")) fail(`unknown option: ${arg}\n${usage()}`);
    if (options.slugArg) fail(`unexpected argument: ${arg}\n${usage()}`);
    options.slugArg = arg;
  }

  if (!options.slugArg) fail(usage());
  return options;
}

function deriveSlug(input) {
  const parts = String(input).trim().replace(/\\/g, "/").split("/").filter(Boolean);
  let slug = parts.length ? parts[parts.length - 1] : "";

  if (slug.endsWith(".tasks.json")) {
    slug = slug.slice(0, -".tasks.json".length);
  } else if (slug.endsWith(".md")) {
    slug = slug.slice(0, -".md".length);
  }

  if (!slug) fail(`could not derive slug from: ${input}`);
  return slug;
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (!trimmed) return value;

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function objectOrNull(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function stringifyForSearch(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeTargets(targets) {
  return Array.isArray(targets) ? targets.filter((target) => typeof target === "string" && target.length > 0) : [];
}

function fileMtimeAtOrAfter(filePath, runWindowMs) {
  try {
    return fs.statSync(filePath).mtimeMs >= runWindowMs;
  } catch {
    return false;
  }
}

function gitCommittedSince(targets, sinceIso) {
  if (targets.length === 0) return false;

  const result = childProcess.spawnSync(
    "git",
    ["log", `--since=${sinceIso}`, "--format=%H", "--", ...targets],
    {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  if (result.error || result.status !== 0) return false;
  return result.stdout.trim().length > 0;
}

function collectWorkflowFiles(projectsRoot) {
  const files = [];

  function visit(dirPath) {
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }

      if (
        entry.isFile() &&
        path.basename(path.dirname(fullPath)) === "workflows" &&
        entry.name.startsWith("wf_") &&
        entry.name.endsWith(".json")
      ) {
        files.push(fullPath);
      }
    }
  }

  visit(projectsRoot);
  return files;
}

function isVerifyWorkflow(workflow) {
  const workflowName = typeof workflow.workflowName === "string" ? workflow.workflowName : "";
  const summary = stringifyForSearch(workflow.summary);
  return workflowName === "goal-exec-verify" || summary.includes("goal-exec-verify");
}

function verdictFromResult(result) {
  const highSeverity = Array.isArray(result.highSeverity) ? result.highSeverity : [];
  return result.consensusMatch === true && highSeverity.length === 0 ? "verified" : "failed";
}

function loadVerifyVerdicts(runWindowMs) {
  const projectsRoot = path.join(rootDir, "projects", "-Users-ooizumiyou--claude");
  const latestByTask = new Map();

  for (const filePath of collectWorkflowFiles(projectsRoot)) {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }

    if (stat.mtimeMs < runWindowMs) continue;

    let workflow;
    try {
      workflow = readJsonFile(filePath);
    } catch {
      continue;
    }

    if (!objectOrNull(workflow) || !isVerifyWorkflow(workflow)) continue;

    const args = objectOrNull(parseMaybeJson(workflow.args));
    const result = objectOrNull(parseMaybeJson(workflow.result));
    if (!result) continue;

    const taskIds = new Set();
    if (args && typeof args.taskId === "string") taskIds.add(args.taskId);
    if (typeof result.taskId === "string") taskIds.add(result.taskId);
    if (taskIds.size === 0) continue;

    const verdict = verdictFromResult(result);
    for (const taskId of taskIds) {
      const previous = latestByTask.get(taskId);
      if (!previous || stat.mtimeMs >= previous.mtimeMs) {
        latestByTask.set(taskId, { verdict, mtimeMs: stat.mtimeMs, filePath });
      }
    }
  }

  return latestByTask;
}

function statusForTask(task, runWindowMs, runWindowIso, verifyVerdicts) {
  const id = typeof task.id === "string" ? task.id : "";
  const targets = normalizeTargets(task.targets);

  const verifyVerdict = id ? verifyVerdicts.get(id)?.verdict : null;
  if (verifyVerdict) return verifyVerdict;

  if (gitCommittedSince(targets, runWindowIso)) return "committed";

  const codexOutPath = path.join(rootDir, ".codex-out", `${id}.md`);
  if (id && fileMtimeAtOrAfter(codexOutPath, runWindowMs)) return "running";

  return "pending";
}

function injectGraphData(rendererHtml, graphData) {
  const graphJson = JSON.stringify(graphData, null, 2).replace(/</g, "\\u003c");
  const graphScriptPattern =
    /<script\b(?=[^>]*\bid=(["'])graph-data\1)(?=[^>]*\btype=(["'])application\/json\2)[^>]*>[\s\S]*?<\/script>/;

  if (!graphScriptPattern.test(rendererHtml)) {
    fail("renderer.html does not contain a graph-data application/json script");
  }

  return rendererHtml.replace(
    graphScriptPattern,
    `<script id="graph-data" type="application/json">${graphJson}</script>`
  );
}

function displayPath(filePath) {
  const relative = path.relative(process.cwd(), filePath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : filePath;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const slug = deriveSlug(options.slugArg);
  const tasksPath = path.join(rootDir, "docs", "plans", `${slug}.tasks.json`);

  if (!fs.existsSync(tasksPath)) {
    fail(`tasks.json not found: ${tasksPath}`);
  }

  let tasksStat;
  let tasksJson;
  try {
    tasksStat = fs.statSync(tasksPath);
    tasksJson = readJsonFile(tasksPath);
  } catch (error) {
    fail(`failed to read tasks.json: ${tasksPath}\n${error.message}`);
  }

  const runWindowMs = options.since ? Date.parse(options.since) : tasksStat.mtimeMs;
  if (!Number.isFinite(runWindowMs)) {
    fail(`invalid --since timestamp: ${options.since}`);
  }

  const runWindowIso = new Date(runWindowMs).toISOString();
  const verifyVerdicts = loadVerifyVerdicts(runWindowMs);
  const sourceTasks = Array.isArray(tasksJson.tasks) ? tasksJson.tasks : [];
  const tasks = sourceTasks.map((task) => {
    const sourceTask = objectOrNull(task) || {};
    return {
      ...sourceTask,
      status: statusForTask(sourceTask, runWindowMs, runWindowIso, verifyVerdicts),
    };
  });

  const graphData = {
    planSlug: typeof tasksJson.planSlug === "string" && tasksJson.planSlug ? tasksJson.planSlug : slug,
    generatedAt: tasksJson.generatedAt,
    runWindow: runWindowIso,
    tasks,
    edges: Array.isArray(tasksJson.edges) ? tasksJson.edges : [],
  };

  const rendererPath = path.join(scriptDir, "renderer.html");
  let rendererHtml;
  try {
    rendererHtml = fs.readFileSync(rendererPath, "utf8");
  } catch (error) {
    fail(`failed to read renderer.html: ${rendererPath}\n${error.message}`);
  }

  const outputHtml = injectGraphData(rendererHtml, graphData);
  const outPath = options.out
    ? path.resolve(process.cwd(), options.out)
    : path.join(rootDir, ".goalflow", "viz", `${slug}.html`);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, outputHtml, "utf8");

  console.log(displayPath(outPath));
  for (const task of tasks) {
    console.log(`${task.id}: ${task.status}`);
  }

  if (options.open) {
    childProcess.spawnSync("open", [outPath], { stdio: "inherit" });
  }
}

main();
