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
注意:`e2e:smoke` 有两层问题(2026-11-11):① palette 切换场景曾丢失"先展开折叠
dormant Tag 再断言行可见"的兜底,已在 commit 4d3ed14 恢复;② 套件整体在本机存在
普遍时序脆弱——失败点在多次运行间漂移(4371→6301→5849→2614),即使同代码也会
在不同场景挂,疑似与机器负载/journal drain 收敛相关;shared 覆盖率门槛也因此
依赖 drain 时序,已用直接分支测试钉死(6d14af6)。`e2e:restart` 全绿且稳定,是
数据持久化修复的权威验证。治理 smoke 需专门会话(超时/重试/场景隔离)。
