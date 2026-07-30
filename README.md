# Herdr Codex App

English | [简体中文](README.zh-CN.md)

**Automatically sync recent Codex chats and projects into Herdr.**

The plugin reads your recently active Codex chats and adds them to Herdr:

- each exact project directory becomes a Herdr workspace;
- each Codex chat becomes a tab in that workspace;
- focusing a chat tab resumes its Codex TUI.

## What it looks like

```text
┌ Herdr ──────────────────────┬───────────────────────────────────────────┐
│ spaces                      │ < Fix login | Add tests | Update docs >  │
│                             ├───────────────────────────────────────────┤
│ ● project-1                 │                                           │
│   main                      │                                           │
│ ○ project-2                 │                 Codex TUI                 │
│   feature/search            │                                           │
│ ○ project-3                 │  Focus a chat tab to resume it.           │
│   main                      │                                           │
│ ○ project-4                 │                                           │
│   release                   │                                           │
│ ○ project-5                 │                                           │
│   docs                      │                                           │
│                             │                                           │
│ agents             priority │                                           │
│ ● project-1        working  │                                           │
│   Fix login...              │                                           │
│ ✓ project-1           idle  │                                           │
│   Add tests...              │                                           │
│ ✓ project-1           idle  │                                           │
│   Update docs...            │                                           │
│ ✓ project-2           idle  │                                           │
│   Improve search...         │                                           │
│ ✓ project-3           idle  │                                           │
│   Refactor cache...         │                                           │
│ ✓ project-4           idle  │                                           │
│   Prepare release...        │                                           │
│ ✓ project-5           idle  │                                           │
│   Review docs...            │                                           │
└─────────────────────────────┴───────────────────────────────────────────┘
```

Projects appear under `spaces`, chats appear as tabs and under `agents`, and
the selected chat runs in the main pane. History tabs stay lightweight until
focused. The plugin syncs automatically when Herdr starts or performs a live
handoff.

## Install

Requires Linux, Herdr 0.7.5+, Node.js 20+, and Codex CLI 0.146.0+.

```bash
herdr integration install codex
herdr plugin install jievince/herdr-codex-app
herdr plugin action invoke jievince.herdr-codex-app.sync
```

The last command performs the first sync immediately; later Herdr startups
sync automatically.

## Use

1. Open Herdr's workspace browser.
2. Select the workspace for your project.
3. Focus a Codex chat tab to resume it.

Refresh at any time:

```bash
herdr plugin action invoke jievince.herdr-codex-app.sync
```

If the same chat is already running in another pane, the plugin focuses that
pane instead of starting a second TUI.

## Configure

Find the configuration directory:

```bash
herdr plugin config-dir jievince.herdr-codex-app
```

Create `config.json` there. All fields are optional:

```json
{
  "maxIndexedChats": 40,
  "maxIndexedChatsPerProject": 8,
  "maxActiveTuis": 8,
  "codexRemoteEndpoint": "unix://",
  "sourceKinds": ["cli", "vscode", "appServer"]
}
```

| Field | Default | Meaning |
| --- | ---: | --- |
| `maxIndexedChats` | `40` | Recent chats kept across all projects. |
| `maxIndexedChatsPerProject` | `8` | Recent chats kept for one exact project directory. |
| `maxActiveTuis` | `8` | Soft limit for running managed Codex TUIs. |
| `codexRemoteEndpoint` | `"unix://"` | Endpoint used by `codex resume --remote`. |
| `sourceKinds` | `["cli", "vscode", "appServer"]` | Codex chat sources included in sync. |

Run the refresh action after changing indexing limits or sources. Other
settings apply on the next chat focus.

## Notes

- The plugin stores paths, chat IDs, titles, and Herdr placement metadata, but
  never stores or edits Codex transcripts.
- The active-TUI limit only parks unfocused `idle` or `done` managed TUIs. It
  never kills a working, blocked, focused, or unknown process.
- Invalid JSON fails visibly. Invalid field values use the documented defaults.

## Development

```bash
npm ci
npm run check
npm test
npm run preflight
```

See [RELEASING.md](RELEASING.md) for the release checklist.

## License

Apache-2.0. See [LICENSE](LICENSE).
