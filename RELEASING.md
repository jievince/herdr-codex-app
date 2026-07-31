# Releasing

Use this checklist for every tagged release.

1. Update the version in `herdr-plugin.toml`, `package.json`,
   `package-lock.json`, `src/constants.mjs`, and `CHANGELOG.md`.
2. Run:

   ```bash
   npm ci
   npm run check
   npm test
   node --experimental-test-coverage --test test/*.test.mjs
   npm run preflight
   ```

3. Push the release commit and tag.
4. From a clean Herdr profile, install the exact tag:

   ```bash
   herdr integration install codex
   herdr plugin install jievince/herdr-codex-app --ref vX.Y.Z
   herdr plugin action invoke jievince.herdr-codex-app.sync
   ```

5. Verify chat indexing, lazy resume, safe parking, cleanup, and uninstall.
6. Add or retain the public GitHub topic `herdr-plugin` only after the tagged
   install passes.

The repository description should be:

> Turn Herdr into a terminal-first Codex app: sync projects, resume chats.
