# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- New contextual homepage callback modes: jealousy, birthday / special date, and SSR / EX reunion.
- Jealousy copy pools with last-chat template variables: `{lastChar}`, `{lastChat}`, and `{minutesSinceLastChat}`.
- Per-character jealousy appearance weights, allowing different characters to appear at different rates when a post-chat jealousy event is eligible.
- Time and date template variables for saved copy pools: `{time}`, `{hour}`, `{weekday}`, `{date}`, `{period}`, `{todayEvent}`, `{daysUntilCharacterBirthday}`, and `{daysUntilUserBirthday}`.
- Per-character character birthdays, user birthdays, and custom special dates, with global defaults available as fallbacks.
- Birthday / special-date line tags: `用户生日==`, `角色生日==`, event-name tags, and `通用==`, with `--`, `==`, `：：`, and `::` separators.
- A one-day birthday / special-date guard so a successful date callback does not repeat on the same local date.
- SSR / EX reunion thresholds with `{daysSinceLastChat}`, `{lastChatDate}`, and `{reunionTier}` template variables.
- Distinct reunion visual treatments for SSR and EX callbacks.
- AI draft generation scopes for jealousy, birthday / special date, and reunion, each with built-in prompt presets.
- Manual preview / trigger controls for jealousy, birthday / special date, and reunion callbacks.
- Light console panel themes: Mist Blue, Frost Blue, Citrus, Snow, and Sakura.
- Birthday / special-date variable help and a control to reset the current local date guard.

### Changed

- Homepage mode resolution now selects one mode per popup in this order: anger-ready callbacks, birthday / special date, post-chat jealousy, reunion, then primary.
- Jealousy, birthday / special-date, and reunion now activate from their configured data and thresholds instead of separate global enable switches.
- Jealousy uses a global event chance first, then picks from eligible characters by their per-character appearance weights.
- Birthday / special-date callbacks only use matching tagged lines, generic tagged lines, or untagged birthday / special-date lines. Main invitation lines are not used as date fallback.
- Last-chat snapshots are kept in the current runtime session, so refreshed homepages do not reuse an older jealousy context.
- Reunion absence checks prefer the chat list's last-message timestamp, with SillyTavern `date_last_chat` used only as a fallback.
- User-facing manual popup controls now use preview / manual-trigger wording.

### Fixed

- Console text inputs, textareas, selects, placeholders, disabled states, and select options now use scoped panel control colors so they remain readable across built-in panel themes and SillyTavern themes.
- Reunion detection supports month-name `send_date` values from SillyTavern chat metadata.
- SSR and EX reunion callbacks now use distinct labels and visual intensity.

## [1.0.0] - 2026-05-27

Initial public release.

### Homepage callbacks

- Homepage invitation flow that randomly surfaces a selected character with full-cover artwork, a saved line, an "enter" action that calls `selectCharacterById(id, { switchMenu: true })`, and a "dismiss" action.
- Three presentation modes: barrage (multiple horizontally-floating lines), bubble (9-grid positioned dialogue bubble with `bubbleOffsetX` / `bubbleOffsetY` micro-adjust), and banner (cinematic bottom strip above the action row, leaving the character name visible at the top).
- Configurable barrage line count (`barrageLineCount`, 2–8, default 3) with auto-shrinking font size so high counts stay readable.
- Optional retention round: dismissing the main invitation triggers a second callback at configurable probability (`retentionChance`). Retention uses its own per-character copy pool, not the main pool.
- Anger mode: when a character is dismissed enough times (`angerThreshold`, default 5), the next callback for that character switches to the anger form. Anger mode has no dismiss path — a configurable countdown (`angerCountdownSeconds`, default 6s, range 3–20) force-enters the chat. Reject count resets on accept by default (`angerResetOnAccept`).
- Anger-ready characters get scheduling priority: when picking from the pool, any character past the threshold and with anger lines saved is chosen first; the regular pool only runs when no anger-ready character exists.
- Homepage trigger modes: `session` (one popup per refresh / page load), `cooldown` (re-show after `homepageCooldownMinutes`), `everyHome` (every return to the homepage), and `manual` (auto-popup off; manual trigger only).
- Homepage popup never calls AI at runtime — it only reads saved per-character copy pools, so display stays fast and predictable.

### Copy pools and AI drafts

- Per-character copy pools stored separately for main invitation, retention, and anger lines (`characterMessages` / `retentionMessages` / `angerMessages`).
- AI-generated drafts persist in matching per-character draft pools (`characterDrafts` / `retentionDrafts` / `angerDrafts`) until the user moves them into the saved pool or removes them.
- Three copy tab cards with chip lists, search, click-to-edit, paste-multi-line input, and append-all / clear-drafts shortcuts.
- AI generation reads optional inputs: the character card persona, a selected floor range of one or more chat files (or the current chat), and selected world books / entries.
- Built-in prompt presets: 5 main invitation (memory flashback, signature moments, old chat echo, world shard, emotional hook), 5 retention (last whisper, unkept promise, restrained pleading, possessive warmth, story cliffhanger), and 8 anger (cold back, monosyllabic, sore-spot callback, mocking distance, silent exit, pressured outburst, silent glare, direct warning).
- Custom prompt templates per scope (`aiCustomTemplates` / `retentionCustomTemplates` / `angerCustomTemplates`), saved under user-named keys (`custom:<name>`).
- Anger intensity setting (`angerIntensity`: `restrained` / `direct` / `outburst`) layers on top of every anger preset to control how explicit the AI output is.
- Prompt rules forbid advertising-style invitations, customer-service openers, blunt enter-now phrasing; retention rules additionally forbid coercive or oily phrasing; anger rules require each line to read as anger and explicitly forbid screaming insults or character attacks.
- `responseLength` is controlled by `aiMaxTokens` (default 2400, up to 16000) to keep reasoning models from being cut off.

### Auto-batch generation

- `chatFloorStart` / `chatFloorEnd` / `chatChunkSize` describe a real auto-batch pipeline: the plugin walks the floor range in chunk-sized batches automatically and merges every batch's drafts into the pool.
- Cancellable: during generation the same button morphs into `✕ Cancel ({current}/{total})` with a tooltip. Clicking again sets an abort flag, lets the current batch finish, then stops the loop. Already-completed batches are kept; a warning toast reports `Completed X/Y batches; N drafts added`.
- Each batch completion fires an info toast. The button title (tooltip) explains that completed batches are kept on cancel.
- `chatBatchDelayMs` setting (default 500ms, range 0–5000) sleeps between batches to keep proxied APIs comfortable.
- 0-batch fallback: when `aiUseChatContext` is off or no chat source is selected, the plugin makes a single AI call with no chat context (no progress label shown).
- 1-batch fast path: when the floor range fits in one chunk, the plugin runs the legacy single-shot flow with no progress label.

### Chat context controls

- Floor range with three visible labels (start floor, end floor, floors per batch).
- Token estimate reflects the actual single-batch payload that will be sent.
- Hidden messages are intentionally still read (users frequently park summaries in hidden floors).
- Chat source selection: optionally read selected historical chat files per character (`characterChatFiles`); when none are selected, the current chat is read.
- Filter / exclude tag chip pools: filter tags render as green chips (allow-list — keep only `<tag>...</tag>` content), exclude tags as red chips (block-list — strip `<tag>...</tag>` content). Enter / comma / semicolon (zh + en) commits a chip; paste with separators splits into multiple chips; backspace on empty input removes the trailing chip.
- Tag matching accepts attributes: entering `div` strips `<div class="x">...</div>`, `<span style="...">...</span>`, etc. Word-boundary check still prevents `<diva>` from matching `div`.
- `stripHtmlNoise` switch (default on): strips HTML comments (`<!-- ... -->`) and self-closing elements (`<img>`, `<br>`, `<hr>`, `<meta>`, `<input>`, `<source>`, `<track>`, `<wbr>`, `<area>`, `<base>`, `<col>`, `<embed>`, `<link>`, `<param>`) before tag filter / exclude processing.
- Per-character world book selection (`characterWorldNames`) with character-bound defaults shown first and labeled.
- Per-entry world book selection (`characterWorldEntries`): toggle a whole book or pick specific entry UIDs. Selection state survives the world-info entry search filter (selecting an entry, then filtering, does not lose the selection).
- `worldEntryLimit` caps the number of world entries injected.

### Visual customization

- Real invitation card uses the character cover as the visual foundation: blurred ambient background underlay, full standee on top with `object-fit: contain`, name / line / actions stacked over the image.
- Cover effects (`coverEffect`): breath, float, glow, parallax, static.
- Cover fit (`coverFit`).
- 9-grid bubble positioning with `bubbleOffsetX` / `bubbleOffsetY` micro-adjustment.
- Adjustable text font size, opacity, container width / height, container color, container opacity.
- 8 built-in CSS templates (mono / neon border / vintage / palace / gothic shadow / soft glow / comic panel / cyber dream).
- User-saved CSS templates (`customCssTemplates`) — save, switch, delete.
- Custom CSS injected as `<style id="pi-custom-style">` into the document head.
- AI-assisted CSS generation: uses `routeGenerate`, returns are scrubbed by `extractCssFromAiReply` and applied immediately. Prompt rules forbid changing `.pi-invitation-card` dimensions / margin / transform, dialog width / margin / padding / transform, or `.pi-invitation-actions` visibility / clickability.
- Preview and real invitation share the `.pi-invitation-*` class names, so built-in CSS, custom CSS, and AI CSS all show up in preview before the real popup.
- Console panel theme setting (`panelTheme`): five built-in themes (`midnight` / `parchment` / `ember` / `jade` / `st`); `midnight` is the default so the console does not depend entirely on SillyTavern theme tokens, `st` follows the SillyTavern theme.
- Mobile fallback: `.pi-invitation-actions` has a sticky fallback so action buttons remain visible and clickable even with aggressive custom CSS.

### Anger mode visuals and AI

- Anger invitation card with red-black rage treatment, flickering opacity, pulsing crack-corner frame, blood-red cover gradient, flashing kicker badge, rage-pulse character name, monospace red countdown panel, four animated anger markers at the corners.
- All anger colors driven by `--pi-anger-accent` so the color picker re-themes the entire treatment.
- Anger AI draft generation in the AI tab with eight built-in presets and three intensity levels stacked on top.
- Anger mode preview buttons (copy tab manual preview, run-control random invitation preview) do not increment `rejectCounts` and do not actually enter the chat. After the countdown ends or ESC is pressed, the dialog closes with a toast and the console reopens to the originating tab.

### API modes

- Shared mode (default): uses SillyTavern's current `generateRaw` for everything.
- Independent mode: configure an OpenAI-compatible endpoint (`independentApiConfig`: `apiUrl`, `apiKey`, `model`). Multiple profiles can be saved (`apiProfiles`) and switched at any time.
- Independent generation does not browser-fetch the configured API URL directly; it posts to SillyTavern's same-origin backend endpoint `/api/backends/chat-completions/generate` and uses `reverse_proxy` + `proxy_password` for the outgoing OpenAI-compatible request. This avoids browser mixed-content blocking when the SillyTavern page is HTTPS and the configured API URL is HTTP.
- Independent model list pulls via SillyTavern's same-origin backend `/api/backends/chat-completions/status` for the same reason.
- API URL normalization: users can paste a base URL, `/v1`, `/v1/models`, or `/v1/chat/completions`; the plugin normalizes to a base URL + `/v1` before handing off to the SillyTavern backend.
- Independent mode with incomplete config falls back to shared mode silently rather than hard-failing.
- API mode card is a collapsible details element with the active mode tag in the summary.

### Console layout and entry points

- Entry is the SillyTavern extension menu. The settings inline drawer exists only as a small launcher / settings entry — no floating ball, no drawer as the main UI.
- Main console is a centered modal / native `<dialog>`. The console template is rendered through `renderExtensionTemplateAsync` with DOMPurify disabled so the `<dialog>` element is preserved.
- Top-level tabs: `Invitation Characters` / `Copy` / `AI Generate` / `Look` / `Appearance`. Plus a `Run Control` tab that consolidates the most-used switches (enable plugin, show menu entry, enable homepage auto-popup) without removing the originals from the settings drawer.
- AI tab keeps a sticky current-character banner near the top so prompt assembly stays focused on the right character.
- Console blank-area clicks do not accidentally close the modal.

### Internationalization

- Self-contained bilingual i18n (Chinese / English). The extension fetches its own locale JSON files and does not depend on SillyTavern's translation namespace.
- `src/i18n.js` `applyI18n` supports arbitrary `[attr]key` form, not just `[title]` / `[placeholder]`.
- The plugin never refers to itself as a familial nickname in UI or i18n strings.

### Compatibility

- Works under `localhost`, plain HTTP, HTTPS, and pure-IP VPS access (e.g. `http://203.0.113.10:8000`).
- Runtime code avoids secure-context-only browser APIs such as `crypto.subtle`, so the plugin loads correctly in non-secure-context environments.
- Mobile console tab bar is a 50px horizontal compact-chip scroller (32px tab) using inner `box-shadow` for active / focus state so the scroll container does not crop the indicator.
- Mobile `.pi-mini-preview-bar` (appearance live preview) and `.pi-current-character-banner` (AI tab) stay sticky during scroll, matching desktop behavior.
- Copy tab desktop character row is an explicit four-column grid so badges and character info do not misalign.

### Stability hardening

- Homepage auto-invitation waits for `APP_READY` plus a post-`APP_READY` grace window (`homepageAppReadyGraceMs`, 2500ms) before counting homepage stability time. The earlier "character list loaded" gate was satisfied very early during slow VPS boot and let the invitation pop while SillyTavern was still restoring the user's last chat.
- Accepting an invitation re-checks the ready state at click time. If SillyTavern is not ready, the invitation stays open and a toast asks the user to retry — preventing `selectCharacterById` from being called mid-restore and overwriting the user's existing chat with an empty new one.
- Cover artwork is preloaded before the invitation pops out, with a timeout fallback. Preload completion re-checks that the user is still on the homepage, reducing premature pops on slow VPS that could otherwise prevent entry.

### SillyTavern integration boundaries

- SillyTavern internal API calls resolve against the current page origin instead of relying on a hardcoded host or protocol.
- SillyTavern imports use absolute module paths (`/script.js`, `/scripts/extensions.js`, `/scripts/world-info.js`); internal imports use relative paths.
- Generation routing is centralized in `routeGenerate({ prompt, responseLength, trimNames })`; shared and independent modes are both reached through this single function.
