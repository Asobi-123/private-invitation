# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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

