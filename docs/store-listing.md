# Space Tabs Chrome Web Store Listing

Last updated: 2026-07-15

## English (United States)

Name:

```text
Space Tabs
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

Space Tabs helps people returning from Arc move selected Spaces into Chrome in minutes. Choose Arc's StorableSidebar.json for each import; Space Tabs reads it locally and never modifies it. Review names, conflicts, folders, and tab counts before import, then undo the latest import if it is not right. Saved pages stay dormant until opened, and a portable JSON backup gives you an escape hatch at any time.

Use the compact side panel for quick switching, finding, and dragging tabs. Open the full-page Workbench for migration, backup, Ask Page, and AI organization.

Features:

- Arc-like Spaces for separate browser work contexts.
- Selectable Arc import with conflict preview and Undo.
- Nested folders and Chrome tab group integration.
- Dormant saved tabs that stay unloaded until opened.
- Ask Page for the current HTTP(S) page, with review before sending, streaming, Stop, and a clickable source link.
- Optional BYOK AI with built-in and OpenAI-compatible providers.
- Tidy Names and Auto Group proposals that require confirmation and support Undo.
- A command palette for switching Spaces, finding tabs, and opening Ask.
- Portable export and restore for Spaces, saved tabs, and Ask history.

Space Tabs is local-first. Core organization works without an account or AI key. There is no telemetry, Space Tabs server, hosted sync service, or persistent script running on every website.

Before Ask Page sends anything, Space Tabs shows the selected provider, the current page, whether selected text is included, the total extracted character count including that selection, and whether stored text from recent conversation messages is included. Generated-response source links are not sent as conversation context. Tidy Names uses your configured provider when available and falls back to local naming rules without sending metadata when AI is unavailable. Auto Group requires configured AI. AI proposals send only the disclosed tab metadata and generate one final preview. No tab or Tag changes until you review that preview and choose Apply. API keys are kept in Chrome session storage and are excluded from workspace data, backups, and release packages.
```

## 中文（简体）

名称：

```text
Space Tabs
```

简短说明：

```text
把 Arc 工作空间带回 Chrome。迁移 Spaces，用自己的 AI 密钥询问当前页面，工作区数据默认保存在本地。
```

详细说明：

```text
继续使用 Chrome，同时保留熟悉的 Arc 工作流，并加入由你控制的 BYOK AI。

每次导入时，由你手动选择 Arc 的 StorableSidebar.json；Space Tabs 只在本地读取，绝不会修改原文件。随后可预览并选择要导入的 Arc Spaces，提前查看命名冲突、文件夹和标签页数量，导入后也可以一键撤销。保存的页面默认休眠，需要时再打开，并可随时导出便携备份。

侧边栏用于快速切换、查找和拖动标签页；全屏 Workbench 用于迁移、备份、Ask Page 和 AI 整理。

Ask Page 只读取你点击发送时的当前 HTTP(S) 页面。发送前会明确显示 AI 提供商、当前页面、提取的字符数，以及是否包含近期对话中已存储的消息文本；生成回复中的来源链接不会作为对话上下文发送。回答支持流式输出、Stop 和可点击的单一来源链接。Tidy Names 会在 AI 可用时把已披露的标签页元数据发送给你配置的提供商；AI 未配置或不可用时改用本地命名规则，不发送标签页元数据。Auto Group 需要已配置的 AI。AI 提案只发送已披露的元数据并生成唯一的最终预览；只有在预览中点击 Apply，才会修改标签页或 Tag。应用后支持撤销。

无需账号、无遥测、没有 Space Tabs 中转服务器。工作区数据默认保存在 Chrome 本地；只有当你主动发起 AI 操作时，相关内容才会直接发送给你选择的 AI 提供商。API Key 保存在 Chrome 会话存储中，不会进入普通工作区数据、备份或发布包。
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
Extracts only the current HTTP(S) page after the user sends a question with Ask Page.

`favicon`:
Shows page icons in the side panel.

Optional host permissions:
Requested only for the current Ask Page origin and the user-selected AI provider endpoint at the explicit action that needs them.

`file:///*` host permission:
Lets Space Tabs recognize, restore, and manage local-file tab URLs from the
user's workspace, Arc import, or backup. Chrome still requires the user to
manually enable **Allow access to file URLs** on the extension details page.
Space Tabs does not extract local file contents for Ask Page.

## Privacy Practices Copy

```text
Space Tabs stores workspace data locally in Chrome extension storage. This can include Space and folder names, tab titles and URLs, Chrome tab group metadata, panel-only names, Ask history, operation records, shortcuts, and preferences.

Space Tabs does not sell user data, require an account, collect telemetry, or operate a hosted sync or proxy service. It does not run a persistent content script on every website.

AI is optional. Ask Page uses only the current HTTP(S) page captured when the user sends a question and prioritizes selected text when present. Before sending, Space Tabs shows the provider, page, whether selected text is included, the total extracted character count including that selection, and whether stored text from recent conversation messages will be included; generated-response source links are excluded from the conversation context. Responses stream, can be stopped, and include a clickable link to the single source page. Tidy Names uses the configured provider when available and falls back to local naming rules without sending tab metadata when AI is unavailable. Auto Group requires configured AI. AI proposals send only the disclosed tab metadata and generate one final preview. No tab or Tag changes until the user chooses Apply. The API key stays in Chrome session storage and is excluded from workspace state, backups, and release packages.
```

## Reviewer Notes

```text
Core features do not require an account or AI API key.

Suggested review flow:

1. Install Space Tabs and choose Start fresh or Move from Arc in the visible three-stage setup: Choose, Space, then AI & ready.
2. For Arc, manually select a StorableSidebar.json fixture, review conflicts and counts, select Spaces, import, and use Undo. Start another import and verify that the file must be selected again.
3. Create or switch a Space, open several pages, and use the command palette, folders, tab groups, and dormant tabs.
   Optionally import a `file://` saved row: before enabling Chrome's file-access
   toggle it remains saved and shows an actionable explanation; after enabling
   the toggle it opens normally and remains recoverable across Space switches.
4. In setup step three, leave the provider unselected and choose Save to finish without AI. Repeat with complete provider settings and verify that Save stores them. The setup footer has no Not now, export, or import-Undo actions. Then open Workbench Settings to review backup, restore, BYOK settings, and shortcuts.
5. With a test AI provider configured, make an HTTP(S) page active and ask about it. Review the provider, exact current page, extracted character count, and conversation context; confirm, observe streaming and the clickable single-source link, and Stop if desired. Verify that selected or background tabs are not sent.
6. Run Tidy Names and verify one click generates its single final preview without an intermediate confirmation; cancel it and verify nothing changes. Do the same for Auto Group, then run it again, apply, and use the 10-second Undo prompt.
7. In AI Settings, verify Thinking is available for DeepSeek V4 and GLM-5.2,
   but visibly unavailable for OpenAI, Gemini, Ollama, and unknown custom
   models. The built-in Z.ai option uses its general API endpoint and does not
   retry against Coding Plan after an account error.

Space Tabs has no persistent content script. Source text is extracted only from the current HTTP(S) page after the user sends with Ask Page and grants access to that page's origin.
```

## Screenshot Plan

Generate 1280x800 screenshots with `npm run screenshots:store` and upload them in this outcome order:

1. `01-spaces-overview.png`: Your Arc workspace, now in Chrome.
2. `02-nested-folders-dormant-tabs.png`: Import Arc Spaces in minutes.
3. `05-ask-page-byok-ai.png`: Ask the current page with your own AI key.
4. `03-tab-context-menu.png`: AI organizes tabs; you approve every change.
5. `04-settings-arc-import-shortcuts.png`: Local by default; export anytime.

## Launch Checklist

- Build the release zip with `npm run package` and run the packaged-secret scan.
- Upload the five screenshots in the outcome order above.
- Publish the English and Simplified Chinese listings from this file.
- Link the public product, privacy, and support pages.
- Invite 10–20 Arc-returning early users and ask only genuine users for honest reviews.
- Provide the reviewer flow above and keep every privacy claim aligned with the packaged manifest.
