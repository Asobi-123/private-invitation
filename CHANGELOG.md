# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

Panel stability and usability improvements. Version number for the first public release will be finalized once the codebase is stable.

### Added

- `panelTheme` setting with five built-in console themes (`midnight` / `parchment` / `ember` / `jade` / `st`); `midnight` is the default so the console no longer depends entirely on SillyTavern theme tokens. `st` follows the SillyTavern theme.
- Run-control tab consolidating the most-used switches (enable plugin, show menu entry, enable homepage auto-popup) without removing the originals from the settings drawer.
- World-info entry search box: filter entries inside a book by title, keyword, or body text without losing checked entries that the filter hides.

### Changed

- Mobile console tab bar is now a horizontal compact-chip scroller (50px high, 32px tab) using inner `box-shadow` for active/focus state so the parent's overflow scroll does not crop the indicator.
- Mobile layout: `.pi-mini-preview-bar` (appearance live preview) and `.pi-current-character-banner` (AI tab current-character banner) now stay sticky while scrolling, matching desktop behavior. Earlier rule that forced them to `position: relative` on mobile is removed.
- Copy tab desktop character row uses an explicit four-column grid so badges and character info no longer misalign.
- `.pi-header` / `.pi-tabs` are now non-shrinkable flex items and `.pi-body` carries `min-height: 0` for the scroll container, preventing sticky regions and content from squeezing the top tab bar.

### Fixed

- Clicking on console blank areas no longer accidentally closes the modal.
- Homepage auto-invitation no longer fires before SillyTavern has finished restoring the user's last chat state. The earlier "ready" check accepted "character list loaded" as good enough, which is satisfied very early during slow VPS boot and let the invitation pop while the previous chat was still being restored. The gate now requires `APP_READY` plus a post-`APP_READY` grace window before counting homepage stability time.
- Accepting an invitation now re-checks the ready state at click time. Previously, accepting while SillyTavern was still loading could call `selectCharacterById` mid-restore and overwrite the user's existing chat with an empty new one. When not ready, the invitation stays open and a toast asks the user to retry.
- Cover artwork is preloaded before the invitation pops out, with a timeout fallback; preload completion re-checks that the user is still on the homepage, reducing premature pops on slow VPS that prevented entry.

## [0.1.0] - 2026-05-26

Initial public-preparation release.

### Added

- Homepage character invitation flow with random character selection, cover art, entry button, dismiss button, and optional retention prompt.
- Invitation copy pools and retention copy pools stored per character.
- AI draft generation for invitation and retention copy from character cards, selected chat ranges, selected chat files, and world info.
- Three presentation modes: barrage, bubble, and banner.
- Cover effects, 9-grid bubble positioning, bubble offsets, text/frame opacity controls, and custom CSS.
- Built-in CSS templates, user-saved CSS templates, and AI-assisted CSS generation.
- Shared SillyTavern API mode and independent OpenAI-compatible API mode with profile management and model fetching.
- Bilingual Chinese / English i18n.
- Release documentation, manual testing checklist, troubleshooting guide, and repository metadata.

### Changed

- SillyTavern internal API calls now resolve against the current page origin instead of relying on a hardcoded host or protocol.

