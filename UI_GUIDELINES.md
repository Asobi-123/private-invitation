# UI Design Rules

## Core Shape

- Primary UI: centered modal/native `<dialog>`.
- Entry: SillyTavern extension menu.
- No floating ball.
- No drawer as the main UI.
- The settings inline drawer is only a launcher/config entry.

## Console Layout

- Use top-level tabs for major product areas.
- Use cards inside tabs.
- Cards may be collapsible when the section is secondary or dense.
- Keep role selection, copy pools, and AI generation visually separate.
- The AI tab should keep the current character visible near the top.

## Invitation Card

- The real invitation uses the character cover as the visual foundation.
- Avoid cold text-container layouts.
- Preserve three presentation modes:
  - Barrage: multiple moving lines.
  - Bubble: positioned dialogue bubble.
  - Banner: cinematic lower banner.
- Banner mode keeps the character name at the top and the banner above actions.
- Mobile actions must stay visible and clickable.

## Custom CSS

- Custom CSS should hook `.pi-invitation-*` classes.
- Preview and real invitation must share the same core class names.
- Do not encourage custom CSS that changes card min/max height, dialog width, or action position.
- Avoid large decorations over the character face area.
- Do not apply generic `.pi-invitation-message` decorations that pollute all modes.
- Mode-specific CSS should target `--bubble`, `--banner`, or `--barrage` selectors.

## Responsive Rules

- Grids collapse on narrow screens.
- Buttons remain horizontal.
- Long controls should wrap by row, not by letter.
- Touch targets should remain large enough on mobile.

