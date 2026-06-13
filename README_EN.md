# Private Invitation

[中文](README.md)

A SillyTavern extension that turns the homepage into a character-recall surface. It randomly surfaces characters you have selected, with full-cover artwork, custom lines, and optional retention, anger, jealousy, special-date, and reunion callbacks — bringing characters back into view instead of letting them slip out of mind.

> The extension is for the moment your roleplay library grows past the point where you remember who you should be returning to.

---

## What It Does

### Homepage callbacks
- Pulls a random character from your selected pool when SillyTavern's home screen is shown
- Full-cover artwork as the visual base, plus a line saved for that character
- Three presentation modes: **barrage** (multiple lines floating sideways), **bubble** (9-grid positioned bubble), **banner** (cinematic bottom strip)
- Pressing "enter" jumps straight into chat; pressing "dismiss" optionally triggers a **retention** second callback by chance

### Per-character copy pools
- Main invitation lines and retention lines stored independently per character
- The homepage popup only reads saved pools — **never calls AI at runtime**, so the popup is fast and predictable

### AI draft generation
- Generated offline in the console, then manually picked into the pool
- Inputs to the AI: character card, chat history floors you choose, world info entries
- Built-in presets: 5 invitation, 5 retention, 8 anger, plus 5 each for jealousy, birthday, and reunion
- **Auto-batching**: when chat is long, the plugin walks the floor range in chunks automatically and merges all batch drafts at the end
- Cancel mid-generation; already-completed batches are kept

### Anger mode
- When you've rejected a character enough times (default 5), the next callback uses the anger form instead
- Red-black rage visuals, countdown that auto-enters the chat
- Independent anger copy pool and AI presets
- Accepting any invitation resets the count (configurable)

### Contextual callbacks
- **Jealousy / triangle**: after returning home from character A, character B can react to the last-chat snapshot if drawn
- **Time / special dates**: saved lines support variables like `{time}`, `{period}`, and `{todayEvent}`; birthday / special dates can be configured per character
- **SSR reunion**: after a character is drawn, long chat absence can trigger a gold visual treatment and reunion lines
- One popup uses exactly one form, so no combined copy pools are required; birthday mode is consumed for the local date after a successful display

### Visual customization
- 8 built-in CSS templates (mono / neon border / vintage / palace / gothic shadow / soft glow / comic panel / cyber dream)
- Custom CSS (savable as template)
- AI-generated CSS

### API modes
- **Shared** (default): use SillyTavern's current API. Zero configuration
- **Independent**: any OpenAI-compatible endpoint, multi-profile, switch anytime
- Independent mode routes through SillyTavern's backend so HTTPS pages can use HTTP API URLs without browser mixed-content blocking

---

## Installation

### Option 1 (recommended) — from SillyTavern UI
1. Extensions → Install Extension
2. Paste: `https://github.com/Asobi-123/private-invitation`
3. Refresh

### Option 2 — manual clone
```bash
cd SillyTavern/data/default-user/extensions/
git clone https://github.com/Asobi-123/private-invitation.git
```
Refresh SillyTavern.

---

## First Run: 5 Steps

> Assumes the extension is installed.

### Step 1: Open the console
SillyTavern extension menu → **Private Invitation**. A centered console opens with several tabs.

### Step 2: Choose which characters can appear
Switch to **Invitation Characters**:
- Tick the characters you want the homepage to surface
- Start with 3–5 for testing; too many dilutes each one's chance
- Tick none = all characters are eligible

### Step 3: Give them lines
Switch to **Copy**:
- Pick the current character
- Add lines to the main invitation pool (press Enter to commit)
- Or switch to **AI Generate** and let AI draft them; review and add to the pool

> **What is AI Generate?**
> The plugin reads the character card, your chosen chat floor range, and world info, then asks the AI for in-character lines. Drafts are not used automatically — you pick which ones to add to the saved pool. Only saved pool lines appear on the homepage.

### Step 4: Tune visuals
- **Look** tab: presentation mode (barrage / bubble / banner), font size, opacity, container size
- **Appearance** tab: cover effects, 9-grid bubble position, built-in / custom CSS, AI CSS

### Step 5: Enable homepage auto-popup
**Run Control** tab (or settings drawer):
- Enable plugin
- Enable homepage auto-popup
- Pick a trigger mode (see below)

Go back to SillyTavern home — the callback should appear.

---

## Key Concepts

### Floors / chunk / batching

Each chat message is one "floor". For long chats the plugin auto-batches floor ranges so AI calls stay manageable.

```
Chat has 80 floors, you set:
  Start floor = 0
  End floor   = 80
  Floors per batch = 20

The plugin runs:
  Batch 1: floors 0–19  → one AI draft set
  Batch 2: floors 20–39 → another draft set
  Batch 3: floors 40–59
  Batch 4: floors 60–79
  All drafts are merged into the draft pool.
```

The generate button morphs during the run: `✕ Cancel (2/4)` shows progress and is clickable to stop. **Drafts from completed batches are kept** when cancelled.

### Filter / exclude tag chips

If chat floors carry metadata noise (thinking blocks, system tags, HTML nodes), use the chip pools:

- **Filter tags (green chips, allow-list)**: keep only what's wrapped in `<tag>...</tag>`
- **Exclude tags (red chips, block-list)**: strip out everything wrapped in `<tag>...</tag>`

Tags with attributes match too — entering `div` also strips `<div class="x">...</div>` blocks.

> **HTML comments and self-closing elements** like `<!-- ... -->`, `<img>`, `<br>`, `<hr>` are not paired tags. The "Strip HTML comments and img tags" switch (on by default) handles those.

### Homepage trigger modes

| Mode | Behavior |
|---|---|
| One popup per refresh / page load | Show once each SillyTavern startup |
| Cooldown timer (N minutes) | Show again after N minutes since last popup |
| Every return to homepage | Show whenever the user leaves chat and returns to home |
| Manual only (no auto-popup) | Auto-popup off; only manual test buttons trigger |

---

## Callback Forms

| Form | Trigger | Behavior |
|---|---|---|
| **Main invitation** | Homepage auto / manual | Standard callback, dismissible |
| **Retention** | After dismissing main, by chance | Second callback; further dismiss closes |
| **Anger** | Reject count reaches threshold (default 5) | Red-black rage form, countdown auto-enters chat |
| **Birthday / special date** | Drawn character matches a current date event | Uses the special-date pool; does not repeat after successful display that day |
| **SSR reunion** | Drawn character has not been chatted with for the configured days | Gold visual treatment and reunion pool |
| **Jealousy / triangle** | Drawn character differs from the last-chat character and is within the time window | Uses last-chat variables |

Main, retention, anger, jealousy, birthday, and reunion all have independent AI draft generation. Runtime homepage popups still only read saved pools and never call AI on the fly.

---

## Deployment Compatibility

Works under:
- `localhost`
- plain HTTP
- HTTPS
- pure-IP VPS access (e.g. `http://203.0.113.10:8000`)

Independent API requests route through the SillyTavern backend instead of direct browser fetch. HTTPS SillyTavern pages can use HTTP independent API URLs because the backend (not the browser) makes the outgoing call.

---

## Project Structure

```
manifest.json       — SillyTavern extension manifest
index.js            — extension entry
settings.html       — settings drawer template
console.html        — console dialog template
menu-item.html      — extension menu template
style.css           — extension styles
i18n/               — zh-cn / en-us locale files
src/
  bootstrap.js      — startup
  constants.js      — constants
  i18n.js           — self-contained i18n loader
  utils.js          — shared helpers
  core/
    app.js          — main logic and UI binding
    ui.js           — template mounting helpers
docs/               — architecture / data model / testing / troubleshooting
```

---

## Related Docs

- [Changelog](CHANGELOG.md)
- [Manual Testing Checklist](docs/MANUAL_TESTING.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Architecture](docs/ARCHITECTURE.md) (developer)
- [Data Model](docs/DATA_MODEL.md) (developer)

---

## License

[AGPL-3.0](LICENSE)
