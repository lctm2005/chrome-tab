# Space Tabs 产品改造:删 Ask Page + Tidy 合并 + 设置重构 + Chrome 风格

## Context

在完成三类历史 bug 修复后,用户提出整体产品调整:① 彻底删除 Ask Page 功能;② 🧹Tidy Names 与 📦Auto Group 合并为单个 **Tidy** 按钮(功能保留、本质都是整理 Tab),并把去重/分组规则做成设置页可配置的"规则"(提示词模板+占位符引用脚本规则,如"URL 一致只保留一个"、按域名分组=纯脚本、按主题分组=AI,默认用主题);③ 巨大的设置弹窗改为**侧边栏内可切换的 settings 视图**;④ 删除 Workspace "Run Setup";⑤ 设置按 快捷键 / AI 配置 / Import From Arc 等分类做子面板;⑥ 分组和 tab 样式改成 Chrome 侧边栏风格(色块 pill、组名居左、右侧 ⋮+▼、底部 +)。

三份盘点已定位全部涉及面(Ask 产品面/测试门槛面/Tidy+设置+样式面)。仓库约束:node 覆盖率门槛要求 `src/shared/*.js` 与 `background.js` **100% 覆盖**,发布文件清单派生自 `scripts/release-files.mjs` 的 RUNTIME_FILES(删文件必须同步),MV3 CSP **禁止外部脚本**,所以"规则插件"只能是内置规则注册表。

## 关键默认决策(可改)

- **workbench 全页模式保留**,默认视图从 'ask' 改为 'space';settings 在两种布局下都是内嵌视图
- **onboarding 两步向导整体删除**(含 Run Setup 按钮、dock "Finish setup" 星形按钮);`state.onboarding` 字段保留在 schema 中不再触发 UI,AI 改在 settings 里配
- **快捷键**:删 openAsk/askSubmit/askAbort;tidy(⌃⌥T)与 auto-group(⌃⌥G)合并为单个 `tidy` 快捷键;`mergeShortcuts` 按白名单重建,旧存储键自然清除,无需迁移
- **备份 schema**:导出不再含 askSessions;旧备份文件的 askSessions 在导入时自然丢弃;便携指纹值会变 → 旧 Undo 记录 fail-closed 拒绝(预期行为)
- **Tidy 规则默认集**:重复 Tag 合并(始终,本地);URL 去重(脚本规则,默认**关**,开启后关闭重复标签页);分组=按主题(AI,默认)+按域名(脚本,可选);命名=AI(无 AI 回退本地 `tidyPanelName` 规则表)

---

## Phase 0 — 删除 Ask Page(边界清晰,先做减法)

**产品代码**(清单已逐行核实):
- 删文件:`src/shared/ask-session.js`、`ask-sources.js`、`ask-stream.js`、`markdown.js`、`page-extraction.js`;测试 `tests/ask-session.test.js`、`ask-sources.test.js`、`ask-stream.test.js`、`markdown.test.js`、`page-extraction.test.js`
- `sidepanel.html`:删 #askPageView 整块(50-62)、命令面板标题 "…or ask" 文案(311)
- `sidepanel.js`:els ask* 9 项(401-409);dock askButton(3558-3568、3603);ask 视图切换与 render 分支(326-330、846、966、1491、1516-1547、3784、10984——workbench 默认改 'space');ask 渲染函数群(13043-13087、2475-2515);ai:stream 流式入口(998-1004);ask 源 tab 追踪体系(376-388、2210-2271、2311、2430-2488);命令/快捷键(1043、1162-1165);startAskFromUserGesture 及 ask 流程(约 10003-10269);askSessions 管理函数群(10347-10353、12473-12534、2374-2385、738、12245);applyPanelTabIdReplacement 剥离 ask 字段(2387-2428);panelFocus getTarget ask 分支(504-505)
- 共享模块剥离 ask 字段:`tab-replacement.js`、`tab-lifecycle.js`(578-590)、`space-membership.js`(663-665)、`space-deletion.js`(31,42,483-497)、`space-transfer.js`(备份去 askSessions、指纹更新、删 normalizePortableAskSessions 等函数群)
- `panel-routing.js`:删 selectEligibleTabSource / mergeTabActivationCache / createEligibleTabActivationController(仅 ask 使用)
- `panel-keyboard.js`:删 submitAsk/askSubmit/askAbort 分支(Escape 中止保留为通用 activeAIRequestId 中止)
- `panel-render-signatures.js`:删 askMessagesRenderSignature
- `command-palette.js`:删 command:ask;`shortcuts.js`:删三个 ask action
- `preview-runtime.js`:删 pages:extract handler(410-433)
- `background.js`:删 ask-session/ask-stream imports、ASK_STREAM_* 常量、recoverAskStreamsAtWorkerStart、alarms 监听、ask:begin/pages:extract handlers、beginAskStreamTurn/Persistence/Recovery 全族、runChatCompletion 的 askStream 持久化分支、notifyAIStream、fetchChatCompletion 的 onStream 分支;**保留** ai:chat 通用路径、ai:abort、activeAIRequests
- `ai.js`:删 'ask-page' 预算与 createPrompt 分支、askSourcePage/formatAskPage
- `state.js`:删 askSessions/activeAskSessionKey 字段与 migrateShortcuts 的 ask legacy 分支(mergeStoredState 白名单机制使旧数据安全丢弃)
- `manifest.json`:description 去 "ask pages"、删 "alarms" 权限;`sidepanel.css`:删全部 ask 样式(410-424、965-1149、1175-1184、1302-1315、1379-1389、2692-2703)
- `scripts/release-files.mjs`:RUNTIME_FILES 删 3 个 ask 文件(+markdown/page-extraction)

**测试**:按盘点清单执行——整删 5 文件;manifest.test.js 重写 test@81、改 L322(workbench 默认视图)等;约 30 个测试文件删用例/改断言(清单在手);`package.json` check 链删 3 个文件。

**e2e**:`e2e-extension-smoke.mjs` 剥离 ask 场景块(盘点列出的 L9182-10230、13452-15420 等区间),**保留** askFixtureServer(283 处引用,30 个非 ask 场景复用)与 `__askE2ECalls` 捕获器(auto-group 用),仅删 SSE ask 语义与 ask 断言;workbench 默认视图断言(1940-1947)改 space;`e2e-smoke.mjs` 删 ask 会话场景;`e2e-extension-restart.mjs` 不动。

**文档/网站**:README/PRIVACY/docs/store-listing/docs/commercialization/website 页面与测试删 ask 文案;删 05-ask 截图两份 + website-assets.test.js 条目;store-screenshots.mjs 删 ask 场景。

## Phase 1 — 删除 Run Setup / onboarding

删 `sidepanel.html:274-280` workspace-settings 区(Run Setup + Open Workbench 按钮)、onboardingDialog 整块(91-211)、dock "Finish setup"(sp.js:3570-3581、3603)、openOnboarding/renderOnboarding/continueOnboarding/finishOnboarding/maybeShowOnboarding 函数群(3636-3733、3995+)、相关事件绑定;`state.onboarding` schema 保留但只读不触发;dock-tools 区随 Ask/Setup 删除后**整体移除**。manifest.test.js 183-322 对应断言重写。

## Phase 2 — Settings 侧边栏视图 + 分类子面板

- `#settingsDialog` 从 `<dialog>` 改为 `<main class="settings-view" id="settingsView" hidden>` 常驻容器(放入主内容区,与 groupsList 同级);render() 统一 hidden 切换(改 1515-1537,删 dialog show/close 机制);settingsButton 变 toggle(activeView 'space' ↔ 'settings'),saveSettings 不再 close;`hasBlockingDialogOpen`(1006-1009)与 10 处 `els.settingsDialog` 引用清理;checkpoint 恢复已含 activeView 无需改
- 设置内容分 5 个子面板(侧栏导航或顶部 tab):**AI 配置** / **Tidy 规则**(Phase 3 填充)/ **快捷键** / **Import from Arc** / **备份**(含主题色放 AI 之外的外观区或 AI 面板顶部);DOM 重排 sidepanel.html 设置区,渲染函数(renderSettings/renderShortcutSettings/AI controls)与元素 id 基本不变
- workbench 布局同步:第 3 列渲染同一 settings 视图(删 dialog 静态化 CSS 2713-2765)

## Phase 3 — Tidy 合并按钮 + 可配置规则

- **按钮**:删 `#autoGroupButton`;`#tidyNamesButton` 保留 id(减少 churn)、title 改 "Tidy";busy/状态文案合并;快捷键 auto-group 删除、tidy 快捷键触发统一流程;command:tidy 保留、command:auto-group 删除;manifest.test.js 974-1110 的"两按钮并存"断言组重写
- **规则注册表**(新共享模块 `src/shared/tidy-rules.js`,纯函数可 100% 覆盖):`{ id, label, kind: 'script'|'prompt', defaultEnabled, config }`;内置规则:
  - `dedupe-tags`(script,始终开):现有 mergeDuplicateSnapshotTags 链
  - `dedupe-urls`(script,默认关):接线现有 `planDuplicateUrlClosures`(tab-utils.js:387),关闭重复标签页
  - `group-by-topic`(prompt,默认开):现有 tidy-tabs 主题提示词(补 languageInstruction)
  - `group-by-domain`(script,默认关):接线现有 `planTidyGroups`(tab-utils.js:197,已实现未接线)
  - `rename-tabs`(prompt,默认开):现有 tidy-names 提示词;本地回退 `tidyPanelName` 规则表
  - prompt 规则文本可编辑(设置存储 `state.tidyRules.texts`),模板占位符 `{{tabs}}`/`{{domains}}`/`{{existingGroups}}`/`{{duplicateUrls}}`/`{{language}}` 由脚本填充(复用 compactTabForAI 数据);硬约束(输出 JSON 形状、id 完备性)保持固定骨架,不开放编辑
- **统一流程** `runTidy()`:本地规则先行(dedupe/group-by-domain)→ 需要 AI 的规则合并为一次 `ai:chat`(purpose 'auto-group' 预算档;命名一次+分组一次或合并单次调用视解析器兼容性,首选**两次调用复用现有解析器**降低风险)→ `showPlanPreview` 统一预览(命名+分组+合并三段)→ 确认后单一 `runChromeGroupMutationTransaction` 应用(复用 prepareOrganizationAIRequestFromUserGesture、buildOrganizationCandidates、resolveOrganizationPlanChanges、applyOrganizationPlanToSnapshot、recordOperation type 'tidy'——新 operation type,Undo freshness 分支合并 tidy-names/auto-group 两分支逻辑)→ 无 AI 时仅执行脚本规则(合并+可选域名分组+本地命名),走同一预览
- **设置暴露**:Tidy 规则子面板(Phase 2 的容器)列出规则开关 + prompt 模板编辑框 + 恢复默认

## Phase 4 — Chrome 侧边栏风格

- `createGroupCard`:组卡片注入组色背景(`groupColor` 色板生成柔和色块,inline `--group-color`);header 布局改为 组名居左 + 右侧 ⋮(复用 showGroupContextMenu) + ▼ 折叠箭头(替代隐藏的 caret/grip);折叠仍只渲染 header(2886 语义不变);hover 预览 popover 保留
- tab 行样式贴近截图:降双行为单行密度可选/保持双行,弱化边框、色块内缩进;`+` 新建行移到列表底部(createUngroupedSection 调整)
- CSS 改造块:433-446(卡片 pill 化)、506-545/653-687(header/箭头/⋮)、570-587/620-630(启用箭头)、808-962(tab 行)、724-805(ungrouped);同步改 manifest.test.js 306-313(hover CSS 原文断言)与 1839
- dock 去掉已删按钮后自然只剩 Space 列表 + "+"

## Phase 5 — 门槛重算、文档、打包

- 重跑 `e2e:coverage` 与 `e2e:coverage:preview`,按新值改写 `package.json:19` union 阈值
- 文档:README / PRIVACY / docs/store-listing / docs/commercialization / docs/branch-change-goals 删 Ask、改 Tidy/设置描述;website 页面与测试同步、删 05 截图
- 重新 `npm run package`,覆盖 `~/Downloads/space-tabs`(保留其 config.local.js)

## 提交策略

每个 Phase 一个 commit(Phase 0 最大,内部可拆"产品代码"+"测试与门槛"两个);每 phase 完成即跑 `npm test` + 两个 coverage gate + `npm run check` 守护。

## 验证

1. 每 phase:`npm test`、`npm run test:coverage:shared`、`npm run test:coverage:background`(100% 门槛)、`npm run check`
2. Phase 0/5:`npm run e2e:restart`(权威数据验证,应保持全绿)
3. Phase 2/3/4:`npm run e2e:smoke` 冒烟推进(套件本身有时序脆弱,已知漂移,以单测+restart 为权威)
4. 最终:重新打包覆盖 Downloads,用户本地验收清单:① 无 Ask 入口/快捷键;② 单个 Tidy 按钮走统一预览→应用→Undo;③ 设置在侧边栏内切换、五个子面板、无 Run Setup;④ 分组 pill 色块 + ⋮ + ▼ + 底部 +;⑤ Tidy 规则面板可开关/编辑提示词并生效
