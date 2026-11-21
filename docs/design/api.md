## 2026-11-21 原始自动记录输入状态

OpenAPI 2.6.0 在 /usage/query 的响应声明可选 inputState（active/idle/unknown）和 foregroundOnly。旧数据字段缺省可读，CLI 复用该 JSON 接口。仅前台观察可查询，常规时长统计沿用原闲置阈值。

# AI REST API 与并发

## 2026-11-16 全功能原生接口与活动写入

Server 0.2.9、OpenAPI 2.4.0 增加 `/usage/query` POST、`/usage/status` GET、`/usage/settings` GET/PATCH、`/usage/applications` GET、`/usage/import` POST 与 `/usage/sync` POST。桌面和独立服务器通过原 Runtime 注入同一 DesktopUsage，继续由原 UsageStore 持有 SQLite。健康接口以 `capabilities.usageApi` 标明可用性。通用 api.mjs 支持这些端点。

新增同步入口覆盖 discover、pair、disconnect、setEndpoint、resolve、ensureTasks，分别为 GET /sync/discover、POST /sync/pair、POST /sync/disconnect、PATCH /sync/endpoint、POST /sync/resolve、POST /sync/ensure-tasks，原 SyncBridge 执行配对、身份、配置和冲突持久化。OpenAPI 2.5.0 移除日历账号与外部日历导入接口；ICS 订阅通过 PATCH /settings 的 calendarFeeds 管理。

行为规则 POST /timelog/goals/{id}/count?date=YYYY-MM-DD 传 counter=trigger/action、step=1/-1、expectedUpdatedAt（初始 null），复用原 countBehavior 和当前业务日规则。状态从目标 GET 的 review 读取，过期计数返回 409。复用客户端计数和撤销语义，整包导入仍保留已存在回顾。

脚本库支持 GET/POST /timelog/scripts、GET/PATCH/DELETE /timelog/scripts/{id}。修改和删除要求 expectedUpdatedAt，使用共享 saveGoalScript/removeGoalScript，与界面保存、同名、引用和并发校验一致。POST /timelog/scripts/inspect 读取代码元数据，POST /timelog/scripts/test 以 code/date/period/params 调用原 QuickJS 与 scriptHost，只读取真实业务及原自动观察。服务端目标判定仍由原中心拥有。

服务器 /server/status、/server/shutdown 与 /sync/peers/{id} 已进入共享 OpenAPI。通用 CLI 通过任意路径和 JSON 文件调用全部上述入口。AI Decision 0.1.51 的 request_dayweave 将当前全部 API 暴露给 Gemini MCP 和原生主脑，无业务端点名单。

query 请求直接使用原 UsageQuery 的 start/end、deviceId、search、before、limit，时间为 UTC epoch 毫秒。响应含 events、complete 和可选 next，下一页将 next 作为 before；同一起始时刻的观察保持在同一页。settings PATCH 合并原设置后调用 configure，import 接受 UsageEvent 数组并由原存储校验、按身份及 revision 去重，sync 复用原自动记录交换。

AI Decision 0.1.51 从 API 获取电脑和手机观察，保留原设备/平台过滤、域名脱敏、区间并集与工具分页。原生 API 缺失或失败时返回 unavailable。时间记录创建、纠错、撤销调用已有 `/timelog/records` POST/PATCH/DELETE，使用原 ETag、expectedUpdatedAt 和动作账本。确认以实际服务器返回的时间戳读回，允许记录 updatedAt 由领域层生成。

活动类别以用户当前保留的目录为准。`GET /timelog/activities` 共用 `activeActivity`，同时检查 archived 和 deletedAt。历史数据仍可引用已删除活动，AI 新写入以当前可用目录选择目标。此前 AI 适配器只检查 archived，将已软删除“吃饭”活动继续暴露给模型，整包导入又接受其历史引用，造成范围外补录。适配已改为原生目录查询及记录接口，删除状态参与执行校验。

下节表格记录 2026-11-15 的核对结果，本次原生接口和 AI 读写路径进展以上文为准。

## 全功能无头接口要求与当前覆盖

2026-11-15 用户再次明确，Dayweave 全部功能均须开放可供 AI 调用的接口，范围包含服务器端，全部对应操作应支持无头执行。新增和修改功能需要同时落实领域实现、接口契约、OpenAPI、CLI 调用和无头验收。项目 AGENTS.md、设计文档和项目日志均随改动提交并推送到 GitHub。

本次在 OMEN、Mac、ROG 核对同一项目的 Git 状态和日志。Mac 的最新部署记录已提交到 GitHub，OMEN 从该分支快进合入。ROG 项目目录无未提交文档，其提交已包含在当前历史中。ROG 的源码日志停留在较早版本，实际运行包通过认证 GET /health 核实为 Server 0.2.8、appVersion 0.5.11、mode=server。运行服务 GET /openapi.json 返回 2.3.0，包含 63 个路径。检查时 Dayweave GUI 进程数为零。

桌面、AI-tools 和独立服务器共用 electron/headless-runtime.ts 的 Runtime、StateService、DesktopSync、DesktopUsage 和 startApi。服务器已具备独立无界面运行能力，接口覆盖仍有待补齐部分。

| 功能                                                | 当前接口与无头能力                                                                                                                   | 待补齐部分                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| 任务、清单、子任务、完成/恢复、重复规则、日计划分组 | 本机 REST、OpenAPI 和通用 CLI 已覆盖主要操作，写入进入原 StateService 队列                                                           | 后续字段和动作继续逐项核对界面与接口覆盖                                                               |
| 时间活动、历史记录、计时、目标与统计                | REST 已支持记录增改删、补空档、计时 start/configure/next/pause/resume/stop/cancel、目标管理及手动目标勾选                            | AI Decision 当前业务命令只接入其中一部分，完整计时控制仍需接入                                         |
| 行为规则触发/执行计数与撤销                         | 客户端已有领域动作，REST 可查询回顾和管理规则                                                                                        | REST 明确拒绝 review/reviewStatus/behaviorReviews 写入，整包导入保留原回顾，计数与撤销缺少无头写入入口 |
| 电脑、手机自动记录                                  | 服务端已有 UsageStore/DesktopUsage、加密 /usage 同步和 /usage/status 管理健康查询，桌面经 usage:* IPC 查询、配置、导入和读取应用目录 | 本机 REST/CLI 缺少对应业务查询和管理入口；AI Decision 仍通过 SQLite 只读适配查询 usage.db              |
| 目标脚本库与试运行                                  | 中心已执行 QuickJS 脚本，目标 REST 可引用已存在的 scriptId 并读取结果，完整 JSON 导入导出可携带脚本库                                | 专用脚本库管理和试运行 REST/CLI 尚未覆盖界面动作                                                       |
| 日程、课程、RRULE、ICS 订阅                         | /events、/schedule、/recurrences；ICS 订阅为 PATCH /settings 的 calendarFeeds                                                        | 无                                                                                                     |
| 设备同步与冲突处理                                  | 本机 REST 已有 status/invite/hub/now 和设备 revoke，配对等另有加密协议；桌面 IPC 还支持 discover/pair/disconnect/setEndpoint/resolve | 本机 REST/CLI 尚未覆盖全部设备管理和冲突处理动作                                                       |
| 服务器运维                                          | 已有认证 /server/status、/usage/status、/server/shutdown 和 Server admin CLI                                                         | 这些服务器扩展端点及设备 revoke 尚未完整进入运行服务共用的 OpenAPI                                     |

### 当前 AI Decision 的调用依赖

常驻决策流程由模型提交业务命令，经 WSL controller 校验、持久化动作及依赖后，派发给 ROG Windows Node。Node 的 ai_decision.dayweave.Dayweave 读取本机用户 profile 的 api.json，使用 Bearer 令牌访问 http://127.0.0.1:49731/api/v1。ROG 实测 Node 的 dayweave.enabled 和 write_enabled 均为 true，api_file 与 usage_db 均未覆盖默认值。

任务和时间读取主要使用 GET /export 与 GET /context。写入按操作使用 /tasks、完成/恢复/重复专用动作、/plan-groups、/timelog/goals、记录 PATCH、timer/configure 或带 If-Match 的合并导入。Node 另以自己的 dayweave.sqlite3 保存动作意图、幂等身份和回执，结果未知时只读核对。

电脑与手机自动记录查询走 ai_decision.dayweave_usage，直接以 SQLite mode=ro、PRAGMA query_only=ON 读取原 Dayweave profile 的 usage.db。这使当前 AI 读取额外依赖 Dayweave SQLite 表结构及本机文件权限。通用外部 AI 可通过项目 scripts/api.mjs 或打包的 api.mjs 调用已开放 REST，远程访问可经 SSH 转发进入同一回环服务。

Dayweave 已有完整计时控制接口，AI Decision 当前 UpTimerChange 只允许 fill_gap、correct_record、restore 和 link_task，其中 timer 目标仅用于关联任务。模型可调用的业务工具范围需要继续扩展，才能使用 Dayweave 全部接口能力。

### 缺口补齐与验收

接口复用现有领域操作及持久化队列，保留版本冲突、时间占用和引用校验。涉及外部账号授权或系统权限时，提供授权状态、请求及结果接入接口，并明确实际需要用户参与的步骤。每项功能在隔离 profile 下验证 CLI/HTTP 调用、持久化读回、并发失败及重启后状态，服务器路径使用独立 Node 进程验证。按功能核对客户端动作、服务器实现、接口、OpenAPI 与 AI 消费端的覆盖，缺口持续保留在 AGENTS.md Active Work。

## 现有 REST 基础契约

Windows / macOS 桌面进程提供 `http://127.0.0.1:<port>/api/v1`，默认端口 49731。端口被占用时选择空闲端口，并将实际地址写入用户数据目录 `api.json`。`DAYWEAVE_API_PORT` 可为当前进程指定端口；`DAYWEAVE_API_DISABLE=1` 可关闭接口。移动端暂不运行 HTTP 服务。

每个数据目录生成独立随机令牌，保存为仅当前用户可读的 `api.json`，不进入 Git 或导出备份。请求使用 `Authorization: Bearer <token>`。所有端点均需认证；拒绝带 Origin 的跨站请求，校验 Host，固定监听 loopback，不提供 CORS 或远程代码执行。令牌可在设置中查看和复制供本机 AI 使用。

`electron/state-service.ts` 是桌面的唯一内存状态和写入队列，UI 与 API 都在持久化成功后提交修改并广播。UI 发送字段级增量，按变更前值做并发检查：修改不同字段可合并；同一字段冲突则拒绝，保留未保存的 UI 内容以供导出，禁止静默覆盖。API 写请求可使用 `If-Match` 指定响应中的 ETag；过期版本返回 409。

任务默认软删除；完成与恢复使用显式幂等动作。重复任务由同步中心按 Cron 生成有限未来窗口，不由完成动作生成。禁止通过普通 PATCH 改写身份、创建时间、完成时间和重复链；这些由专门动作管理。导入使用现有合并规则。整个事务必须通过 Zod 格式与引用校验。

主动记录写入、计时与合并导入都检查新占用，命中冲突时整笔不提交并返回 HTTP 409、`error.code: 409`、`error.reason: "TIME_OVERLAP"`。 `error.details` 含 `recordId`、`conflictingRecordId`、`conflictingTimer` 与冲突交集的 `startAt/endAt`（UTC epoch ms，无上限时 `endAt:null`）。读取最新记录和计时、修正区间后重试；不要把重叠当成单纯的 ETag 过期。健康接口的 `capabilities.timeOverlapProtection` 表示中心已启用规则。全状态导入保留服务器的计时，不采纳导入中的计时副本。

OpenAPI 文档由 `src/api-contract.ts` 生成到 `docs/api/openapi.json`，运行服务也通过 `/openapi.json` 返回同一份文档。命令行客户端默认从当前平台的用户数据目录读取地址和令牌，不输出令牌。

`/health` 从运行包元数据读取真实版本。独立服务器的 version 为服务器版本、appVersion 为共享客户端领域版本，并携带 mode=server/sourceCommit。服务器扩展受认证的 `/server/status`、`/usage/status`、`/server/shutdown`，撤销设备用 `DELETE /sync/peers/{id}` 调用原 revoke；其余完整业务API不变。服务器端口冲突失败，桌面保持原空闲端口回退；管理与CLI的具体契约见 `server/README.md` 和 `server.md`。

0.3 新增 /context、/schedule/_、/timelog/_ 与 /tasks/{id}/track。ROG 独立服务使用相同状态队列和 profile 进程锁；见 docs/api/README.md。

行为规则在 `/timelog/goals` 用 `kind: "behaviorRule"`、`period: "day"`、`trigger` 和 `action` 表示。查询按 `date` 返回 `review`（含 `triggered`、`executed` 与派生 `status`，未计数为 null），`/context` 的当前及上一期返回 `reviewStatus`。当前实现只接受 Dayweave 客户端写入回顾，REST 尚缺计数及撤销入口，整份 `POST /import` 保留已有回顾。此项已列入全功能无头接口待补齐范围。

任务 API 使用 dates/difficulty；子任务新增、PATCH、DELETE 有基于稳定 ID 的专用路由，完成动作共用领域规则。重复配置通过 PUT/DELETE /tasks/{id}/repeat，窗口通过 POST /repeat-rules/generate（through）请求中心。所有操作保留 If-Match；GET /tasks?date=YYYY-MM-DD&view=today 是精确业务日查询。完整模型与升级边界见 task-system.md。

## 任务与计时关联、事后成果（OpenAPI 2.1.0）

2026-11-06 源码契约：HTTP 路径仍为 `/api/v1`，状态 schema/同步协议仍为 2，OpenAPI `info.version` 从 2.0.0 升至 2.1.0。应用/Server 包版本保持 0.5.4/0.2.1；尚未打包、部署或在生产数据验收。调用方应读取目标运行服务的 `/openapi.json` 确认能力，不能由现有包版本推断新接口已上线。

运行时能力入口为认证的 `GET /health`，响应 JSON 路径是 `data.capabilities.taskRecordLinks === true`（同一个 health 对象也进入 Server `/server/status`）。当前未有既有 capabilities 字段，因此在原 health 响应新增此对象，不新增路由/服务。调用方必须严格检查 true；旧中心缺少/false/无法确认时，拦住本节新增关联及 caller-id 创建，不能先试写旧历史 PATCH 再靠读回发现它静默忽略了 taskId。该标志声明同批源码的历史关联、任务引用校验、原计时关联围栏和预存ID创建契约；只改源码不会改变旧生产中心响应。

记录及计时继续保存原有可选 `taskId`：一条记录至多关联一个完整 Task ID，一个任务可关联多条记录；循环任务必须使用实例完整 ID，不能仅给前缀。显式写入关联时在原 `StateService.mutate` 事务内检查最新任务：已完成但未删除的任务可关联，目标不存在返回 404，软删除目标返回 409，非法类型、空字符串或超长字符串返回 400。历史/迁移/同步读取不新增强制外键约束：已保存任务后来删除或旧导入存在悬空引用时保留原 `taskId`，省略关联字段的普通编辑仍可保存；显式清空可以解除，显式指向删除目标仍拒绝。

| 操作                            | 请求与并发契约                                                                                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /timelog/records`         | `activityId`、完整有效 `spans` 必填，可附 `taskId`；201 返回原始记录。只创建已结束记录，不操作当前计时。                                                                                                           |
| `PATCH /timelog/records/{id}`   | 必须携带原记录的 `expectedUpdatedAt`（缺少 428、过期 409）。`taskId:字符串` 建立/改绑，`taskId:null` 删除属性，省略保留原关联。可同时带全局 `If-Match`，过期 409。纯关联请求只发 `expectedUpdatedAt` 和 `taskId`。 |
| `POST /time-records`            | 延用 `startAt/endAt` 创建未结束或已结束记录，可附字符串 `taskId`，使用同一目标校验。创建历史记录时原运行/暂停计时保持完整。                                                                                        |
| `POST /timelog/timer/start`     | 可附字符串 `taskId`，使用同一目标校验。                                                                                                                                                                            |
| `POST /timelog/timer/configure` | 运行/暂停计时均可用，仅发 `timerId` 和 `taskId` 即纯关联；null 解绑、省略保留。携带全局 `If-Match`，无需也不支持另一种 timer revision。计时不存在、已结束/到期、ID 不匹配返回 409，不改为启动新计时。              |

纯关联不改记录的活动、性质、片段、暂停间隔、备注、标签、删除状态，也不改任何任务字段或当前运行计时；历史记录只有 `taskId` 和单调 `updatedAt` 变化。运行/暂停计时纯关联则只有 `taskId` 变化：`id/activityId/nature/note/tags/startedAt/runningSince/spans/plannedEndAt` 都保留。到期收尾仍由原领域/队列负责；请求执行前已过截止时拒绝 configure，调用方重读已保存记录。不能使用 `/stop`+`/start` 替代关联。

查询沿用原始对象：`GET /timelog/records/{id}` 及列表返回真实 `taskId`、`updatedAt` 和全部片段；未绑定时省略 `taskId`。列表新增精确 `taskId` 筛选，可与 `date/activityId/q/offset/limit/includeDeleted` 组合，最多每页 500 条。`GET /time-records` 返回最近 1000 条（含开放记录）的真实关联；`GET /timelog/timer`、`/context.timeTimer` 和 `/export.timelog.timer` 返回完整原 timer。任务名称、完成/删除状态、dates、notes、清单和标签继续用 `GET /tasks/{taskId}` 读取（包含已完成/软删除任务），不复制另一份任务摘要。活动归类、记录业务日、任务 `dates` 和日计划分组各自独立，关联不迁移活动/日期/分组、不自动完成任务、不填任务 `actualMinutes`。

AI Decision 交接：`Proposal.uptimer_changes` 的 `kind=link_task` 以 `target=record|timer` 区分目标，携带 `record_id/expected_revision/task_id`；`task_id` 可为 AI 内部 ID 或 `new:key`，由 AI 控制器解析成 Dayweave 完整外部 Task ID。历史记录使用实际 `updatedAt` → `expectedUpdatedAt`；运行/暂停计时可对完整原 timer JSON 计算稳定内容指纹（排除派生 elapsed），写前重新 GET `/export` 比较，再用这次响应的全局 ETag 发 configure，围住比较之后的并发修改。Dayweave 不接收 SHA-256/expected_revision 字段，也不新增第二套计时器；调用方可比较写前/写后完整 timer 除 `taskId` 外的不变性。`fill_gap/correct_record` 同样可携带任务 ID；单纯关联不借这些动作改时间。未知结果后 AI 只读核对，不盲目重发；动作账本与幂等由 AI Decision 拥有。

### 补建已经完成的事项

`POST /tasks` 接受可选 `id`（随机 UUID 前缀 + `-` + 非负安全整数后缀，普通新任务用 `UUID-0`），省略仍由服务器生成。调用方先把随机 ID 写入自己的动作账本，再发送创建；同 ID 已存在（包括软删除）返回 409，不覆盖/复用内容，也不再创建另一个 ID。普通 PATCH 禁止改身份。创建可保留 v2 `dates/difficulty/notes/tags/listId/estimatedMinutes/actualMinutes`，与当前计时无互斥；所有校验/落盘仍在原队列中。

创建请求的完整字段集合为：必填 `title`，其余可选 `id/notes/estimatedMinutes/actualMinutes/difficulty/listId/dates/tags/subtasks/pinned/order`。`dates` 为真实业务日期→该日有效 planGroup ID/null，`∞` 只能为 null；`subtasks` 为 `{id,title,done}` 数组，省略即无子任务；预计/实际分钟独立、允许非负小数/0/null。title/notes/标签/日期/清单等沿原 schema 与引用校验，未知字段返回 400。没有直接的 `status=completed` 字段，AI Decision 的该状态须转换成下述两步；不能把它或 completedAt/history 原样传入 Dayweave 创建请求。创建成功返回 200、`{data:完整Task,revision}` 和对应 ETag。

可靠顺序是：先按已知 ID 或任务查询核对 → `POST /tasks` 创建普通未完成任务 → 记录响应/重读 → `POST /tasks/{id}/complete`（`{}`，携带最新 `If-Match`）→ 再用记录 PATCH 或 timer configure 关联。空子任务列表也能完成，不得为了完成状态加虚构子任务。complete 是显式幂等动作，但仍检查 If-Match；创建和完成是两个独立事务，不宣称原子。任何一步结果未知时先 GET 原任务/记录/timer 核对，不能假定未执行，也不能自动重发写入。

没有原生历史完成时间写入参数。创建/普通 PATCH 不接受 `completedAt/createdAt/updatedAt/history`；complete 的时间由服务器本次操作产生，完成动作体不提供可回填时间字段。若用户说过去一天已做某事，用 `dates:{"实际业务日期":null}` 加 notes 记录实际发生日/来源，再执行 complete；任务原生完成统计/事件仍属于补录操作日，不应对外宣称已回填过去的完成事件。关联记录可保留真实历史 `spans`，作为独立执行证据；未知道真实起止时不虚构计时。未来需要历史原生完成事件时，必须另行设计和授权，不能借导入伪造本次补录事实。

### 源码验证与交付边界

2026-11-06 `npm test` 完整 195 项、`npm run check` 和涉及文件的 Prettier/diff 检查通过。`tests/timer-api.test.ts` 新增 6 项实际 loopback HTTP + StateService/FileStore 隔离回归：有暂停片段的历史记录建立/改绑/解绑与多记录查重、缺失/删除/非法任务原子拒绝和历史引用兼容、并发 UI 编辑及双写围栏、运行/暂停计时完整快照不变性/持久化/已结束错误、预存 ID 创建+无子任务完成及真实完成时间、读取与写队列之间倒计时到期不能复活。另核验备份/导入、同步文档往返，完整套件涵盖 v1 引用迁移和原加密同步。到期竞争用例控制测试时钟，其余使用隔离样例，均不读写生产任务或计时。没有打包/生产安装/物理设备或新 UI 验收；AI Decision 的具体实现及联调由其原对话拥有。
