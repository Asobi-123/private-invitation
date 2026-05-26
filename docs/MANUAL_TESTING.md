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
5. Delete one line from each pool.
6. Reload SillyTavern and reopen the console.

Expected:

- Copy pools are stored per character.
- Main and retention pools do not overwrite each other.
- Chip lists render correctly.
- Reload preserves saved lines.

## 4. Shared API Draft Generation

Steps:

1. Switch API mode to shared.
2. Select a character.
3. Generate main invitation drafts.
4. Move one draft into the saved pool.
5. Generate retention drafts.
6. Move one retention draft into the saved pool.

Expected:

- Drafts are generated through SillyTavern's configured API.
- New drafts append to existing drafts.
- Moving a draft removes it from the draft list and adds it to the correct saved pool.
- Main and retention drafts remain separate.

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
4. Add include-tag filters.
5. Add exclude-tag filters.
6. Generate drafts.

Expected:

- Floor labels are visible.
- Token estimate reflects the actual chunk, not the entire chat file.
- Include filters keep only matching tag contents.
- Exclude filters remove matching tag contents first.
- Hidden messages are still eligible for context.

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

