# Implementation Plan: Optimistic Tab Teardown & Resource Cleanup

Date: 2026-08-30
Spec: `docs/superpowers/specs/2026-08-30-optimistic-tab-close-design.md`
Status: Ready to execute

## Tasks

- [ ] Task 1: Tab Store Optimistic State Updates & Tests
  - File: `apps/desktop/src/renderer/state/tabStore.ts`
  - File: `apps/desktop/test/renderer/tabStore.test.ts`
  - Action: Update `closeTab` in `tabStore` to immediately filter tabs, select adjacent tab, and invoke non-blocking bridge call. Add tests validating active tab fallback when closing first, middle, and last tab.

- [ ] Task 2: Terminal Cleanup & Event Disposals
  - File: `apps/desktop/src/renderer/views/TerminalTabs.tsx`
  - Action: Ensure terminal instance dispose/unmount is executed cleanly upon tab removal without memory leaks.

- [ ] Task 3: Backend SessionManager Tab Teardown
  - File: `packages/core/src/sessions.ts`
  - File: `packages/core/test/sessions.test.ts`
  - Action: Verify `closeTab` terminates SSH/PTY streams cleanly and fires `onTabClosed`. Add unit test in `sessions.test.ts`.

- [ ] Task 4: IPC Handler Non-blocking Wiring
  - File: `apps/desktop/src/main/ipc/sessions.ts` (or main IPC handlers)
  - Action: Wire renderer bridge `closeTab` to main `sessionManager.closeTab` with full try/catch error safety.

- [ ] Task 5: End-to-End Verification & Test Suite
  - Run: `pnpm test`
  - Verify all unit and integration tests pass cleanly.
