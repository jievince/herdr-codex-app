import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

import {
  PLACEHOLDER_AGENT,
  PLACEHOLDER_SOURCE,
  STATE_VERSION,
} from "./constants.mjs";

const LOCK_STALE_MS = 120_000;

function requireDirectory(variable) {
  const configured = process.env[variable];
  if (!configured) {
    throw new Error(`${variable} is required in the Herdr plugin runtime`);
  }
  fs.mkdirSync(configured, { recursive: true });
  return configured;
}

export function stateDirectory() {
  const root = requireDirectory("HERDR_PLUGIN_STATE_DIR");
  const socketPath = process.env.HERDR_SOCKET_PATH;
  if (!socketPath) {
    throw new Error("HERDR_SOCKET_PATH is required in the Herdr plugin runtime");
  }

  // Herdr object IDs are session-local, so every stateful artifact must be too.
  const sessionKey = createHash("sha256")
    .update(socketPath)
    .digest("hex");
  const directory = path.join(root, "sessions", sessionKey);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

export function configDirectory() {
  return requireDirectory("HERDR_PLUGIN_CONFIG_DIR");
}

export function runHerdr(args, options = {}) {
  const binary = process.env.HERDR_BIN_PATH;
  if (!binary) {
    throw new Error("HERDR_BIN_PATH is required in the Herdr plugin runtime");
  }
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    env: process.env,
    timeout: options.timeoutMs ?? 30_000,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`herdr ${args.join(" ")} failed (${result.status}): ${detail}`);
  }

  const stdout = result.stdout.trim();
  if (options.parseJson === false) {
    return stdout;
  }
  if (!stdout) {
    return null;
  }
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`herdr returned invalid JSON: ${error.message}`);
  }
}

export function loadConfig() {
  const defaults = {
    maxIndexedChats: 40,
    maxIndexedChatsPerProject: 8,
    maxActiveTuis: 8,
    codexRemoteEndpoint: "unix://",
    sourceKinds: ["cli", "vscode", "appServer"],
  };
  const configPath = path.join(configDirectory(), "config.json");
  if (!fs.existsSync(configPath)) {
    return defaults;
  }

  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return {
    maxIndexedChats: positiveInteger(
      parsed.maxIndexedChats,
      defaults.maxIndexedChats,
    ),
    maxIndexedChatsPerProject: positiveInteger(
      parsed.maxIndexedChatsPerProject,
      defaults.maxIndexedChatsPerProject,
    ),
    maxActiveTuis: positiveInteger(
      parsed.maxActiveTuis,
      defaults.maxActiveTuis,
    ),
    codexRemoteEndpoint:
      typeof parsed.codexRemoteEndpoint === "string" &&
      parsed.codexRemoteEndpoint.trim().length > 0
        ? parsed.codexRemoteEndpoint.trim()
        : defaults.codexRemoteEndpoint,
    sourceKinds:
      Array.isArray(parsed.sourceKinds) && parsed.sourceKinds.length > 0
        ? parsed.sourceKinds.map(String)
        : defaults.sourceKinds,
  };
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function emptyState() {
  return { version: STATE_VERSION, projects: {}, threads: {} };
}

export function loadState() {
  const statePath = path.join(stateDirectory(), "index.json");
  return loadStatePath(statePath);
}

export function loadStateForSync() {
  const currentPath = path.join(stateDirectory(), "index.json");
  if (fs.existsSync(currentPath)) {
    return loadStatePath(currentPath);
  }

  // Legacy state is migration input only; writes always stay session-scoped.
  const legacyPath = path.join(
    requireDirectory("HERDR_PLUGIN_STATE_DIR"),
    "index.json",
  );
  return loadStatePath(legacyPath);
}

function loadStatePath(statePath) {
  if (!fs.existsSync(statePath)) {
    return emptyState();
  }

  return normalizeState(JSON.parse(fs.readFileSync(statePath, "utf8")));
}

function normalizeState(parsed) {
  return {
    version: STATE_VERSION,
    projects:
      parsed.projects && typeof parsed.projects === "object"
        ? parsed.projects
        : {},
    threads:
      parsed.threads && typeof parsed.threads === "object"
        ? parsed.threads
        : {},
  };
}

export function saveState(state) {
  const directory = stateDirectory();
  const statePath = path.join(directory, "index.json");
  const temporaryPath = path.join(
    directory,
    `index.${process.pid}.${randomUUID()}.tmp`,
  );
  fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.renameSync(temporaryPath, statePath);
}

export async function updateState(mutator) {
  const result = await withLock(
    "state",
    async () => {
      const state = loadState();
      const value = await mutator(state);
      saveState(state);
      return value;
    },
    { waitMs: 5_000 },
  );
  if (result?.skipped) {
    throw new Error("timed out waiting for the plugin state lock");
  }
  return result;
}

export async function withLock(name, callback, options = {}) {
  const lockPath = path.join(stateDirectory(), `${name}.lock`);
  const waitMs = Math.max(0, Number(options.waitMs) || 0);
  const deadline = Date.now() + waitMs;
  const owner = {
    pid: process.pid,
    createdAt: Date.now(),
    token: randomUUID(),
  };

  let descriptor;
  while (descriptor === undefined) {
    recoverStaleLock(lockPath);
    try {
      descriptor = fs.openSync(lockPath, "wx", 0o600);
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
      if (Date.now() >= deadline) {
        return { skipped: true };
      }
      await delay(50);
    }
  }

  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(owner)}\n`);
    return await callback();
  } finally {
    fs.closeSync(descriptor);
    releaseOwnedLock(lockPath, owner.token);
  }
}

export function recoverStaleLock(
  lockPath,
  {
    now = Date.now(),
    staleMs = LOCK_STALE_MS,
    isAlive = isProcessAlive,
  } = {},
) {
  let stat;
  let raw;
  try {
    stat = fs.statSync(lockPath);
    raw = fs.readFileSync(lockPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }

  const owner = parseLockOwner(raw);
  if (owner && isAlive(owner.pid)) {
    return false;
  }

  // A valid dead owner is definitive. Corrupt content needs an age guard.
  if (!owner && now - stat.mtimeMs <= staleMs) {
    return false;
  }

  try {
    fs.unlinkSync(lockPath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function parseLockOwner(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (
      Number.isInteger(parsed.pid) &&
      parsed.pid > 0 &&
      typeof parsed.token === "string" &&
      parsed.token.length > 0
    ) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") {
      return false;
    }
    if (error.code === "EPERM") {
      return true;
    }
    throw error;
  }
}

function releaseOwnedLock(lockPath, token) {
  try {
    const owner = parseLockOwner(fs.readFileSync(lockPath, "utf8"));
    if (owner?.token === token) {
      fs.unlinkSync(lockPath);
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

export function reportPlaceholder(paneId) {
  // The placeholder owns only the sidebar row; the thread id stays in metadata.
  runHerdr([
    "pane",
    "report-agent",
    paneId,
    "--source",
    PLACEHOLDER_SOURCE,
    "--agent",
    PLACEHOLDER_AGENT,
    "--state",
    "idle",
  ]);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function threadTitle(thread) {
  const source =
    thread.name || thread.preview || `Codex ${String(thread.id).slice(0, 8)}`;
  const normalized = String(source).replace(/\s+/g, " ").trim();
  return truncateDisplay(normalized, 72);
}

export function projectLabel(cwd, usedLabels) {
  const base = path.basename(cwd) || cwd;
  if (!usedLabels.has(base)) {
    return truncateDisplay(base, 60);
  }

  const parent = path.basename(path.dirname(cwd));
  return truncateDisplay(`${parent}/${base}`, 60);
}

export function codexAgentName(threadId) {
  const compact = String(threadId).toLowerCase().replace(/[^a-z0-9]/g, "");
  return `codex-${compact.slice(0, 24)}`;
}

export function normalizeCwd(cwd) {
  if (!cwd || typeof cwd !== "string") {
    return null;
  }
  return path.resolve(cwd);
}

export function projectCwdToken(cwd) {
  const normalized = normalizeCwd(cwd);
  if (!normalized) {
    throw new Error("project cwd is required");
  }
  return `sha256:${createHash("sha256").update(normalized).digest("hex")}`;
}

export function paneIdFromEvent() {
  if (process.env.HERDR_PANE_ID) {
    return process.env.HERDR_PANE_ID;
  }

  for (const variable of [
    "HERDR_PLUGIN_CONTEXT_JSON",
    "HERDR_PLUGIN_EVENT_JSON",
  ]) {
    const raw = process.env[variable];
    if (!raw) {
      continue;
    }
    try {
      const paneId = findPaneId(JSON.parse(raw));
      if (paneId) {
        return paneId;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function findPaneId(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  if (typeof value.pane_id === "string") {
    return value.pane_id;
  }
  if (typeof value.paneId === "string") {
    return value.paneId;
  }
  for (const child of Object.values(value)) {
    const found = findPaneId(child);
    if (found) {
      return found;
    }
  }
  return null;
}

function truncateDisplay(value, limit) {
  const characters = Array.from(value);
  if (characters.length <= limit) {
    return value;
  }
  return `${characters.slice(0, limit - 1).join("")}…`;
}
