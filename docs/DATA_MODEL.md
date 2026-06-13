# Data Model

## Storage Location

Settings are stored in:

```text
extension_settings.privateInvitation
```

The project currently keeps global extension state in SillyTavern extension settings. Per-character data is keyed by stable character keys.

## Main Settings Shape

Representative shape:

```json
{
  "enabled": true,
  "showMenuEntry": true,
  "autoOpenOnHome": false,
  "panelTheme": "midnight",
  "presentationMode": "barrage",
  "barrageLineCount": 3,
  "poolCharacterKeys": [],
  "selectedCharacterKey": "",
  "characterMessages": {},
  "characterDrafts": {},
  "retentionMessages": {},
  "retentionDrafts": {},
  "angerMessages": {},
  "angerDrafts": {},
  "jealousyMessages": {},
  "birthdayMessages": {},
  "reunionMessages": {},
  "jealousyDrafts": {},
  "birthdayDrafts": {},
  "reunionDrafts": {},
  "characterJealousyLabels": {},
  "characterJealousyChances": {},
  "characterBirthdays": {},
  "characterUserBirthdays": {},
  "characterDateEvents": {},
  "dateEventConsumed": {},
  "rejectCounts": {},
  "characterChatFiles": {},
  "selectedWorldNames": [],
  "characterWorldNames": {},
  "characterWorldEntries": {},
  "homepageTriggerMode": "session",
  "homepageCooldownMinutes": 120,
  "lastHomepageInviteAt": 0,
  "aiPromptPreset": "memoryFlashback",
  "aiPromptBody": "",
  "aiBatchCount": 8,
  "aiMaxTokens": 2400,
  "aiCustomTemplates": {},
  "retentionPromptPreset": "lastWhisper",
  "retentionPromptBody": "",
  "retentionBatchCount": 8,
  "retentionCustomTemplates": {},
  "angerPromptPreset": "coldBack",
  "angerPromptBody": "",
  "angerBatchCount": 8,
  "angerCustomTemplates": {},
  "angerAiPrompt": "",
  "angerThreshold": 5,
  "angerCountdownSeconds": 6,
  "angerResetOnAccept": true,
  "angerAccentColor": "#c2415a",
  "angerIntensity": "restrained",
  "jealousyEnabled": false,
  "jealousyChance": 45,
  "jealousyWindowMinutes": 10,
  "jealousyPromptPreset": "teasingJealousy",
  "jealousyPromptBody": "",
  "jealousyBatchCount": 8,
  "jealousyCustomTemplates": {},
  "jealousyAiPrompt": "",
  "birthdayEnabled": true,
  "userBirthday": "",
  "customDateEvents": "",
  "builtinDateEventsEnabled": false,
  "birthdayPromptPreset": "warmBirthday",
  "birthdayPromptBody": "",
  "birthdayBatchCount": 8,
  "birthdayCustomTemplates": {},
  "birthdayAiPrompt": "",
  "reunionEnabled": false,
  "reunionThresholdDays": 30,
  "reunionExtremeThresholdDays": 180,
  "reunionNoChatPolicy": "skip",
  "reunionVisualIntensity": 70,
  "reunionPromptPreset": "quietReturn",
  "reunionPromptBody": "",
  "reunionBatchCount": 8,
  "reunionCustomTemplates": {},
  "reunionAiPrompt": "",
  "aiUseChatContext": false,
  "aiUseWorldInfo": false,
  "chatFloorStart": 0,
  "chatFloorEnd": 80,
  "chatChunkSize": 40,
  "chatBatchDelayMs": 500,
  "stripHtmlNoise": true,
  "chatFilterTags": "",
  "chatExcludeTags": "",
  "worldEntryLimit": 40,
  "retentionChance": 35,
  "coverEffect": "breath",
  "coverFit": "contain",
  "bubblePosition": "top-right",
  "bubbleOffsetX": 0,
  "bubbleOffsetY": 0,
  "customCss": "",
  "customCssTemplates": {},
  "characterStyles": {},
  "apiMode": "shared",
  "independentApiConfig": {
    "apiUrl": "",
    "apiKey": "",
    "model": ""
  },
  "apiProfiles": [],
  "currentApiProfileId": ""
}
```

## Character Keyed Pools

`characterMessages` stores saved main invitation lines:

```json
{
  "character-key": [
    "A remembered line.",
    "A story hook."
  ]
}
```

`retentionMessages` stores saved retention lines:

```json
{
  "character-key": [
    "One more line after dismiss."
  ]
}
```

Contextual mode pools mirror the same per-character shape:

- `jealousyMessages`: lines used when a character is selected by the post-chat jealousy event and reacts to the last chat character.
- `birthdayMessages`: lines used on user birthday, character birthday, built-in holidays, or custom dates. If empty, birthday mode falls back to `characterMessages`.
- `reunionMessages`: lines used when a randomly drawn character has not been chatted with for at least `reunionThresholdDays`.
- `jealousyDrafts`, `birthdayDrafts`, `reunionDrafts`: AI draft pools for the matching contextual modes.

Per-character contextual settings:

- `characterJealousyLabels`: optional display label used as `{lastChar}` when another character refers to this character.
- `characterJealousyChances`: optional per-character jealousy appearance weight. Missing keys fall back to `jealousyChance` as the default weight.
- `characterBirthdays`: per-character `MM-DD` birthday map.
- `characterUserBirthdays`: optional per-character `MM-DD` map for user birthday variants inside that character's setting.
- `characterDateEvents`: per-character custom special date text. Same line format as `customDateEvents`.

Date consumption:

```json
{
  "birthdayMode": "2026-06-13",
  "characterBirthday:character-key": "2026-06-13"
}
```

`dateEventConsumed.birthdayMode` is the date-level guard. Once birthday mode has successfully shown on a date, all birthday / special-date checks are skipped for the rest of that local day.

Contextual mode trigger settings:

- `jealousyEnabled`, `jealousyChance`, `jealousyWindowMinutes`; `jealousyChance` is the global event probability for a homepage callback inside the recent-chat window. If the event hits, eligible characters are picked by `characterJealousyChances` weight. Missing weights fall back to `jealousyChance`.
- `birthdayEnabled`, `userBirthday`, `customDateEvents`, `builtinDateEventsEnabled`; `userBirthday` and `customDateEvents` are global defaults, while `characterUserBirthdays` and `characterDateEvents` are checked first for the drawn character.
- `reunionEnabled`, `reunionThresholdDays`, `reunionExtremeThresholdDays`, `reunionNoChatPolicy`, `reunionVisualIntensity`

`customDateEvents` and each `characterDateEvents[characterKey]` value are plain text, one event per line:

```text
06-12 Anniversary
12-31 Countdown
```

## Draft Pools

AI-generated drafts are persisted until the user moves or removes them.

```json
{
  "character-key": [
    "Draft line 1",
    "Draft line 2"
  ]
}
```

Draft pools:

- `characterDrafts`
- `retentionDrafts`
- `angerDrafts`
- `jealousyDrafts`
- `birthdayDrafts`
- `reunionDrafts`

## Anger Mode Per-Character State

`rejectCounts` tracks dismissed-invitation counts per character. Once a character's count reaches `angerThreshold`, the next homepage callback for that character switches to the anger form.

```json
{
  "character-key": 4
}
```

`angerMessages` mirrors `characterMessages` / `retentionMessages` but stores anger lines:

```json
{
  "character-key": [
    "A clipped, angry line."
  ]
}
```

`rejectCounts` is incremented on **final dismiss** of a non-test invitation (after the optional retention round has also been dismissed). Test-mode invitations (`state.invitationFromConsoleTest`) do not increment. `rejectCounts` resets to zero when the user accepts an invitation (configurable via `angerResetOnAccept`) or when triggered explicitly from the copy-tab manual reset button.

## Character Chat File Selection

`characterChatFiles` stores selected historical chat files per character:

```json
{
  "character-key": [
    "chat-file-name"
  ]
}
```

If no chat file is selected, the extension may read the current chat when chat context is enabled.

## World Info Selection

`characterWorldNames` stores selected world books per character:

```json
{
  "character-key": [
    "World Book Name"
  ]
}
```

`characterWorldEntries` stores entry-level selection:

```json
{
  "character-key": {
    "World Book Name": "all"
  }
}
```

or:

```json
{
  "character-key": {
    "World Book Name": [12, 18, 23]
  }
}
```

`"all"` means all entries in that selected world book are eligible. An array means only the listed entry UIDs are used.

## API Profile Shape

Stored inside `apiProfiles`:

```json
{
  "id": "profile_...",
  "name": "My API Profile",
  "apiUrl": "http://127.0.0.1:8000/v1",
  "apiKey": "",
  "model": "model-id",
  "apiMode": "independent"
}
```

Applying a profile overwrites the active `independentApiConfig` and `apiMode`.

## Prompt Template Shape

Custom prompt templates are maps:

```json
{
  "Template Name": "Prompt body with {char} and {count}"
}
```

Template maps:

- `aiCustomTemplates`
- `retentionCustomTemplates`
- `angerCustomTemplates`
- `jealousyCustomTemplates`
- `birthdayCustomTemplates`
- `reunionCustomTemplates`
- `customCssTemplates`

Custom template select values use:

```text
custom:<name>
```

## Character Style Overrides

`characterStyles` stores optional visual overrides per character. It is reserved for character-specific presentation adjustments.

## Trigger Modes

`homepageTriggerMode` values:

- `session`
- `cooldown`
- `everyHome`
- `manual`

The user-facing copy should describe `session` as one popup after each refresh/page load, not as a long-lived login session.

## Panel Theme Values

`panelTheme` controls the console color scheme:

- `midnight` (default — does not depend on SillyTavern theme tokens)
- `parchment`
- `ember`
- `jade`
- `st` (follows the SillyTavern theme)

## Anger Intensity Values

`angerIntensity` layers on top of every anger preset and controls how explicit AI output is:

- `restrained` (default — keep anger in actions and distance)
- `direct` (explicit emotion words allowed)
- `outburst` (commands and warnings allowed, still in character)

## Auto-Batch State (runtime, not persisted)

These fields live on the in-memory `state` object during AI batch generation; they are never persisted to settings:

- `state.aiBatchAbortRequested` — `true` once the user clicks the morphed cancel button; the running batch loop reads it before each new batch
- `state.aiBatchActiveKind` — `'dialogue'` / `'retention'` / `'anger'` while a batch run is in flight; used so a second click on the same button is treated as a cancel rather than a re-start
- `state.aiBatchProgress` — `{ current, total, phase }` for the most recent `onProgress` event so the button label can show `(X/Y)` and the cancel label remains accurate
