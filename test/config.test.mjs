import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "../src/lib.mjs";

const defaults = {
  maxIndexedChats: 40,
  maxIndexedChatsPerProject: 8,
  maxActiveTuis: 8,
  codexRemoteEndpoint: "unix://",
  sourceKinds: ["cli", "vscode", "appServer"],
};

test("uses documented defaults when config.json is absent", () => {
  withConfigDirectory(() => {
    assert.deepEqual(loadConfig(), defaults);
  });
});

test("loads all documented user configuration fields", () => {
  withConfigDirectory((directory) => {
    fs.writeFileSync(
      path.join(directory, "config.json"),
      `${JSON.stringify({
        maxIndexedChats: 20,
        maxIndexedChatsPerProject: 4,
        maxActiveTuis: 3,
        codexRemoteEndpoint: "unix:///tmp/codex.sock",
        sourceKinds: ["cli"],
      })}\n`,
    );

    assert.deepEqual(loadConfig(), {
      maxIndexedChats: 20,
      maxIndexedChatsPerProject: 4,
      maxActiveTuis: 3,
      codexRemoteEndpoint: "unix:///tmp/codex.sock",
      sourceKinds: ["cli"],
    });
  });
});

function withConfigDirectory(callback) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "herdr-codex-app-config-"),
  );
  const previous = process.env.HERDR_PLUGIN_CONFIG_DIR;
  process.env.HERDR_PLUGIN_CONFIG_DIR = directory;
  try {
    callback(directory);
  } finally {
    if (previous === undefined) {
      delete process.env.HERDR_PLUGIN_CONFIG_DIR;
    } else {
      process.env.HERDR_PLUGIN_CONFIG_DIR = previous;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
