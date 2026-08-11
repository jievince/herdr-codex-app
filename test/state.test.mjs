import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadState,
  loadStateForSync,
  saveState,
  stateDirectory,
} from "../src/lib.mjs";

test("uses empty state when the app has no persisted state", () => {
  withStateDirectory(() => {
    assert.deepEqual(loadState(), {
      version: 4,
      projects: {},
      threads: {},
    });
  });
});

test("loads and normalizes the app's persisted state", () => {
  withStateDirectory((directory) => {
    fs.writeFileSync(
      path.join(directory, "index.json"),
      `${JSON.stringify({
        version: 2,
        projects: {
          "/project/a": { workspaceId: "w1", managed: true },
        },
        threads: {
          a1: {
            workspaceId: "w1",
            tabId: "w1:t1",
            paneId: "w1:p1",
          },
        },
      })}\n`,
    );

    const state = loadState();
    assert.equal(state.version, 4);
    assert.equal(state.projects["/project/a"].workspaceId, "w1");
    assert.equal(state.threads.a1.paneId, "w1:p1");
  });
});

test("keeps state and runtime artifacts isolated by Herdr socket", () => {
  withStateDirectory((directory, root) => {
    const firstDirectory = stateDirectory();
    saveState({ version: 4, projects: {}, threads: { first: {} } });
    fs.writeFileSync(path.join(firstDirectory, "sync.lock"), "first\n");
    fs.writeFileSync(
      path.join(firstDirectory, "last-sync-succeeded-at"),
      "1000\n",
    );

    process.env.HERDR_SOCKET_PATH = path.join(root, "second.sock");
    const secondDirectory = stateDirectory();
    assert.notEqual(secondDirectory, firstDirectory);
    assert.deepEqual(loadState(), {
      version: 4,
      projects: {},
      threads: {},
    });
    assert.equal(fs.existsSync(path.join(secondDirectory, "sync.lock")), false);
    assert.equal(
      fs.existsSync(path.join(secondDirectory, "last-sync-succeeded-at")),
      false,
    );
  });
});

test("uses legacy state only as first-sync migration input", () => {
  withStateDirectory((directory, root) => {
    const legacy = {
      version: 3,
      projects: {},
      threads: { legacy: { paneId: "w1:p1" } },
    };
    fs.writeFileSync(
      path.join(root, "index.json"),
      `${JSON.stringify(legacy)}\n`,
    );

    assert.deepEqual(loadState().threads, {});
    assert.equal(loadStateForSync().threads.legacy.paneId, "w1:p1");

    saveState({ version: 4, projects: {}, threads: { current: {} } });
    assert.deepEqual(Object.keys(loadStateForSync().threads), ["current"]);
    assert.equal(fs.existsSync(path.join(directory, "index.json")), true);
  });
});

function withStateDirectory(callback) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "herdr-codex-app-state-"),
  );
  const previous = process.env.HERDR_PLUGIN_STATE_DIR;
  const previousSocket = process.env.HERDR_SOCKET_PATH;
  process.env.HERDR_PLUGIN_STATE_DIR = directory;
  process.env.HERDR_SOCKET_PATH = path.join(directory, "first.sock");
  try {
    return callback(stateDirectory(), directory);
  } finally {
    if (previous === undefined) {
      delete process.env.HERDR_PLUGIN_STATE_DIR;
    } else {
      process.env.HERDR_PLUGIN_STATE_DIR = previous;
    }
    if (previousSocket === undefined) {
      delete process.env.HERDR_SOCKET_PATH;
    } else {
      process.env.HERDR_SOCKET_PATH = previousSocket;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
