# Space Tabs

Keep Chrome. Bring your Arc workflow. Add private BYOK AI.

Space Tabs is an Arc-like workspace for Chrome. Its first-run migration wizard
previews selected Arc Spaces before import, while controlled AI workflows show
what data will be sent before generating a proposal and what will change before applying it.

## Features

- Spaces: switch between separate work contexts without keeping every saved tab loaded.
- Arc migration: import selected Spaces from `StorableSidebar.json`, review conflicts and counts, and undo the latest import.
- Ask Space: ask across up to 12 confirmed live HTTP(S) pages in a Space, prioritizing pages you select, with disclosure of the provider, sources, content size, and stored text from recent conversation messages, plus streaming, Stop, and clickable citations.
- Workbench: use a full-page view for the current Space's tabs, Ask, and Settings.
- Folders: show locally stored nested folders, up to three levels deep.
- Tab Groups: leaf folders map to Chrome tab groups when tabs are opened.
- Ungrouped tabs: Arc-style temporary area with quick new tab and clear actions.
- Panel-only names: tidy tab names in the side panel without renaming Chrome tabs globally.
- Tidy Names and Auto Group: confirm tab metadata before AI generation, then review the proposal before applying it. Tidy handles live tab names; Auto Group includes eligible live and dormant saved tabs and lists untouched historical Tags.
- Recovery: use the operation record to undo the latest Tidy, Auto Group, or restore action; Arc import has a dedicated visible Undo. Undo stops safely if the affected portable content changed afterward.
- Command palette: switch Spaces, find tabs, and open Ask with `Cmd/Ctrl+K`.
- Drag sorting: reorder tab groups and tabs inside a Space.
- Multi-select grouping: select multiple tabs with `Cmd/Ctrl` or `Shift`, then right-click to group them.
- Portable backup: export and restore Spaces, saved tabs, and Ask history without API keys. Restore checks an 8 MB Chrome-storage safety budget before writing and rolls back on failure.
- Local-first privacy: no account, hosted sync service, or persistent script running on every website.
- Panel shortcuts: built-in keyboard actions with user-editable bindings in Settings.

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
shows a preview, replaces the current Spaces while keeping local AI settings,
shortcuts, and API keys unchanged, and creates an Undo record. The exported
file can contain saved page URLs and Ask history, so treat it as personal data.

## Product, Privacy, and Support Site

The source for the aligned product, privacy, and support pages lives in
`website/`. A private validation deployment is available at
`https://space-tabs-chrome.james-lctm.chatgpt.site`; make the site public before
using its URLs in the Chrome Web Store listing.

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
