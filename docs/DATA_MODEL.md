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
  "presentationMode": "barrage",
  "poolCharacterKeys": [],
  "selectedCharacterKey": "",
  "characterMessages": {},
  "characterDrafts": {},
  "retentionMessages": {},
  "retentionDrafts": {},
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
  "aiUseChatContext": false,
  "aiUseWorldInfo": false,
  "chatFloorStart": 0,
  "chatFloorEnd": 80,
  "chatChunkSize": 40,
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

