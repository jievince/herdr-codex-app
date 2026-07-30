import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadState } from "../src/lib.mjs";

test("uses empty state when the app has no persisted state", () => {
  withStateDirectory(() => {
    assert.deepEqual(loadState(), {
      version: 3,
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
    assert.equal(state.version, 3);
    assert.equal(state.projects["/project/a"].workspaceId, "w1");
    assert.equal(state.threads.a1.paneId, "w1:p1");
  });
});

function withStateDirectory(callback) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "herdr-codex-app-state-"),
  );
  const previous = process.env.HERDR_PLUGIN_STATE_DIR;
  process.env.HERDR_PLUGIN_STATE_DIR = directory;
  try {
    callback(directory);
  } finally {
    if (previous === undefined) {
      delete process.env.HERDR_PLUGIN_STATE_DIR;
    } else {
      process.env.HERDR_PLUGIN_STATE_DIR = previous;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
