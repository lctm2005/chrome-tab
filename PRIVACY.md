# Space Tabs Privacy Policy

Last updated: 2026-07-15

Space Tabs is a Chrome extension for Arc-like browser workspaces, dormant saved
tabs, and optional BYOK AI.

## Data Space Handles

Space Tabs may handle:

- Tab titles, URLs, favicons, Chrome tab IDs, and tab group metadata.
- User-created Spaces, folders, ordering, panel-only tab names, collapsed
  state, shortcuts, and preferences.
- Space backup files when the user explicitly exports or restores one.
- Arc `StorableSidebar.json` files when the user explicitly selects one for an
  import. Space Tabs reads the selected file locally and never modifies it.
- Tab titles, simplified URLs without query strings or fragments, and domains
  when the user starts Tidy with usable AI settings. Tidy uses
  local naming rules and sends no tab metadata when AI is unconfigured or
  unavailable. Topic grouping additionally sends current Tag and live/saved status
  when the user starts it with configured AI.
- User-provided AI provider settings and an optional AI API key.
- Local `file://` page URLs present in open tabs, Arc imports, or backups. Space
  Tabs does not read local file contents; opening or managing those tabs
  requires the user's separate **Allow access to file URLs** Chrome setting.

## Local Storage

Space Tabs stores workspace data and preferences in Chrome extension storage on the
user's device. The optional AI API key is stored in Chrome local extension
storage (it stays in this browser profile and never leaves the device) and is
excluded from normal workspace state and exported backups.

Space Tabs does not require an account, collect telemetry, or operate a hosted
sync service in this release. Workspace data is not uploaded to a Space Tabs server. Space Tabs does not
declare a persistent content script that runs on every website.

Exported backups can contain tab titles and URLs.
The user chooses where those files are stored and shared.

Space Tabs does not persist an Arc source file or a reusable file handle. The
user selects `StorableSidebar.json` again for each import.

Space Tabs cannot be enabled in Incognito mode. This prevents private-window
tab URLs from entering the regular profile's shared extension storage.

## Network Requests

Core Space, Arc import, folder, shortcut, export, restore, and tab management
features work locally.

Before Tidy sends anything, Space Tabs shows the selected
provider and the tab metadata being sent: tab titles, simplified URLs without
query strings or fragments, and domains (topic grouping additionally sends
current Tag and live/saved status). Rename sends the disclosed tab
metadata directly to the configured provider when AI is available; if AI is
unconfigured or the request fails, it uses local naming rules without sending
metadata (or without sending again after a failed provider request). Auto
Group requires configured AI and sends the disclosed metadata directly to
that provider. Both workflows generate one final preview and neither changes
tabs or Tags until the user reviews that preview and chooses Apply. Space
Tabs sends the disclosed tab metadata directly to the AI endpoint configured
by the user. The API key is sent to that provider as an authorization
credential. Space Tabs does not proxy AI requests through its own server.

Space Tabs does not sell, rent, or share user data for advertising.

## Permissions

Space Tabs requests Chrome permissions to:

- Show the extension in Chrome's side panel.
- Read and manage tabs and Chrome tab groups across browser windows for Space
  actions. Each side panel displays its own window; explicit cross-window
  restore, switch, move, and delete actions can inspect or update other windows.
- Store local Space data and preferences.
- Request access only to the selected AI provider endpoint at the explicit
  action that needs it (Test AI and Tidy sends).
- Recognize, restore, and manage saved local-file tabs only after the user
  manually enables Chrome's **Allow access to file URLs** setting. The declared
  `file:///*` host permission does not bypass that user-controlled toggle.

## User Control

Users can clear an AI API key in Settings, export their Space data, restore a
chosen backup, select a local Arc file for each import, and undo supported
import or organization operations. Users can
remove all local extension data by uninstalling Space Tabs or clearing its Chrome extension
storage. Leaving AI unconfigured prevents AI network requests.

## Contact

Email privacy questions and data requests to lctm2005@gmail.com.
