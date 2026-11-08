# 时织 AI 接口与 ROG 接入

Windows/macOS 程序启动后提供本机 HTTP API；也可使用 Release 的 `Dayweave-AI-tools` 包在 ROG 运行无界面服务。写入与界面共用领域校验、串行事务及原子保存，成功后广播给界面。正计时、倒计时与任务计时共用同一个活动计时器。

## 连接与鉴权

- 默认 `http://127.0.0.1:49731/api/v1`，端口占用时选择空闲端口，以发现文件为准。
- Windows 发现文件 `%APPDATA%\Dayweave\api.json`；Mac 为 `~/Library/Application Support/Dayweave/api.json`。
- 每个 profile 有独立随机令牌，请求携带 `Authorization: Bearer <token>`；CLI 自动读取，不输出令牌。
- 拒绝浏览器 Origin、伪造 Host 和非 loopback 连接，不提供 CORS。
- `DAYWEAVE_DATA_DIR`、`DAYWEAVE_API_PORT` 只设置当前进程；`DAYWEAVE_API_DISABLE=1` 关闭桌面接口。
- 响应为 `{data,revision}`，ETag 也是 revision；OpenAPI 端点直接返回文档。
- 写入建议带 `If-Match: "<revision>"`；409 后重读并重新决策。时间记录实体编辑/删除及预设修改另需 `expectedUpdatedAt`，运行中计时操作需匹配 `timerId`。
- `error.reason=TIME_OVERLAP` 的 409 表示新占用与已保存片段或未结束计时冲突；`error.details` 给出两个记录 ID、是否撞到计时及重叠区间。暂停计时仍保护从开始时刻起的时间，边界相接允许。导入也遵守该规则，冲突时整笔不写入；旧重叠可读取和修正。

## ROG 运行方式

启动桌面 Dayweave 后，本机 AI 可读取 `api.json` 并调用；源码中的 CLI 是 `scripts/api.mjs`，工具 ZIP 中是 `api.mjs`：

```powershell
node api.mjs GET /context
node api.mjs GET /schedule/next
node api.mjs GET /timelog/timer
```

登录后台运行使用稳定路径的 `Dayweave.exe --tray`：启动隐藏到托盘，关闭主窗口仍保留 API 与同步中心，托盘“退出时织”才停止。也可用现有 Node.js 24 运行工具包中的 `node headless.mjs`，无需 npm 安装；Ctrl+C 退出。桌面与 headless 不得同时占用同一 profile。

需要独立 profile 时，服务与 CLI 指定同一目录：

```powershell
$env:DAYWEAVE_DATA_DIR = 'C:\Users\Meta\Project\Workspaces\dayweave-data'
node headless.mjs
node api.mjs --profile 'C:\Users\Meta\Project\Workspaces\dayweave-data' GET /context
```

远程控制另一台电脑可经 SSH 转发，保留 loopback 与 Bearer 鉴权，例如：

```powershell
ssh -N -L 49733:127.0.0.1:49731 meta@192.168.31.214
```

目标地址与远端端口以实际设备的发现文件为准，AI 使用该 profile 的令牌访问 `127.0.0.1:49733`。CLI 不接受远程 URL；49733 避开 LAN 同步端口 49732。以上是配置示例，不代表已在物理设备部署验收。

## 常用端点

路径均相对于 `/api/v1`；详细字段见 [OpenAPI](openapi.json)。

| 端点                                                                          | 用途                                                                                                                                                                              |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /context`                                                                | 当前时刻与日程时区、今天任务、`timeTimer`、冲突计时候选、有效时长、当前/下一节课与未来七天课程                                                                                    |
| `GET/POST /tasks`、`GET/PATCH/DELETE /tasks/{id}`                             | 查找、创建、编辑或删除任务                                                                                                                                                        |
| `POST /tasks/{id}/complete`、`reopen`、`restore`                              | 显式幂等动作，restore 保留历史数据恢复兼容                                                                                                                                        |
| `POST /tasks/{id}/track`                                                      | `{}` 使用清单活动映射，或传 `{activityId}` 覆盖本次选择；带入任务 ID、标题及标签                                                                                                  |
| `GET/POST /lists`、`PATCH/DELETE /lists/{id}`                                 | 清单管理，`color` 为颜色，`activityId` 为默认计时活动绑定                                                                                                                         |
| `GET/PATCH /settings`                                                         | 日程时区、外观等主程序偏好，不再接受番茄时长设置                                                                                                                                  |
| `GET/PATCH /schedule`、`GET /schedule/next`                                   | 学期、课程时区、全校停课与当前/下一节课                                                                                                                                           |
| `GET /schedule/occurrences?from=<epochMs>&until=<epochMs>`                    | 展开最多 400 天范围的课程                                                                                                                                                         |
| `POST /schedule/import`                                                       | `{name,content,preview:true}` 预览 CSV/JSON/ICS，`preview:false` 合并                                                                                                             |
| `POST /schedule/courses`、`PATCH/DELETE /schedule/courses/{id}`               | 周课程创建与维护                                                                                                                                                                  |
| `GET/POST /schedule/events`、`PATCH/DELETE /schedule/events/{id}`             | 单次或 ICS 课程实例                                                                                                                                                               |
| `GET/POST /time-records`、`POST /time-records/{id}/stop`                      | 未结束与已结束记录的统一表示，最近 1000 条；给相同 ID 补结束时间                                                                                                                  |
| `GET /timelog/timer`                                                          | 当前 `timer` 与 `elapsedMs`；`plannedEndAt` 非空表示倒计时                                                                                                                        |
| `POST /timelog/timer/start`                                                   | `{activityId,note?,startAt?,fromPreviousRecord?,endAt?,taskId?,tags?}` 开始计时                                                                                                   |
| `POST /timelog/timer/configure`                                               | `{timerId,startAt?,fromPreviousRecord?,endAt?,taskId?,note?,tags?}` 调整原计时，保留 ID 与暂停片段                                                                                |
| `POST /timelog/timer/next`                                                    | `{timerId,activityId}` 在同一时刻保存当前活动并开始下一活动                                                                                                                       |
| `POST /timelog/timer/pause`、`resume`、`stop`、`cancel`                       | `{timerId}`，暂停后继续会顺延倒计时截止                                                                                                                                           |
| `GET/PATCH /timelog/settings`                                                 | 读取记录偏好；PATCH 用 `{expectedUpdatedAt,timerPresets}` 替换倒计时预设                                                                                                          |
| `GET/POST /timelog/activities`、`/records`、`/goals`                          | 活动、记录和目标管理                                                                                                                                                              |
| `PATCH/DELETE /timelog/activities/{id}`、`/records/{id}`、`/goals/{id}`       | 需 `expectedUpdatedAt`；活动/目标直接删除，记录保留删除标记，无归档操作                                                                                                           |
| 目标字段                                                                      | `target` 文本（`9h`、`<2h`、`90`；范围 `8-16h`/`<1-3h` 同时设置阶段，单值清除阶段）或 `minutes`+`comparison`(`atLeast`/`atMost`)；读取返回 `settled`/`met`，周期结束前 `met=null` |
| 计时目标的计入                                                                | `rules: [{activities, tags, excludeTags}]`，满足任一规则的记录计入；规则内活动任选其一（空为任意）、`tags` 全部带上、`excludeTags` 都不带。`activityId` 仍可作单活动简写          |
| 目标阶段                                                                      | 可选 `stages`：分钟数组，`null` 清除（优先于 `target` 文本里的范围）；读取返回 `reached`/`levels`（达到的阈值数/阶段数+1）                                                        |
| 脚本目标                                                                      | `kind: "script"`、`scriptId`（应用脚本库中的脚本）与 `params`；脚本只在设备上运行、结果不存储，接口读取时 `met=null`，并返回 `scriptName`。脚本规范见 `docs/goal-scripts.md`      |
| `POST /timelog/records/{id}/fill`                                             | 用 `date,direction,spanIndex,expectedUpdatedAt` 填充相邻空档                                                                                                                      |
| `GET /timelog/timeline?date=YYYY-MM-DD`、`GET /timelog/stats?date=YYYY-MM-DD` | 日程时区下的时间线与时长统计                                                                                                                                                      |
| `GET /export`、`POST /import`                                                 | 完整备份或兼容旧程序备份的合并导入                                                                                                                                                |
| `GET /openapi.json`                                                           | 统一 OpenAPI                                                                                                                                                                      |

## 任务范围与计时

0.4.0 手机的日计划与周计划按所选日程时区计算，周计划为周一至周日；待办箱仅判断 `dates={}`，与 `listId` 无关。默认清单 ID `inbox` 表示未分组。任务 `order` 保存用户拖动顺序，确认框中的序号由当前可见未完成任务推导，不是永久编号。

清单 `activityId` 显式绑定优先；未配置时默认学习 → 学习、工作 → 实操、生活 → 日常。`POST /tasks/{id}/track` 与界面复用 `startTaskTimer`。清单/活动颜色与 `tagColors.tasks/records` 标签颜色进入完整状态和同步；新建、编辑任务使用同一 UI 保存流程，API 修改也受并发检查约束。

`POST /time-records` 只需 `{"startAt":<epochMs>}`，可附 `activityId/taskId/note/tags`。未给 `endAt` 或为 null 时正计时；未来的 `endAt` 保存为 `plannedEndAt` 并开始倒计时；过去的 `endAt` 创建已结束记录。`POST /time-records/{id}/stop` 可用可选的过去结束时刻结束原记录。

`/timelog/timer/start` 和 `/configure` 的 `startAt` 不晚于现在，不能与 `fromPreviousRecord:true` 同用；`endAt` 仅接受未来 UTC epoch 毫秒，null 清除截止。`configure` 不传字段则保留现值，`taskId:null` 解除任务绑定。需要创建过去的完整记录时使用 `/time-records` 或 `/timelog/records`。

倒计时暂停冻结剩余时间，恢复顺延截止；到期按原计划截止保存同一 ID，延迟唤醒不额外累计。`next` 的旧记录结束边界与新计时起点一致，返回新计时；之后操作使用它的新 `timerId`。离线同时开始的计时保留为冲突候选，不能盲目新开计时。

默认预设为 `[5,30,45,60]` 分钟。先 `GET /timelog/settings` 读取 `updatedAt`，再 PATCH，例如：

```json
{
  "expectedUpdatedAt": 1792700000000,
  "timerPresets": [5, 15, 30, 45, 60]
}
```

上面的更新时间仅为格式示例，必须替换为实际读到的值。预设最多 30 项，每项为 1 至 10080 的整数分钟，去重后保存，空数组表示删除全部预设。

## 任务关联与事后成果（OpenAPI 2.1.0，源码待交付）

本节能力以目标服务 `GET /openapi.json` 的 `info.version=2.1.0` 为准，路径仍是 `/api/v1`；当前源码的应用/Server 包版本尚为 0.5.4/0.2.1，不表示已部署新接口。状态 schema/同步协议仍为 2。

运行时首先检查 `GET /health` 的 JSON `data.capabilities.taskRecordLinks === true`。旧中心没有该标志时禁止发本节新增写入，避免旧历史 PATCH 静默忽略 taskId；同一标志也声明本节 caller-id 创建能力。源代码修改不会使尚未升级的生产中心自动获得该标志。

先 `GET /timelog/records/{id}` 读取原记录及其 `updatedAt`，再以响应 ETag 作为 `If-Match` 发稀疏 PATCH：

```json
{
  "expectedUpdatedAt": 1792700000000,
  "taskId": "e6e0ce1f-7347-42bf-96fa-a96b2d0adb7c-0"
}
```

所有示例 ID/时间都需要换成真实读到的值。字符串建立或改绑，`taskId:null` 解绑，省略保留；其余字段省略就保留原片段（含暂停空隙）、活动/性质、备注、标签及删除状态，也不会调整正在进行的计时。`expectedUpdatedAt` 必填，缺少返回 428、过期返回 409；全局 If-Match 过期同样返回 409。`POST /timelog/records` 用 `activityId+spans` 创建已结束记录时也可带 taskId，返回 201。

运行或暂停计时先 `GET /timelog/timer` 或 `/export` 取得完整原 `timer` 与 ETag，再发 `POST /timelog/timer/configure`，仅包含 `{"timerId":"真实ID","taskId":"真实TaskID"}` 并带 `If-Match`。null 解除，省略保留。除 taskId 外，完整 timer 的 id、活动/性质、开始/运行起点、spans、截止、备注和标签应完全相同；派生 elapsed 随时钟变化不用于比较。无活动计时、旧 ID、已经结束/到期返回 409，不能因此重新 start。接口不接收额外 expected_revision/指纹，调用方自己的完整快照指纹比较由原 If-Match 围栏保护。

全部显式关联都在最新状态的同一写事务内验证任务。已完成但未删除的任务可以关联，不存在返回 404，软删除返回 409，非法类型/空串返回 400。既有历史/导入引用在读取、同步和省略字段的普通编辑中保留；null 可解除。一个任务可以关联多条记录，一条记录只有一个 taskId；活动分组、记录业务日、任务 dates/日计划分组各自独立，关联不会改变它们，也不自动完成任务或回填 actualMinutes。

查重与读回沿用 `GET /timelog/records/{id}`、`GET /timelog/records?taskId=<完整TaskID>&offset=0&limit=100`（最多 500/页，可组合 date/activityId/q/includeDeleted）、`GET /time-records`（最近 1000 条，含开放记录）；它们返回实际 taskId，未绑定时省略。任务相关详情用 `GET /tasks/{taskId}` 核对 title、dates、notes、completedAt、deletedAt 等，已完成/已删除目标均能读回。重复系列须使用完整实例 ID。

补建用户报告已经做完的事项：

1. 先查询核对既有任务；确无对应项时，调用方先持久化随机 `UUID-0`，再 `POST /tasks` 传可选 `id`、title、实际业务日的 dates、notes 及正常任务字段。省略 id 则由服务生成；同 ID（包含软删除）返回 409，不覆盖既有内容，普通 PATCH 禁止改 ID。
2. 创建并读回后，用最新 ETag 调用 `POST /tasks/{id}/complete`，请求体 `{}`。显式完成支持空子任务列表；无需添加虚构子任务。创建与完成为两个独立事务，活动计时不会阻止它们。
3. 再用上述 PATCH/configure 把真实记录/计时关联到新任务。记录有真实起止才补录 spans；只有完成陈述时不虚构计时范围。

`POST /tasks` 的完整可写字段为必填 title，可选 id、notes、estimatedMinutes、actualMinutes、difficulty、listId、dates、tags、subtasks（`{id,title,done}`数组）、pinned、order；未知字段400，成功200返回完整Task及revision/ETag。不接受 status；AI Decision的 `status=completed` 必须由控制器转换为上述创建→complete两步。

创建/普通 PATCH 不接受 completedAt、createdAt、updatedAt、history。complete 使用服务器当前操作时间，不支持原生历史完成时间回填；dates+notes 可以记录实际发生日期，但原生完成统计/历史仍属于补录操作日。所有动作结果未知时先按预存 ID 只读核对；AI Decision 负责动作账本与幂等，不能在未知结果后盲目重发写入或换一个任务 ID。详细交接字段和版本边界见 [API 设计](../design/api.md)。

## 课程与请求文件

周课程的 `start/end` 是课程时区下的 `HH:mm`，实例的 `start/end` 是 UTC epoch 毫秒。日期字符串为日历日，不应由设备 UTC-4 转换后重写成另一日。例如：

```json
{
  "name": "量子化学",
  "weekday": 1,
  "start": "08:00",
  "end": "09:40",
  "weeks": [1, 3, 5, 7, 9, 11, 13, 15],
  "location": "H4306",
  "teacher": "",
  "color": "#4264b2",
  "excludedDates": []
}
```

请求体保存为 UTF-8 文件再调用，避免命令行引号与 JSON 转义：

```powershell
node api.mjs --body-file course.json POST /schedule/courses
node api.mjs --if-match '<revision>' --body-file presets.json PATCH /timelog/settings
```

## 同步中心与升级

Android 不运行 HTTP 服务。ROG AI 调用中心 profile 的接口，修改通过配对同步传播；手机和平板在前台运行和恢复时交换，系统冻结后台 WebView 后下次打开补齐，不承诺后台即时传播。

无界面中心在当前进程设置 `DAYWEAVE_SYNC_HUB=1` 后运行 `node headless.mjs`，LAN 同步默认 49732，AI 仍仅监听 loopback 49731。`GET /sync/status` 返回状态；`POST /sync/hub` 开启中心，`POST /sync/invite` 生成一次五分钟邀请，`POST /sync/now` 立即同步；启动时也可用 `node headless.mjs --invite`。邀请含配对密钥，私有 `sync.json` 不得作为业务备份传播。

0.4.0 的 `plannedEndAt`、清单映射、标签颜色和预设要求 ROG 中心与手机/平板配套升级。旧 0.3 中心的严格 schema 不接受新增字段；新程序能读取旧 schema-1 备份，不代表旧程序能安全读取新状态。本轮物理设备更新和跨设备新功能验收尚未完成，发布包、源码测试与实际设备状态需分别记录。

## 任务模型 v2（源代码，待协调交付）

创建/编辑写 `dates: {"2026-11-05": "该日真实时段ID", "2026-11-06": null, "∞": null}`；没有键表示不安排该日，空映射表示待办箱。日期不是截止，只有过去日期的任务自然进入历史，不结转、不逾期警告。任务难度 `difficulty: "easy"|"medium"|"hard"` 为独立手动选择，默认简单无强调，预计/实际分钟照常独立。

`POST /tasks/{id}/subtasks` 新增（可传稳定 id），`PATCH/DELETE /tasks/{id}/subtasks/{subtaskId}` 增量修改/软删除；父完成/撤销会联动所有子任务，子任务全部完成会完成父任务。历史事件由领域层记录。

`PUT /tasks/{id}/repeat` 写 `{ "cron": "0 4 * * 1", "dateOffsets": [0,1,2] }`，每周生成一个含三天日期的普通任务；中心统一提前生成，取消用 DELETE 同一路由，不删实例。`GET /repeat-rules` 查看模板与触发账本，`POST /repeat-rules/generate` 的 `{through:"YYYY-MM-DD"}` 经中心扩展，未连接返回不可用。Task ID 前缀只用于系列展示，完整 ID 才是实体；复制产生新前缀。

备份 state.version=2，支持 v1 迁移并改写全部任务引用。离线工具 `npx tsx scripts/migrate-task-state.ts <旧备份.json> <新输出目录>` 生成迁移状态和完整身份映射；它不改输入。中心、客户端及 AI Decision 必须协调升级并保留原始 checkpoint，见 ../design/task-system.md；禁止旧端混写。
