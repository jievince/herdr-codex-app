# Changelog

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
