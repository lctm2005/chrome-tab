# 设计：父子分组的真层级模型（Group Hierarchy Redesign）

日期：2026-11-14
状态：待用户审阅（用户未响应澄清问题，按其目标诉求选定方案 A：状态层真父子 + 任意层级；可推翻）

## 1. 问题与根因

用户报告四类问题：

1. **4 个 console 报错**：
   - `The stable saved row for "…" could not be checkpointed (…matches 0, …target missing). The Auto Group change was rolled back.`
   - `This Space changed in another Space Tabs view. Review it before dragging again.`
   - 以及同源守卫变体（`This folder changed…` / `The target group changed…`）。
2. **图 1**：在真 Tag 下创建 subgroup 后不挂在原组内，而是出现同名"重复 group"，且删不掉。
3. **图 2/3**：把现有 group 拖到另一个 group 下时，被拖入组的父层级多出一层：真父组被降级成"子组样式"（folder-tabs 卡），折叠后叶子显示为默认的「Tabs」。
4. **子组无法拖回顶层**：不知道拖到哪里才能放下让它自己成为父。

### 根因

现行 "subgroup" 不是父子实体，而是**用 Tag 标题里的 `" / "` 编码路径**（`src/shared/folder-tree.js` 把标题按 `/` 拆成派生树）+ `state.folderPaths[spaceId]` 存空文件夹占位。由此必然产生：

- 在真 Tag「AI 研发工具」下建 subgroup = 存路径 `"AI 研发工具/New Group"` → 渲染时合成一个**同名文件夹壳**，与真 Tag 并存成"重复 group"（图 1）。删除走占位路径清理，中途要过 `folderGroupContextFingerprint` 守卫（指纹含 tab url 等易变字段），漂移即报错拒绝 → "删不了"。
- 拖 group 进 group = 把被拖组标题改写成 `"父 / 子"`（`moveGroupBlockIntoContext` → `retitleGroupForNestedMove`）→ 下一帧：真父组（标题单段）因路径命中 `folderPathKeys` 被吸进同名壳，降级为 `folder-tabs` 子卡（图 2）；叶子卡缺 `displayTitle` 时折叠显示默认「Tabs」（图 3）。
- 拖出嵌套：只有把子组拖到根级组头上下 25% 边带才触发 `targetPathForSiblingMove`（父路径去掉末段）回到顶层，无任何视觉指示。

报错链：

- **拖拽指纹报错**：`organizationForCurrentSpaceState` → `buildOrganizationCandidates.fingerprint`（src/shared/organization-plan.js `fingerprintLiveGroups`）逐 tab 包含 `title`、`panelTitle`、`displayTitle`、`windowId`。页面加载期标题/挂载窗口自然变化 → 拖拽起止两次采样不一致 → 自己的改动被当成"别的视图改了"。标题级联重命名进一步放大漂移面。
- **Auto Group checkpoint 报错**：`checkpointAutoGroupLifecycleBindings`（sidepanel.js:9183）要求每个 live 行的 `snapshotTabId` 能在当前快照里唯一归组；上游快照重建/清退（标题重命名、同名收敛、空 Tag 清退）删除了保存行后，绑定失联 → `matches 0, target missing` → 整个 Auto Group 回滚。上游清退路径从不校验"该快照组仍有 tabLifecycle 行绑定"。

## 2. 目标 / 非目标

**目标**

1. 父组卡同时容纳自己的 tab 与子组卡；不出现合成壳、重复节点、额外层级。
2. 支持独立建组（空组），拖现有组到其下成为子组；子组可拖回顶层（有可见的投放目标与指示线）。
3. 拖拽不再改写 Tag 标题（Chrome 侧组名保持单段），移除标题级联重命名整类复杂度。
4. 修复/消灭第 1 节列出的报错类。
5. 边界场景（环、自身、祖先、空组、dormant、foreign 窗口、键再生、旧数据迁移）全部有测试钉死。

**非目标**

- 不改 Chrome 原生 tab strip 的扁平结构（物理不可嵌套；层级仅存在于面板视图与状态层）。
- 不改 Space / ungrouped 模型、Tidy 规则内容、AI 管线的行为语义。
- 不做多选拖拽增强（现有多选 tab 拖拽行为保持）。

## 3. 数据模型

`src/shared/state.js` schema 变更：

- 新增 `state.groupParents[spaceId]`：`{ [childKey]: parentKey }`。child/parent 均为当前空间可见节点键：live 组 `group:<chromeId>`、dormant snapshot 键（`tag:…`/snapshot index 键）、virtual 键 `vgroup:<id>`、空组节点键 `node:<uuid>`。
- 新增 `state.emptyNodes[spaceId]`：`{ [nodeKey]: { title, color } }`。空组节点 = 无 tab、无 chrome 组、无快照身份的占位节点；可以有子组与子空节点。往里拖 tab 时物化为 chrome 组（沿用 `createChromeGroup` 流程）。
- 退役 `state.folderPaths`：schema 保留键（旧版本前向兼容读取到空对象），运行时不再写入。
- 折叠状态沿用 `collapsedGroups[nodeKey]`（稳定键，不再需要 `rekeyCollapsedFolderKeys`）。
- `groupOrder[spaceId]` 仍为全节点扁平 **DFS 序**（父在子前）。树的构建与重排只通过共享纯函数从 `groupOrder + groupParents` 派生。

### 迁移（载入时一次性）

新共享函数 `migrateLegacyGroupHierarchy(state, helpers)`（src/shared/group-tree.js）：

1. `folderPaths[spaceId]` 的每条路径按 `/` 拆段 → 为每段生成稳定 `node:<uuid>`，父子关系写入 `groupParents`，标题/颜色写入 `emptyNodes`（同路径幂等，不重复建）。
2. 标题含 `" / "` 的组（live/dormant 均可）按段拆出父链：若某父段标题与现有组或空节点重名则挂靠到它，否则为缺失段创建空节点；组本身标题改写为末段（live 组经 `groups:update` 一次写入；dormant 走 snapshot retitle）。幂等：无 `" / "` 标题时空转。
3. 迁移失败安全：任一步骤异常则整体回退为"标题原样、无层级"，不阻断载入。

### 键再生与重映射

组键会在物化/合并/移动空间时再生。现有重映射咽喉必须同步维护 `groupParents`：

- `replaceGroupOrderKeys`（sidepanel.js:5451）
- `remapSnapshotGroupIndexedState`（→ :7374）
- `transferGroupLocalState`（:11807）
- `remapSnapshotGroupOrderKeys`（:5162/:5168）
- 空节点获得 tab 物化为 chrome 组时：`node:<uuid>` → `group:<id>` 的键替换同样走上述咽喉（合并 `emptyNodes` 项删除，子组 parent 键跟随改写）。

新增共享纯函数 `remapGroupParents(parents, replacements)` 供各咽喉调用。

## 4. 视图构建与渲染

- `buildSpaceView`（space-view-merge）不变，仍产出扁平组列表。新增共享纯函数 `buildGroupTree(groups, { parents })`：按 `groupParents` 嵌套，返回树节点 `{ ...group, children: GroupNode[] }`（父节点同时携带自身 tabs 与 children）。孤儿键（parent 不在当前视图）自动升根，不丢节点。
- 渲染：`renderGroups` 递归渲染组卡。父卡 = 组头 + 自身 tab 列表 + `children` 容器（缩进用 `--group-depth`）。折叠沿用 `collapsedGroups`。退役 `createFolderSection` / `createFolderTabs` / `folder-*` DOM 与 CSS。
- 孤儿节点（parent 键不在当前视图，如父组被清退/他窗口渲染过滤）渲染期自动升根，**不改状态**——状态修复交给键再生重映射与清退防线。
- 空组节点渲染为普通组卡（空态文案 "Drop tabs or groups here"），✎ / × 与普通组一致 —— 修复"删不了"。× 删除规则：无 tab 且无后代 → 直接删（无确认）；有后代 → 确认文案列出将删除的子组与其 tab 数。

## 5. 拖拽语义

- 源 = 单组或整棵子树（subtree keys = 自身 + 全部后代，沿用 `dragState.groupKeys`）。
- 目标判定（沿用 25% 边带 + 新增根区）：
  - 头中部（25–75%）= `inside` → `groupParents[source] = target`；
  - 上/下 25% = `before` / `after` → 与 target 同父、插到 target 前/后；
  - 面板空白区（`#groupsList` 背景）/ 根级间隙 = **root drop** → 回到顶层，插入最近根边界；拖拽经过时显示插入指示线（独立 indicator 元素）。
- 拒绝（静默回到无操作 + 状态条提示）：`target ∈ subtree(source)`（环）；`source === target`；target 与 source 已是同父同位置（no-op 不落库）。其余全部允许：把子组拖回根、空组收子组、组间任意换父。
- tab 拖入组卡：现有逻辑不变。tab 拖入空组节点：物化 chrome 组并落入（替换 `groupForFolderTabDrop` 的合成目标）。
- 拖拽落点 = 一次状态事务：`runChromeGroupMutationTransaction`，apply 只写内存（groupParents/groupOrder），checkpoint = `saveState`；**不再向 Chrome 发送重命名**，Chrome 侧零写入 → 回滚面从"重命名链"缩为"纯状态恢复"。
- foreign live tabs 守卫沿用：含外窗口 tab 的组不可拖（现状）。

## 6. 菜单与头部

- 组卡右键菜单（含空组节点）：`Rename` / `New Subgroup`（在该组下建空子节点，`askText` 默认 "New Group"）/ `Move to Space` 子菜单。头部 hover 按钮 ✎ / × 不变。
- 独立建组入口（全新）：面板空白处右键 `New Group`，在根级创建空组节点（现状没有"凭空建组"入口——现有 `groupSelectedTabs` 只能从选中 tab 建组）。
- `renameGroup` 不再处理 `/` 组合路径（`renamedFolderGroupTitle` 退役）；标题是字面文本。
- 文件夹专属菜单（`showFolderContextMenu`）与 `renameStoredEmptyFolder` / `deleteStoredEmptyFolder` / `createEmptySubgroup` 的路径语义全部退役。

## 7. 报错修复

1. **组织指纹去易变字段**（src/shared/organization-plan.js）：`fingerprintLiveGroups` 每 tab 仅保留 `tabId`（alias 感知）、`url`、`pinned`、`order`、`windowId`；去除 `title` / `displayTitle` / `panelTitle`。组级保留 `title` / `color` / `collapsed`。`ORGANIZATION_FINGERPRINT_VERSION` 升版（旧指纹作废，仅影响 Undo 的一次新鲜度校验，可接受）。该指纹同时服务 Undo 新鲜度——tab 标题的自然变化不再阻断 Auto Group Undo（Tidy Names Undo 另有自己的目标指纹，不受影响）。
2. **checkpoint 治愈而非回滚**（sidepanel.js `checkpointAutoGroupLifecycleBindings`）：`matches 0 / target missing` 时先尝试用 `candidate.source.snapshot.snapshotGroupId` 治愈绑定（该组仍在快照 → 重写 `state.tabLifecycle`）；仍不可解 → 清除该行 stale 绑定（行退化为未保存 live 行）并继续，而不是回滚整个 Auto Group。
3. **快照清退审计**：`snapshotGroupShouldPersist` / `snapshotEmptyTagIsMergeCandidate` 的所有调用点加防线——快照组仍有 `tabLifecycle` 行绑定（live 绑定未消失）时不得整组清除（防"保存行消失"这一上游根因）。
4. **文件夹守卫类报错**随文件夹层退役消失；组级操作守卫沿用 `currentGroupForMutation`（稳定字段指纹）。

## 8. 测试计划

- **单元（node --test，shared 100% 分支门槛）**：
  - 新 `tests/group-tree.test.js`：树构建（嵌套/孤儿升根/空节点）、drop plan（inside/before/after/root、环拒绝、自身、祖先、同父 no-op）、`remapGroupParents`、迁移（folderPaths→空节点、" / " 标题拆链、重名挂靠、失败回退）。`tests/folder-tree.test.js` 随模块退役删除。
  - `tests/state.test.js`：新 schema 键默认值与合并。
  - organization-plan：标题/panelTitle 漂移不改指纹；url/顺序/分组变化改指纹。
  - tab-lifecycle / auto-group：checkpoint 治愈路径（matches 0 → 治愈成功；目标组也没了 → 降级继续）。
  - operation-safety / space-snapshot：有 live 绑定的快照组不被清退。
- **e2e（scripts/e2e-extension-smoke.mjs）新场景**：菜单建子组 → 嵌套渲染断言；组拖入组 → 子组（dump 断言用 parent 的 children）；子组拖到根区 → 顶层；空组 × 删除；父组 rename 不影响子组；旧 " / " 标题迁移后 Chrome 组名单段。coverage union 阈值按实测更新。
- **真机回归**：`npm run check` + `node --test` + `npm run e2e:smoke`；部署到 `~/Downloads/space-tabs`（rsync 排除 config.local.js）后用 chrome-devtools MCP 手工过一遍图 1/2/3 的操作序列。

## 9. 风险与权衡

- **键漏映射 → 子组掉回顶层**：所有键替换收敛到既有咽喉 + `remapGroupParents`，用测试钉死每个调用点。
- **Tidy / Auto Group 重建组**：被合并/解散的父组的子组升到父的父级（root）；子组本身不被 Tidy 触碰（Tidy 只重排 tab）。
- **迁移不可逆假设**：`" / "` 标题全部视为层级编码。用户此前已认可该约定，误伤面仅限"字面含 ' / ' 的组名"，迁移后仍可改名回原样。
- **前向兼容**：降级旧版本读到新键（groupParents/emptyNodes）会被 schema merge 默认值覆盖为空 → 表现为层级暂时消失、数据无损。
- **Chrome 标签条不再显示 "A / B"**：预期行为变化，属本设计目标（组名单段更干净）。

## 10. 交付物清单

1. `src/shared/group-tree.js`（新）+ `src/shared/state.js`（schema/迁移）+ `src/shared/organization-plan.js`（指纹）+ `src/shared/space-snapshot.js`（清退防线）。
2. `sidepanel.js`：渲染树、拖拽/菜单/CRUD 重构、键重映射接线、checkpoint 治愈；`src/shared/folder-tree.js` 退役。
3. `sidepanel.css`：缩进、插入指示线、空组空态；`sidepanel.html` 需要时缓存戳 `?v=33`。
4. 测试：`tests/group-tree.test.js`（新）等按第 8 节。
5. e2e 场景 + 阈值更新。

## 11. 增补设计（2026-11-15，0.5.14）：层级边改 anchor 域

### 11.1 问题（键域引用的系统性缺陷）

`groupParents` 的边端点引用**易变视图键**（chrome 组 id / 快照索引）。键在四类事件
中再生，每处都靠手写重映射，且实测存在三类缺口：

| 事件 | groupOrder | collapsedGroups | groupParents |
|---|---|---|---|
| 快照重索引 remapSnapshotGroupIndexedState | ✓ | ✓ | ✗ 不重映射 |
| closeGroupToSaved / openDormantGroup 键替换 | ✓（未持久化）| ✗/✓ | ✓（未持久化）|
| 会话轮换 resetChromeSessionBindings | — | — | ✗ 直接丢弃 group:* 边 |

后果：存档/展开后层级静默拉平（syncStateFromStorage 回滚内存重映射）、
快照变化后子组失挂、浏览器重启后 live-live 嵌套全部丢失。零散修补不可收敛。

### 11.2 设计：anchor 域边 + 读投影 + 单一迁移

**持久化域**：边的端点一律存 anchor：
- `sgid:<snapshotGroupId>` — 快照行持久身份（跨重启、跨重索引、跨物化稳定）；
- `node:<uuid>` / `vgroup:<key>` — 本来就稳定的键，原样保留；
- 裸视图键（`group:<id>` / `snapshot:<idx>:…`）— 仅作为未获得身份时的兜底，
  读路径按原样解析，写路径/自愈会尽快升级为 `sgid:`。

**读路径**：`resolveHierarchyKeyParents(parents, bySgid)` 把 anchor 投影回当前
视图键（sgid → 当前快照行键；node/vgroup/裸键原样）。投影失败的边**只跳过渲染，
不删数据**（身份可能暂时失联，回来后边仍在）。buildGroupTree / planHierarchyDrop /
nodeDepth 等纯函数不变，仍消费键域投影结果。

**写路径**：所有层级写操作（拖拽/建组/物化/跨 Space 移动/删除）通过
`hierarchyAnchorForNode(node)` 落 anchor（node.snapshotGroupId 优先，node:/vgroup:
直存，其余裸键兜底）。

**每 render 自愈**：`upgradeHierarchyParentAnchors` 把裸键边升级为 sgid anchor
（幂等 O(边数)），结果写回 state，随下一次 save 持久化。这是身份 mint 时机
不确定的唯一防线。

**键再生管线不再触碰 parents**：
- closeGroupToSaved / openDormantGroup：删除手写 parents 重映射（anchor 免疫）；
  仅保留 groupOrder 替换（视图排序）并**新增 saveState 持久化**（修"未持久化"缺口）。
- 快照重索引：parents 无需处理。
- 物化（node→group）：`remapGroupParents(parents, {nodeKey → group:<newId>})`
  保留（域无关字符串替换），随后由自愈升级为 sgid。
- 身份合并/重塑（convergeDuplicateSavedTags、Auto Group 合并）：把
  snapshotGroupIdReplacements（space-snapshot 已返回 old→new sgid 映射）套到
  parents 上。
- 会话轮换：`sanitizeGroupParentsForNewSession` 不再丢边——用**被擦除前的
  tabLifecycle**（groupId→snapshotGroupId 桥）把 `group:<id>` 端点转成 sgid
  anchor；`snapshot:idx:space:sgid` 裸键解析出 sgid 段；node/vgroup/sgid 原样；
  不可解析才丢弃。→ **live-live 嵌套跨浏览器重启存活**。

### 11.3 操作 → 动作映射（架构清晰性要求）

| 用户操作 | 入口 | 层级动作 |
|---|---|---|
| 拖组嵌套/排序/回根 | applyHierarchyDrop | plan（键域投影）→ anchorize 落盘 |
| New Subgroup / 删组 | createEmptyGroupNode / deleteHierarchyNode | node anchor 边增删 |
| 拮 tab 进空组 | materializeEmptyNodeWithTab | node→group 键替换（单迁移函数）|
| 折叠（纯显示）| toggleGroup | 不碰层级 |
| 存档 / 恢复 | closeGroupToSaved / openDormantGroup | 仅 order 替换 + 持久化 |
| 跨 Space 移动 | moveHierarchyEntriesBetweenSpaces | anchor 边随行 |
| 身份合并 | converge / Auto Group | sgid 替换套 parents |
| 浏览器重启 | resetChromeSessionBindings | anchor 天然存活，兜底转 sgid |

### 11.4 测试

- 单元：anchor 编解码/解析/升级/迁移纯函数全分支；会话轮换转换（group:→sgid、
  snapshot:→sgid、node 保留、不可解析丢弃）；双域读。
- e2e：dormant 子组在 live 父组下 → 父组折叠 OK → reload 后子组仍嵌套 →
  点开子组恢复 tabs → **仍嵌套**（存 storage + DOM）→ 再 reload → 仍嵌套
  （持久性）。既有 parents 断言改为 anchor 感知（由快照行 sgid 推导）。
