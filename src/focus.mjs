import { ensureCodexAppServer } from "./codex-client.mjs";
import {
  PLACEHOLDER_AGENT,
  PLACEHOLDER_SOURCE,
} from "./constants.mjs";
import {
  enforceActiveTuiLimit,
  gracefullyParkManagedPane,
  isStandaloneCodexTuiProcessInfo,
} from "./lru.mjs";
import {
  codexAgentName,
  loadConfig,
  paneIdFromEvent,
  reportPlaceholder,
  runHerdr,
  updateState,
  withLock,
} from "./lib.mjs";

const paneId = paneIdFromEvent();
if (paneId) {
  try {
    await handleFocus(paneId);
  } catch (error) {
    process.stderr.write(`Codex chat focus failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

async function handleFocus(targetPaneId) {
  // Topology writes can emit focus events; they must not resume a TUI mid-refresh.
  const refreshGate = await withLock("sync", () => true);
  if (refreshGate?.skipped) {
    process.stdout.write(
      "Ignored Codex chat focus while history refresh is running.\n",
    );
    return;
  }

  const config = loadConfig();
  const paneResponse = runHerdr(["pane", "get", targetPaneId]);
  const pane = paneResponse?.result?.pane;
  const threadId = pane?.tokens?.codex_thread_id;

  if (threadId) {
    await touchThread(threadId, pane);
  }

  let migrated = false;
  if (
    threadId &&
    pane.agent === "codex" &&
    (pane.agent_status === "idle" || pane.agent_status === "done") &&
    isStandaloneCodexTui(targetPaneId)
  ) {
    ensureCodexAppServer();
    const migration = await gracefullyParkManagedPane(targetPaneId, {
      allowFocused: true,
    });
    if (migration.parked) {
      resumeThread(targetPaneId, threadId, config.codexRemoteEndpoint);
      migrated = true;
      process.stdout.write(
        `Migrated Codex chat ${threadId} to the shared app server.\n`,
      );
    } else {
      process.stderr.write(
        `Kept standalone Codex TUI ${threadId}: ${migration.reason}.\n`,
      );
    }
  }

  if (
    !migrated &&
    threadId &&
    (!pane.agent || pane.agent === PLACEHOLDER_AGENT)
  ) {
    const result = await withLock(`resume-${threadId}`, () =>
      resumeThread(targetPaneId, threadId, config.codexRemoteEndpoint),
    );
    if (result?.skipped) {
      process.stdout.write(`Codex chat ${threadId} is already resuming.\n`);
    }
  }

  const lruResult = await withLock(
    "lru",
    () =>
      enforceActiveTuiLimit({
        maxActiveTuis: config.maxActiveTuis,
        protectedPaneId: targetPaneId,
      }),
    { waitMs: 5_000 },
  );
  if (lruResult?.skipped) {
    process.stderr.write(
      "Skipped Codex TUI LRU because another pass is still running.\n",
    );
  }
}

function isStandaloneCodexTui(targetPaneId) {
  const response = runHerdr(["pane", "process-info", "--pane", targetPaneId]);
  return isStandaloneCodexTuiProcessInfo(response?.result?.process_info);
}

async function touchThread(threadId, pane) {
  await updateState((state) => {
    const current = state.threads[threadId] || {};
    state.threads[threadId] = {
      ...current,
      paneId: pane.pane_id,
      workspaceId: pane.workspace_id,
      tabId: pane.tab_id,
      lastFocusedAt: Date.now(),
    };
  });
}

function resumeThread(targetPaneId, threadId, remoteEndpoint) {
  ensureCodexAppServer();
  const paneResponse = runHerdr(["pane", "get", targetPaneId]);
  if (paneResponse?.result?.pane?.agent === PLACEHOLDER_AGENT) {
    runHerdr([
      "pane",
      "release-agent",
      targetPaneId,
      "--source",
      PLACEHOLDER_SOURCE,
      "--agent",
      PLACEHOLDER_AGENT,
    ]);
  }

  try {
    const agentName = codexAgentName(threadId);
    runHerdr(
      [
        "agent",
        "start",
        agentName,
        "--kind",
        "codex",
        "--pane",
        targetPaneId,
        "--timeout",
        "60000",
        "--",
        "resume",
        "--remote",
        remoteEndpoint,
        "--no-alt-screen",
        threadId,
      ],
      { timeoutMs: 70_000 },
    );
  } catch (error) {
    restorePlaceholderIfAvailable(targetPaneId);
    throw error;
  }
  process.stdout.write(`Resumed Codex chat ${threadId} in ${targetPaneId}.\n`);
}

function restorePlaceholderIfAvailable(targetPaneId) {
  const paneResponse = runHerdr(["pane", "get", targetPaneId]);
  const pane = paneResponse?.result?.pane;
  if (!pane?.agent || pane.agent === PLACEHOLDER_AGENT) {
    reportPlaceholder(targetPaneId);
  }
}
