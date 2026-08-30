# Termif UI/UX Redesign Implementation Plan: Hybrid Studio Console

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Termif desktop interface into a high-end, professional Hybrid Studio Console SSH/SFTP client following Taste-Skill guidelines and clean component modularity.

**Architecture:** Update design tokens and base styles, upgrade Titlebar with Quick Connect search and modern segmented tabs, modernize HostList sidebar with tree view & badges, enhance Terminal tabs & SFTP panels with polished typography and micro-interactions.

**Tech Stack:** React 19, TypeScript, CSS Variables (Design Tokens), Lucide Icons / Tabler Icons, Vite.

## Global Constraints
- High-contrast, dark-slate aesthetic (`#0B0E14`, `#111620`, `#19202E`, hairline borders `rgba(255,255,255,0.08)`).
- Typography: Inter / system sans-serif for UI, JetBrains Mono / monospace for code & terminal.
- Maintain existing IPC handlers, test suite compatibility, and avoid regressing functional SSH/SFTP flows.

---

### Task 1: Update Design Tokens and Global Theme Styles

**Files:**
- Modify: `apps/desktop/src/renderer/styles/tokens.css`
- Modify: `apps/desktop/src/renderer/styles/app.css`

**Interfaces:**
- Consumes: CSS custom properties (`--bg-primary`, `--bg-secondary`, `--border-color`, `--accent-color`, `--font-mono`, etc.)
- Produces: Polished studio dark theme tokens and utility classes for glass/hairline styling.

- [x] **Step 1: Update design tokens in `tokens.css`**
  Add Obsidian Slate palette, emerald/amber/sky status colors, hairline border variables, and crisp typography sizing.

- [x] **Step 2: Update base styles and utility scrollbars in `app.css`**
  Enhance custom slim scrollbars, input focus rings, and transition utilities.

- [x] **Step 3: Verify build / typecheck**
  Run: `pnpm --filter @termif/desktop build` (or test runner).

- [x] **Step 4: Commit changes**
  ```bash
  git add apps/desktop/src/renderer/styles/tokens.css apps/desktop/src/renderer/styles/app.css
  git commit -m "style: update design tokens and global styles for studio console"
  ```

---

### Task 2: Redesign Titlebar with Quick Connect & Segmented Switcher

**Files:**
- Modify: `apps/desktop/src/renderer/views/Titlebar.tsx`
- Modify: `apps/desktop/src/renderer/styles/app.css`

**Interfaces:**
- Consumes: `activeView`, `onViewChange`, host connection statuses.
- Produces: Segmented pill tab buttons (`Terminal`, `SFTP`, `Port Forwarding`), Quick Command bar (`Ctrl+P`), Host ping indicator badge.

- [x] **Step 1: Update `Titlebar.tsx` JSX and structure**
  Implement the centered Quick Search / Connect pill and refined pill tab selector with micro-interactions.

- [x] **Step 2: Style Titlebar controls with subtle gradients and active states**
  Ensure native window dragging works seamlessly while interactive controls remain clickable.

- [x] **Step 3: Run desktop test suite**
  Run: `pnpm --filter @termif/desktop test`
  Expected: PASS

- [x] **Step 4: Commit changes**
  ```bash
  git add apps/desktop/src/renderer/views/Titlebar.tsx apps/desktop/src/renderer/styles/app.css
  git commit -m "feat(ui): upgrade titlebar with quick search and studio console switcher"
  ```

---

### Task 3: Upgrade Server Sidebar (HostList) & Group Navigation

**Files:**
- Modify: `apps/desktop/src/renderer/views/HostList.tsx`
- Modify: `apps/desktop/src/renderer/styles/app.css`

**Interfaces:**
- Consumes: Host records list, group tags, connection trigger callbacks.
- Produces: Modern hierarchical group tree, status dot badges, hover quick-action menu (Connect / SFTP / Edit).

- [x] **Step 1: Refactor `HostList.tsx` layout**
  Structure collapsible group folders with server count badges and latency status dots.

- [x] **Step 2: Add hover action shortcuts & search filter UI**
  Integrate keyboard accessible filtering and fast action buttons.

- [x] **Step 3: Run desktop test suite**
  Run: `pnpm --filter @termif/desktop test`
  Expected: PASS

- [x] **Step 4: Commit changes**
  ```bash
  git add apps/desktop/src/renderer/views/HostList.tsx apps/desktop/src/renderer/styles/app.css
  git commit -m "feat(ui): modernize hostlist sidebar with hierarchical groups and status badges"
  ```

---

### Task 4: Polish Terminal Tabs, Split Panes & SFTP File Explorer

**Files:**
- Modify: `apps/desktop/src/renderer/views/TerminalTabs.tsx`
- Modify: `apps/desktop/src/renderer/views/SftpBrowser.tsx`
- Modify: `apps/desktop/src/renderer/styles/app.css`

**Interfaces:**
- Consumes: Active terminal sessions, remote file tree data.
- Produces: Polished tab chrome, breadcrumbs navigation in SFTP, high-contrast file list.

- [x] **Step 1: Style `TerminalTabs.tsx` with browser-grade tab indicators**
  Add close buttons, active tab indicators, and add tab shortcut buttons.

- [x] **Step 2: Refine `SftpBrowser.tsx` toolbar and breadcrumbs**
  Make breadcrumb segments interactive, add file permission tags, and clean up file size badges.

- [x] **Step 3: Full test suite verification**
  Run: `pnpm test`
  Expected: ALL PASS

- [x] **Step 4: Commit changes**
  ```bash
  git add apps/desktop/src/renderer/views/TerminalTabs.tsx apps/desktop/src/renderer/views/SftpBrowser.tsx apps/desktop/src/renderer/styles/app.css
  git commit -m "feat(ui): polish terminal tabs and sftp file explorer interface"
  ```
