# Space

Space is an Arc-like workspace for Chrome: one thing per Space, with the pages
around it kept together. `Ask Space` can use the current page through an
optional BYOK provider.

## Features

- Spaces: switch between separate work contexts without keeping every saved tab loaded.
- Ask Space: ask questions using the active page.
- Workbench: use a full-page view for the current Space's tabs, Ask, and Settings.
- Folders: show locally stored nested folders, up to three levels deep.
- Tab Groups: leaf folders map to Chrome tab groups when tabs are opened.
- Ungrouped tabs: Arc-style temporary area with quick new tab and clear actions.
- Panel-only names: tidy tab names in the side panel without renaming Chrome tabs globally.
- Auto Group: group ungrouped tabs locally, with optional BYOK AI support.
- Drag sorting: reorder tab groups and tabs inside a Space.
- Multi-select grouping: select multiple tabs with `Cmd/Ctrl` or `Shift`, then right-click to group them.
- Portable backup: export and restore Spaces, saved tabs, and Ask history without API keys.
- Local-first privacy: no account, hosted sync service, or persistent script running on every website.
- Panel shortcuts: built-in keyboard actions with user-editable bindings in Settings.

## Package for Chrome Web Store

Run the release packager:

```bash
npm run package
```

The script writes a clean Chrome Web Store zip to `dist/space-<version>.zip`.
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
7. Pin `Space` to the toolbar and click the extension icon to open the side panel.

## Install From Source

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select the repository directory.
6. Pin `Space` to the toolbar and click the extension icon to open the side panel.

After updating the source files, reload the unpacked extension from `chrome://extensions`.

## AI Setup

AI features are optional and use your own API key.

Click `Settings` in the side panel to open the full-page Workbench, then configure:

- `Provider`: choose `Z.ai / GLM`, `OpenAI`, `Google Gemini`, `DeepSeek`,
  `Ollama (Local)`, or `Custom OpenAI-compatible`.
- `Base URL`: built-in providers fill this automatically; custom providers can
  edit it.
- `Model`: choose a provider model, or pick `Custom model...` for compatible
  endpoints and local Ollama models.
- `API Key`: stored locally by Chrome for the current extension session; Ollama
  runs locally and does not require one.
- `Language`: controls Ask Space output language.

If no API key is configured, normal Space, folder, and tab management features continue to work.

## Space Backup

Open `Settings` and use `Export Backup` to write a portable JSON file. Restore
replaces the current Spaces while keeping local AI settings, shortcuts, and API
keys unchanged. The exported file can contain saved page URLs and Ask history,
so treat it as personal workspace data.

## Shortcuts

Default bindings:

| Action | Shortcut |
| --- | --- |
| Toggle panel | `Alt+S` |
| Ask submit | `Cmd+Enter` |
| Abort Ask | `Ctrl+C` |
| Open Ask Space | `Alt+A` |
| Tidy names | `Ctrl+Alt+T` |
| Auto group | `Ctrl+Alt+G` |
| Add Space | `Ctrl+Alt+N` |
| Previous Space | `Ctrl+Alt+Left` |
| Next Space | `Ctrl+Alt+Right` |

`Alt+S` is the global Chrome action shortcut. The other bindings apply while
the side panel is focused and can be edited in `Settings`.
