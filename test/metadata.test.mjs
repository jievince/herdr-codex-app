import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { PLUGIN_ID, PLUGIN_VERSION } from "../src/constants.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = fs.readFileSync(path.join(root, "herdr-plugin.toml"), "utf8");
const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const chineseReadme = fs.readFileSync(
  path.join(root, "README.zh-CN.md"),
  "utf8",
);
const releasing = fs.readFileSync(path.join(root, "RELEASING.md"), "utf8");

test("keeps plugin identity and version metadata aligned", () => {
  assert.equal(manifestValue("id"), PLUGIN_ID);
  assert.equal(manifestValue("version"), PLUGIN_VERSION);
  assert.equal(packageJson.version, PLUGIN_VERSION);
  assert.equal(packageLock.version, PLUGIN_VERSION);
  assert.equal(packageLock.packages[""].version, PLUGIN_VERSION);
});

test("keeps the public repository tagline aligned", () => {
  const tagline =
    "Turn Herdr into a terminal-first Codex app: sync projects, resume chats.";
  assert.equal(manifestValue("description"), tagline);
  assert.equal(packageJson.description, tagline);
  assert.match(
    readme,
    /Turn \[Herdr\]\(https:\/\/herdr\.dev\) into a terminal-first Codex app: sync projects, resume chats\./,
  );
  assert.match(
    chineseReadme,
    /把 \[Herdr\]\(https:\/\/herdr\.dev\) 变成终端里的 Codex App：同步项目，随时恢复会话。/,
  );
  assert.match(releasing, new RegExp(escapeRegExp(tagline)));
});

test("links the default English and Simplified Chinese READMEs", () => {
  assert.match(readme, /\[简体中文\]\(README\.zh-CN\.md\)/);
  assert.match(chineseReadme, /\[English\]\(README\.md\)/);
});

test("names the public sync action clearly", () => {
  assert.match(manifest, /title = "Sync recent Codex chats"/);
});

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function manifestValue(key) {
  const match = manifest.match(new RegExp(`^${key} = "([^"]+)"$`, "m"));
  assert.ok(match, `missing ${key} in herdr-plugin.toml`);
  return match[1];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
