# Changelog

## 0.1.11 - 2026-08-11

- Repair missing chat metadata during startup and manual sync instead of on
  pane focus.
- Build the chat index from the Codex state database without scanning rollout
  files.
- Use Herdr's global Agent index for duplicate detection and active-TUI LRU.

## 0.1.10 - 2026-08-11

- Recover legacy history tabs on focus when exact project and title metadata
  identify one Codex chat.
- Keep recovered legacy tabs outside automatic deletion ownership.

## 0.1.9 - 2026-08-11

- Safely prune managed duplicate placeholders even when an older sync placed
  them in the wrong project workspace.

## 0.1.8 - 2026-08-11

- Isolate persisted topology and runtime locks by Herdr session.
- Restore verified chat placeholders after a Herdr server restart without
  duplicating tabs.
- Reject stale cross-session workspace IDs and prune safe duplicate
  placeholders.
- Use bounded project identity tokens so long working directories remain
  idempotent.

## 0.1.7 - 2026-07-31

- Reframe the public tagline around the terminal-first Codex app experience.

## 0.1.6 - 2026-07-30

- Use pane focus only to recover a missing first sync.
- Stop focus-driven sync permanently after the first successful sync.

## 0.1.5 - 2026-07-30

- Sync in the background after pane focus.
- Throttle automatic sync requests while keeping explicit refresh available.
- Clarify first-run, automatic, and manual sync behavior in both READMEs.

## 0.1.4 - 2026-07-30

- Focus an already running Codex chat instead of starting a duplicate TUI.
- Simplify the English and Chinese READMEs around automatic recent-chat and
  project sync.

## 0.1.3 - 2026-07-30

- Use fictional project data in all public documentation examples.

## 0.1.2 - 2026-07-30

- Run CI on the latest supported GitHub Actions runtimes.

## 0.1.1 - 2026-07-30

- Make the app-server timeout test independent of CI runner startup latency.

## 0.1.0 - 2026-07-30

- Establish Herdr Codex App as the product identity for a terminal-first Codex
  experience inside Herdr.
- Index recent Codex threads by exact project working directory.
- Lazily resume indexed chats through the shared Codex app server.
- Enforce a soft active-TUI LRU limit without parking unsafe agent states.
- Safely prune stale plugin-owned placeholders after fresh ownership checks.
- Recover dead-owner locks without stealing locks from live processes.
