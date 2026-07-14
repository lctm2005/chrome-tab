# Space Tabs Chrome Web Store Listing

Last updated: 2026-07-13

## English (United States)

Name:

```text
Space Tabs: Arc-like Spaces & BYOK AI
```

Short description:

```text
Move your Arc workspace into Chrome. Organize Spaces, ask pages with your own AI key, and keep workspace data local.
```

Category:

```text
Productivity
```

Detailed description:

```text
Keep Chrome. Bring your Arc workflow. Add private BYOK AI.

Space Tabs helps people returning from Arc move selected Spaces into Chrome in minutes. Review names, conflicts, folders, and tab counts before import; undo the latest import if it is not right. Saved pages stay dormant until opened, and a portable JSON backup gives you an escape hatch at any time.

Use the compact side panel for quick switching, finding, and dragging tabs. Open the full-page Workbench for migration, backup, multi-page Ask, and AI organization.

Features:

- Arc-like Spaces for separate browser work contexts.
- Selectable Arc import with conflict preview and Undo.
- Nested folders and Chrome tab group integration.
- Dormant saved tabs that stay unloaded until opened.
- Ask Space across up to 12 confirmed live HTTP(S) pages, prioritizing selected pages, with numbered sources.
- Optional BYOK AI with built-in and OpenAI-compatible providers.
- Tidy Names and Auto Group proposals that require confirmation and support Undo.
- A command palette for switching Spaces, finding tabs, and opening Ask.
- Portable export and restore for Spaces, saved tabs, and Ask history.

Space Tabs is local-first. Core organization works without an account or AI key. There is no telemetry, Space Tabs server, hosted sync service, or persistent script running on every website.

Before Ask sends anything, Space Tabs shows the selected provider, source pages, extracted content size, and whether stored text from recent conversation messages is included. Generated-response Sources appendices are not sent as conversation context. Before Tidy Names or Auto Group sends tab metadata, it shows the provider, model, exact tabs, URLs, and fields. AI requests go directly to the provider you configure. API keys are kept in Chrome session storage and are excluded from workspace data, backups, and release packages.
```

## 中文（简体）

名称：

```text
Space Tabs：Arc 式空间与自带密钥 AI
```

简短说明：

```text
把 Arc 工作空间带回 Chrome。迁移 Spaces，用自己的 AI 密钥询问多个页面，工作区数据默认保存在本地。
```

详细说明：

```text
继续使用 Chrome，同时保留熟悉的 Arc 工作流，并加入由你控制的 BYOK AI。

Space Tabs 可预览并选择要导入的 Arc Spaces，提前显示命名冲突、文件夹和标签页数量；导入后可以一键撤销。保存的页面默认休眠，需要时再打开，并可随时导出便携备份。

侧边栏用于快速切换、查找和拖动标签页；全屏 Workbench 用于迁移、备份、多页面 Ask 和 AI 整理。

Ask Space 最多读取 12 个用户确认的、当前打开的 HTTP(S) 页面，并优先使用你选择的页面。发送前会明确显示 AI 提供商、来源页面、内容大小，以及是否包含近期对话中已存储的消息文本；生成回复中的 Sources 附录不会作为对话上下文发送。Tidy Names 与 Auto Group 会先展示即将发送的标签元数据；确认生成方案后，还需再次确认才会应用，并支持撤销。

无需账号、无遥测、没有 Space Tabs 中转服务器。工作区数据默认保存在 Chrome 本地；只有当你主动确认 AI 操作时，相关内容才会直接发送给你选择的 AI 提供商。API Key 保存在 Chrome 会话存储中，不会进入普通工作区数据、备份或发布包。
```

## Permission Justifications

`sidePanel`:
Shows Space Tabs in Chrome's side panel.

`tabs`:
Lists, focuses, creates, duplicates, discards, closes, and moves tabs for explicit Space actions.

`tabGroups`:
Creates, renames, recolors, collapses, moves, and restores Chrome tab groups.

`storage`:
Stores local Spaces, folders, dormant tabs, Ask history, operation records, shortcuts, and preferences.

`scripting`:
Extracts only the confirmed Ask source pages after the user starts Ask Space.

`favicon`:
Shows page icons in the side panel.

Optional host permissions:
Requested only for Ask source origins and the user-selected AI provider endpoint at the explicit action that needs them.

## Privacy Practices Copy

```text
Space Tabs stores workspace data locally in Chrome extension storage. This can include Space and folder names, tab titles and URLs, Chrome tab group metadata, panel-only names, Ask history, operation records, shortcuts, and preferences.

Space Tabs does not sell user data, require an account, collect telemetry, or operate a hosted sync or proxy service. It does not run a persistent content script on every website.

AI is optional. Ask uses up to 12 confirmed live HTTP(S) pages, prioritizing pages the user selects. Before Ask, Space Tabs shows the provider, source pages, content size, and whether stored text from recent conversation messages will be included; generated-response Sources appendices are excluded from the conversation context. Before Tidy Names or Auto Group, it shows the exact tab metadata to be sent. After confirmation it sends the relevant prompt, content, stored text from recent conversation messages, or metadata directly to the provider selected by the user. A second review controls whether organization changes are applied. The API key stays in Chrome session storage and is excluded from workspace state, backups, and release packages.
```

## Reviewer Notes

```text
Core features do not require an account or AI API key.

Suggested review flow:

1. Install Space Tabs and choose Start fresh or Move from Arc in the visible three-stage setup.
2. For Arc, select a StorableSidebar.json fixture, review conflicts and counts, select Spaces, import, and use Undo.
3. Create or switch a Space, open several pages, and use the command palette, folders, tab groups, and dormant tabs.
4. Open Workbench Settings to review backup, restore, BYOK settings, and shortcuts.
5. With a test AI provider configured, select two live tabs, ask a comparison, review provider/sources/size, confirm, observe streaming, and Stop if desired.
6. Run Tidy Names or Auto Group, cancel once before generation (verify no provider request), then generate, cancel the apply preview, generate again, apply, and Undo from the visible operation record.

Space Tabs has no persistent content script. Source text is extracted only after a user starts Ask Space and grants the requested source origins.
```

## Screenshot Plan

Generate 1280x800 screenshots with `npm run screenshots:store` and upload them in this outcome order:

1. `01-spaces-overview.png`: Your Arc workspace, now in Chrome.
2. `02-nested-folders-dormant-tabs.png`: Import Arc Spaces in minutes.
3. `05-ask-page-byok-ai.png`: Ask multiple pages with your own AI key.
4. `03-tab-context-menu.png`: AI organizes tabs; you approve every change.
5. `04-settings-arc-import-shortcuts.png`: Local by default; export anytime.

## Launch Checklist

- Build the release zip with `npm run package` and run the packaged-secret scan.
- Upload the five screenshots in the outcome order above.
- Publish the English and Simplified Chinese listings from this file.
- Link the public product, privacy, and support pages.
- Invite 10–20 Arc-returning beta users and ask only genuine users for honest reviews.
- Provide the reviewer flow above and keep every privacy claim aligned with the packaged manifest.
