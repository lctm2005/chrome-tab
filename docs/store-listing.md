# Space Tabs Chrome Web Store Listing Draft

Last updated: 2026-06-25

## Listing Fields

Name:

```text
Space Tabs
```

Short description:

```text
Organize Chrome tabs into Spaces, folders, groups, and dormant saved tabs from a focused side panel.
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
Space Tabs is a Chrome side panel for organizing browser work into Spaces,
folders, Chrome tab groups, and dormant saved tabs.

Use it to keep separate work contexts without keeping every saved tab loaded.
Create Spaces for projects, clients, classes, trips, or research threads. Store
tabs locally, reopen them when needed, and keep temporary tabs separate from
saved work.

Features:

- Spaces for separate browser work contexts.
- Folders with nested saved tab organization.
- Chrome tab group integration.
- Dormant saved tabs that stay unloaded until opened.
- Panel-only tab names for cleaner workspace labels.
- Drag sorting for groups and tabs.
- Multi-select grouping with Cmd/Ctrl and Shift.
- Duplicate, close, discard, rename, and move tab actions.
- Arc StorableSidebar.json import.
- User-editable keyboard shortcuts.
- Optional BYOK AI for Ask Page, page summaries, and tab grouping.

AI features are optional. Space Tabs works without an AI API key. When AI is
configured, requests are sent to the AI endpoint selected by the user.
```

## Permission Justifications

`sidePanel`:
Shows Space Tabs as a Chrome side panel.

`tabs`:
Lists, focuses, creates, duplicates, discards, closes, and moves tabs as part
of the user's workspace actions.

`tabGroups`:
Creates, renames, recolors, collapses, moves, and updates Chrome tab groups for
Space organization.

`storage`:
Stores local Spaces, folders, dormant saved tabs, shortcut preferences, panel
state, and AI preferences.

`activeTab`:
Supports user-initiated actions on the currently active tab.

`scripting`:
Extracts current page content only after the user starts Ask Page or summary.

`favicon`:
Shows page icons in the side panel.

Optional host permissions:
Requested at the moment of need for Ask Page on the active website or for a
custom AI base URL configured by the user. AI provider access is requested only
after the user configures a provider and starts an AI action.

## Privacy Practices Copy

```text
Space Tabs stores workspace data locally in Chrome extension storage. This can
include tab titles, URLs, Space and folder names, Chrome tab group metadata,
panel-only tab names, shortcut preferences, and extension settings.

Space Tabs does not sell user data and does not run a hosted sync service in
this release.

AI features are optional. If the user configures an AI API key and starts an AI
action, Space Tabs sends the relevant prompt and page or tab context to the AI
endpoint selected by the user. The API key is used only for that configured AI
request.
```

## Reviewer Notes

```text
Core features do not require an account or AI API key.

Suggested review flow:

1. Install Space Tabs and click the toolbar action to open the side panel.
2. Create a new Space.
3. Open several normal web pages.
4. Use Auto Group without an API key to test local grouping fallback.
5. Right-click a tab row to test Duplicate, Rename, Move to, and Close actions.
6. Open Settings to edit shortcuts and review optional AI settings.
7. Use Ask Page only if an AI API key is configured by the reviewer.

AI is BYOK and optional. Without an API key, the extension still provides its
local tab organization features.
```

## Screenshot Plan

1. Main side panel with multiple Spaces and saved tab groups.
2. Nested folders and dormant saved tabs.
3. Tab context menu showing Duplicate, Rename, Move to, and Close.
4. Settings with shortcuts, Arc import, and optional AI configuration.
5. Ask Page view with a short page summary response.

Use 1280x800 screenshots for Chrome Web Store upload.

## Launch Checklist

- Build the release zip with `npm run package`.
- Upload `dist/space-tabs-<version>.zip` in the Chrome Web Store Developer
  Dashboard.
- Use `PRIVACY.md` as the source for the public privacy policy page.
- Add the permission justifications above in the privacy and permissions form.
- Provide reviewer notes so AI is understood as optional.
- Publish beta as Unlisted or Private before switching to Public.
