import {
  MANAGED_TAB_TOKEN,
  MANAGED_TOKEN,
  PLACEHOLDER_AGENT,
  THREAD_TOKEN,
} from "./constants.mjs";
import { normalizeCwd, threadTitle } from "./lib.mjs";
import {
  findThreadPlacement,
  findThreadPlacements,
  panesForTab,
  placementForPane,
  placementIsManaged,
  samePlacement,
} from "./sync-topology.mjs";

export function duplicatePlaceholderCandidates({ topology, finalThreads }) {
  const duplicates = [];
  for (const [threadId, record] of Object.entries(finalThreads)) {
    // Wrong-workspace duplicates are still removable when ownership is live.
    for (const placement of findThreadPlacements(topology, threadId)) {
      if (samePlacement(record, {
        workspaceId: placement.workspace.workspace_id,
        tabId: placement.tab.tab_id,
        paneId: placement.pane.pane_id,
      })) {
        continue;
      }
      duplicates.push(stalePlacement(topology, threadId, record, placement));
    }
  }
  return duplicates;
}

export function classifyStaleThreads({
  topology,
  initialState,
  selectedIds,
}) {
  const stale = [];
  const classifiedIds = new Set();
  for (const [threadId, record] of Object.entries(initialState.threads)) {
    if (selectedIds.has(threadId)) {
      continue;
    }
    classifiedIds.add(threadId);
    const placement = findThreadPlacement(
      topology,
      threadId,
      record.cwd,
      record,
    );
    if (!placement || placement.pane.tokens?.[THREAD_TOKEN] !== threadId) {
      stale.push({ threadId, record, placement: null, safeCandidate: false });
      continue;
    }

    stale.push(stalePlacement(topology, threadId, record, placement));
  }

  // Recover explicitly managed panes that are missing from the current state.
  for (const pane of topology.panesById.values()) {
    const threadId = pane.tokens?.[THREAD_TOKEN];
    if (
      typeof threadId !== "string" ||
      selectedIds.has(threadId) ||
      classifiedIds.has(threadId) ||
      (pane.tokens?.[MANAGED_TOKEN] !== "1" &&
        pane.tokens?.[MANAGED_TAB_TOKEN] !== "1")
    ) {
      continue;
    }
    const placement = placementForPane(topology, pane);
    if (!placement) {
      continue;
    }
    const record = {
      cwd: normalizeCwd(pane.cwd),
      workspaceId: placement.workspace.workspace_id,
      tabId: placement.tab.tab_id,
      paneId: pane.pane_id,
      title: placement.tab.label,
      recencyAt: Number(pane.tokens?.codex_recency) || 0,
      lastFocusedAt: 0,
      lastParkedAt: 0,
    };
    stale.push(stalePlacement(topology, threadId, record, placement));
  }
  return stale;
}

export function pruneSafeStalePlaceholders({ topology, stale, runHerdr }) {
  const removedThreadIds = new Set(
    stale.filter((item) => !item.placement).map((item) => item.threadId),
  );
  const byWorkspace = groupSafeCandidatesByWorkspace(stale);
  let prunedWorkspaces = 0;
  let prunedTabs = 0;

  for (const [workspaceId, items] of byWorkspace) {
    const workspace = topology.workspacesById.get(workspaceId);
    const candidateTabIds = new Set(
      items.map((item) => item.placement.tab.tab_id),
    );
    const allTabsAreCandidates =
      workspace?.tokens?.[MANAGED_TOKEN] === "1" &&
      workspace.tabs.length > 0 &&
      workspace.tabs.every((tab) => candidateTabIds.has(tab.tab_id));

    if (
      allTabsAreCandidates &&
      verifyManagedWorkspaceClose(workspaceId, items, runHerdr)
    ) {
      runHerdr(["workspace", "close", workspaceId]);
      for (const item of items) {
        removedThreadIds.add(item.threadId);
      }
      prunedWorkspaces += 1;
      continue;
    }

    for (const item of items) {
      if (verifyManagedTabClose(item, runHerdr)) {
        runHerdr(["tab", "close", item.placement.tab.tab_id]);
        removedThreadIds.add(item.threadId);
        prunedTabs += 1;
      }
    }
  }

  return {
    removedThreadIds,
    prunedTabs,
    prunedWorkspaces,
  };
}

export function pruneMisplacedLegacyTabs({
  topology,
  allThreads,
  finalThreads,
  runHerdr,
}) {
  const threadsByTitle = new Map();
  for (const thread of allThreads) {
    if (thread.ephemeral === true || !normalizeCwd(thread.cwd)) {
      continue;
    }
    appendGrouped(threadsByTitle, threadTitle(thread), thread);
  }

  let prunedTabs = 0;
  for (const pane of topology.panesById.values()) {
    const placement = placementForPane(topology, pane);
    const matches = placement
      ? threadsByTitle.get(placement.tab.label) || []
      : [];
    if (
      !placement ||
      matches.length !== 1 ||
      !isUnindexedLegacyPane(topology, placement) ||
      placement.workspace.tokens?.[MANAGED_TOKEN] !== "1"
    ) {
      continue;
    }

    const thread = matches[0];
    const correct = finalThreads[thread.id];
    if (
      !correct ||
      normalizeCwd(thread.cwd) === normalizeCwd(pane.cwd) ||
      normalizeCwd(correct.cwd) !== normalizeCwd(thread.cwd) ||
      correct.workspaceId === placement.workspace.workspace_id ||
      correct.paneId === pane.pane_id
    ) {
      continue;
    }

    if (verifyMisplacedLegacyTab(placement, thread, correct, runHerdr)) {
      runHerdr(["tab", "close", placement.tab.tab_id]);
      prunedTabs += 1;
    }
  }
  return { prunedTabs };
}

export function retainedThreadRecord(item) {
  const { placement, record, managedTab } = item;
  return {
    ...record,
    workspaceId: placement.workspace.workspace_id,
    tabId: placement.tab.tab_id,
    paneId: placement.pane.pane_id,
    managedTab: managedTab === true,
  };
}

export function projectStateForThreads({
  finalThreads,
  initialState,
  topology,
}) {
  const projects = {};
  for (const record of Object.values(finalThreads)) {
    if (!record.cwd || projects[record.cwd]) {
      continue;
    }
    const workspace = topology.workspacesById.get(record.workspaceId);
    const previous = initialState.projects[record.cwd];
    projects[record.cwd] = {
      workspaceId: record.workspaceId,
      managed:
        workspace?.tokens?.[MANAGED_TOKEN] === "1" ||
        (previous?.workspaceId === record.workspaceId &&
          previous.managed === true),
    };
  }
  return projects;
}

function stalePlacement(topology, threadId, record, placement) {
  const managedTab = placementIsManaged(topology, record, placement);
  return {
    threadId,
    record,
    placement,
    managedTab,
    safeCandidate:
      managedTab &&
      placement.pane.agent === PLACEHOLDER_AGENT &&
      placement.pane.focused !== true &&
      panesForTab(topology, placement.tab.tab_id).length === 1,
  };
}

function groupSafeCandidatesByWorkspace(stale) {
  const byWorkspace = new Map();
  for (const item of stale) {
    if (!item.safeCandidate) {
      continue;
    }
    const workspaceId = item.placement.workspace.workspace_id;
    const items = byWorkspace.get(workspaceId) || [];
    items.push(item);
    byWorkspace.set(workspaceId, items);
  }
  return byWorkspace;
}

function verifyManagedWorkspaceClose(workspaceId, items, runHerdr) {
  const workspace = runHerdr(["workspace", "get", workspaceId])?.result
    ?.workspace;
  if (workspace?.tokens?.[MANAGED_TOKEN] !== "1") {
    return false;
  }
  const tabs =
    runHerdr(["tab", "list", "--workspace", workspaceId])?.result?.tabs || [];
  const panes =
    runHerdr(["pane", "list", "--workspace", workspaceId])?.result?.panes || [];
  const expectedByTab = new Map(
    items.map((item) => [item.placement.tab.tab_id, item]),
  );
  if (
    tabs.length === 0 ||
    tabs.length !== expectedByTab.size ||
    tabs.some((tab) => !expectedByTab.has(tab.tab_id))
  ) {
    return false;
  }

  return tabs.every((tab) => {
    const item = expectedByTab.get(tab.tab_id);
    const tabPanes = panes.filter((pane) => pane.tab_id === tab.tab_id);
    if (
      tabPanes.length !== 1 ||
      tabPanes[0].pane_id !== item.placement.pane.pane_id
    ) {
      return false;
    }
    return paneStillSafe(item, runHerdr);
  });
}

function verifyManagedTabClose(item, runHerdr) {
  const { workspace, tab } = item.placement;
  const currentTab = runHerdr(["tab", "get", tab.tab_id])?.result?.tab;
  if (!currentTab || currentTab.workspace_id !== workspace.workspace_id) {
    return false;
  }
  const tabs =
    runHerdr([
      "tab",
      "list",
      "--workspace",
      workspace.workspace_id,
    ])?.result?.tabs || [];
  const panes =
    runHerdr([
      "pane",
      "list",
      "--workspace",
      workspace.workspace_id,
    ])?.result?.panes || [];
  const tabPanes = panes.filter((pane) => pane.tab_id === tab.tab_id);
  if (
    tabPanes.length !== 1 ||
    tabPanes[0].pane_id !== item.placement.pane.pane_id
  ) {
    return false;
  }

  // Never close the last tab of a workspace the plugin did not create.
  if (
    workspace.tokens?.[MANAGED_TOKEN] !== "1" &&
    tabs.filter((candidate) => candidate.tab_id !== tab.tab_id).length === 0
  ) {
    return false;
  }
  return paneStillSafe(item, runHerdr);
}

function paneStillSafe(item, runHerdr) {
  const pane = runHerdr([
    "pane",
    "get",
    item.placement.pane.pane_id,
  ])?.result?.pane;
  if (
    pane?.pane_id !== item.placement.pane.pane_id ||
    pane.tab_id !== item.placement.tab.tab_id ||
    pane.tokens?.[THREAD_TOKEN] !== item.threadId ||
    pane.agent !== PLACEHOLDER_AGENT ||
    pane.focused === true
  ) {
    return false;
  }
  return pane.tokens?.[MANAGED_TAB_TOKEN] === "1";
}

function isUnindexedLegacyPane(topology, placement) {
  const pane = placement.pane;
  return (
    pane.label === "Codex" &&
    !pane.tokens?.[THREAD_TOKEN] &&
    !pane.agent &&
    !pane.agent_session &&
    pane.focused !== true &&
    panesForTab(topology, placement.tab.tab_id).length === 1
  );
}

function verifyMisplacedLegacyTab(placement, thread, correct, runHerdr) {
  const workspaceId = placement.workspace.workspace_id;
  const workspace = runHerdr(["workspace", "get", workspaceId])?.result
    ?.workspace;
  const tab = runHerdr(["tab", "get", placement.tab.tab_id])?.result?.tab;
  const tabs =
    runHerdr(["tab", "list", "--workspace", workspaceId])?.result?.tabs || [];
  const panes =
    runHerdr(["pane", "list", "--workspace", workspaceId])?.result?.panes || [];
  const pane = panes.find(
    (candidate) => candidate.pane_id === placement.pane.pane_id,
  );
  const correctPane = runHerdr(["pane", "get", correct.paneId])?.result?.pane;
  const processInfo = runHerdr([
    "pane",
    "process-info",
    "--pane",
    placement.pane.pane_id,
  ])?.result?.process_info;

  if (
    workspace?.tokens?.[MANAGED_TOKEN] !== "1" ||
    !tab ||
    tab.workspace_id !== workspaceId ||
    tab.label !== placement.tab.label ||
    tabs.length <= 1 ||
    panes.filter((candidate) => candidate.tab_id === tab.tab_id).length !== 1 ||
    !pane ||
    pane.label !== "Codex" ||
    pane.tokens?.[THREAD_TOKEN] ||
    pane.agent ||
    pane.agent_session ||
    pane.focused === true ||
    normalizeCwd(pane.cwd) === normalizeCwd(thread.cwd) ||
    correctPane?.tokens?.[THREAD_TOKEN] !== thread.id ||
    normalizeCwd(correctPane.cwd) !== normalizeCwd(thread.cwd) ||
    !isAvailableShell(processInfo)
  ) {
    return false;
  }
  return true;
}

function isAvailableShell(processInfo) {
  const shellPid = Number(processInfo?.shell_pid);
  const foregroundGroup = Number(processInfo?.foreground_process_group_id);
  const processes = processInfo?.foreground_processes;
  // Closing is safe only when the shell itself is the sole foreground process.
  return (
    Number.isInteger(shellPid) &&
    shellPid > 0 &&
    foregroundGroup === shellPid &&
    Array.isArray(processes) &&
    processes.length === 1 &&
    Number(processes[0]?.pid) === shellPid
  );
}

function appendGrouped(groups, key, value) {
  const items = groups.get(key) || [];
  items.push(value);
  groups.set(key, items);
}
