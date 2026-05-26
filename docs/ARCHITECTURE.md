# Architecture

## Overview

Private Invitation is a third-party SillyTavern extension that creates homepage character invitations. It stores per-character invitation copy, can generate AI drafts from character/chat/world context, and displays saved lines in a visual invitation card.

The extension has no build step. SillyTavern loads `index.js` directly.

## Runtime Flow

1. SillyTavern loads `index.js`.
2. `index.js` calls `bootstrap()`.
3. `bootstrap()` waits for jQuery ready and calls `initializeApp()`.
4. `initializeApp()` loads settings, i18n, settings UI, menu item, console template, and event handlers.
5. The user opens the console from the extension menu.
6. The user selects invitation characters and maintains copy pools.
7. The homepage trigger chooses a character and reads saved copy.
8. The invitation dialog displays the character cover, line, and actions.
9. Entering the invitation calls `selectCharacterById(id, { switchMenu: true })`.

## Layer Diagram

```text
┌──────────────────────────────────────────────┐
│ Entry                                        │
│ index.js → src/bootstrap.js                  │
├──────────────────────────────────────────────┤
│ App Core                                     │
│ src/core/app.js                              │
│ - lifecycle                                  │
│ - settings normalization                     │
│ - character selection                        │
│ - copy pools and drafts                      │
│ - AI prompt building                         │
│ - API routing                                │
│ - invitation rendering                       │
│ - console event binding                      │
├──────────────────────────────────────────────┤
│ Templates                                    │
│ settings.html                                │
│ console.html                                 │
│ menu-item.html                               │
├──────────────────────────────────────────────┤
│ Styling                                      │
│ style.css                                    │
│ custom CSS injected as #pi-custom-style       │
├──────────────────────────────────────────────┤
│ i18n                                         │
│ src/i18n.js                                  │
│ i18n/zh-cn.json                              │
│ i18n/en-us.json                              │
├──────────────────────────────────────────────┤
│ SillyTavern APIs                             │
│ /script.js                                   │
│ /scripts/extensions.js                       │
│ /scripts/world-info.js                       │
│ /api/characters/chats                        │
│ /api/chats/get                               │
│ /api/backends/chat-completions/*             │
└──────────────────────────────────────────────┘
```

## Key Design Decisions

### Root-level extension structure

The extension root directly contains `manifest.json`, `index.js`, templates, styles, `i18n/`, and `src/`. This is the installable SillyTavern extension directory. Do not add a nested `extension/` folder.

### Extension menu entry

The user entry is the SillyTavern extension menu. The project intentionally does not use a floating ball.

### Dialog console

The main console uses a centered modal/native `<dialog>`. The settings inline drawer exists only as a normal SillyTavern settings entry and launcher.

### Saved copy at runtime

The homepage invitation never calls AI. It reads saved per-character copy pools. AI is a console-only draft generator.

### Shared preview classes

Preview and real invitation share `.pi-invitation-*` class names. This makes built-in CSS templates, custom CSS, and AI CSS visible in preview before the real popup appears.

### Independent API backend route

Independent API mode does not browser-fetch the configured API URL. It posts to SillyTavern same-origin backend endpoints:

- `/api/backends/chat-completions/generate`
- `/api/backends/chat-completions/status`

The configured OpenAI-compatible endpoint is passed through `reverse_proxy` and `proxy_password`. This avoids browser mixed-content blocking when SillyTavern is HTTPS and the independent API URL is HTTP.

### Self-contained i18n

The extension fetches its own locale JSON files. It does not depend on SillyTavern's translation namespace.

## Compatibility Notes

The extension must work under localhost, HTTP, HTTPS, and pure IP VPS access. Runtime code avoids secure-context-only browser APIs such as `crypto.subtle`.

