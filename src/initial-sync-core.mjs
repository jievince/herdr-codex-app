import fs from "node:fs";
import path from "node:path";

import { PLUGIN_ID } from "./constants.mjs";
import {
  runHerdr,
  stateDirectory,
  withLock,
} from "./lib.mjs";

export const INITIAL_SYNC_RETRY_COOLDOWN_MS = 30_000;

const LAST_REQUEST_FILE = "initial-sync-requested-at";
const LAST_SUCCESS_FILE = "last-sync-succeeded-at";

export async function requestInitialSync({
  now = Date.now(),
  retryCooldownMs = INITIAL_SYNC_RETRY_COOLDOWN_MS,
  invoke = invokeSyncAction,
} = {}) {
  return withLock("initial-sync-request", async () => {
    // Pane focus is only a first-run recovery path; successful installations
    // refresh later through startup or an explicit plugin action.
    if (readTimestamp(LAST_SUCCESS_FILE) > 0) {
      return { requested: false, reason: "already-synced" };
    }

    const lastRequest = readTimestamp(LAST_REQUEST_FILE);
    if (lastRequest > 0 && now - lastRequest < retryCooldownMs) {
      return { requested: false, reason: "cooldown" };
    }

    // Do not enqueue an action that is already running under the sync lock.
    const syncGate = await withLock("sync", () => true);
    if (syncGate?.skipped) {
      return { requested: false, reason: "sync-running" };
    }

    invoke();
    writeTimestamp(LAST_REQUEST_FILE, now);
    return { requested: true };
  });
}

export function recordSyncSuccess(now = Date.now()) {
  writeTimestamp(LAST_SUCCESS_FILE, now);
}

function invokeSyncAction() {
  runHerdr([
    "plugin",
    "action",
    "invoke",
    `${PLUGIN_ID}.sync`,
  ]);
}

function readTimestamp(filename) {
  try {
    const value = Number(
      fs.readFileSync(path.join(stateDirectory(), filename), "utf8").trim(),
    );
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch (error) {
    if (error.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

function writeTimestamp(filename, value) {
  fs.writeFileSync(
    path.join(stateDirectory(), filename),
    `${value}\n`,
    { mode: 0o600 },
  );
}
