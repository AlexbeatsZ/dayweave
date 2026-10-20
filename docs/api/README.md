# 时织 AI 接口与 ROG 接入

Windows/macOS 程序启动后提供本机 HTTP API；也可使用 Release 的 `Dayweave-AI-tools` 包在 ROG 上运行无界面服务。所有写入与界面共用领域校验、串行事务和原子落盘，成功后才广播给界面。

## 连接与鉴权

- 默认 `http://127.0.0.1:49731/api/v1`。端口占用时选择空闲端口，以发现文件为准。
- Windows 发现文件 `%APPDATA%\Dayweave\api.json`；Mac 为 `~/Library/Application Support/Dayweave/api.json`。
- 每个数据目录拥有独立随机令牌，使用 `Authorization: Bearer <token>`；CLI 自动读取，不输出令牌。
- 拒绝浏览器 Origin、伪造 Host 和非 loopback 连接，不提供 CORS。
- `DAYWEAVE_DATA_DIR`、`DAYWEAVE_API_PORT` 只对当前启动进程设置。`DAYWEAVE_API_DISABLE=1` 关闭桌面接口。
- GET/写入响应为 `{data,revision}`，ETag 也是该 revision。OpenAPI 文档端点直接返回文档。
- 写入建议带 `If-Match: "<revision>"`。409 后先重读并重新决策，避免盲目重试。时迹实体编辑另需 `expectedUpdatedAt`；暂停/继续/停止计时需 `timerId`。

## ROG 上的运行方式

### 与桌面同机

启动 Dayweave，再运行：

```powershell
node api.mjs GET /context
node api.mjs GET /schedule/next
```

原始仓库中 CLI 路径是 `scripts/api.mjs`；AI 工具 ZIP 中为 `api.mjs`。本机 AI 读取 `api.json` 即可直接发 HTTP 请求。

### ROG 无界面服务

解压 AI 工具包，仅需现有 Node.js 24，无需 npm 安装。默认数据路径与桌面一致。

```powershell
node headless.mjs
```

服务启动时打印接口地址与发现文件路径，不打印令牌。Ctrl+C 安全退出。与桌面共用同一数据目录时，两者互斥；关闭服务后可用桌面编辑同一份数据。若使用独立 profile，CLI 也要指定同一目录：

```powershell
$env:DAYWEAVE_DATA_DIR = 'C:\Users\Meta\Project\Workspaces\dayweave-data'
node headless.mjs
node api.mjs --profile 'C:\Users\Meta\Project\Workspaces\dayweave-data' GET /context
```

此处只演示配置，不代表发行包已在 ROG 安装或启动。

### ROG 控制另一台设备

可用 SSH 隧道连接运行 Dayweave 的电脑，保留 loopback 与 Bearer 保护。例如在 ROG 执行：

```powershell
ssh -N -L 49732:127.0.0.1:49731 meta@192.168.31.214
```

实际目标电脑、远端端口以其发现文件为准。AI 通过 `127.0.0.1:49732` 调用，并在本地安全配置中使用目标 profile 的令牌。CLI 有意拒绝远程 URL，隧道端点仍是本机地址。

## 常用端点

| 端点                                                                    | 用途                                                                               |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `GET /context`                                                          | 真实时刻、日程时区、课程时区、今天待办、正向/番茄计时、当前/下一节课、未来七天课程 |
| `GET/POST /tasks`                                                       | 查找 / 创建任务                                                                    |
| `GET/PATCH/DELETE /tasks/{id}`                                          | 详情 / 修改 / 软删除                                                               |
| `POST /tasks/{id}/complete`、`reopen`、`restore`                        | 显式幂等动作                                                                       |
| `POST /tasks/{id}/track`                                                | 开始关联任务的正向计时；请求体可用 `{}` 或 `{activityId}`                          |
| `GET/POST /lists`、`PATCH/DELETE /lists/{id}`                           | 清单管理                                                                           |
| `GET/PATCH /settings`                                                   | 日程时区 `timeZone`、外观、番茄时长                                                |
| `GET /schedule`、`PATCH /schedule`                                      | 学期设置、课程时区、全校停课                                                       |
| `GET /schedule/next`                                                    | 当前课程数组与下一节课                                                             |
| `GET /schedule/occurrences?from=<epochMs>&until=<epochMs>`              | 展开最多 400 天范围内的课程                                                        |
| `POST /schedule/import`                                                 | `{name,content,preview:true}` 预览 CSV/JSON/ICS；`preview:false` 合并              |
| `POST /schedule/courses`、`PATCH/DELETE /schedule/courses/{id}`         | 周课程创建与维护                                                                   |
| `GET/POST /schedule/events`、`PATCH/DELETE /schedule/events/{id}`       | 单次或 ICS 课程实例                                                                |
| `GET /timelog/timer`                                                    | 活动计时及实际有效时长                                                             |
| `POST /timelog/timer/start`                                             | `{activityId,note?,fromPreviousRecord?}`                                           |
| `POST /timelog/timer/pause`、`resume`、`stop`、`cancel`                 | `{timerId}`；界面与 AI 使用同一计时器                                              |
| `GET/POST /timelog/activities`、`/records`、`/goals`                    | 时间记录实体管理                                                                   |
| `PATCH/DELETE /timelog/activities/{id}`、`/records/{id}`、`/goals/{id}` | 编辑 / 归档 / 软删除，需 `expectedUpdatedAt`                                       |
| `POST /timelog/records/{id}/fill`                                       | 相邻空档填充，需 `date,direction,spanIndex,expectedUpdatedAt`                      |
| `GET /timelog/timeline?date=YYYY-MM-DD`                                 | 日程时区下的时间线                                                                 |
| `GET /timelog/stats?date=YYYY-MM-DD`                                    | 时长与积分统计                                                                     |
| `GET /export`、`POST /import`                                           | 完整备份或兼容旧程序备份的合并导入                                                 |
| `GET /openapi.json`                                                     | 统一 OpenAPI                                                                       |

新建周课程示例：

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

写请求体可保存为 UTF-8 文件后调用：

```powershell
node api.mjs --body-file course.json POST /schedule/courses
node api.mjs --if-match '<revision>' --body-file change.json PATCH /settings
```

课程实例中的 `start/end` 为 UTC epoch 毫秒。周课程的 `start/end` 为课程时区下的 `HH:mm`。日期字符串是日历日，不应由设备 UTC−4 转换后重写成另一日。`Asia/Shanghai` 与固定 `-04:00` 可同时存在，不修改设备时区。

Android 当前只提供原生桌面组件和应用内操作，不运行 HTTP 服务。各平台本地数据不自动同步；ROG 系统对哪个 profile 调用，就控制那一份数据。
