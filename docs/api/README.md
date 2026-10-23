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

| 端点                                                                          | 用途                                                                                               |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `GET /context`                                                                | 当前时刻与日程时区、今天任务、`timeTimer`、冲突计时候选、有效时长、当前/下一节课与未来七天课程     |
| `GET/POST /tasks`、`GET/PATCH/DELETE /tasks/{id}`                             | 查找、创建、编辑或删除任务                                                                         |
| `POST /tasks/{id}/complete`、`reopen`、`restore`                              | 显式幂等动作，restore 保留历史数据恢复兼容                                                         |
| `POST /tasks/{id}/track`                                                      | `{}` 使用清单活动映射，或传 `{activityId}` 覆盖本次选择；带入任务 ID、标题及标签                   |
| `GET/POST /lists`、`PATCH/DELETE /lists/{id}`                                 | 清单管理，`color` 为颜色，`activityId` 为默认计时活动绑定                                          |
| `GET/PATCH /settings`                                                         | 日程时区、外观等主程序偏好，不再接受番茄时长设置                                                   |
| `GET/PATCH /schedule`、`GET /schedule/next`                                   | 学期、课程时区、全校停课与当前/下一节课                                                            |
| `GET /schedule/occurrences?from=<epochMs>&until=<epochMs>`                    | 展开最多 400 天范围的课程                                                                          |
| `POST /schedule/import`                                                       | `{name,content,preview:true}` 预览 CSV/JSON/ICS，`preview:false` 合并                              |
| `POST /schedule/courses`、`PATCH/DELETE /schedule/courses/{id}`               | 周课程创建与维护                                                                                   |
| `GET/POST /schedule/events`、`PATCH/DELETE /schedule/events/{id}`             | 单次或 ICS 课程实例                                                                                |
| `GET/POST /time-records`、`POST /time-records/{id}/stop`                      | 未结束与已结束记录的统一表示，最近 1000 条；给相同 ID 补结束时间                                   |
| `GET /timelog/timer`                                                          | 当前 `timer` 与 `elapsedMs`；`plannedEndAt` 非空表示倒计时                                         |
| `POST /timelog/timer/start`                                                   | `{activityId,note?,startAt?,fromPreviousRecord?,endAt?,taskId?,tags?}` 开始计时                    |
| `POST /timelog/timer/configure`                                               | `{timerId,startAt?,fromPreviousRecord?,endAt?,taskId?,note?,tags?}` 调整原计时，保留 ID 与暂停片段 |
| `POST /timelog/timer/next`                                                    | `{timerId,activityId}` 在同一时刻保存当前活动并开始下一活动                                        |
| `POST /timelog/timer/pause`、`resume`、`stop`、`cancel`                       | `{timerId}`，暂停后继续会顺延倒计时截止                                                            |
| `GET/PATCH /timelog/settings`                                                 | 读取记录偏好；PATCH 用 `{expectedUpdatedAt,timerPresets}` 替换倒计时预设                           |
| `GET/POST /timelog/activities`、`/records`、`/goals`                          | 活动、记录和目标管理                                                                               |
| `PATCH/DELETE /timelog/activities/{id}`、`/records/{id}`、`/goals/{id}`       | 需 `expectedUpdatedAt`；活动/目标直接删除，记录保留删除标记，无归档操作                            |
| `POST /timelog/records/{id}/fill`                                             | 用 `date,direction,spanIndex,expectedUpdatedAt` 填充相邻空档                                       |
| `GET /timelog/timeline?date=YYYY-MM-DD`、`GET /timelog/stats?date=YYYY-MM-DD` | 日程时区下的时间线、时长与积分统计                                                                 |
| `GET /export`、`POST /import`                                                 | 完整备份或兼容旧程序备份的合并导入                                                                 |
| `GET /openapi.json`                                                           | 统一 OpenAPI                                                                                       |

## 任务范围与计时

0.4.0 手机的日计划与周计划按所选日程时区计算，周计划为周一至周日；待办箱仅判断 `due=null`，与 `listId` 无关。默认清单 ID `inbox` 表示未分组。任务 `order` 保存用户拖动顺序，确认框中的序号由当前可见未完成任务推导，不是永久编号。

清单 `activityId` 显式绑定优先；未配置时默认学习 → 学习、工作 → 实操、生活 → 日常。`POST /tasks/{id}/track` 与界面复用 `startTaskTimer`。清单/活动颜色与 `tagColors.tasks/records` 标签颜色进入完整状态和同步；新建、编辑任务使用同一 UI 保存流程，API 修改也受并发检查约束。

`POST /time-records` 只需 `{"startAt":<epochMs>}`，可附 `activityId/taskId/note/tags`。未给 `endAt` 或为 null 时正计时；未来的 `endAt` 保存为 `plannedEndAt` 并开始倒计时；过去的 `endAt` 创建已结束记录。`POST /time-records/{id}/stop` 可用可选的过去结束时刻结束原记录。

`/timelog/timer/start` 和 `/configure` 的 `startAt` 不晚于现在，不能与 `fromPreviousRecord:true` 同用；`endAt` 仅接受未来 UTC epoch 毫秒，null 清除截止。`configure` 不传字段则保留现值，`taskId:null` 解除计划绑定。需要创建过去的完整记录时使用 `/time-records` 或 `/timelog/records`。

倒计时暂停冻结剩余时间，恢复顺延截止；到期按原计划截止保存同一 ID，延迟唤醒不额外累计。`next` 的旧记录结束边界与新计时起点一致，返回新计时；之后操作使用它的新 `timerId`。离线同时开始的计时保留为冲突候选，不能盲目新开计时。

默认预设为 `[5,30,45,60]` 分钟。先 `GET /timelog/settings` 读取 `updatedAt`，再 PATCH，例如：

```json
{
  "expectedUpdatedAt": 1792700000000,
  "timerPresets": [5, 15, 30, 45, 60]
}
```

上面的更新时间仅为格式示例，必须替换为实际读到的值。预设最多 30 项，每项为 1 至 10080 的整数分钟，去重后保存，空数组表示删除全部预设。

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
