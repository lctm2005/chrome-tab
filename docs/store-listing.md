# Space Chrome Web Store Listing

Last updated: 2026-07-12

## Listing Fields

Name:

```text
Space: Arc-like Workspaces for Chrome
```

Short description:

```text
Arc-like Spaces for Chrome with dormant tabs, full-page Workbench, private BYOK AI, and portable backups.
```

Category:

```text
Productivity
```

Language:

```text
English (United States)
```

## Detailed Description

```text
Space brings an Arc-like workspace model to Chrome: one thing per Space, with
the pages around it kept together.

Create a Space for a project, decision, trip, research thread, client, or any
other focused piece of work. Organize its pages with folders and Chrome tab
groups, keep saved tabs dormant until needed, and switch contexts without
keeping every page loaded. Stay compact in the side panel, or open the
full-page Workbench to see the current Space's tabs beside Ask and Settings.

Features:

- Arc-like Spaces for separate browser work contexts.
- Nested folders and Chrome tab group integration.
- Dormant saved tabs that stay unloaded until opened.
- Ask Space grounded in the active page.
- Optional BYOK AI with built-in and OpenAI-compatible providers.
- Panel-only tab names, AI-assisted tidy names, and auto grouping.
- Drag sorting, multi-select grouping, duplicate, discard, rename, and move.
- Portable export and restore for Spaces, saved tabs, and Ask history.
- User-editable panel shortcuts.

Space is local-first. Core organization works without an account or AI key.
There is no Space sync server in this release, and no persistent content script
runs on every website. AI requests happen only after you start an AI action and
go directly to the provider you configure. API keys are kept in Chrome session
storage and are excluded from Space backups.
```

## Permission Justifications

`sidePanel`:
Shows Space in Chrome's side panel.

`tabs`:
Lists, focuses, creates, duplicates, discards, closes, and moves tabs for
user-initiated Space actions.

`tabGroups`:
Creates, renames, recolors, collapses, moves, and updates Chrome tab groups.

`storage`:
Stores local Spaces, folders, dormant tabs, Ask history,
shortcuts, and preferences.

`activeTab`:
Limits page access to the active tab following a user action.

`scripting`:
Extracts current page content only after the user starts Ask Space. Space does
not declare a persistent content script.

`favicon`:
Shows page icons in the side panel.

Optional host permissions:
Requested only when needed for the current website or the user-selected AI
provider endpoint. Space requests the specific origin at the moment of use.

## Privacy Practices Copy

```text
Space stores workspace data locally in Chrome extension storage. This can
include Space and folder names, tab titles and URLs, Chrome
tab group metadata, panel-only names, Ask history, shortcuts, and preferences.

Space does not sell user data, require an account, or operate a hosted sync
service in this release. It does not run a persistent content script on every
website.

AI is optional. When the user starts an AI action, Space sends the relevant
prompt and current page or tab metadata directly to the AI
endpoint selected by the user. The API key is kept in Chrome session storage
and is not included in normal workspace state or exported Space backups.
```

## Reviewer Notes

```text
Core features do not require an account or AI API key.

Suggested review flow:

1. Install Space, click the toolbar action, and complete or skip the focused setup.
2. Create a Space, open several pages, and use folders, tab groups, dormant tabs, and sorting.
3. Open Workbench Settings to review Space backup, BYOK AI, and shortcuts.
4. Use Ask Space only if an AI API key is configured by the reviewer.

Space has no persistent content script. Current page text is extracted only
after a user starts Ask Space and grants access when Chrome asks.
```

## Screenshot Plan

Generate 1280x800 Chrome Web Store screenshots with:

```sh
npm run screenshots:store
```

Upload the generated PNG files from `docs/store-assets/screenshots/` in this
order:

1. `01-spaces-overview.png`: Arc-like Spaces with live Chrome tab groups.
2. `02-nested-folders-dormant-tabs.png`: nested folders and dormant saved tabs.
3. `03-tab-context-menu.png`: tab context menu and Move to Space actions.
4. `04-settings-arc-import-shortcuts.png`: full-page Workbench Settings with backup, BYOK, and shortcuts.
5. `05-ask-page-byok-ai.png`: Ask Space grounded in the active page.

## Launch Checklist

- Build the release zip with `npm run package`.
- Upload `dist/space-<version>.zip` in the Chrome Web Store Developer Dashboard.
- Use `PRIVACY.md` as the source for the public privacy policy page.
- Add the permission justifications above in the privacy and permissions form.
- Provide reviewer notes so optional AI and on-demand page access are clear.
- Update the five screenshots before uploading version 0.5.1.
