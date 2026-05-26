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

The token estimate reflects the chunk that will actually be sent, not the entire chat file.

The effective range is:

- Start at `chatFloorStart`.
- Stop at `chatFloorEnd`.
- Never include more than `chatChunkSize` messages in one generation request.

For example, if the chat has 80 messages but chunk size is 40, the estimate only covers up to 40 messages.

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

