import { spawnSync } from "node:child_process";

const MIN_NODE = [20, 0, 0];
const MIN_CODEX = [0, 146, 0];

assertVersion("Node.js", process.versions.node, MIN_NODE);

const codexBinary = process.env.HERDR_CODEX_BIN || "codex";
const result = spawnSync(codexBinary, ["--version"], {
  encoding: "utf8",
  env: process.env,
  timeout: 10_000,
});
if (result.error) {
  throw new Error(`Codex CLI is required: ${result.error.message}`);
}
if (result.status !== 0) {
  const detail = (result.stderr || result.stdout || "").trim();
  throw new Error(`Codex CLI version check failed (${result.status}): ${detail}`);
}
const match = `${result.stdout} ${result.stderr}`.match(/\d+\.\d+\.\d+/);
if (!match) {
  throw new Error("Codex CLI returned an unrecognized version");
}
assertVersion("Codex CLI", match[0], MIN_CODEX);

process.stdout.write(
  `Preflight passed: Node.js ${process.versions.node}, Codex CLI ${match[0]}.\n`,
);

function assertVersion(name, actual, minimum) {
  const parsed = actual.split(".").slice(0, 3).map(Number);
  if (
    parsed.length !== 3 ||
    parsed.some((part) => !Number.isInteger(part)) ||
    compare(parsed, minimum) < 0
  ) {
    throw new Error(
      `${name} ${minimum.join(".")} or newer is required; found ${actual}`,
    );
  }
}

function compare(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}
