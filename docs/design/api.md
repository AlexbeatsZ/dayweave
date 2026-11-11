# AI REST API 与并发

Windows / macOS 桌面进程提供 `http://127.0.0.1:<port>/api/v1`，默认端口 49731。端口被占用时选择空闲端口，并将实际地址写入用户数据目录 `api.json`。`DAYWEAVE_API_PORT` 可为当前进程指定端口；`DAYWEAVE_API_DISABLE=1` 可关闭接口。移动端暂不运行 HTTP 服务。

每个数据目录生成独立随机令牌，保存为仅当前用户可读的 `api.json`，不进入 Git 或导出备份。请求使用 `Authorization: Bearer <token>`。所有端点均需认证；拒绝带 Origin 的跨站请求，校验 Host，固定监听 loopback，不提供 CORS 或远程代码执行。令牌可在设置中查看和复制供本机 AI 使用。

`electron/state-service.ts` 是桌面的唯一内存状态和写入队列，UI 与 API 都在持久化成功后提交修改并广播。UI 发送字段级增量，按变更前值做并发检查：修改不同字段可合并；同一字段冲突则拒绝，保留未保存的 UI 内容以供导出，禁止静默覆盖。API 写请求可使用 `If-Match` 指定响应中的 ETag；过期版本返回 409。

任务默认软删除；完成与恢复使用显式幂等动作。重复任务由同步中心按 Cron 生成有限未来窗口，不由完成动作生成。禁止通过普通 PATCH 改写身份、创建时间、完成时间和重复链；这些由专门动作管理。导入使用现有合并规则。整个事务必须通过 Zod 格式与引用校验。

主动记录写入、计时与合并导入都检查新占用，命中冲突时整笔不提交并返回 HTTP 409、`error.code: 409`、`error.reason: "TIME_OVERLAP"`。 `error.details` 含 `recordId`、`conflictingRecordId`、`conflictingTimer` 与冲突交集的 `startAt/endAt`（UTC epoch ms，无上限时 `endAt:null`）。读取最新记录和计时、修正区间后重试；不要把重叠当成单纯的 ETag 过期。健康接口的 `capabilities.timeOverlapProtection` 表示中心已启用规则。全状态导入保留服务器的计时，不采纳导入中的计时副本。

OpenAPI 文档由 `src/api-contract.ts` 生成到 `docs/api/openapi.json`，运行服务也通过 `/openapi.json` 返回同一份文档。命令行客户端默认从当前平台的用户数据目录读取地址和令牌，不输出令牌。

`/health` 从运行包元数据读取真实版本。独立服务器的 version 为服务器版本、appVersion 为共享客户端领域版本，并携带 mode=server/sourceCommit。服务器扩展受认证的 `/server/status`、`/usage/status`、`/server/shutdown`，撤销设备用 `DELETE /sync/peers/{id}` 调用原 revoke；其余完整业务API不变。服务器端口冲突失败，桌面保持原空闲端口回退；管理与CLI的具体契约见 `server/README.md` 和 `server.md`。

0.3 新增 /context、/schedule/_、/timelog/_ 与 /tasks/{id}/track。ROG 独立服务使用相同状态队列和 profile 进程锁；见 docs/api/README.md。

行为规则在 `/timelog/goals` 用 `kind: "behaviorRule"`、`period: "day"`、`trigger` 和 `action` 表示。查询按 `date` 返回 `review`（未选择为 null），`/context` 的当前及上一期返回 `reviewStatus`。回顾只接受 Dayweave 客户端的个人选择，REST 不提供代填入口。整份 `POST /import` 保留已有回顾。

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
