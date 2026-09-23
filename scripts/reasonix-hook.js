#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const PATH_KEYS = /^(?:path|file|file_path|filepath|source_path|destination_path|target_path)$/i;
const PROTECTED_PATHS = [
  /^AGENTS\.md$/,
  /^DEVELOPMENT\.md$/,
  /^harness\//,
  /^standards\//,
  /^templates\//,
  /^迭代索引\/snapshots\//,
];

function readPayload() {
  const input = fs.readFileSync(0, "utf8").trim();
  if (!input) {
    throw new Error("Reasonix hook received an empty payload");
  }
  return JSON.parse(input);
}

function run(command, args) {
  return spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 8000,
  });
}

function relativeProjectPath(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const absolute = path.isAbsolute(value) ? path.normalize(value) : path.resolve(ROOT, value);
  const relative = path.relative(ROOT, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join("/");
}

function collectPaths(value, key = "", out = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectPaths(item, key, out);
    return out;
  }
  if (!value || typeof value !== "object") {
    if (PATH_KEYS.test(key)) {
      const relative = relativeProjectPath(value);
      if (relative) out.add(relative);
    }
    return out;
  }
  for (const [childKey, childValue] of Object.entries(value)) {
    collectPaths(childValue, childKey, out);
  }
  return out;
}

function commandFrom(args) {
  if (!args || typeof args !== "object") return "";
  return [args.command, args.cmd].find((value) => typeof value === "string") || "";
}

function commandVerdict(command) {
  if (!command.trim()) return null;
  const hardBlocks = [
    [/(?:^|[;&|]\s*)git\s+add\s+(?:-A|--all|\.)(?:\s|$)/i, "bulk staging is forbidden; stage explicit paths"],
    [/\bgit\s+reset\s+--hard\b/i, "git reset --hard can destroy unrelated worktree changes"],
    [/\bgit\s+clean\s+-[^\s]*f/i, "git clean can delete untracked user files"],
    [/\bgit\s+checkout\s+--\b/i, "git checkout -- can discard user changes"],
    [/\bgit\s+restore\s+(?:--worktree\s+)?\.\s*(?:$|[;&|])/i, "git restore . can discard unrelated changes"],
    [/\brm\s+-[^\s]*r[^\s]*f|\brm\s+-[^\s]*f[^\s]*r/i, "recursive forced deletion is forbidden"],
  ];
  for (const [pattern, reason] of hardBlocks) {
    if (pattern.test(command)) return { level: "block", reason };
  }
  if (/\bgit\s+push\b/i.test(command) && !/\bPROTO_HARNESS_ALLOW_PUSH=1\b/.test(command)) {
    return {
      level: "block",
      reason: "git push may invoke the repository pre-push hook and create a commit; re-run with PROTO_HARNESS_ALLOW_PUSH=1 only after explicit review",
    };
  }
  if (/\bnpm\s+run\s+check:ui(?:\s|$)/i.test(command) && !/check:ui:readonly/i.test(command)) {
    return {
      level: "warn",
      reason: "npm run check:ui can write page registration; prefer npm run check:ui:readonly unless write-back is explicitly required",
    };
  }
  return null;
}

function isProtected(relativePath) {
  return PROTECTED_PATHS.some((pattern) => pattern.test(relativePath));
}

function worktreeSummary() {
  const result = run("git", ["status", "--short", "--untracked-files=all"]);
  if (result.status !== 0) return "worktree status unavailable";
  const lines = result.stdout.split(/\r?\n/).filter(Boolean);
  const untracked = lines.filter((line) => line.startsWith("??")).length;
  return `${lines.length} changed entries (${untracked} untracked)`;
}

function onSessionStart() {
  process.stdout.write(`proto-harness bootstrap (thin pointer; not a parallel rule set):
- Canonical project entry: AGENTS.md. Read it and memory/MEMORY.md before acting.
- Follow AGENTS.md routing for the business brain, Harness, repository skills, and current-turn authorization.
- Reclassify every latest user message as discussion, execution, diagnosis, or governance; old authorization does not carry forward.
- Before edits, classify the dirty worktree and protect unrelated changes. Current snapshot: ${worktreeSummary()}.
- Visible replies must start with \u201c\u5c71\u201d and default to Chinese.
`);
}

function onPreCompact() {
  process.stdout.write(
    "Preserve exact current-turn authorization, task state, user corrections, target and forbidden files, " +
      "dirty-worktree classification, clone-source, change-type, page adjustment contract when applicable, " +
      "validation commands/results, existing-vs-new issues, unresolved items, and the next safe action. " +
      "Do not convert executor claims or unverified relay material into facts."
  );
}

function onPreToolUse(payload) {
  const command = commandFrom(payload.toolArgs);
  const verdict = commandVerdict(command);
  if (verdict) {
    console.error(`[proto-harness hook] ${verdict.reason}\nCommand: ${command}`);
    process.exit(verdict.level === "block" ? 2 : 1);
  }

  const protectedPaths = [...collectPaths(payload.toolArgs)].filter(isProtected);
  if (protectedPaths.length) {
    console.error(
      "[proto-harness hook] protected path warning: confirm current-turn authorization and the execution gate before continuing:\n" +
        protectedPaths.map((item) => `- ${item}`).join("\n")
    );
    process.exit(1);
  }
}

function checkJSON(relativePath) {
  try {
    JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
    return null;
  } catch (error) {
    return `${relativePath}: invalid JSON: ${error.message}`;
  }
}

function checkNodeSyntax(relativePath) {
  const result = run(process.execPath, ["--check", relativePath]);
  if (result.status === 0) return null;
  return `${relativePath}: JavaScript syntax check failed\n${(result.stderr || result.stdout).trim()}`;
}

function checkDiffWhitespace(relativePaths) {
  if (!relativePaths.length) return null;
  const result = run("git", ["diff", "--check", "--", ...relativePaths]);
  if (result.status === 0) return null;
  return `git diff --check failed\n${(result.stdout || result.stderr).trim()}`;
}

function onPostToolUse(payload) {
  const paths = [...collectPaths(payload.toolArgs)].filter((relativePath) => {
    try {
      return fs.statSync(path.join(ROOT, relativePath)).isFile();
    } catch {
      return false;
    }
  });
  if (!paths.length) return;

  const failures = [];
  const whitespaceFailure = checkDiffWhitespace(paths);
  if (whitespaceFailure) failures.push(whitespaceFailure);

  for (const relativePath of paths) {
    const extension = path.extname(relativePath).toLowerCase();
    if (extension === ".json") {
      const failure = checkJSON(relativePath);
      if (failure) failures.push(failure);
    } else if ([".js", ".cjs", ".mjs"].includes(extension)) {
      const failure = checkNodeSyntax(relativePath);
      if (failure) failures.push(failure);
    }
  }

  if (failures.length) {
    console.error(`[proto-harness hook] narrow post-edit validation failed:\n${failures.join("\n\n")}`);
    process.exit(1);
  }
}

function runSelfTest() {
  assert.equal(commandVerdict("git add -A").level, "block");
  assert.equal(commandVerdict("git add ./README.md"), null);
  assert.equal(commandVerdict("git push origin main").level, "block");
  assert.equal(commandVerdict("PROTO_HARNESS_ALLOW_PUSH=1 git push origin main"), null);
  assert.equal(commandVerdict("npm run check:ui").level, "warn");
  assert.equal(commandVerdict("npm run check:ui:readonly"), null);
  assert.deepEqual([...collectPaths({ edits: [{ file_path: "standards/doc-spec.json" }] })], [
    "standards/doc-spec.json",
  ]);
  assert.equal(isProtected("standards/doc-spec.json"), true);
  assert.equal(isProtected("scripts/reasonix-hook.js"), false);
  console.log("reasonix-hook self-test: ok");
}

function main() {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
    return;
  }

  let payload;
  try {
    payload = readPayload();
  } catch (error) {
    console.error(`[proto-harness hook] ${error.message}`);
    process.exit(1);
  }

  switch (payload.event) {
    case "SessionStart":
      onSessionStart();
      break;
    case "PreToolUse":
      onPreToolUse(payload);
      break;
    case "PostToolUse":
      onPostToolUse(payload);
      break;
    case "PreCompact":
      onPreCompact();
      break;
    default:
      console.error(`[proto-harness hook] unsupported event: ${payload.event || "<empty>"}`);
      process.exit(1);
  }
}

main();
