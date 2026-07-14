# Space Tabs Privacy Policy

Last updated: 2026-07-13

Space Tabs is a Chrome extension for Arc-like browser workspaces, dormant saved
tabs, and optional BYOK AI.

## Data Space Handles

Space may handle:

- Tab titles, URLs, favicons, Chrome tab IDs, and tab group metadata.
- User-created Spaces, folders, ordering, panel-only tab names, Ask history,
  collapsed state, shortcuts, and preferences.
- Space backup files when the user explicitly exports or restores one.
- Titles, URLs, selected text, and page text from up to 12 confirmed live
  HTTP(S) source tabs only when the user starts Ask Space. Ask prioritizes the
  pages the user selects.
- Tab titles, URLs, domains, and—for Auto Group—current Tag and live/saved
  status, only after the user confirms generation of a Tidy Names or Auto
  Group proposal.
- User-provided AI provider settings and an optional AI API key.

## Local Storage

Space Tabs stores workspace data and preferences in Chrome extension storage on the
user's device. The optional AI API key is stored in Chrome session storage when
available and is excluded from normal workspace state and exported backups.

Space Tabs does not require an account, collect telemetry, or operate a hosted
sync service in this release. Workspace data is not uploaded to a Space Tabs server. Space Tabs does not
declare a persistent content script that runs on every website.

Exported backups can contain Ask history, tab titles, and URLs.
The user chooses where those files are stored and shared.

## Network Requests

Core Space, Arc import, folder, shortcut, export, restore, and tab management
features work locally.

Before Ask Space sends anything, it shows the selected provider, successful
source pages, extracted character count, truncation state, whether stored text
from recent conversation messages will be included, and any confirmed sources
that could not be read or fit within the content limit. Generated-response
Sources appendices are not included in the conversation context sent to the AI
provider. Before Tidy Names or Auto Group sends tab metadata, it shows the
provider, model, exact
tabs, full URLs, and fields involved. Confirmation generates a proposal; a
separate review controls whether that proposal is applied. Space Tabs sends
the confirmed prompt, source content, stored text from recent conversation
messages, or tab metadata directly to the AI endpoint configured by the user.
The API key is sent to that provider as an authorization credential.
Space Tabs does not proxy AI requests through its own server.

Space Tabs does not sell, rent, or share user data for advertising.

## Permissions

Space Tabs requests Chrome permissions to:

- Show the extension in Chrome's side panel.
- Read and manage tabs and Chrome tab groups for the active browser window.
- Store local Space data and preferences.
- Read only confirmed live source pages after a user starts Ask Space.
- Request access to confirmed Ask source origins and the selected AI provider
  endpoint at the explicit action that needs it.

## User Control

Users can clear an AI API key in Settings, export their Space data, restore a
chosen backup, and undo supported import or organization operations. Users can
remove all local extension data by uninstalling Space Tabs or clearing its Chrome extension
storage. Leaving AI unconfigured prevents AI network requests.

## Contact

Email privacy questions and data requests to lctm2005@gmail.com.
