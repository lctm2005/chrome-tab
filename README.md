# Space Tabs

Space Tabs is a Chrome side panel extension for managing browser workspaces with a Space -> Folder -> Tab Group -> Tab model.

It is built for an Arc-like workflow in Chrome: each Space keeps its own working context, saved tabs are stored locally by the extension, and dormant tabs stay unloaded until you explicitly open them.

## Features

- Spaces: switch between separate work contexts without keeping every saved tab loaded.
- Folders: show locally stored nested folders, up to three levels deep.
- Tab Groups: leaf folders map to Chrome tab groups when tabs are opened.
- Ungrouped tabs: Arc-style temporary area with quick new tab and clear actions.
- Panel-only names: tidy tab names in the side panel without renaming Chrome tabs globally.
- Auto Group: group ungrouped tabs locally, with optional BYOK AI support.
- Drag sorting: reorder tab groups and tabs inside a Space.
- Multi-select grouping: select multiple tabs with `Cmd/Ctrl` or `Shift`, then right-click to group them.
- Ask Page: optional page summary and Q&A with a user-provided OpenAI-compatible API key.
- Arc import: append Arc `StorableSidebar.json` Spaces and folders as saved Space content.
- Shortcuts: built-in keyboard actions with user-editable bindings in Settings.

## Package for Chrome Web Store

Run the release packager:

```bash
npm run package
```

The script writes a clean Chrome Web Store zip to `dist/space-tabs-<version>.zip`.
It stages only runtime files, generates a safe empty `config.local.js` stub, and
keeps local secrets, Git metadata, raw artwork, backup icons, and test files out
of the upload package.

Store preparation docs:

- `PRIVACY.md`: privacy policy copy for the store listing or product site.
- `docs/store-listing.md`: Chrome Web Store listing copy, permission
  justifications, reviewer notes, and screenshot plan.
- `docs/commercialization.md`: free-to-Pro packaging and launch plan.

## Install From Package

1. Run `npm run package`, or download a release zip from `dist/`.
2. Unzip it to a local folder.
3. Open `chrome://extensions`.
4. Enable `Developer mode`.
5. Click `Load unpacked`.
6. Select the unzipped extension folder.
7. Pin `Space Tabs` to the toolbar and click the extension icon to open the side panel.

## Install From Source

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select the repository directory.
6. Pin `Space Tabs` to the toolbar and click the extension icon to open the side panel.

After updating the source files, reload the unpacked extension from `chrome://extensions`.

## AI Setup

AI features are optional and use your own API key.

Open `Settings` in the side panel and configure:

- `Base URL`: OpenAI-compatible chat completions endpoint root. Store builds
  leave this blank until you choose a provider.
- `Model`: for example `glm-5.1`.
- `API Key`: stored locally by Chrome for the current extension session.
- `Language`: controls Ask and Summary output language.

If no API key is configured, normal Space, folder, and tab management features continue to work.

## Arc Import

1. Open `Settings`.
2. Choose Arc's `StorableSidebar.json`.
3. Review the import summary.
4. Click `Append Import`.

The importer appends Spaces and keeps the current Space active. Arc folders become nested folder paths, leaf folders become Chrome tab groups when opened, and saved tabs remain dormant until selected.

## Shortcuts

Default bindings:

| Action | Shortcut |
| --- | --- |
| Toggle panel | `Alt+S` |
| Ask submit | `Cmd+Enter` |
| Abort Ask | `Ctrl+C` |
| Open Ask Page | `Alt+A` |
| Tidy names | `Ctrl+Alt+T` |
| Auto group | `Ctrl+Alt+G` |
| Add Space | `Ctrl+Alt+N` |
| Previous Space | `Ctrl+Alt+Left` |
| Next Space | `Ctrl+Alt+Right` |

You can edit common shortcuts in `Settings`.
