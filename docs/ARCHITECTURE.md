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

### Homepage mode resolution

`maybeShowHomepageInvitation()` keeps anger as the outer scheduling override:

```text
resolvePoolCharacters()
  ├─ if any anger-ready character exists
  │     → pick from anger candidates, mode = anger
  └─ else
        → pick one normal pool character
        → resolveInvitationModeAfterAnger(character)
             ├─ birthday / special date, if not consumed today
             ├─ reunion, if last chat age reaches the threshold
             ├─ jealousy, if the last-chat snapshot is recent and chance passes
             └─ primary
```

Only one mode is used per invitation. There are no combined pools such as anger-birthday or reunion-jealousy. Birthday mode writes a date-level consumption marker after a successful display, so the same local day does not repeatedly enter birthday mode.

The last-chat snapshot is updated from SillyTavern navigation events. While on a character chat page, the active character is stored as `state.activeChatCharacter`; when returning to the homepage, that snapshot is copied to `state.lastChatCharacter` with `leftAt`. Jealousy uses that snapshot only if the newly drawn character is different. The drawn character may override the global jealousy probability through `characterJealousyChances`; otherwise `jealousyChance` is the default.

Birthday / special-date resolution checks the drawn character first: `characterUserBirthdays`, `characterBirthdays`, and `characterDateEvents`. Global `userBirthday` and `customDateEvents` remain defaults, not the only source of date events.

Reunion checks only the character that was already randomly drawn. It uses `character.date_last_chat` first, then falls back to `/api/characters/chats` and the maximum `last_mes` timestamp. This does not increase old characters' draw probability.

### Shared preview classes

Preview and real invitation share `.pi-invitation-*` class names. This makes built-in CSS templates, custom CSS, and AI CSS visible in preview before the real popup appears.

### Independent API backend route

Independent API mode does not browser-fetch the configured API URL. It posts to SillyTavern same-origin backend endpoints:

- `/api/backends/chat-completions/generate`
- `/api/backends/chat-completions/status`

The configured OpenAI-compatible endpoint is passed through `reverse_proxy` and `proxy_password`. This avoids browser mixed-content blocking when SillyTavern is HTTPS and the independent API URL is HTTP.

### Self-contained i18n

The extension fetches its own locale JSON files. It does not depend on SillyTavern's translation namespace.

### AI batch generation pipeline

AI draft generation is the most layered part of the app core. The same pipeline serves main, retention, anger, jealousy, birthday, and reunion scopes. The relevant call chain:

```text
handleGenerateAiBatch(root, kind)
  ├─ if state.aiBatchActiveKind === kind && !aiBatchAbortRequested
  │     → set aiBatchAbortRequested, morph button to "Cancelling…", return
  ├─ reset abort flag, mark aiBatchActiveKind, morph button to cancel form
  └─ generateAiMessages(characterInfo, kind, { onProgress, shouldAbort })
        ├─ if !aiUseChatContext → runSingleGenerate(_, kind, '')         (0-batch fallback)
        ├─ collectChatContextSources(characterInfo)                       (read each source once)
        │     ├─ getContext()?.chat (no selected files)
        │     └─ fetchChatFileMessages(characterInfo, fileName)
        ├─ computeBatchRanges(settings)                                   (start..end in chunkSize steps)
        ├─ ranges.length === 0 → runSingleGenerate(_, kind, '')
        ├─ ranges.length === 1 → runSingleGenerate(_, kind, contextForOnlyRange)
        └─ ranges.length >= 2  → loop:
              ├─ if shouldAbort() break
              ├─ chatContext = renderSourcesForRange(sources, settings, range)
              │     └─ sliceChatMessages(messages, settings, range)
              │           └─ formatChatMessage(message, idx, filterTags, excludeTags, stripHtml)
              │                 └─ stripHtmlNoise(text) if stripHtml is true
              ├─ runSingleGenerate(characterInfo, kind, chatContext)
              │     ├─ buildCharacterPersonaContext
              │     ├─ buildWorldInfoContext
              │     ├─ getPromptPresetText / applyTemplate
              │     ├─ routeGenerate({ prompt, responseLength, trimNames })
              │     └─ parseGeneratedLines(reply).slice(0, batchCount)
              ├─ collected.push(...lines)
              ├─ onProgress({ current, total, phase: 'done' }) → info toast
              └─ if next batch && chatBatchDelayMs > 0 → await sleep(chatBatchDelayMs)
  └─ finally: clear abort flag, clear aiBatchActiveKind, restore button label / title
```

Key invariants:

- `runSingleGenerate` is the only path that calls `routeGenerate`. It is parameterized purely by `characterInfo`, `kind`, and `chatContext`.
- `collectChatContextSources` runs once per batch run, not per batch. Sources (current chat array or fetched chat files) are reused across batches.
- `renderSourcesForRange` re-slices the same source arrays per batch using `sliceChatMessages`'s `{rangeStart, rangeEnd}` override.
- `formatChatMessage` performs HTML-noise stripping (`stripHtmlNoise`) before exclude-tag stripping (`stripTaggedContent`) before include-tag extraction (`extractTaggedContent`). This order matters: pre-stripping HTML removes nodes that could otherwise interfere with tag matching.
- Anger-mode prompt assembly reuses the same pipeline through `aiPromptFieldFor / instructionKeyFor / rulesKeyFor / batchCountFieldFor / promptBodyFieldFor / presetFieldFor` helpers — there is no separate anger generation function.

### Tag matching regex contract

`extractTaggedContent(text, tags)` and `stripTaggedContent(text, tags)` both build per-tag regexes of the shape:

```js
new RegExp(`<\\s*${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\s*/\\s*${tag}\\s*>`, 'gi')
```

Matches:

- `<tag>...</tag>`
- `<tag attr="x">...</tag>`, `<tag  data-y="1" >...</tag>`, multi-line attribute lists

Does not match:

- `<taga>...</taga>` (word-boundary protection — `tag` is followed by either whitespace or `>`, never by an additional letter)
- Self-closing elements (`<img>`, `<br>`, etc.) — these are handled by `stripHtmlNoise` instead
- HTML comments (`<!-- ... -->`) — also `stripHtmlNoise`

Known limitation: nested same-name tags (`<div><div>inner</div></div>`) match only the first `</div>`. Chat floors rarely contain this; the limitation is documented but not patched.

### Console event binding

`bindConsoleEvents(root)` is called exactly once at extension init. It owns event listeners that should not be re-bound when settings change:

- Tab switching
- Filter / exclude chip pool input listeners (Enter / comma / paste / × delete / backspace)
- Number-pair sync between sliders and number inputs
- Close button, retention chance pair, color pickers, etc.
- Contextual copy-pool controls, per-character contextual settings, manual tests, and AI draft controls for jealousy, birthday, and reunion.

`syncDomFromSettings(root)` and `syncSettingsFromDom(root)` move state between the persisted `settings` object and the rendered DOM; they do not bind listeners. Re-rendering or re-opening the console should call sync, not bind.

## Compatibility Notes

The extension must work under localhost, HTTP, HTTPS, and pure IP VPS access. Runtime code avoids secure-context-only browser APIs such as `crypto.subtle`.
