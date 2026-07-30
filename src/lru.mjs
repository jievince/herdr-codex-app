import path from "node:path";

import { PLACEHOLDER_AGENT } from "./constants.mjs";
import {
  loadState,
  reportPlaceholder,
  runHerdr,
  updateState,
} from "./lib.mjs";

const SAFE_TO_PARK = new Set(["idle", "done"]);

export function planLruEvictions({
  panes,
  state,
  maxActiveTuis,
  protectedPaneId,
}) {
  const active = panes.filter(isManagedCodexPane);
  const overflow = Math.max(0, active.length - maxActiveTuis);
  const candidates = active
    .filter(
      (pane) =>
        pane.pane_id !== protectedPaneId &&
        pane.focused !== true &&
        SAFE_TO_PARK.has(pane.agent_status),
    )
    .sort((left, right) => compareRecency(left, right, state))
    .slice(0, overflow);

  return {
    activeCount: active.length,
    overflow,
    candidates,
  };
}

export async function enforceActiveTuiLimit({
  maxActiveTuis,
  protectedPaneId,
}) {
  const state = loadState();
  const panes = listAllPanes();
  const plan = planLruEvictions({
    panes,
    state,
    maxActiveTuis,
    protectedPaneId,
  });
  const parked = [];

  for (const candidate of plan.candidates) {
    const result = await gracefullyParkManagedPane(candidate.pane_id, {
      protectedPaneId,
    });
    if (result.parked) {
      parked.push({
        paneId: candidate.pane_id,
        threadId: candidate.tokens.codex_thread_id,
      });
    } else {
      process.stderr.write(
        `Kept Codex TUI in ${candidate.pane_id}: ${result.reason}.\n`,
      );
    }
  }

  if (parked.length > 0) {
    const parkedAt = Date.now();
    await updateState((current) => {
      for (const item of parked) {
        const thread = current.threads[item.threadId];
        if (thread) {
          thread.lastParkedAt = parkedAt;
        }
      }
    });
  }

  const remainingOverflow = Math.max(0, plan.overflow - parked.length);
  if (remainingOverflow > 0) {
    process.stderr.write(
      `Codex TUI LRU remains ${remainingOverflow} over the soft limit; no additional idle/done panes were safe to park.\n`,
    );
  }
  if (parked.length > 0) {
    process.stdout.write(
      `Parked ${parked.length} Codex TUI${parked.length === 1 ? "" : "s"}; active TUI soft limit is ${maxActiveTuis}.\n`,
    );
  }

  return {
    ...plan,
    parked,
    remainingOverflow,
  };
}

export function isStandaloneCodexTuiProcessInfo(processInfo) {
  const processes = processInfo?.foreground_processes;
  if (!Array.isArray(processes)) {
    return false;
  }
  return processes.some((process) => {
    if (!Array.isArray(process.argv) || process.argv.length === 0) {
      return false;
    }
    const executable = path.basename(
      process.argv0 || process.argv[0] || process.name || "",
    );
    return (
      executable === "codex" &&
      process.argv.includes("resume") &&
      !process.argv.includes("--remote")
    );
  });
}

export function codexTuiResumesThread(processInfo, threadId) {
  const processes = processInfo?.foreground_processes;
  if (!Array.isArray(processes) || typeof threadId !== "string") {
    return false;
  }
  return processes.some((process) => {
    if (!Array.isArray(process.argv) || process.argv.length === 0) {
      return false;
    }
    const executable = path.basename(
      process.argv0 || process.argv[0] || process.name || "",
    );
    // A resume process owns the thread only when the exact thread ID is an argv item.
    return (
      executable === "codex" &&
      process.argv.includes("resume") &&
      process.argv.includes(threadId)
    );
  });
}

export function listAllPanes() {
  const workspaceResponse = runHerdr(["workspace", "list"]);
  const workspaces = workspaceResponse?.result?.workspaces || [];
  const panes = [];
  for (const workspace of workspaces) {
    const paneResponse = runHerdr([
      "pane",
      "list",
      "--workspace",
      workspace.workspace_id,
    ]);
    panes.push(...(paneResponse?.result?.panes || []));
  }
  return panes;
}

export async function gracefullyParkManagedPane(
  paneId,
  { protectedPaneId = null, allowFocused = false } = {},
) {
  const before = getPane(paneId);
  if (!before) {
    return { parked: false, reason: "pane no longer exists" };
  }
  if (
    (!allowFocused &&
      (paneId === protectedPaneId || before.focused === true)) ||
    !isManagedCodexPane(before) ||
    !SAFE_TO_PARK.has(before.agent_status)
  ) {
    return { parked: false, reason: "pane state changed before parking" };
  }

  // /quit preserves the thread in the shared app server before placeholder restore.
  runHerdr(["pane", "run", paneId, "/quit"]);
  const deadline = Date.now() + 10_000;
  let after = before;
  while (Date.now() < deadline) {
    await delay(100);
    after = getPane(paneId);
    if (!after || after.agent !== "codex") {
      break;
    }
  }

  if (!after) {
    return { parked: false, reason: "pane disappeared while Codex was exiting" };
  }
  if (after.agent === "codex") {
    return { parked: false, reason: "Codex did not exit after /quit" };
  }
  if (after.agent && after.agent !== PLACEHOLDER_AGENT) {
    return { parked: false, reason: `pane is now occupied by ${after.agent}` };
  }

  reportPlaceholder(paneId);
  return { parked: true };
}

function getPane(paneId) {
  const response = runHerdr(["pane", "get", paneId]);
  return response?.result?.pane || null;
}

function isManagedCodexPane(pane) {
  return (
    pane?.agent === "codex" &&
    typeof pane.tokens?.codex_thread_id === "string" &&
    pane.tokens.codex_thread_id.length > 0
  );
}

function compareRecency(left, right, state) {
  const leftThread = state.threads[left.tokens.codex_thread_id] || {};
  const rightThread = state.threads[right.tokens.codex_thread_id] || {};
  const leftFocused = finiteTimestamp(leftThread.lastFocusedAt);
  const rightFocused = finiteTimestamp(rightThread.lastFocusedAt);
  if (leftFocused !== rightFocused) {
    return leftFocused - rightFocused;
  }

  const leftRecency = finiteTimestamp(leftThread.recencyAt);
  const rightRecency = finiteTimestamp(rightThread.recencyAt);
  if (leftRecency !== rightRecency) {
    return leftRecency - rightRecency;
  }
  return left.pane_id.localeCompare(right.pane_id, undefined, { numeric: true });
}

function finiteTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
