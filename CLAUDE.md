# Claude Development Instructions

This document is for Claude Code and other AI assistants working on Private Invitation.

## Project Overview

Private Invitation is a SillyTavern extension for homepage character invitations. It shows selected characters with full-cover artwork, memory-style copy, and optional retention lines. AI generation is used only inside the console to create drafts; the homepage invitation reads saved copy pools.

## Before Making Changes

1. Read `AGENTS.md`.
2. Read `docs/ARCHITECTURE.md` and `docs/DATA_MODEL.md` when changing behavior or persisted settings.
3. Inspect the current code before proposing changes.
4. Keep changes inside the extension root. Do not add a nested `extension/` folder.

## Code Conventions

- Pure ES module JavaScript.
- No build step.
- 4-space indentation.
- Semicolons required.
- Internal imports use relative paths.
- SillyTavern imports use `/script.js`, `/scripts/extensions.js`, and `/scripts/world-info.js`.
- All user-visible copy must use i18n.

## Runtime Compatibility

The extension must work on:

- `localhost`
- HTTP
- HTTPS
- pure IP VPS access

Do not use browser APIs that require a secure context unless there is a fallback. Avoid `crypto.subtle`, clipboard APIs, Service Worker APIs, and similar secure-context-only dependencies.

Independent API requests must go through SillyTavern same-origin backend endpoints. Do not browser-fetch the configured API URL directly.

## UI Rules

- The console is a centered modal/native `<dialog>`.
- Do not replace the main console with a drawer.
- Do not add a floating ball.
- The SillyTavern settings inline drawer is only a small launcher/settings entry.
- Preview and real invitation should share `.pi-invitation-*` classes so custom CSS affects both.
- Mobile action buttons must remain visible and clickable.

## i18n Rules

1. Add every new key to `i18n/zh-cn.json`.
2. Add the matching key to `i18n/en-us.json`.
3. Keep key sets identical.
4. Static fallback text in HTML should match the meaning of the i18n value.

## Verification

Use these checks before handoff:

```bash
node --check src/core/app.js
node --check src/i18n.js
node -e "const fs=require('fs'); const zh=JSON.parse(fs.readFileSync('i18n/zh-cn.json','utf8')); const en=JSON.parse(fs.readFileSync('i18n/en-us.json','utf8')); const z=Object.keys(zh).sort(); const e=Object.keys(en).sort(); const missingEn=z.filter(k=>!e.includes(k)); const missingZh=e.filter(k=>!z.includes(k)); console.log({zh:z.length,en:e.length,missingEn,missingZh}); if(missingEn.length||missingZh.length) process.exit(1);"
```

After syncing to the test directory, run `diff -qr` between source and test directory.

