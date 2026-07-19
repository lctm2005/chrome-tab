# Branch Change Goals

Branch: `codex/space-context-foundation`

## Product Objective

Space Tabs should be easy for Arc users to discover, safe to try, and credible to keep using. The branch is not a general feature expansion project. Its purpose is to sharpen the product's position, prove the difference in the Chrome Store, and complete the trust path from migration to everyday use.

## Positioning

> Keep Chrome. Bring your Arc workflow. Add private BYOK AI.

Recommended store name:

```text
Space Tabs: Arc-like Spaces & BYOK AI
```

Recommended short description:

```text
Move your Arc workspace into Chrome. Organize Spaces, ask pages with your own AI key, and keep workspace data local.
```

The product promise is the combination of:

- Arc-like Spaces and workflow migration without browser lock-in.
- User-controlled BYOK AI for asking, naming, and organizing.
- Local-first workspace data with explicit disclosure of what is sent to the selected AI provider.
- Reviewable changes, user confirmation, and Undo instead of silent tab movement or deletion.

## Priority Outcomes

### P0: Discoverability and Trust

- Publish the Arc-oriented name, short description, screenshot order, and Chinese listing.
- Rebuild the five store screenshots around user outcomes and real Chrome usage:
  1. Your Arc workspace, now in Chrome.
  2. Import Arc Spaces in minutes.
  3. Ask any page with your own AI key.
  4. AI organizes tabs. You approve every change.
  5. Local by default. Export anytime.
- Create a real product page, privacy page, and support page.
- Secure the first 10 to 20 Arc-returning users and the first five authentic reviews.

### P1: Migration and Recovery

- Turn Arc import into a first-run migration wizard instead of a hidden Settings append action.
- Add selectable import, conflict preview, import Undo, complete JSON export, and restore.
- Make the core migration promise true: `Import from Arc in minutes. Export anytime.`
- Keep setup's final AI step focused on one `Save` action: saving with no provider finishes setup without AI, while a complete provider configuration is saved for use.

### P2: Controlled AI Workflow

- Make Tidy Names and Auto Group produce a proposal before changing anything.
- Show what will move, rename, merge, or remain untouched.
- Add one-click Undo and an operation record.
- Keep Ask Page scoped to the current HTTP(S) page captured when the user sends a question.
- Show the chosen provider, single page, content size, and conversation context before sending; support streaming, stop generation, and a clickable single-source citation.
- Defer multi-page Ask Space until its use case, source-selection model, and user experience are defined.

### P3: Right-Sized Surfaces

- Keep Side Panel focused on quick switching, finding, and dragging tabs.
- Use the full-page Workbench for Spaces, migration, backup, Ask Page, and AI organization.
- Add a Command Palette for switching Spaces, searching tabs, and Ask Page on demand.
- Treat Pins/Favorites as a focused core workflow only if they improve daily retrieval; do not add features without a clear use case.
- Keep any Hover Rail optional and off by default because it must not undermine the privacy-first position.

## Privacy Requirements

- Remove the default all-site `document_start` content script where the user action can use `activeTab` and `scripting` instead.
- Use Chrome Commands for panel toggling; handle panel shortcuts only while the panel is focused.
- Default AI grouping to title and URL; request page structure only when the user explicitly asks for it.
- State clearly: no account, no telemetry, no Space Tabs server, and BYOK content is sent to the provider selected by the user.
- Keep API keys in session storage and keep them out of ordinary workspace state and release packages.

## Acceptance Criteria

- An Arc user can understand the product's value from the store title, first screenshot, and short description without reading a feature list.
- Arc migration is visible during first-run setup, has preview and Undo, and does not require trusting an opaque append operation.
- The final setup step has one `Save` action and no onboarding-only skip, export, or import-Undo controls.
- Export and restore provide a credible escape hatch before users commit their workspace.
- AI changes are proposed, reviewable, confirmable, and reversible.
- Ask Page identifies the provider, current page, extracted character count, and conversation context before sending content.
- Privacy claims match the manifest, runtime permissions, storage model, and published privacy page.
- The store listing, website, onboarding, and product UI repeat the same Arc migration, BYOK control, and local-data promise.

## Scope Discipline

The goal is not to accumulate more controls. Multi-page Ask Space, Cross-Space Search, dynamic integrations, files, Hover Rail, and other additions stay out unless they directly strengthen migration, retrieval, controlled AI, or trust. Every new feature needs a concrete use case and a corresponding user-visible proof point.

## Validation

Each user-facing promise must have a matching check:

- Store claims: rendered screenshots and listing review.
- Migration: real import preview, conflict handling, Undo, export, and restore E2E.
- AI control: proposal, confirmation, no-op cancel, and Undo E2E.
- Privacy: manifest permission audit, storage audit, and packaged-secret scan.
- Core workflows: clean-profile MV3 E2E across onboarding, Space switching, dormant tabs, Workbench, and Ask Page.
