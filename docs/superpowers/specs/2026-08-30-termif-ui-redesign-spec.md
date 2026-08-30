# Termif UI/UX Redesign Specification: Hybrid Studio Console

## 1. Overview & Objective
Transform the Termif desktop interface into a high-end, professional SSH & Terminal Studio client ("Hybrid Studio Console" style, inspired by Warp, Termius, and VS Code). Replace generic styling with a meticulously crafted design system using the taste-skill philosophy.

---

## 2. Design System Tokens (`tokens.css` & Theme Palettes)

### 2.1 Color Palette
- **Canvas Base:** `#0B0E14` (Deep obsidian slate)
- **Surface Level 1 (Sidebar, Titlebar):** `#111620`
- **Surface Level 2 (Cards, Selected Tabs, Panels):** `#19202E`
- **Surface Level 3 (Hover states, Active highlights):** `#222B3D`
- **Borders & Dividers:** `1px solid rgba(255, 255, 255, 0.08)` (Micro-hairline)
- **Accents:**
  - Primary Accent: `#38BDF8` (Sky blue 400)
  - Success / Active: `#34D399` (Emerald 400)
  - Warning / Connecting: `#FBBF24` (Amber 400)
  - Danger / Disconnected: `#F87171` (Rose 400)
- **Text Hierarchy:**
  - Primary: `#F1F5F9` (Slate 100)
  - Secondary / Muted: `#94A3B8` (Slate 400)
  - Ghost / Disabled: `#475569` (Slate 600)

### 2.2 Typography
- **UI & Controls:** `-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif`
- **Terminal & Monospace:** `'JetBrains Mono', 'Fira Code', Menlo, Monaco, Consolas, monospace`
- **Tracking:** `-0.01em` on body, `-0.02em` on headings and button labels.

### 2.3 Spacing & Radii
- **Border Radius:** `6px` for small chips/buttons, `8px` for inputs/cards, `12px` for modals/dialogs.
- **Elevation Shadows:** Soft diffuse shadows `0 8px 24px -4px rgba(0, 0, 0, 0.45)`.

---

## 3. Structural Components & Layout

### 3.1 Hybrid Titlebar (`Titlebar.tsx`)
- Native window controls integration (macOS traffic lights / Windows caption buttons).
- Center Quick Command & Host Search input (`Ctrl+P` / `Cmd+K` trigger).
- Segmented Pill Tab Switcher:
  - `Terminal` (`>_`)
  - `SFTP Files` (`📁`)
  - `Port Forwards` (`⇄`)
- Right Utility Cluster:
  - Active Host Latency Badge (`● 24ms`).
  - Snippets Palette toggle.
  - Inspector Toggle (`ⓘ`).
  - Preferences / Settings gear.

### 3.2 Hierarchical Server Sidebar (`HostList.tsx`, `SidebarResizer.tsx`)
- Search filter input with instant matching.
- Folder tree grouping (e.g. `Production`, `Staging`, `Database Clusters`) with host count chips.
- Host item cards:
  - Status indicator (Live ping dot, SSH protocol badge).
  - Quick action hover toolbar (Connect, SFTP, Edit, Duplicate).
  - Context menu support for immediate operations.

### 3.3 Terminal Tabs & Multi-Pane View (`TerminalTabs.tsx`, `TerminalPane.tsx`)
- Sleek browser-style tabs with close buttons, active glow, and process status indicators.
- High-contrast xterm canvas container with balanced padding (`12px 16px`).
- Quick split terminal buttons (Horizontal / Vertical split).

### 3.4 SFTP File Manager (`SftpBrowser.tsx`, `TransferList.tsx`)
- Breadcrumbs path bar with interactive segment clicking.
- Dual view toggle (Remote tree vs Local tree).
- File list with file-type icons, formatted file size, permissions (`drwxr-xr-x`), and modification dates.
- Bottom floating transfer speed and progress dock.

### 3.5 Host & Session Inspector Drawer (`Inspector.tsx`)
- Collapsible sidebar on the right.
- Connection metadata: Remote OS, Uptime, IP Address, Public Key finger-print.
- Live Port Forwards summary with 1-click toggle switch.

---

## 4. Interaction & Micro-Animations
- Tab switching: `150ms ease-out` opacity and transform transition.
- Host card hover: Subtle background shift (`#111620` -> `#19202E`) and hairline border glow.
- Quick connect dropdown: Spring drop animation with keyboard navigation (`ArrowUp`/`ArrowDown`/`Enter`).

---

## 5. Non-Functional Requirements & Accessibility
- Respect high contrast and color-blind safety in status dots (using icon shapes + color).
- Strict keyboard navigability across all tabs and menus.
- Zero layout shift during pane resize and drawer toggles.
