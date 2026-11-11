# Space Tabs Chrome Web Store Listing

Last updated: 2026-07-15

## English (United States)

Name:

```text
Space Tabs
```

Short description:

```text
Move your Arc workspace into Chrome. Organize Spaces, tidy tabs with your own AI key, and keep workspace data local.
```

Category:

```text
Productivity
```

Detailed description:

```text
Keep Chrome. Bring your Arc workflow. Add private BYOK AI.

Space Tabs helps people returning from Arc move selected Spaces into Chrome in minutes. Choose Arc's StorableSidebar.json for each import; Space Tabs reads it locally and never modifies it. Review names, conflicts, folders, and tab counts before import, then undo the latest import if it is not right. Saved pages stay dormant until opened, and a portable JSON backup gives you an escape hatch at any time.

Use the compact side panel for quick switching, finding, and dragging tabs. Open the full-page Workbench for migration, backup, and AI organization.

Features:

- Arc-like Spaces for separate browser work contexts.
- Selectable Arc import with conflict preview and Undo.
- Nested folders and Chrome tab group integration.
- Dormant saved tabs that stay unloaded until opened.
- Optional BYOK AI with built-in and OpenAI-compatible providers.
- One Tidy action merges duplicate Tags, regroups tabs, renames tabs, and can close duplicate tabs. Every step is shown in one reviewable preview before applying, and Undo is available afterward.
- A command palette for switching Spaces and finding tabs.
- Portable export and restore for Spaces, saved tabs, and Space context.

Space Tabs is local-first. Core organization works without an account or AI key. There is no telemetry, Space Tabs server, hosted sync service, or persistent script running on every website.

Before Tidy sends anything, Space Tabs shows the selected provider and the tab metadata being sent: tab titles, simplified URLs without query strings or fragments, and domains; topic grouping additionally sends current Tag and live/saved status. Prompt rules use your configured provider and are editable in Settings; local script rules (duplicate merging, duplicate-URL closing, grouping by domain) send no tab metadata. One preview shows every proposed change before you choose Apply. API keys are kept in Chrome local extension storage, where they stay in this browser profile, and are excluded from workspace data, backups, and release packages.
```

## 中文（简体）

名称：

```text
Space Tabs
```

简短说明：

```text
把 Arc 工作空间带回 Chrome。整理 Spaces，用自己的 AI 密钥整理标签页，工作区数据默认保存在本地。
```

详细说明：

```text
继续使用 Chrome，同时保留熟悉的 Arc 工作流，并加入由你控制的 BYOK AI。

每次导入时，由你手动选择 Arc 的 StorableSidebar.json；Space Tabs 只在本地读取，绝不会修改原文件。随后可预览并选择要导入的 Arc Spaces，提前查看命名冲突、文件夹和标签页数量，导入后也可以一键撤销。保存的页面默认休眠，需要时再打开，并可随时导出便携备份。

侧边栏用于快速切换、查找和拖动标签页；全屏 Workbench 用于迁移、备份和 AI 整理。

AI 整理只发送已披露的标签页元数据：标签页标题、去掉查询参数和片段的简化 URL 以及域名；主题分组还会额外发送当前 Tag 与 live/saved 状态。发送前会明确显示所选 AI 提供商和这些元数据。提示词规则可在设置中编辑，AI 可用时把已披露的元数据发送给你配置的提供商；本地脚本规则（重复合并、重复 URL 关闭、按域名分组）与本地命名回退不发送标签页元数据。所有变更在同一个预览中确认后才应用，并支持撤销。

无需账号、无遥测、没有 Space Tabs 中转服务器。工作区数据默认保存在 Chrome 本地；只有当你主动发起 AI 操作时，相关内容才会直接发送给你选择的 AI 提供商。API Key 保存在 Chrome 本地扩展存储中（仅保留在当前浏览器 profile 内），不会进入普通工作区数据、备份或发布包。
```

## Permission Justifications

`sidePanel`:
Shows Space Tabs in Chrome's side panel.

`tabs`:
Lists, focuses, creates, duplicates, discards, closes, and moves tabs for explicit Space actions.

`tabGroups`:
Creates, renames, recolors, collapses, moves, and restores Chrome tab groups.

`storage`:
Stores local Spaces, folders, dormant tabs, operation records, shortcuts, and preferences.

`favicon`:
Shows page icons in the side panel.

Optional host permissions:
Requested only for the user-selected AI provider endpoint at the explicit action that needs it (Test AI and Tidy sends).

`file:///*` host permission:
Lets Space Tabs recognize, restore, and manage local-file tab URLs from the
user's workspace, Arc import, or backup. Chrome still requires the user to
manually enable **Allow access to file URLs** on the extension details page.
Space Tabs does not read local file contents.

## Privacy Practices Copy

```text
Space Tabs stores workspace data locally in Chrome extension storage. This can include Space and folder names, tab titles and URLs, Chrome tab group metadata, panel-only names, operation records, shortcuts, and preferences.

Space Tabs does not sell user data, require an account, collect telemetry, or operate a hosted sync or proxy service. It does not run a persistent content script on every website.

AI is optional. When Tidy sends tab metadata, Space Tabs first shows the provider and exactly what is being sent: tab titles, simplified URLs without query strings or fragments, and domains; topic grouping additionally sends current Tag and live/saved status. Prompt rules use the configured provider and are editable in Settings; local script rules send no tab metadata. One preview covers every proposed change before applying. The API key stays in Chrome local extension storage, where it remains in this browser profile, and is excluded from workspace state, backups, and release packages.
```

## Reviewer Notes

```text
Core features do not require an account or AI API key.

Suggested review flow:

1. Install Space Tabs and choose Create new space or Move from Arc in setup step one: Space.
2. For Arc, manually select a StorableSidebar.json fixture, review conflicts and counts, select Spaces, import, and use Undo. Start another import and verify that the file must be selected again.
3. Create or switch a Space, open several pages, and use the command palette, folders, tab groups, and dormant tabs.
   Optionally import a `file://` saved row: before enabling Chrome's file-access
   toggle it remains saved and shows an actionable explanation; after enabling
   the toggle it opens normally and remains recoverable across Space switches.
4. In setup step two, AI, leave the provider unselected and choose Save to finish without AI. Repeat with complete provider settings and verify that Save stores them. The setup footer has no Not now, export, or import-Undo actions. Then open Workbench Settings to review backup, restore, BYOK settings, and shortcuts.
5. With a test AI provider configured, use Test AI in AI Settings and verify the request reaches that endpoint, then run Tidy and confirm that only the disclosed tab metadata is sent. Verify that no page content is requested from any tab.
6. Run Tidy, cancel its preview and verify nothing changes, then run it again, apply, and use the 10-second Undo prompt.
7. In AI Settings, verify Thinking is available for DeepSeek V4 and GLM-5.2,
   but visibly unavailable for OpenAI, Gemini, Ollama, and unknown custom
   models. The built-in Z.ai option uses its general API endpoint and does not
   retry against Coding Plan after an account error.

Space Tabs has no persistent content script.
```

## Screenshot Plan

Generate 1280x800 screenshots with `npm run screenshots:store` and upload them in this outcome order:

1. `01-spaces-overview.png`: Your Arc workspace, now in Chrome.
2. `02-nested-folders-dormant-tabs.png`: Import Arc Spaces in minutes.
3. `03-tab-context-menu.png`: AI organizes tabs; you approve every change.
4. `04-settings-arc-import-shortcuts.png`: Local by default; export anytime.

## Launch Checklist

- Build the release zip with `npm run package` and run the packaged-secret scan.
- Upload the four screenshots in the outcome order above.
- Publish the English and Simplified Chinese listings from this file.
- Link the public product, privacy, and support pages.
- Invite 10–20 Arc-returning early users and ask only genuine users for honest reviews.
- Provide the reviewer flow above and keep every privacy claim aligned with the packaged manifest.
