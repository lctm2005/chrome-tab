---
name: space-tabs-architecture-notes
description: chrome-tab(space-tabs 扩展)的核心架构陷阱与 2026-11 修复后的数据语义
metadata:
  type: project
---

chrome-tab(/Users/bytedance/github/chrome-tab)是 MV3 扩展,全部状态存单个 key
`spaceTabsState`(chrome.storage.local),每次写入都是整对象覆盖,依赖 Web Lock
`space-tabs-shared-state` + 写前 sync 防竞态。2026-11-11 修复三类历史 bug 后的关键语义:

- `browserSessionId`:session storage 为主、storage.local carryover
  (`spaceTabsBrowserSessionCarryover`)兜底;background 的 `onStartup` 清 carryover,
  只有真浏览器重启才轮换 id 并清 tab/group 绑定;扩展重载不丢绑定。
- AI KEY:存 `chrome.storage.local`(键名仍 `spaceTabsSecrets`),跨浏览器重启保留;
  `persistScopedAIConfiguration` 只在 scope 匹配时才允许 clearAuth;
  `reconcileScopedAIKey` 对同 provider 的 baseUrl 漂移自动改写 scope。
- `preserveGroups` 不再永久粘住:`sanitizeStoredSpaceSnapshot` 在无 Auto Group
  计划进行中时剥掉标志(in-flight 保护集:`inFlightOrganizationPlanSpaceIds`);
  空 Tag 只有标题重复(`snapshotEmptyTagIsMergeCandidate`)才持久化,作为 Tidy
  merge-only 的候选;合并后唯一空 Tag 即被清退(有意的行为变更,smoke 断言已更新)。
- dormant 删除:共享层 `findDormantSnapshotGroupIndex` 暴露未命中;删除流程对
  未删掉的行显式报错,不再假报成功;`loadTabs({skipOwnershipRestoreGroupIds})`
  防止删除期间 restoreSnapshotOwnership 复活归属。
- `saveState` 现在自取共享锁(withSharedStateLock 可重入),不再依赖 69 处调用点纪律。

**Why**:Codex 时代的测试只覆盖 src/shared 纯函数,编排层竞态防不住,历史 bug 反复。
**How to apply**:改动 sidepanel.js 写入路径时仍须先 sync 再写;新增共享层代码必须
保持 node coverage gate 的 100% 覆盖(shared+background 均为 100% 门槛)。
2026-11-12 大改造后(删除 Ask Page、Tidy 合并、设置侧边栏化、Chrome 风格 Tag 卡,
已推送 origin/main f48c8c0):`e2e:smoke` 142 场景全部通过(exit 0 已复验);
`e2e:coverage`(带 Profiler)在本机时序敏感,曾三过final代码但后续轮次在
durable-lifecycle 场景超时,union 阈值已按实测通过轮更新(80.46/51.1/76.33/82.2)。
注意:`waitFor` 全局加大预算会顶掉 10 秒 Undo 横幅窗口,反而更糟——只能按场景
单独加大。折叠/展开新语义:折叠 live Tag=closeGroupToSaved,展开 dormant
Tag=openDormantGroup(外窗口已打开行时仅披露不物化);空唯一命名 Tag 会被
持久化规则清退。
