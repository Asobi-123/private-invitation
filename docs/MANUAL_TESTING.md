# Manual Testing Checklist

This checklist is for release validation before publishing a new Private Invitation version.

## Preconditions

- SillyTavern loads without extension initialization errors.
- At least two character cards are available.
- At least one character has a cover/avatar.
- At least one test chat has enough messages for AI context testing.
- Shared API can complete a normal reply, or an independent OpenAI-compatible endpoint is reachable from the SillyTavern server.
- Test one desktop viewport and one narrow/mobile viewport.

## 1. Extension Load And Menu Entry

Steps:

1. Refresh SillyTavern.
2. Open the extension menu.
3. Click **Private Invitation / 专属邀约**.

Expected:

- No initialization error appears.
- The menu entry appears when enabled.
- The centered console opens.
- Closing and reopening the console works.

## 2. Character Pool

Steps:

1. Open the invitation character tab.
2. Search for a character.
3. Select one or more characters.
4. Use select-visible and clear-selected actions.
5. Add a manual character name/file/id entry.

Expected:

- Search filters without losing selected state.
- Selected characters move or remain easy to identify.
- Manual entries persist.
- Empty selection means all characters are eligible.

## 3. Copy Pools

Steps:

1. Open the Copy tab.
2. Select a current character.
3. Add several main invitation lines.
4. Add several retention lines.
5. Add several anger, jealousy, birthday, and reunion lines.
6. Set a per-character jealousy label, jealousy appearance weight, character birthday, user birthday, and special date.
7. Delete one line from each pool.
8. Reload SillyTavern and reopen the console.

Expected:

- Copy pools are stored per character.
- Main, retention, anger, jealousy, birthday, and reunion pools do not overwrite each other.
- Chip lists render correctly.
- Per-character jealousy label, jealousy appearance weight, birthday, user birthday, and special dates persist.
- Reload preserves saved lines.

## 4. Shared API Draft Generation

Steps:

1. Switch API mode to shared.
2. Select a character.
3. Generate main invitation drafts.
4. Move one draft into the saved pool.
5. Generate retention, anger, jealousy, birthday, and reunion drafts.
6. Move one draft from each scope into the matching saved pool.

Expected:

- Drafts are generated through SillyTavern's configured API.
- New drafts append to existing drafts.
- Moving a draft removes it from the draft list and adds it to the correct saved pool.
- Main, retention, anger, jealousy, birthday, and reunion drafts remain separate.

## 5. Independent API Draft Generation

Steps:

1. Switch API mode to independent.
2. Fill API URL, model, and API key if required.
3. Use an HTTP API URL while SillyTavern is served over HTTPS if that environment is available.
4. Fetch models or type a model manually.
5. Generate a main invitation draft.

Expected:

- Fetch Models uses SillyTavern backend routing and does not trigger browser mixed-content errors.
- Generation uses `/api/backends/chat-completions/generate`.
- HTTP independent API URLs work when the SillyTavern server can reach them.
- Missing API URL or model falls back to shared mode instead of hard failing.

## 6. Chat Context

Steps:

1. Enable chat context.
2. Select a historical chat file.
3. Set start floor, end floor, and chunk size.
4. Add include-tag filters (filter chip pool).
5. Add exclude-tag filters (exclude chip pool).
6. Toggle the "Strip HTML comments and img tags" switch.
7. Generate drafts.

Expected:

- Floor labels are visible.
- Filter chips render green; exclude chips render red.
- Enter / comma / semicolon (zh + en) commits a chip; backspace on empty input removes the trailing chip; paste with separators splits into multiple chips.
- Token estimate reflects the actual chunk, not the entire chat file.
- Include filters keep only matching tag contents; tags with attributes (`<div class="x">…</div>`) match when only the tag name is provided.
- Exclude filters remove matching tag contents first; attribute-bearing tags are also removed.
- With the strip switch on, HTML comments (`<!-- ... -->`) and self-closing elements (`<img>`, `<br>`, `<hr>`, etc.) are removed before tag filtering.
- Hidden messages are still eligible for context.

## 6.1 Auto-Batch Generation

Steps:

1. Set up a chat with significantly more floors than `chatChunkSize` (e.g. 80+ floors, chunk size 20).
2. Set start floor = 0, end floor = 80, batch delay = 500ms.
3. Generate drafts in the dialogue / retention / anger / jealousy / birthday / reunion scope.
4. While generation is running, observe the button label.
5. Mid-run, click the button to cancel.
6. After the run, inspect the draft pool count.
7. Repeat with `aiUseChatContext` disabled.

Expected:

- The button morphs from "AI generate drafts" to "✕ Cancel (1/4)" → "✕ Cancel (2/4)" → … as batches progress.
- The button tooltip explains that completed batches are kept on cancel.
- An info toast fires after each batch completes ("Batch X/Y done").
- Clicking the button mid-run changes the label to "Cancelling… (X/Y)" and disables further clicks; the current batch finishes, then the loop stops.
- A warning toast reports "Completed X/Y batches; N drafts added" after cancellation.
- Already-generated drafts from completed batches are present in the pool.
- With `aiUseChatContext` disabled, only one AI call is made and no progress label appears (0-batch fallback).
- The `chatBatchDelayMs` value adds a visible delay between batches (test with 2000ms to confirm). Setting it to 0 produces back-to-back calls.

## 7. World Info Context

Steps:

1. Enable world info context.
2. Select a character with default world info if available.
3. Expand a world book.
4. Toggle all entries.
5. Select individual entries.
6. Generate drafts.

Expected:

- Default world books appear first and are marked.
- Per-character world selection persists.
- Entry-level selection persists.
- Prompt context respects selected entries.

## 8. Invitation Display Modes

Steps:

1. Add saved copy for a selected character.
2. Test barrage mode.
3. Test bubble mode.
4. Test banner mode.
5. Click enter.
6. Click dismiss and test retention chance.

Expected:

- Barrage shows multiple non-identical saved lines when available.
- Bubble appears at the selected 9-grid position.
- Banner appears above actions and does not cover the character name.
- Enter switches to the selected character.
- Dismiss closes or shows one retention prompt based on chance.

## 8.1 Contextual Invitation Modes

Steps:

1. Keep at least two characters in the invitation pool.
2. Save jealousy, birthday, and reunion lines for one target character. For birthday, include at least one tagged line such as `用户生日==...`, `角色生日==...`, the configured event name with `==`, or a `通用==...` / untagged fallback line. Keep other characters' jealousy pools empty for the deterministic test.
3. Enable jealousy mode, set global event chance to 100%, set the target character's jealousy appearance weight to 100%, and set the window to at least 10 minutes.
4. Open a different character chat, then return to the homepage and trigger an invitation.
5. Enter the jealousy invitation character, switch to another character chat, return to the homepage, and verify the next jealousy trigger uses the new last-chat character instead of the previous one.
6. Set the test character's user birthday, character birthday, or special date to today's `MM-DD`, then trigger a homepage invitation.
7. Remove or rename the matching birthday tag, trigger again, and confirm the date guard is not consumed when no usable birthday line exists.
8. Restore the matching birthday line, trigger birthday mode, then trigger again on the same local date.
9. Enable reunion mode, set `reunionThresholdDays` low enough to match an old chat, or use the manual reunion test button.
10. Test the manual buttons for jealousy, birthday, and reunion from the Copy tab.

Expected:

- Jealousy mode only triggers when the last-chat character exists, the window is valid, the global event roll hits, and at least one different pool character has jealousy lines with positive appearance weight.
- Entering a new character overwrites the older runtime snapshot; returning home writes the new character as the last-chat snapshot.
- Birthday / special-date mode has top priority when a pool character has a matching event and usable birthday line. Successful jealousy dispatch still happens before the normal reunion / primary draw when no birthday candidate exists.
- After birthday mode is consumed for the date, later callbacks can still enter anger, jealousy, reunion, or primary mode.
- Reunion mode only checks the already drawn character and does not change draw probability.
- Reunion visual treatment shows a gold SSR-style effect without hiding actions or changing card size.
- Contextual test buttons close back to the console and do not actually switch chats.

## 9. Appearance And Custom CSS

Steps:

1. Change cover effect and cover fit.
2. Adjust bubble position and offsets.
3. Apply each built-in CSS template.
4. Save and delete a custom CSS template.
5. Generate CSS with AI if an API is available.
6. Check preview and real invitation.

Expected:

- Preview reflects the same core styles as the real invitation.
- Custom CSS applies immediately.
- Built-in templates do not hide actions.
- AI CSS does not break card dimensions or action clickability.

## 10. Responsive UI

Steps:

1. Open the console on desktop width.
2. Open the console on a narrow/mobile width.
3. Show a real invitation on mobile width.

Expected:

- Console remains usable.
- Buttons remain horizontal.
- Invitation actions remain visible and clickable.
- No major content is inaccessible off-screen.

## 11. Deployment Compatibility

Test as many as are available:

- localhost
- plain HTTP
- HTTPS
- pure IP VPS access

Expected:

- The extension loads.
- Templates and i18n JSON load.
- SillyTavern same-origin APIs work.
- Independent API mode works with HTTP API URLs when the SillyTavern backend can reach the endpoint.

## Release Gate

Before tagging a release:

- `manifest.json` version matches the release version.
- `CHANGELOG.md` has the release entry and date.
- `README.md` and `README_EN.md` point to the correct repository URL.
- `node --check src/core/app.js` passes.
- `node --check src/i18n.js` passes.
- i18n key parity passes.
- Source and test directories are synced and `diff -qr` shows no differences.
- There is no extra `extension/` directory.
