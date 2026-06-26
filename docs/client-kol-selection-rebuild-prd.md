# Client KOL Selection Console PRD

## 1. 背景

当前 Client KOL Selection Console 已经支持：

- 顶部 root audience / 目标人群确认
- 下方 KOL 执行池评审
- 通过 / 排除 / 需补充 / 撤回
- click-level 行为记录
- final decision 历史记录

下一阶段的核心产品目标，不是单纯让客户“看一批 KOL 然后点选”，而是让客户先明确“他们真正想看到的目标人群 / 投资人 / 受众层”，再基于这份确认结果，重新生成下一版 KOL list。

这意味着：

- root audience 是输入，不只是展示层
- KOL list 是输出，不只是固定池
- 每次确认和重跑都必须保留版本和历史
- 排除原因、不满意原因要可学习、可回溯

## 2. 产品目标

### 2.1 核心目标

让客户先在上层完成目标人群确认，再驱动下层 KOL 执行池重跑，形成“目标定义 -> KOL 生成 -> 评审 -> 再生成”的闭环。

### 2.2 成功标准

- 客户可在上层明确选择：通过、排除、需补充。
- 客户点击确认后，系统生成一版新的 KOL pool。
- 旧版本保留，可追溯。
- 排除原因、需补充原因进入后端学习记录。
- 所有关键动作有时间戳和操作者。

## 3. 用户与使用场景

### 3.1 用户角色

- 客户：确认 root audience，评审 KOL，给出通过/排除/需补充。
- 代理/内部运营：查看历史、维护模板、处理数据同步。
- 系统：基于 root selection 生成新一版 KOL list。

### 3.2 关键场景

1. 客户打开页面，先在顶部选择目标人群。
2. 客户对部分人群通过、排除或要求补充。
3. 客户确认目标人群后，点击“重新生成 KOL list”。
4. 系统保存一份 snapshot，并生成新的 KOL pool version。
5. 客户在新版本 KOL pool 继续评审。
6. 未来可查看历史版本、历史动作、历史原因。

## 4. 范围

### 4.1 本期范围

- root audience selection snapshot
- generation run
- versioned KOL pool
- reject / question reason learning record
- decision history 和 action history 保留
- 新版本 KOL list UI 展示

### 4.2 非本期范围

- 真正的外部 KOL 爬虫系统重构
- 复杂推荐模型训练
- 多租户权限系统重做
- 实时协作编辑
- 完整 BI 报表系统

## 5. 现有系统概览

当前代码已经有：

- `kol_selection_events`：KOL 决策事件
- `client_action_events`：客户端点击级动作日志
- `kol_selection_current_state`：当前状态快照
- `kol_selection_followups`：question follow-up
- `RootAudienceBoard`：root audience 交互
- `ReviewPoolCard` / `DecisionModal`：KOL 评审交互
- `exportSelection()`：JSON / CSV 导出

现有缺口是：

- root audience 仍主要是前端 local state
- 没有 generation run 概念
- 没有版本化 KOL pool
- 没有“确认目标人群后重跑”的后端对象

## 6. 产品方案

### 6.1 上层：Root Audience Confirmation

用户在顶部确认目标人群，每个目标对象支持：

- 通过
- 排除
- 需补充
- 撤回

每个动作都记录：

- 时间
- 操作人
- 目标对象
- 原状态 -> 新状态
- 原因标签
- 补充说明

当客户确认完目标人群后，点击主 CTA：

- `确认目标人群，重新生成 KOL list`

### 6.2 下层：Versioned KOL Execution Pool

点击确认后，系统生成新的 KOL pool version：

- 不覆盖旧池
- 新池有版本号 / round / runId
- 展示“本轮基于什么 root audience 生成”
- 支持查看上一版本

### 6.3 反馈学习

对于 KOL 的排除或需补充：

- 保留原因标签
- 保留补充说明
- 进入学习数据表
- 可用于后续重排逻辑或运营分析

## 7. 后端数据设计

### 7.1 推荐新增表

#### `root_audience_snapshots`

记录某次确认的 root audience 快照。

建议字段：

- id
- client_id
- campaign_id
- round
- snapshot_json
- created_by
- created_at

#### `kol_generation_runs`

记录每次重跑任务。

建议字段：

- id
- client_id
- campaign_id
- source_snapshot_id
- status (`pending` / `running` / `succeeded` / `failed`)
- version_label
- trigger_actor_id
- trigger_actor_role
- trigger_reason
- created_at
- completed_at
- metadata_json

#### `kol_generation_run_items`

记录某次 run 生成的 KOL 列表。

建议字段：

- id
- run_id
- campaign_kol_item_id
- display_order
- score
- explanation_json
- created_at

#### `kol_feedback_learning_events`（可选）

记录客户对 KOL 的不满意原因，便于后续学习。

建议字段：

- id
- campaign_id
- campaign_kol_item_id
- action_type
- reason_tags
- note
- source_event_id
- created_at

### 7.2 推荐扩展现有表

`campaign_kol_items` 可扩展：

- `generation_run_id`
- `source_snapshot_id`
- `pool_version`
- `rank_score`
- `rank_reason`

如果想保持最小侵入，也可以不改原表，而是让 `kol_generation_run_items` 作为生成层映射表。

## 8. API 设计

### 8.1 Root Snapshot

`POST /api/campaigns/:campaignId/root-audience/snapshots`

作用：保存当前 root audience 确认结果。

返回：snapshot id、round、createdAt。

`GET /api/campaigns/:campaignId/root-audience/snapshots/latest`

作用：读取最新快照。

### 8.2 Generation Run

`POST /api/campaigns/:campaignId/kol-generation-runs`

作用：基于某个 root snapshot 创建新的 generation run。

输入：

- snapshot id 或 snapshot payload
- trigger actor
- version label
- 生成策略参数

返回：run id、状态、生成的 version label。

`GET /api/campaigns/:campaignId/kol-generation-runs`

作用：列出历史版本。

`GET /api/campaigns/:campaignId/kol-generation-runs/:runId/items`

作用：读取某个版本的 KOL list。

### 8.3 行为日志

现有 `client_action_events` 保留，用来存：

- root audience 点击
- popover open/close
- rules expand/collapse
- confirm / rerun click
- KOL decision click
- feedback open / close

## 9. 前端交互设计

### 9.1 Root Audience 区域

- 保留小窗布局
- 不做全屏遮罩
- 目标对象头像紧凑排列
- 详细解释在展开卡片内显示
- 通过 / 排除 / 需补充 的历史动作可查看，但不要占据主视觉过多空间
- 增加主 CTA：`确认目标人群，重新生成 KOL list`

### 9.2 KOL Pool 区域

- 显示当前版本 label
- 支持版本切换或查看历史版本
- 新版本池重新排序或重新生成后，旧版本仍可访问
- KOL feedback 采用小面板，不使用霸占页面的大弹窗

### 9.3 历史展示

- 上层显示 root audience 历史
- 下层显示 KOL decision history
- 导出时包含 root snapshot / action history / generation run history

## 10. 规则与约束

- 通过 / 排除 / 需补充 三类动作都必须落库。
- 撤回也必须落库。
- root audience 的最终确认不能只靠浏览器 localStorage。
- generation run 不能覆盖旧版池。
- 导出的 JSON 必须能完整还原一次客户确认和一次 KOL 生成。
- 后端必须能区分：动作日志、业务状态、生成版本。

## 11. 风险

- 如果不引入 snapshot，后续无法稳定重跑。
- 如果把动作日志当作状态源，版本恢复会脆弱。
- 如果生成池只在前端维护，客户换设备会丢失上下文。
- 如果没有版本边界，客户会混淆“旧一轮”和“新一轮”的 KOL。
- 如果不保留原因标签，后续学习无法用。

## 12. 验收标准

### 功能验收

- 客户完成 root audience 选择后，能保存 snapshot。
- 客户点击确认后，系统生成新的 KOL list version。
- 页面能看到当前版本和历史版本。
- 排除 / 需补充 原因保留并可导出。
- 撤回动作可追溯。

### 技术验收

- 新增表结构通过迁移。
- API 具备幂等性或可重试保护。
- `npm run typecheck` 通过。
- `npm run test` 通过。
- `npm run build` 通过。

## 13. 推荐实施顺序

1. 先落库 root snapshot 与 generation run。
2. 再把前端的确认按钮接到后端。
3. 再把 KOL list 切到 versioned 数据源。
4. 最后接真实 KOL / K8s 数据库生成服务。

## 14. 交付物

- PRD 文档
- 后端 schema / migration
- generation run API
- 前端版本展示和确认按钮
- 导出字段扩展
- 验收测试
