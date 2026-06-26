# Client KOL Selection Console 技术方案

## 1. 目标

把“客户先确认 root audience，再重新生成 KOL list”做成可落库、可回溯、可版本化的后端链路。

本方案的核心不是重写现有页面，而是在现有 React + Express + SQLite 结构上补齐三个对象：

1. root audience snapshot
2. KOL generation run
3. versioned KOL pool

## 2. 当前代码基线

现有代码已经具备：

- `kol_selection_events`：KOL 决策事件
- `client_action_events`：点击级行为日志
- `kol_selection_current_state`：当前状态
- `RootAudienceBoard`：root audience 交互
- `ReviewPoolCard` / `DecisionModal`：KOL 评审交互
- `exportSelection()`：导出

当前缺口：

- root audience 只在前端 localStorage 里形成“临时状态”
- 没有 generation run
- 没有 KOL pool version
- 没有“确认 root 后重跑”的后端入口

## 3. 研发拆分

### 3.1 第一阶段：数据模型

#### 新增表

##### `root_audience_snapshots`

用途：保存某次 root audience 确认结果。

建议字段：

- `id`
- `client_id`
- `campaign_id`
- `round`
- `snapshot_json`
- `created_by`
- `created_at`

##### `kol_generation_runs`

用途：保存每次“基于 snapshot 重跑 KOL list”的任务。

建议字段：

- `id`
- `client_id`
- `campaign_id`
- `source_snapshot_id`
- `status`
- `version_label`
- `trigger_actor_id`
- `trigger_actor_role`
- `trigger_reason`
- `metadata_json`
- `created_at`
- `completed_at`

##### `kol_generation_run_items`

用途：保存某次 run 生成出来的 KOL 列表。

建议字段：

- `id`
- `run_id`
- `campaign_kol_item_id`
- `display_order`
- `score`
- `explanation_json`
- `created_at`

##### 可选：`kol_feedback_learning_events`

用途：把 reject / question / dislike reason 单独沉淀成学习记录。

建议字段：

- `id`
- `campaign_id`
- `campaign_kol_item_id`
- `action_type`
- `reason_tags`
- `note`
- `source_event_id`
- `created_at`

### 3.2 第二阶段：后端服务层

#### 新增/扩展能力

1. 保存 root audience snapshot
2. 创建 generation run
3. 读取 latest snapshot / run history
4. 读取某个 run 对应的 KOL items
5. 导出时带上 snapshot/run 结构

#### 推荐实现位置

- `/Users/chenboyu/Documents/New project 11/client-kol-selection-console/server/selectionService.ts`
- `/Users/chenboyu/Documents/New project 11/client-kol-selection-console/server/types.ts`
- `/Users/chenboyu/Documents/New project 11/client-kol-selection-console/server/index.ts`

### 3.3 第三阶段：前端交互

#### RootAudienceBoard

新增主操作：

- `确认目标人群，重新生成 KOL list`

行为：

- 先提交 snapshot
- 再触发 generation run
- 成功后刷新下方 KOL pool

#### KOL Pool

新增展示：

- 当前版本 label
- run id / round
- 可切换历史版本

#### 反馈面板

保留现有小面板方案，不做全屏弹窗。

### 3.4 第四阶段：测试

重点覆盖：

- snapshot 落库
- generation run 创建
- 版本化 KOL items 读取
- export 中包含 run/snapshot 信息
- 幂等性
- 回退/重试

## 4. API 设计

### 4.1 Snapshot

#### `POST /api/campaigns/:campaignId/root-audience/snapshots`

输入：

- `round`
- `snapshot`
- `client_request_id`

输出：

- `snapshotId`
- `createdAt`

#### `GET /api/campaigns/:campaignId/root-audience/snapshots/latest`

输出：

- 最新 snapshot

### 4.2 Generation Run

#### `POST /api/campaigns/:campaignId/kol-generation-runs`

输入：

- `sourceSnapshotId`
- `versionLabel`
- `triggerReason`
- `metadata`

输出：

- `runId`
- `status`
- `versionLabel`

#### `GET /api/campaigns/:campaignId/kol-generation-runs`

输出：

- 版本列表

#### `GET /api/campaigns/:campaignId/kol-generation-runs/:runId/items`

输出：

- 该版本的 KOL items

## 5. 代码改动清单

### 必改文件

- `/Users/chenboyu/Documents/New project 11/client-kol-selection-console/server/migrations/001_create_kol_selection.sql`
- `/Users/chenboyu/Documents/New project 11/client-kol-selection-console/server/types.ts`
- `/Users/chenboyu/Documents/New project 11/client-kol-selection-console/server/selectionService.ts`
- `/Users/chenboyu/Documents/New project 11/client-kol-selection-console/server/index.ts`
- `/Users/chenboyu/Documents/New project 11/client-kol-selection-console/src/components/RootAudienceBoard.tsx`
- `/Users/chenboyu/Documents/New project 11/client-kol-selection-console/src/App.tsx`
- `/Users/chenboyu/Documents/New project 11/client-kol-selection-console/src/lib/api.ts`
- `/Users/chenboyu/Documents/New project 11/client-kol-selection-console/src/lib/types.ts`
- `/Users/chenboyu/Documents/New project 11/client-kol-selection-console/tests/selection-service.test.ts`

### 推荐新增文件

- `/Users/chenboyu/Documents/New project 11/client-kol-selection-console/tests/root-generation.test.ts`
- `/Users/chenboyu/Documents/New project 11/client-kol-selection-console/docs/client-kol-selection-tech-plan.md`

## 6. 实现顺序

### Step 1

先加表和类型，不动 UI。

### Step 2

实现 snapshot / generation run 的后端 API。

### Step 3

把 root audience 的确认按钮接到 snapshot + generation run。

### Step 4

把 KOL pool 读取改成版本化数据源。

### Step 5

补导出、历史、测试。

## 7. 关键实现细节

### 7.1 幂等性

snapshot 和 run 创建都应支持 `client_request_id`，避免重复点击造成重复版本。

### 7.2 版本边界

旧版本不能被覆盖。

如果当前版本是 `run_001`，下一次重跑必须生成 `run_002` 或新的 `runId`，并可被回查。

### 7.3 数据源边界

- `client_action_events`：记录操作过程
- `root_audience_snapshots`：记录确认结果
- `kol_generation_runs`：记录生成任务
- `kol_generation_run_items`：记录生成结果
- `kol_selection_events`：记录 KOL 最终评审

不要把这四层混成一层。

## 8. 验收标准

### 功能验收

- 客户确认 root audience 后，数据库里能看到 snapshot。
- 点击“重新生成 KOL list”后，数据库里能看到 run。
- 下方 KOL list 能切换到新版本。
- 历史版本仍可读取。
- reject / question reason 能保留并可导出。

### 工程验收

- `npm run typecheck` 通过
- `npm run test` 通过
- `npm run build` 通过
- 新接口有测试
- 旧接口行为不回退

## 9. 风险

- 只做前端重跑会导致状态不可追溯。
- 只做 click log 不够，无法稳定恢复版本。
- 没有 run items 表就无法稳定展示某次生成结果。
- 如果未来接真实 KOL/K8s 数据库，必须把生成逻辑抽到独立服务边界。

