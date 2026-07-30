import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const files = collect(root).filter((file) => file.endsWith(".mjs"));

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}
process.stdout.write(`Syntax check passed for ${files.length} modules.\n`);

function collect(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") {
      continue;
    }
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collect(candidate));
    } else {
      files.push(candidate);
    }
  }
  return files;
}
