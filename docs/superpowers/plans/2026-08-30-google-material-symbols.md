# Implementation Plan: Google Material Symbols Offline Font Integration

Date: 2026-08-30
Spec: `docs/superpowers/specs/2026-08-30-google-material-symbols-design.md`
Status: Ready to execute

## Tasks

- [ ] Task 1: Add Material Symbols Font Asset & CSS @font-face
  - File: `apps/desktop/src/renderer/assets/fonts/material-symbols-outlined.woff2` (or package font asset)
  - File: `apps/desktop/src/renderer/styles/app.css`
  - Action: Place local woff2 font file in assets, add `@font-face` rule and `.icon-symbol` class to `app.css`.

- [ ] Task 2: Implement Reusable `<Icon />` Component & Unit Tests
  - File: `apps/desktop/src/renderer/components/Icon.tsx`
  - File: `apps/desktop/test/renderer/Icon.test.tsx`
  - Action: Create `<Icon name="..." size={...} className="..." />` component. Add unit tests asserting proper className, ligature content, and sizing.

- [ ] Task 3: Migrate TerminalTabs Icons
  - File: `apps/desktop/src/renderer/views/TerminalTabs.tsx`
  - Action: Replace raw `×` close icon and `+` add icon with `<Icon name="close" size={14} />` and `<Icon name="add" size={16} />`.

- [ ] Task 4: Migrate SFTP Browser Icons
  - File: `apps/desktop/src/renderer/views/SftpBrowser.tsx`
  - Action: Replace `📁` and `📄` emojis with `<Icon name="folder" />` and `<Icon name="description" />`.

- [ ] Task 5: End-to-End Verification & Test Suite
  - Run: `pnpm --filter @termif/desktop test`
  - Action: Verify all desktop tests pass and visual rendering is verified.
