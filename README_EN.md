# Private Invitation

[中文](README.md)

A SillyTavern extension that turns the homepage into a character invitation space. It randomly presents selected characters with full-cover artwork, memory-style lines, story hooks, and optional retention copy.

The extension is designed for roleplay libraries where the problem is not missing characters, but remembering which character is worth returning to.

---

## Features

- **Homepage invitations** — Randomly show a selected character from the invitation pool.
- **Three display modes** — Barrage, bubble, and cinematic banner layouts.
- **Per-character copy pools** — Main invitation lines and retention lines are stored separately per character.
- **AI draft generation** — Generate drafts from character cards, chat history, selected chat files, and world info, then manually add chosen lines to the saved pool.
- **No runtime AI calls on homepage** — Homepage invitations only read saved lines, so display stays fast and predictable.
- **Context controls** — Floor range, chunk size, include-tag filters, exclude-tag filters, selected chat files, selected world books, and selected world entries.
- **Visual customization** — Cover effects, cover fit, 9-grid bubble positioning, opacity controls, built-in CSS templates, user CSS templates, and AI-assisted CSS generation.
- **Shared / Independent API** — Use SillyTavern's current generation API or a dedicated OpenAI-compatible endpoint with saved profiles and model fetching.
- **Bilingual i18n** — Chinese / English, auto-detected.
- **Mobile fallback** — Invitation actions remain visible on narrow screens even when custom CSS is aggressive.

---

## Installation

**Option 1 — Install from SillyTavern UI**

1. Open **Extensions** → **Install Extension**.
2. Enter: `https://github.com/Asobi-123/private-invitation`.
3. Refresh SillyTavern.

**Option 2 — Manual install**

```bash
cd SillyTavern/data/default-user/extensions/
git clone https://github.com/Asobi-123/private-invitation.git
```

Refresh SillyTavern after installation.

---

## Usage

1. Open the SillyTavern extension menu and choose **Private Invitation**.
2. In **Invitation Characters**, choose the characters that may appear on the homepage.
3. In **Copy**, choose the current character and manage the main invitation and retention pools.
4. In **AI Generate**, generate drafts from character data, chat history, and world info.
5. In **Look** and **Appearance**, tune the invitation card and custom CSS.
6. Enable homepage auto-open if you want invitations to appear automatically.

AI generation writes drafts only. The homepage uses saved copy pools and does not call the model while showing an invitation.

---

## Deployment Compatibility

The extension uses relative module imports and same-origin SillyTavern API calls, so it works under:

- `localhost`
- plain HTTP
- HTTPS
- pure IP VPS access, such as `http://203.0.113.10:8000`

Independent API mode requests the configured endpoint through the SillyTavern backend instead of calling the API URL directly from the browser. This allows HTTPS SillyTavern pages to use HTTP independent API URLs.

---

## Project Structure

```text
manifest.json          — SillyTavern extension manifest
index.js               — extension entry
settings.html          — extension settings entry
console.html           — centered console dialog
menu-item.html         — extension menu item template
style.css              — extension styles
i18n/                  — Chinese / English locale files
src/
  bootstrap.js         — startup
  constants.js         — constants
  i18n.js              — self-contained i18n loader
  utils.js             — shared helpers
  core/
    app.js             — main app logic and UI binding
    ui.js              — template mounting helpers
docs/                  — architecture, data model, testing, troubleshooting
```

---

## Related Docs

- [Changelog](CHANGELOG.md)
- [Manual Testing Checklist](docs/MANUAL_TESTING.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Data Model](docs/DATA_MODEL.md)

---

## License

[AGPL-3.0](LICENSE)
