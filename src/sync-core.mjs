import fs from "node:fs";

import {
  MANAGED_TAB_TOKEN,
  MANAGED_TOKEN,
  METADATA_SOURCE,
  PLACEHOLDER_AGENT,
  PROJECT_TOKEN,
  STATE_VERSION,
  THREAD_TOKEN,
} from "./constants.mjs";
import {
  normalizeCwd,
  projectCwdToken,
  projectLabel,
  threadTitle,
} from "./lib.mjs";
import {
  classifyStaleThreads,
  duplicatePlaceholderCandidates,
  projectStateForThreads,
  pruneSafeStalePlaceholders,
  retainedThreadRecord,
} from "./sync-cleanup.mjs";
import {
  findThreadPlacement,
  findStoredThreadPlacement,
  loadTopology,
  panesForTab,
  placementForPane,
  placementIsManaged,
  placementMatchesCwd,
  samePlacement,
  workspaceMatchesCwd,
} from "./sync-topology.mjs";

export function synchronizeThreadTopology({
  allThreads,
  config,
  initialState,
  runHerdr,
  reportPlaceholder,
  directoryExists = isDirectory,
}) {
  const topology = loadTopology(runHerdr);
  const { selected, skippedMissingDirectories } = selectRecentThreads(
    allThreads,
    config,
    directoryExists,
  );
  const selectedIds = new Set(selected.map((thread) => thread.id));
  const repairedMetadata = repairMissingThreadMetadata({
    allThreads,
    topology,
    initialState,
    selectedIds,
    runHerdr,
    reportPlaceholder,
  });
  const usedLabels = new Set(
    topology.workspaces.map((workspace) => workspace.label),
  );
  const indexed = indexSelectedThreads({
    selected,
    topology,
    initialState,
    usedLabels,
    runHerdr,
    reportPlaceholder,
  });
  const duplicateCleanup = pruneSafeStalePlaceholders({
    topology,
    stale: duplicatePlaceholderCandidates({
      topology,
      finalThreads: indexed.finalThreads,
    }),
    runHerdr,
  });
  const stale = classifyStaleThreads({
    topology,
    initialState,
    selectedIds,
  });
  const cleanup = pruneSafeStalePlaceholders({
    topology,
    stale,
    runHerdr,
  });
  retainUnsafeStaleThreads(indexed.finalThreads, stale, cleanup.removedThreadIds);
  const projects = projectStateForThreads({
    finalThreads: indexed.finalThreads,
    initialState,
    topology,
  });

  return {
    finalState: {
      version: STATE_VERSION,
      projects,
      threads: indexed.finalThreads,
    },
    repairedMetadata,
    selectedCount: selected.length,
    createdProjects: indexed.createdProjects,
    createdTabs: indexed.createdTabs,
    updatedTabs: indexed.updatedTabs,
    skippedMissingDirectories,
    prunedTabs: cleanup.prunedTabs + duplicateCleanup.prunedTabs,
    prunedWorkspaces:
      cleanup.prunedWorkspaces + duplicateCleanup.prunedWorkspaces,
    removedThreadIds: cleanup.removedThreadIds,
    retainedStale: stale.filter(
      (item) => !cleanup.removedThreadIds.has(item.threadId),
    ).length,
  };
}

export function repairMissingThreadMetadata({
  allThreads,
  topology,
  initialState,
  selectedIds,
  runHerdr,
  reportPlaceholder,
}) {
  const restoredBySelectedState = new Set();
  for (const threadId of selectedIds) {
    const placement = findStoredThreadPlacement(
      topology,
      initialState.threads[threadId],
    );
    if (placement) {
      restoredBySelectedState.add(placement.pane.pane_id);
    }
  }

  const threadsBySignature = new Map();
  for (const thread of allThreads) {
    if (thread.ephemeral === true) {
      continue;
    }
    const signature = historySignature(thread.cwd, threadTitle(thread));
    if (!signature) {
      continue;
    }
    appendGrouped(threadsBySignature, signature, thread);
  }

  const panesBySignature = new Map();
  for (const pane of topology.panesById.values()) {
    if (
      pane.tokens?.[THREAD_TOKEN] ||
      restoredBySelectedState.has(pane.pane_id) ||
      pane.label !== "Codex" ||
      (pane.agent && pane.agent !== PLACEHOLDER_AGENT) ||
      pane.agent_session
    ) {
      continue;
    }
    const placement = placementForPane(topology, pane);
    if (
      !placement ||
      panesForTab(topology, pane.tab_id).length !== 1 ||
      !placementMatchesCwd(placement, pane.cwd)
    ) {
      continue;
    }
    const signature = historySignature(pane.cwd, placement.tab.label);
    if (signature) {
      appendGrouped(panesBySignature, signature, placement);
    }
  }

  let repaired = 0;
  for (const [signature, placements] of panesBySignature) {
    const threads = threadsBySignature.get(signature) || [];
    if (placements.length !== 1 || threads.length !== 1) {
      continue;
    }
    // Repaired user tabs gain resumability, never plugin deletion ownership.
    markPane({
      pane: placements[0].pane,
      thread: threads[0],
      title: placements[0].tab.label,
      managedTab: false,
      runHerdr,
      reportPlaceholder,
    });
    repaired += 1;
  }
  return repaired;
}

function historySignature(cwd, title) {
  const normalized = normalizeCwd(cwd);
  if (!normalized || typeof title !== "string" || title.length === 0) {
    return null;
  }
  return `${normalized}\u0000${title}`;
}

function appendGrouped(groups, key, value) {
  const items = groups.get(key) || [];
  items.push(value);
  groups.set(key, items);
}

export function mergeSynchronizedState(current, initial, synchronized) {
  const desired = synchronized.finalState;
  const initialThreadIds = new Set(Object.keys(initial.threads));

  for (const threadId of initialThreadIds) {
    if (
      !desired.threads[threadId] &&
      samePlacement(current.threads[threadId], initial.threads[threadId])
    ) {
      delete current.threads[threadId];
    }
  }
  for (const [threadId, record] of Object.entries(desired.threads)) {
    const latest = current.threads[threadId] || {};
    current.threads[threadId] = {
      ...record,
      lastFocusedAt: Math.max(
        Number(record.lastFocusedAt) || 0,
        Number(latest.lastFocusedAt) || 0,
      ),
      lastParkedAt: Math.max(
        Number(record.lastParkedAt) || 0,
        Number(latest.lastParkedAt) || 0,
      ),
    };
  }

  for (const [cwd, project] of Object.entries(initial.projects)) {
    if (
      !desired.projects[cwd] &&
      current.projects[cwd]?.workspaceId === project.workspaceId
    ) {
      delete current.projects[cwd];
    }
  }
  for (const [cwd, project] of Object.entries(desired.projects)) {
    current.projects[cwd] = project;
  }
  current.version = STATE_VERSION;
}

export function selectRecentThreads(
  threads,
  config,
  directoryExists = isDirectory,
) {
  const perProject = new Map();
  const selected = [];
  let skippedMissingDirectories = 0;

  for (const thread of threads) {
    if (thread.ephemeral === true) {
      continue;
    }
    const cwd = normalizeCwd(thread.cwd);
    if (!cwd) {
      continue;
    }
    if (!directoryExists(cwd)) {
      skippedMissingDirectories += 1;
      continue;
    }
    const count = perProject.get(cwd) || 0;
    if (count >= config.maxIndexedChatsPerProject) {
      continue;
    }
    perProject.set(cwd, count + 1);
    selected.push(thread);
    if (selected.length >= config.maxIndexedChats) {
      break;
    }
  }
  return { selected, skippedMissingDirectories };
}

function indexSelectedThreads({
  selected,
  topology,
  initialState,
  usedLabels,
  runHerdr,
  reportPlaceholder,
}) {
  const result = {
    finalThreads: {},
    createdProjects: 0,
    createdTabs: 0,
    updatedTabs: 0,
  };
  for (const thread of selected) {
    const indexed =
      indexExistingThread({
        thread,
        topology,
        initialState,
        runHerdr,
        reportPlaceholder,
      }) ||
      indexNewThread({
        thread,
        topology,
        initialState,
        usedLabels,
        runHerdr,
        reportPlaceholder,
      });
    result.finalThreads[thread.id] = indexed.record;
    result.createdProjects += indexed.createdProject ? 1 : 0;
    result.createdTabs += indexed.createdTab ? 1 : 0;
    result.updatedTabs += indexed.updatedTab ? 1 : 0;
  }
  return result;
}

function indexExistingThread({
  thread,
  topology,
  initialState,
  runHerdr,
  reportPlaceholder,
}) {
  const previous = initialState.threads[thread.id];
  const cwd = normalizeCwd(thread.cwd);
  let placement = findThreadPlacement(topology, thread.id, cwd, previous);
  let recoveredFromState = false;
  if (!placement) {
    placement = findStoredThreadPlacement(topology, previous);
    recoveredFromState = placement !== null;
  }
  if (!placement) {
    return null;
  }

  if (
    recoveredFromState &&
    initialState.projects[cwd]?.managed === true &&
    placement.workspace.tokens?.[MANAGED_TOKEN] !== "1"
  ) {
    reportManagedWorkspace({ workspace: placement.workspace, cwd, runHerdr });
  }

  const title = threadTitle(thread);
  let updatedTab = false;
  if (placement.tab.label !== title) {
    runHerdr(["tab", "rename", placement.tab.tab_id, title]);
    placement.tab.label = title;
    updatedTab = true;
  }
  const managedTab = placementIsManaged(
    topology,
    previous,
    placement,
  );
  markPane({
    pane: placement.pane,
    thread,
    title,
    managedTab,
    runHerdr,
    reportPlaceholder,
  });
  return {
    record: threadRecord({
      thread,
      placement,
      managedTab,
      previous,
    }),
    createdProject: false,
    createdTab: false,
    updatedTab,
  };
}

function indexNewThread({
  thread,
  topology,
  initialState,
  usedLabels,
  runHerdr,
  reportPlaceholder,
}) {
  const cwd = normalizeCwd(thread.cwd);
  const title = threadTitle(thread);
  const project = ensureProject({
    topology,
    initialState,
    cwd,
    usedLabels,
    runHerdr,
  });
  const placement = allocateThreadTab(project, title, cwd, runHerdr);
  markPane({
    pane: placement.pane,
    thread,
    title,
    managedTab: true,
    runHerdr,
    reportPlaceholder,
  });
  return {
    record: threadRecord({
      thread,
      placement: {
        ...placement,
        workspace: project.workspace,
      },
      managedTab: true,
      previous: initialState.threads[thread.id],
    }),
    createdProject: project.created,
    createdTab: placement.created,
    updatedTab: false,
  };
}

function ensureProject({
  topology,
  initialState,
  cwd,
  usedLabels,
  runHerdr,
}) {
  const storedWorkspace = initialState.projects[cwd]?.workspaceId;
  let workspace = storedWorkspace
    ? topology.workspacesById.get(storedWorkspace)
    : null;
  if (workspace && !workspaceMatchesCwd(workspace, cwd)) {
    workspace = null;
  }
  if (!workspace) {
    workspace = topology.workspaces.find(
      (candidate) =>
        workspaceMatchesCwd(candidate, cwd),
    );
  }
  if (workspace) {
    const storedProject = initialState.projects[cwd];
    const pluginOwned =
      workspace.tokens?.[MANAGED_TOKEN] === "1" ||
      (storedProject?.workspaceId === workspace.workspace_id &&
        storedProject.managed === true);
    if (
      pluginOwned &&
      workspace.tokens?.[PROJECT_TOKEN] !== projectCwdToken(cwd)
    ) {
      reportManagedWorkspace({ workspace, cwd, runHerdr });
    }
    return { workspace, created: false };
  }

  const label = projectLabel(cwd, usedLabels);
  const response = runHerdr([
    "workspace",
    "create",
    "--cwd",
    cwd,
    "--label",
    label,
    "--no-focus",
  ]);
  const workspaceInfo = response.result.workspace;
  const tab = response.result.tab;
  const pane = response.result.root_pane;
  workspace = {
    ...workspaceInfo,
    tabs: [tab],
    panes: [pane],
    identityCwd: cwd,
    createdRoot: { tab, pane, used: false },
  };

  reportManagedWorkspace({ workspace, cwd, runHerdr });

  topology.workspaces.push(workspace);
  topology.workspacesById.set(workspace.workspace_id, workspace);
  topology.tabsById.set(tab.tab_id, tab);
  topology.panesById.set(pane.pane_id, pane);
  usedLabels.add(label);
  return { workspace, created: true };
}

function reportManagedWorkspace({ workspace, cwd, runHerdr }) {
  runHerdr([
    "workspace",
    "report-metadata",
    workspace.workspace_id,
    "--source",
    METADATA_SOURCE,
    "--token",
    `${MANAGED_TOKEN}=1`,
    "--token",
    `${PROJECT_TOKEN}=${projectCwdToken(cwd)}`,
  ]);
  workspace.tokens = {
    ...(workspace.tokens || {}),
    [MANAGED_TOKEN]: "1",
    [PROJECT_TOKEN]: projectCwdToken(cwd),
  };
}

function allocateThreadTab(project, title, cwd, runHerdr) {
  const workspace = project.workspace;
  if (workspace.createdRoot && !workspace.createdRoot.used) {
    workspace.createdRoot.used = true;
    runHerdr(["tab", "rename", workspace.createdRoot.tab.tab_id, title]);
    workspace.createdRoot.tab.label = title;
    return {
      tab: workspace.createdRoot.tab,
      pane: workspace.createdRoot.pane,
      created: false,
    };
  }

  const response = runHerdr([
    "tab",
    "create",
    "--workspace",
    workspace.workspace_id,
    "--cwd",
    cwd,
    "--label",
    title,
    "--no-focus",
  ]);
  const tab = response.result.tab;
  const pane = response.result.root_pane;
  workspace.tabs.push(tab);
  workspace.panes.push(pane);
  return { tab, pane, created: true };
}

function markPane({
  pane,
  thread,
  title,
  managedTab,
  runHerdr,
  reportPlaceholder,
}) {
  reportThreadPaneMetadata({
    pane,
    thread,
    title,
    managedTab,
    runHerdr,
  });

  // A synthetic idle row keeps indexed chats visible without running a TUI.
  if (!pane.agent && !pane.agent_session) {
    reportPlaceholder(pane.pane_id);
    pane.agent = PLACEHOLDER_AGENT;
    pane.agent_status = "idle";
  }
}

export function reportThreadPaneMetadata({
  pane,
  thread,
  title = threadTitle(thread),
  managedTab,
  runHerdr,
}) {
  if (pane.label !== "Codex") {
    runHerdr(["pane", "rename", pane.pane_id, "Codex"]);
    pane.label = "Codex";
  }
  const metadataArgs = paneMetadataArgs(pane, thread, title, managedTab);
  runHerdr(metadataArgs);
  pane.tokens = {
    ...(pane.tokens || {}),
    [MANAGED_TOKEN]: "1",
    [THREAD_TOKEN]: thread.id,
    ...(managedTab ? { [MANAGED_TAB_TOKEN]: "1" } : {}),
  };
}

function paneMetadataArgs(pane, thread, title, managedTab) {
  const args = [
    "pane",
    "report-metadata",
    pane.pane_id,
    "--source",
    METADATA_SOURCE,
    "--title",
    title,
    "--display-agent",
    "Codex",
    "--token",
    `${MANAGED_TOKEN}=1`,
    "--token",
    `${THREAD_TOKEN}=${thread.id}`,
    "--token",
    `codex_recency=${String(
      thread.recencyAt || thread.updatedAt || thread.createdAt || 0,
    )}`,
  ];
  if (managedTab) {
    args.push("--token", `${MANAGED_TAB_TOKEN}=1`);
  }
  return args;
}

function threadRecord({ thread, placement, managedTab, previous = {} }) {
  return {
    cwd: normalizeCwd(thread.cwd),
    workspaceId: placement.workspace.workspace_id,
    tabId: placement.tab.tab_id,
    paneId: placement.pane.pane_id,
    title: threadTitle(thread),
    recencyAt: thread.recencyAt || thread.updatedAt || thread.createdAt || 0,
    lastFocusedAt: previous.lastFocusedAt || 0,
    lastParkedAt: previous.lastParkedAt || 0,
    managedTab,
  };
}

function retainUnsafeStaleThreads(finalThreads, stale, removedThreadIds) {
  for (const item of stale) {
    if (!removedThreadIds.has(item.threadId) && item.placement) {
      finalThreads[item.threadId] = retainedThreadRecord(item);
    }
  }
}

function isDirectory(candidate) {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}
