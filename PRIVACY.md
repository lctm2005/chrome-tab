# Space Privacy Policy

Last updated: 2026-07-12

Space is a Chrome extension for Arc-like browser workspaces, local Context
documents, dormant saved tabs, and optional BYOK AI.

## Data Space Handles

Space may handle:

- Tab titles, URLs, favicons, Chrome tab IDs, and tab group metadata.
- User-created Spaces, folders, ordering, panel-only tab names, Context
  documents, Ask history, collapsed state, shortcuts, and preferences.
- Arc `StorableSidebar.json` content when the user selects a file.
- Space backup files when the user explicitly exports or restores one.
- Current page title, URL, selected text, and page text only when the user
  starts Ask Space or a page summary.
- User-provided AI provider settings and an optional AI API key.

## Local Storage

Space stores workspace data and preferences in Chrome extension storage on the
user's device. The optional AI API key is stored in Chrome session storage when
available and is excluded from normal workspace state and exported backups.

Space does not require an account or operate a hosted sync service in this
release. Workspace data is not uploaded to a Space server. Space does not
declare a persistent content script that runs on every website.

Exported backups can contain Context text, Ask history, tab titles, and URLs.
The user chooses where those files are stored and shared.

## Network Requests

Core Space, Context, folder, shortcut, import, export, and tab management
features work locally.

When the user starts an AI action, Space sends the relevant prompt, local Space
Context, current page content, or tab metadata directly to the AI endpoint
configured by the user. The API key is sent to that provider as an
authorization credential. Space does not proxy AI requests through its own
server.

Space does not sell, rent, or share user data for advertising.

## Permissions

Space requests Chrome permissions to:

- Show the extension in Chrome's side panel.
- Read and manage tabs and Chrome tab groups for the active browser window.
- Store local Space data and preferences.
- Read the active page only after a user starts Ask Space or Summary.
- Request access to a specific website or AI provider origin at the moment a
  user-initiated feature needs it.

## User Control

Users can edit or clear each Space Context, clear an AI API key in Settings,
export their Space data, and restore a chosen backup. Users can remove all
local extension data by uninstalling Space or clearing its Chrome extension
storage. Leaving AI unconfigured prevents AI network requests.

## Contact

Email privacy questions and data requests to lctm2005@gmail.com.
