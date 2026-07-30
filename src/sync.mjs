import { listCodexThreads } from "./codex-client.mjs";
import { recordSyncSuccess } from "./initial-sync-core.mjs";
import {
  loadConfig,
  loadState,
  reportPlaceholder,
  runHerdr,
  updateState,
  withLock,
} from "./lib.mjs";
import {
  mergeSynchronizedState,
  synchronizeThreadTopology,
} from "./sync-core.mjs";

try {
  const result = await withLock("sync", synchronize);
  if (result?.skipped) {
    process.stdout.write("Codex chat refresh is already running.\n");
  } else {
    recordSyncSuccess();
  }
} catch (error) {
  process.stderr.write(`Codex chat refresh failed: ${error.message}\n`);
  process.exitCode = 1;
}

async function synchronize() {
  const config = loadConfig();
  const initialState = loadState();
  const allThreads = await listCodexThreads({
    maxThreads: Math.min(config.maxIndexedChats * 5, 500),
    sourceKinds: config.sourceKinds,
  });
  const synchronized = synchronizeThreadTopology({
    allThreads,
    config,
    initialState,
    runHerdr,
    reportPlaceholder,
  });

  // Focus hooks may update timestamps while Codex history and topology are scanned.
  await updateState((current) => {
    mergeSynchronizedState(current, initialState, synchronized);
  });
  process.stdout.write(
    [
      `Codex chats refreshed: ${synchronized.selectedCount}`,
      `projects created: ${synchronized.createdProjects}`,
      `tabs created: ${synchronized.createdTabs}`,
      `titles updated: ${synchronized.updatedTabs}`,
      `tabs pruned: ${synchronized.prunedTabs}`,
      `workspaces pruned: ${synchronized.prunedWorkspaces}`,
      `stale chats retained: ${synchronized.retainedStale}`,
      `missing directories skipped: ${synchronized.skippedMissingDirectories}`,
    ].join(", ") + "\n",
  );
}
