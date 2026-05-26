# AI Development Workflow & Instructions

This file applies to all AI coding agents working on this project.

## 0. Project Boundary

Private Invitation is a third-party SillyTavern extension. It is pure ES module JavaScript with no build step.

The extension root must directly contain:

- `manifest.json`
- `index.js`
- `settings.html`
- `console.html`
- `menu-item.html`
- `style.css`
- `i18n/`
- `src/`

Do not add an extra `extension/` wrapper directory.

## 1. Branch Management

The `main` branch is production/distribution code.

1. Create a feature branch from `main`: `feat/feature-name`, `fix/bug-name`, or `docs/description`.
2. Work on the feature branch.
3. Verify before merging: syntax checks, i18n key parity, source/test directory sync, and manual SillyTavern testing.
4. Merge to `main` only after user approval.

Do not commit directly to `main` unless the user explicitly asks for it.

## 2. Code Quality

- Use pure ES modules. No TypeScript, bundler, or generated build output.
- Use 4-space indentation and semicolons.
- Keep user-visible strings in i18n files. Add keys to both `i18n/zh-cn.json` and `i18n/en-us.json`.
- Do not hardcode secrets. API keys live only in user settings.
- Do not hardcode hosts, protocols, localhost, or VPS IPs for runtime requests.
- Keep SillyTavern imports as absolute ST module imports (`/script.js`, `/scripts/extensions.js`, `/scripts/world-info.js`) and internal imports as relative paths.
- Avoid dead code and commented-out code blocks.

## 3. UI Rules

- Primary UI is a centered modal/native `<dialog>`, not a drawer and not a floating ball.
- Entry lives in the SillyTavern extension menu.
- The normal SillyTavern settings area may use an inline drawer only as a small launcher/settings entry.
- Top-level console tabs are stable product areas: invitation characters, copy, AI generation, look, and appearance.
- Buttons must remain horizontal. SillyTavern narrow layouts can otherwise turn labels vertical.
- Mobile actions in the real invitation dialog must remain visible and clickable.
- Custom CSS must not break the core card size, dialog bounds, or action buttons.

## 4. API Rules

- Shared mode uses SillyTavern `generateRaw`.
- Independent mode must not browser-fetch the configured API URL directly.
- Independent generation must go through the SillyTavern same-origin backend endpoint `/api/backends/chat-completions/generate`.
- Independent model fetching must go through `/api/backends/chat-completions/status`.
- Pass custom OpenAI-compatible API config through `reverse_proxy` and `proxy_password`.
- This backend route is required so HTTPS SillyTavern pages can still use HTTP independent API URLs without browser mixed-content blocking.

## 5. Adding Settings

For every new setting:

1. Add a default value in `defaultSettings` in `src/core/app.js`.
2. Normalize it in `ensureSettings` if needed.
3. Add the UI element in `console.html` or `settings.html`.
4. Bind it in `syncDomFromSettings`, `syncSettingsFromDom`, or the relevant card-specific binding.
5. Add i18n keys to both locale files.
6. Include the setting in preview or real invitation rendering if it affects visual output.

## 6. Pre-Commit Checks

Before committing:

1. Run `node --check src/core/app.js`.
2. Run `node --check src/i18n.js`.
3. Parse both i18n JSON files and verify identical key sets.
4. Confirm there is no extra `extension/` directory.
5. Sync the whole project directory to the Docker/SillyTavern test extension directory with `rsync` mirror semantics.
6. Run `diff -qr` between source and test directory after sync.

## 7. Deployment Sync

The test extension directory is:

```text
/Users/hylaw/Projects/Docker/SillyTavern-release/data/default-user/extensions/private-invitation/
```

Sync with a full directory mirror, excluding only transient files:

```bash
rsync -av --delete --exclude '.git/' --exclude 'node_modules/' --exclude '.DS_Store' \
  /Users/hylaw/Projects/private-invitation/ \
  /Users/hylaw/Projects/Docker/SillyTavern-release/data/default-user/extensions/private-invitation/
```

## 8. Commit Messages

Use Conventional Commits:

- `feat(api): route independent generation through SillyTavern backend`
- `fix(ui): keep mobile actions visible`
- `docs: add release checklist`
- `refactor(copy): consolidate character selection`

