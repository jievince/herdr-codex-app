import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  recordSyncSuccess,
  requestInitialSync,
} from "../src/initial-sync-core.mjs";

test("pane focus requests sync only until the first success", async () => {
  await withStateDirectory(async () => {
    let invocations = 0;
    const invoke = () => {
      invocations += 1;
    };

    assert.deepEqual(
      await requestInitialSync({ now: 1_000, invoke }),
      { requested: true },
    );
    assert.deepEqual(
      await requestInitialSync({ now: 20_000, invoke }),
      { requested: false, reason: "cooldown" },
    );

    recordSyncSuccess(25_000);
    assert.deepEqual(
      await requestInitialSync({ now: 50_000, invoke }),
      { requested: false, reason: "already-synced" },
    );
    assert.deepEqual(
      await requestInitialSync({ now: 86_000, invoke }),
      { requested: false, reason: "already-synced" },
    );
    assert.equal(invocations, 1);
  });
});

test("does not enqueue initial sync while a refresh owns the lock", async () => {
  await withStateDirectory(async (directory) => {
    fs.writeFileSync(
      path.join(directory, "sync.lock"),
      `${JSON.stringify({
        pid: process.pid,
        createdAt: Date.now(),
        token: "active-sync",
      })}\n`,
    );
    let invoked = false;

    assert.deepEqual(
      await requestInitialSync({
        now: 1_000,
        invoke: () => {
          invoked = true;
        },
      }),
      { requested: false, reason: "sync-running" },
    );
    assert.equal(invoked, false);
  });
});

async function withStateDirectory(callback) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "herdr-codex-app-initial-sync-"),
  );
  const previous = process.env.HERDR_PLUGIN_STATE_DIR;
  process.env.HERDR_PLUGIN_STATE_DIR = directory;
  try {
    await callback(directory);
  } finally {
    if (previous === undefined) {
      delete process.env.HERDR_PLUGIN_STATE_DIR;
    } else {
      process.env.HERDR_PLUGIN_STATE_DIR = previous;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
