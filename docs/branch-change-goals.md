# Branch Change Goals

Branch: `codex/space-context-foundation`

## Objective

Establish Space as the primary local workspace for Chrome tabs, with a full-page Workbench that keeps Space state, tab organization, setup, and optional BYOK AI actions coherent across extension views.

## In Scope

- Keep each Space's live tabs, saved tabs, groups, ordering, and panel names associated with the correct Space.
- Provide a Workbench surface for Space browsing, Ask Space, setup, settings, and Space switching.
- Keep Workbench state synchronized between the side panel, Workbench tab, and shared Chrome storage.
- Support AI-backed Tidy Names and Auto Group with preview-before-apply behavior and explicit BYOK settings.
- Preserve local-only data handling and avoid bundling developer API credentials.
- Provide onboarding for creating a first Space and maintain the groundwork for Arc data import.
- Validate critical flows with unit tests, preview smoke tests, and real MV3 extension E2E tests.

## Acceptance Criteria

- Switching Spaces does not overwrite saved content or create duplicate Workbench surfaces.
- Setup can be reopened and completed without leaving the Workbench unexpectedly.
- Tidy Names and Auto Group show a reviewable proposal before applying changes.
- AI requests use the configured provider and session-scoped API key only.
- A packaged extension can be loaded and exercised in a clean Chrome profile.

## Explicit Follow-ups

The following items are intentionally tracked as follow-ups rather than claimed as complete by this branch document:

- Make Arc import a visible, tested onboarding path while respecting Chrome's user-granted local file access boundary.
- Decide how Ask Space should behave when the active Chrome tab is not an HTTP(S) page.
- Define whether Auto Group should include dormant saved tabs in its proposal and how those tabs are preserved when applying a regroup.
- Restore or replace the Tidy Names icon only after the intended visual language is confirmed.

## Validation Record

The branch currently includes unit, preview, and MV3 extension smoke-test coverage. New behavior must add a regression test at the same layer where the failure can occur, and user-visible workflows must include at least one real extension E2E assertion.
