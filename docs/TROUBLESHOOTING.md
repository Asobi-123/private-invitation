# Troubleshooting

This guide covers common setup and runtime issues for Private Invitation.

## Invitation Does Not Appear On Homepage

Check these points:

- The extension is enabled.
- Homepage auto-open is enabled if you expect automatic popups.
- The current trigger mode is not `manual`.
- At least one character exists in SillyTavern.
- If the invitation pool is not empty, at least one selected character still exists.
- Cooldown mode may still be waiting for `homepageCooldownMinutes`.

Use the console's manual test controls to verify the dialog itself.

## No Characters Are Listed

Check that SillyTavern itself has loaded character cards. Private Invitation reads the live `characters` array from `/script.js`.

If characters exist but the list is empty, refresh the view from the settings entry or reload SillyTavern.

## Enter Button Does Not Switch Character

The enter action calls:

```js
selectCharacterById(id, { switchMenu: true })
```

If switching fails:

- Confirm the character still exists.
- Confirm the stored key/id maps to a current character.
- Remove stale manual character entries.

## AI Generation Fails

### Shared API

Shared mode uses SillyTavern `generateRaw`. First confirm SillyTavern can generate a normal chat reply.

If normal chat generation fails, Private Invitation cannot generate drafts through shared mode.

### Independent API

Independent mode requires:

- `API URL`
- `Model`

The API key is optional if the endpoint does not require one.

Independent mode uses SillyTavern same-origin backend endpoints, not browser direct fetch:

- `/api/backends/chat-completions/generate`
- `/api/backends/chat-completions/status`

This means HTTPS SillyTavern pages can use HTTP API URLs. If generation still fails:

- Verify the endpoint is OpenAI-compatible.
- Verify the URL points to a base URL, `/v1`, `/v1/models`, or `/v1/chat/completions`.
- Verify the model ID is accepted by that endpoint.
- Verify the API key if the provider requires one.
- Check SillyTavern server logs because the backend performs the outgoing request.

## Fetch Models Returns Empty

Model fetching goes through SillyTavern's backend status endpoint and ultimately requests the configured provider's model list.

Check these points:

- The provider supports an OpenAI-compatible `/v1/models`.
- The API URL is reachable from the SillyTavern server process.
- The API key is valid if required.
- The provider returns model IDs in a `data` array.

If the provider does not expose models, type the model ID manually.

## HTTP Independent API Fails Under HTTPS SillyTavern

The extension is designed to avoid browser mixed-content blocking by routing independent API requests through SillyTavern's backend.

If it still fails, the problem is likely server-side reachability:

- The SillyTavern server cannot reach the API host.
- A firewall blocks the server process.
- SillyTavern's private request filter blocks private IP ranges.
- The API process is bound only to a different interface.

For local APIs, prefer binding the API server to an address reachable from the SillyTavern server process.

## Chat Context Looks Too Short

The token estimate reflects the chunk that will actually be sent in **one** AI call, not the entire chat file or the merged auto-batch payload.

The plugin auto-batches across the full range:

- Start at `chatFloorStart`.
- Stop at `chatFloorEnd`.
- Send `chatChunkSize` messages per AI call.
- Merge all batches' drafts into the pool.

For example, with 80 floors, `chatFloorStart=0`, `chatFloorEnd=80`, `chatChunkSize=20`: four AI calls run sequentially (0–19, 20–39, 40–59, 60–79). The token estimate only describes one batch's payload — that is intentional.

If you want a single AI call covering more floors at once, raise `chatChunkSize`. If you want to constrain the total work, lower `chatFloorEnd` so fewer batches are needed.

## How To Exclude A Specific HTML Block From AI Context

The exclude chip pool removes `<tag>...</tag>` paired content. The matcher accepts attributes — entering `div` in the chip pool strips:

- `<div>...</div>`
- `<div class="x">...</div>`
- `<div  data-y="1" >...</div>`

without you needing to specify the attribute pattern.

Tags that are not paired need a different mechanism:

- HTML comments (`<!-- ... -->`) — handled by the **Strip HTML comments and img tags** switch on the AI tab. The switch is on by default and covers `<!-- ... -->`, `<img>`, `<br>`, `<hr>`, `<meta>`, `<input>`, `<source>`, `<track>`, `<wbr>`, `<area>`, `<base>`, `<col>`, `<embed>`, `<link>`, `<param>`.
- Self-closing tags from the same list (e.g. images, line breaks) — same switch.
- Tags that should be **kept** but only their content matters — use the **filter** chip pool (green chips) instead; that pool extracts only the wrapped content and discards everything else.

Word-boundary check prevents accidental over-matching: entering `div` will not strip `<diva>...</diva>` or `<divider>...</divider>` because the regex requires the tag name to be followed by whitespace or `>`, never by another letter.

Known limitation: nested same-name tags (`<div><div>inner</div></div>`) only match the first inner closing tag, leaving the outer remainder. Chat floors rarely contain this nesting and the limitation is not patched.

## AI Batch Generation Got Stuck

If a batch run does not finish:

1. Click the AI generate button again. While generation is in flight the button shows `✕ Cancel ({current}/{total})`. Clicking it sets the abort flag and stops the loop after the current batch completes.
2. If the very first AI call hangs (no progress indicator advances), the underlying API call is stuck. Cancel via the same button; if that also hangs, refresh SillyTavern. The plugin clears all batch state in the `finally` block of every run, so a fresh page load always returns to a clean idle state.
3. Inspect the SillyTavern server logs if independent API mode is used.

Already-completed batches are appended to the draft pool even when cancelled or aborted by error, so progress is never lost.

## Hidden Messages Are Included

This is intentional. Users may hide old floors that contain summaries. Private Invitation must still read hidden messages when building AI context.

## World Info Entries Missing From Prompt

Check these points:

- World info context is enabled.
- The current character is selected.
- The world book is selected for that character.
- Entry selection is either `all` or includes the target entry UID.
- `worldEntryLimit` is high enough.

Default character-bound world books are shown first and marked as default.

## Custom CSS Breaks The Popup

Use the Appearance tab to clear or replace custom CSS.

Avoid custom CSS that changes:

- `.pi-invitation-card` height, aspect ratio, margin, or transform.
- `.pi-invitation-dialog` width, margin, padding, or transform.
- `.pi-invitation-content` height or core box model.
- `.pi-invitation-actions` positioning or clickability.

On mobile, actions have a sticky fallback, but extreme CSS can still make the design hard to use.

## Before Reporting A Bug

Collect these details:

- Private Invitation version.
- SillyTavern version.
- Browser and device.
- Access environment: localhost, HTTP, HTTPS, or IP VPS.
- API mode: shared or independent.
- Independent API URL shape, without exposing secrets.
- Exact steps that reproduce the issue.
- UI toast or console/server error text.

