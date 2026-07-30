# Herdr Codex App

English | [简体中文](README.zh-CN.md)

**Browse and resume Codex chats as native Herdr workspaces and tabs.**

Herdr's built-in Codex integration recognizes running Codex agents. This
plugin adds your saved Codex chat history to Herdr's normal navigation:

- one workspace per exact project directory;
- one tab per indexed Codex chat;
- a lightweight history placeholder until you focus the tab;
- lazy resume through the shared Codex app server;
- a soft LRU limit for active Codex TUIs.

## What it looks like

```text
+ HERDR ---------------------------------------------------------------+
| WORKSPACES / PROJECTS       | ACTIVE WORKSPACE: project-1            |
|                             |                                        |
| > project-1                 | TABS                                   |
|   project-2                 | [Feature*] [Tests: history]            |
|   herdr-codex-app           | [Write docs: history]                  |
|                             +----------------------------------------+
| AGENTS                      | ACTIVE PANE                            |
|                             |                                        |
| Codex          working      | Codex                                  |
| Codex history  idle         | status: working                        |
| Codex history  idle         | cwd: ~/project-1                       |
|                             |                                        |
|                             | > Implement the feature...             |
+---------------------------------------------------------------------+

  Codex project directory -> Herdr workspace
  Saved Codex chat        -> workspace tab
  Focus a history tab     -> resume its Codex TUI
  Exceed the TUI limit    -> park the least-recent safe TUI
```

Colors and dimensions follow the user's Herdr theme and terminal.

## Requirements

- Herdr 0.7.5 or newer;
- Linux;
- Node.js 20 or newer;
- Codex CLI 0.146.0 or newer.

The installer checks Node.js and Codex CLI versions before registering the
plugin. Codex CLI 0.146.0 is the oldest verified version.

## Install

Install Herdr's Codex integration first:

```bash
herdr integration install codex
herdr plugin install jievince/herdr-codex-app
herdr plugin action invoke jievince.herdr-codex-app.sync
```

The explicit first refresh is intentional. A Herdr startup hook runs when the
server starts or performs a live handoff, not immediately after `plugin
install` or `plugin link`.

Open Herdr's workspace browser after the refresh. Select a generated project
workspace, then focus a history tab to resume that chat.

## Configuration

Find the plugin's configuration directory:

```bash
herdr plugin config-dir jievince.herdr-codex-app
```

Create `config.json` there. Every field is optional:

```json
{
  "maxIndexedChats": 40,
  "maxIndexedChatsPerProject": 8,
  "maxActiveTuis": 8,
  "codexRemoteEndpoint": "unix://",
  "sourceKinds": ["cli", "vscode", "appServer"]
}
```

| Field | Default | Purpose |
| --- | ---: | --- |
| `maxIndexedChats` | `40` | Maximum recent chats shown across all projects. |
| `maxIndexedChatsPerProject` | `8` | Maximum recent chats shown for one exact project directory. |
| `maxActiveTuis` | `8` | Soft limit for running managed Codex TUIs. |
| `codexRemoteEndpoint` | `"unix://"` | Endpoint passed to `codex resume --remote`. |
| `sourceKinds` | `["cli", "vscode", "appServer"]` | Interactive Codex thread sources requested from `thread/list`. |

Configuration is read on every startup hook, refresh action, and focus event.
Run the refresh action after changing history limits or source kinds. LRU and
endpoint changes apply on the next relevant focus event.

Malformed JSON fails visibly. Invalid positive-integer limits, an empty
endpoint, and an empty or non-array `sourceKinds` value use their documented
defaults.

### Active-TUI LRU

The TUI limit is deliberately soft:

- the focused pane is never parked;
- `working`, `blocked`, and `unknown` Codex TUIs are never parked;
- only unfocused `idle` or `done` managed TUIs are candidates;
- parking sends `/quit`, waits for the TUI to exit, then restores the history
  placeholder.

If no additional TUI is safe to park, the plugin reports the remaining
overflow instead of killing a busy or ambiguous process.

## Safety and privacy

The plugin changes Herdr navigation, not Codex history:

- it creates or reuses workspaces by exact project directory;
- it owns only tabs and placeholders marked with its metadata;
- it revalidates ownership, pane count, focus, and thread ID immediately
  before cleanup;
- it never closes a user tab or a tab containing a live Codex TUI;
- it never edits or deletes Codex transcripts.

Plugin state contains local project paths, Codex thread IDs, chat titles,
Herdr IDs, and focus/parking timestamps. It does not store chat transcripts.
Configuration and state stay in Herdr's per-plugin directories.

## Known boundary

The app can safely resume and manage panes carrying an exact
`codex_thread_id`. Indexed history tabs always have one.

A brand-new standalone `codex` TUI does not expose its new thread ID in its
process arguments. Until Herdr has exact thread metadata, the plugin leaves
that pane alone. An older `codex resume <thread-id>` process with exact
metadata can be migrated to the shared app server only while it is `idle` or
`done`.

## Development

```bash
npm ci
npm run check
npm test
npm run preflight
```

Tests use temporary directories and fake Herdr/Codex executables. They do not
modify a running Herdr session. See [RELEASING.md](RELEASING.md) for the
release checklist.

## License

Apache-2.0. See [LICENSE](LICENSE).
