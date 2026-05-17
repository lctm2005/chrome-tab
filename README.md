# Space Tabs

![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-4285F4)
![Side Panel](https://img.shields.io/badge/API-Side%20Panel-34A853)
![BYOK](https://img.shields.io/badge/AI-BYOK-111111)
![Tests](https://img.shields.io/badge/tests-node%20--test-2F63FF)

Space Tabs is a Chrome side panel extension for managing browser workspaces with a Space -> Tab Group -> Tab model. It keeps the UI close to a compact vertical tab workflow while adding panel-only tab naming, automatic grouping, page-aware AI, and bring-your-own-key model configuration.

## Features

- Spaces: switch between separate work contexts and restore the tabs that belong to each Space.
- Tab Groups: keep Chrome tab groups and Space group state in sync, including collapse and expand state.
- Ungrouped tabs: Arc-style temporary tab area with quick new tab and clear actions.
- Panel-only names: tidy tab names in the side panel without renaming Chrome tabs globally.
- Auto Group: classify tabs into Chrome tab groups while keeping Space ownership separate.
- Drag sorting: reorder tab groups and tabs inside a Space.
- Multi-select grouping: select multiple tabs with `Cmd/Ctrl` or `Shift`, then right-click to group them.
- Ask Page: separate Ask view with Markdown answers, Summary, abort, and tab-bound chat sessions.
- Arc import: append Arc `StorableSidebar.json` Spaces and folders as Space snapshots.
- BYOK AI: configure OpenAI-compatible providers such as GLM-5.1 without hardcoding credentials.
- Shortcuts: built-in keyboard actions with user-editable bindings in Settings.

## Install

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this repository directory.
5. Pin `Space Tabs` to the toolbar and click the extension icon to open the side panel.

After pulling new code, reload the unpacked extension from `chrome://extensions` so Chrome picks up the latest files.

## AI Setup

Open `Settings` in the side panel and configure:

- `Base URL`: OpenAI-compatible chat completions endpoint root.
- `Model`: for example `glm-5.1`.
- `API Key`: stored locally by Chrome; never commit it to the repository.
- `Language`: controls Ask and Summary output language.

For local preview or development, copy `config.example.js` to `config.local.js` and fill local values there. `config.local.js` is ignored by Git.

## Arc Import

Open `Settings`, choose Arc's `StorableSidebar.json`, review the import summary, then click `Append Import`.

The importer appends Spaces and does not switch away from the current Space. Arc folders become Chrome tab groups, loose Arc tabs become Ungrouped tabs, and imported tabs are stored as Space snapshots until you open that Space.

## Shortcuts

Default bindings:

| Action | Shortcut |
| --- | --- |
| Toggle panel | `Cmd+S` on macOS, `Ctrl+Shift+S` elsewhere |
| Ask submit | `Cmd+Enter` |
| Abort Ask | `Ctrl+C` |
| Open Ask Page | `Alt+A` |
| Tidy names | `Ctrl+Alt+T` |
| Auto group | `Ctrl+Alt+G` |
| Add Space | `Ctrl+Alt+N` |
| Previous Space | `Ctrl+Alt+Left` |
| Next Space | `Ctrl+Alt+Right` |

You can edit common shortcuts in `Settings`.

## Development

This project is intentionally dependency-light. It uses native ES modules and Chrome Extension APIs.

```bash
npm test
npm run check
```

Useful files:

- `manifest.json`: Chrome MV3 extension manifest.
- `background.js`: service worker and Chrome API bridge.
- `content-script.js`: page extraction, outline extraction, and page-level shortcuts.
- `sidepanel.html`: side panel document.
- `sidepanel.js`: UI behavior and Space workflows.
- `src/shared/`: pure helpers used by the extension and tests.
- `tests/`: Node test suite for AI requests, shortcuts, Space membership, snapshots, tab utilities, and selection.

## Security And Privacy

- API keys are user-provided and should stay in Chrome local storage or ignored local config only.
- Do not commit `config.local.js`.
- A lightweight content script runs on normal web pages to support page-level shortcuts and outline lookup.
- Ask and Summary extract active page text only when the user explicitly starts that action.
- Optional host permissions are requested for active page extraction when Chrome requires them.
- Stored Ask sessions are capped and pruned to limit local storage growth.

## Verification

Before publishing or handing off changes, run:

```bash
npm test
npm run check
git diff --check
```

For extension behavior changes, also reload the unpacked extension in real Chrome and verify the side panel workflow manually.
