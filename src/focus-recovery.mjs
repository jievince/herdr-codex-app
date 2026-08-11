import { listCodexThreads } from "./codex-client.mjs";
import { THREAD_TOKEN } from "./constants.mjs";
import { normalizeCwd, threadTitle } from "./lib.mjs";
import { reportThreadPaneMetadata } from "./sync-core.mjs";

const MAX_RECOVERY_THREADS = 500;

export async function recoverFocusedHistoryThread({
  pane,
  config,
  runHerdr,
  listThreads = listCodexThreads,
}) {
  if (
    !pane ||
    pane.tokens?.[THREAD_TOKEN] ||
    pane.label !== "Codex" ||
    pane.agent ||
    pane.agent_session
  ) {
    return null;
  }

  const tab = runHerdr(["tab", "get", pane.tab_id])?.result?.tab;
  const panes =
    runHerdr([
      "pane",
      "list",
      "--workspace",
      pane.workspace_id,
    ])?.result?.panes || [];
  const tabPanes = panes.filter((candidate) => candidate.tab_id === pane.tab_id);
  if (
    !tab ||
    tab.workspace_id !== pane.workspace_id ||
    tabPanes.length !== 1 ||
    tabPanes[0].pane_id !== pane.pane_id
  ) {
    return null;
  }

  const cwd = normalizeCwd(pane.cwd);
  const threads = await listThreads({
    maxThreads: MAX_RECOVERY_THREADS,
    sourceKinds: config.sourceKinds,
  });
  const matches = threads.filter(
    (thread) =>
      normalizeCwd(thread.cwd) === cwd && threadTitle(thread) === tab.label,
  );
  if (matches.length !== 1) {
    return null;
  }

  // Exact cwd and title recovery does not grant ownership of an old tab.
  reportThreadPaneMetadata({
    pane,
    thread: matches[0],
    managedTab: false,
    runHerdr,
  });
  return matches[0];
}
