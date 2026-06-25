# Space Tabs Privacy Policy

Last updated: 2026-06-25

Space Tabs is a Chrome extension for organizing browser tabs into Spaces,
folders, Chrome tab groups, dormant saved tabs, and optional AI-assisted page
workflows.

## Data Space Tabs Handles

Space Tabs may handle:

- Tab titles, URLs, favicons, Chrome tab IDs, and Chrome tab group metadata.
- User-created Spaces, folders, tab ordering, panel-only tab names, collapsed
  state, shortcut settings, and extension preferences.
- Imported Arc `StorableSidebar.json` content when the user selects a file.
- Current page title, URL, headings, and page text only when the user invokes
  Ask Page, page summary, or AI-assisted grouping.
- User-provided AI settings such as base URL, model, language, temperature,
  and max token preferences.
- A user-provided AI API key when the user chooses to configure one.

## Storage

Space Tabs stores workspace data and preferences in Chrome extension storage on
the user's device. Space Tabs stores the optional AI API key in Chrome session
storage when available, and does not include the API key in the normal saved
workspace state.

Space Tabs does not operate a hosted sync service for this release. Workspace
data is not uploaded to a Space Tabs server.

## Network Requests

Core tab, Space, folder, shortcut, and import features work locally.

When the user enables AI features and starts an AI action, Space Tabs sends the
AI request to the AI endpoint configured by the user in Settings. The request
may include the current page title, URL, extracted page text, selected prompt,
tab titles, tab URLs, and the user's AI API key as an authorization header.

Space Tabs does not sell, rent, or share user data for advertising.

## Permissions

Space Tabs requests Chrome permissions to:

- Show the extension in the Chrome side panel.
- Read and manage tabs and Chrome tab groups for the active browser window.
- Store local Space, folder, shortcut, and panel state.
- Read the current page only after user action for Ask Page or summary.
- Request optional site or AI endpoint access only when a user-initiated
  feature needs that access.

## User Control

Users can remove local extension data by uninstalling Space Tabs or clearing
extension storage in Chrome. Users can clear the AI API key from Settings.
Users can avoid AI network requests by leaving AI unconfigured or by not using
AI actions.

## Contact

Use the support email shown on the Chrome Web Store listing for privacy
questions and data requests.
