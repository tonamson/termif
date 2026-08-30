# Design Spec: Google Material Symbols (Offline Font Integration)

Date: 2026-08-30
Status: Approved

## 1. Context & Problem Statement
Currently, termif desktop UI uses raw unicode characters and emoji (such as `×`, `+`, `📁`, `📄`) for interface icons. This causes inconsistent visual styling across different operating systems and lacks modern, sharp developer-tool aesthetics.

## 2. Goals & Non-Goals
### Goals
- **100% Offline Functionality:** Package font files locally without making any external CDN network requests.
- **Strict CSP Compliance:** Fully adhere to the desktop app's Content Security Policy (`default-src 'self'`).
- **Unified & Reusable Icon API:** Provide a lightweight, type-friendly `<Icon name="..." />` component with size/color flexibility via CSS font ligatures.
- **Clean UI Polish:** Replace all raw text/emoji symbols across tabs, terminals, and SFTP browser with Google Material Symbols Outlined.

### Non-Goals
- Loading remote Google Fonts from CDN.
- Introducing heavy runtime SVG icon dependencies.

## 3. Technical Architecture

### 3.1. Font Assets & CSS Setup
- Store Google Material Symbols Outlined font (`material-symbols-outlined.woff2`) locally under `apps/desktop/src/renderer/assets/fonts/`.
- Register the `@font-face` definition in `apps/desktop/src/renderer/styles/app.css`:
```css
@font-face {
  font-family: 'Material Symbols Outlined';
  font-style: normal;
  font-weight: 100 700;
  src: url('../assets/fonts/material-symbols-outlined.woff2') format('woff2');
  font-display: block;
}

.icon-symbol {
  font-family: 'Material Symbols Outlined';
  font-weight: normal;
  font-style: normal;
  font-size: inherit;
  display: inline-block;
  line-height: 1;
  text-transform: none;
  letter-spacing: normal;
  word-wrap: normal;
  white-space: nowrap;
  direction: ltr;
  user-select: none;
  vertical-align: middle;
}
```

### 3.2. Icon Component (`apps/desktop/src/renderer/components/Icon.tsx`)
```tsx
import React from 'react;

export interface IconProps {
  name: string;
  size?: number | string;
  className?: string;
  title?: string;
}

export function Icon({ name, size = 16, className = '', title }: IconProps) {
  return (
    <span
      className={`icon-symbol ${className}`}
      style={{ fontSize: typeof size === 'number' ? `${size}px` : size }}
      title={title}
      aria-hidden={!title}
    >
      {name}
    </span>
  );
}
```

### 3.3. Target UI Components
- **`TerminalTabs.tsx`**:
  - Close button: `<Icon name="close" size={14} />`
  - New tab button: `<Icon name="add" size={16} />`
- **`SftpBrowser.tsx`**:
  - Folders: `<Icon name="folder" size={16} />`
  - Files: `<Icon name="description" size={16} />`
  - Actions: `<Icon name="refresh" />`, `<Icon name="download" />`, `<Icon name="upload" />`

## 4. Verification & Testing
- Visual and unit tests checking:
  - `<Icon />` renders with correct class and ligature text.
  - No CSP violations when loading font files.
  - Correct rendering of tabs and SFTP file trees.
