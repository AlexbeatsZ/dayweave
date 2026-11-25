# 小米手表 S4 快应用（设计稿，未实现）

状态：2026-11-21 设计。Dayweave 侧没有源码或构建。第 0 步通道验证进行中：问题已实测，Gadgetbridge 修复已提交但未装机（结果见「第 0 步结果」）。

## 目标与范围

- 手表上查看当前计时（手机、电脑或手表任一端开始的），并能开始、暂停、继续、结束、开倒计时。
- 查看今日待办并完成；以后补新建待办、补记记录和今日统计。
- 不在手表上复制业务规则：手表只显示中心或手机算好的精简视图，写操作全部走现有领域校验。
- 目标设备是 Xiaomi Watch S4（Vela / HyperOS 2，466×466 圆屏，型号 M2425W1），手机为 Redmi K70，连接手表的是个人 Gadgetbridge 分支（`/Users/meta/Developer/Gadgetbridge`），不是小米运动健康。

## 已确认的约束

来源：Gadgetbridge `docs/design/xiaomi-wear-app-interconnect.md` 和任务日志 `~/.agents/xiaomi-watch-s4--custom-apps-voice-assistant/AGENTS.md`。

- 第三方软件只能是 Vela JS 快应用 `.rpk`。Gadgetbridge 可直接安装 debug 签名的 rpk，无需官方 App。
- 快应用不能后台运行（只允许 audio/request/geolocation），`@system.record` 为 null（无麦克风），原生 `@system.fetch` 连不上网络。与外界通信只有 `@system.interconnect`。
- interconnect 在 Gadgetbridge 中是命令类型 20：手表打开 interconnect 发子命令 6，手机回子命令 7 CONNECTED 后手表才能 `send`；手表消息是子命令 9，手机消息是子命令 8。手表→手机已实测；手机→手表未实测。
- Gadgetbridge 收到手表消息后，只在设备设置开启「第三方应用收发手表应用消息」时广播 `nodomain.freeyourgadget.gadgetbridge.WATCH_APP_MESSAGE_RECEIVED`（extras `device`、`appId`、`payload` UTF-8）。它是隐式广播，不限接收方。
- 发往手表用 Intent API `nodomain.freeyourgadget.gadgetbridge.command.SEND_WATCH_APP_MESSAGE`（extras `device`、`appId`、`payload`，同一开关授权）。Gadgetbridge 的实现是先 `CMD_RPK_LAUNCH`，等手表回子命令 6，再发消息并结束会话，所以每次发送都会把快应用拉到前台。
- Dayweave Android 后台不运行 WebView，也不做业务同步；`DayweaveFilesPlugin.saveState` 每次保存会把完整状态原子写入私有 `data.json`，并顺带刷新倒计时闹钟和课程组件快照。原生代码可以读，但不能绕过 TS 领域层写。
- 原生代码已有直接和中心加密交换的先例：`UsageSync.java` 用配对时的 `clientId` 与密钥对 `/usage` 做 AES-256-GCM 信封交换，中心入口在 `electron/sync.ts` 的 `/pair`、`/sync`、`/usage` 路由。
- 活动计时是单个 `state.timer`：`spans` + `runningSince`（null 即暂停）+ 可选 `plannedEndAt`（倒计时）。已计时长由 `liveSpans` 从时间戳算出，不存 tick。预设时长在 `settings.timerPresets`。

## 架构

```
S4 快应用 ⇄ Gadgetbridge ⇄ Dayweave Android WatchBridge ⇄ ROG 中心 /watch
                                     ↘ 中心不可达：读 data.json 派生的本地快照，写入排队重发
```

### 手表快应用

- 放在本仓库 `watch/vela/`，aiot-toolkit 作为该目录的本地 devDependency，构建产物不入库。
- 包名 `org.dayweave.mobile`，与手机端一致。Gadgetbridge 路径不校验包名，但这符合官方 interconnect「快应用包名 = 手机端包名」的约定，也让 Gadgetbridge 能按包名定向投递。
- 打开时发 `view` 请求，之后只在用户操作后或回到前台时再请求，不轮询。显示时长用本机时钟根据 `runningSince` 和 `spansMs` 算出，每秒刷新，不依赖手机推送。
- 手机主动推送会强制拉起快应用，所以不推送。倒计时到点由手机现有的 `CountdownReminder` 系统通知提醒，Gadgetbridge 照常转发到手表（需实机确认 Dayweave 未在通知黑名单）。

页面（圆屏，主要点击区域不小于 44 px 等效尺寸，文字避开边缘弧形区域）：

1. 计时（首页）：活动名与颜色、大字已计时长或倒计时剩余、暂停/继续、结束。无计时时显示最近用过的 6 个活动和 `timerPresets` 倒计时按钮，点一下开始。
2. 待办：今日待办列表，点按后二次确认完成。
3. 记录：今日各活动时长和最近几条记录。
4. 补记：滚轮选活动与时长（第 2 步）。

手表上没有可靠的文字输入，新建待办先用手机上配置的常用短语；语音输入留给后续，见「以后」。

### Gadgetbridge 改动（个人分支）

- 收到手表消息时，若已安装与 `appId` 同名的包，则 `setPackage(appId)` 定向发送；否则保持原来的隐式广播。这样 Dayweave 用清单静态接收器就能收到（Android 8+ 静态接收器收不到隐式广播），其他应用也看不到 Dayweave 的消息。
- 快应用已在前台时 `LAUNCH` 不会再触发子命令 6（第 0 步实测），所以快应用最近 30 秒内发过子命令 6 或 9 时直接发 8+7，不再拉起。Gadgetbridge `feat/xiaomi-voice-inject` 提交 e975dc29ae 已实现，与定向广播一并提交。

### Dayweave Android：WatchBridge

- 静态 `BroadcastReceiver` 只接受 `appId == org.dayweave.mobile` 的消息，`goAsync()` 后交给单线程执行器，保存 `device` 作为回复目标。
- 读请求：先问中心 `/watch`；超时（建议 3 秒）或不可达时用本地快照应答，并标注 `stale` 与生成时间。
- 写请求：带上手表生成的 `commandId` 和操作时刻 `at`，先写入私有 `watch-outbox.json`，再尝试发给中心；失败时用 WorkManager 在有网络时重发。因为操作都以时间戳表达，晚一些送达也不改变结果；冲突由中心按现有规则返回 409。
- 本地快照：由 TS 的同一个 `watchView(state, now)` 生成，随 `saveState` 一起传给原生代码写入 `watch-view.json`，和课程组件快照一样，刷新失败不影响保存。不在 Java 中重写今日待办、重复和时区逻辑。
- 回复通过 Gadgetbridge Intent API 发出，单条回复控制在第 0 步测得的上限内，超出时分页。
- 地址、`clientId` 和密钥复用 `SyncEndpoint` 与 `UsageSync` 读取的同一份配对配置，不新增令牌或公网路由。

### 中心：`/watch` 加密交换

- 在 `electron/sync.ts` 的同一 HTTP 入口加 `/watch` 路由，信封格式、AAD 和密钥与 `/usage` 相同（`dayweave:1:/watch:<clientId>`）。
- 写操作映射到 `handleApi` 现有路由，例如 `POST /timelog/timer/start`、`/pause`、`/resume`、`/stop`、`POST /tasks/{id}/complete`，共用 StateService 写队列、occupancy 保护、`timerId` 与 `expectedUpdatedAt` 前置条件。不在 `/watch` 里另写业务逻辑。
- 防重放：`/watch` 不占用 WebView 业务同步的 `seq`（两者会争用同一序号）。中心按客户端保存最近 512 个 `commandId` 及其结果；同一 `commandId` 重放直接返回原结果，`at` 早于 7 天的命令拒绝。
- 读操作返回 `watchView(state, now)`，"今天"按 Dayweave 日程时区计算，不使用手表或 Gadgetbridge 的时区覆盖。
- 写到中心后，Mac 托盘约 2 秒内可见；手机 WebView 下次打开时经业务同步获得。
- 新字段只存在于中心私有状态（命令台账），不进入同步文档，不需要提升同步协议版本，也不需要检查 `isDocumentKey`。

## 消息协议 v1（草案）

所有消息为 UTF-8 JSON，键名尽量短。手表 → 手机：

```json
{"v":1,"id":"c-8f2a","op":"view"}
{"v":1,"id":"c-8f2b","op":"timer.start","activityId":"…","at":1795000000000,"countdownMin":25}
{"v":1,"id":"c-8f2c","op":"timer.pause","timerId":"…","at":1795000300000}
{"v":1,"id":"c-8f2d","op":"task.complete","taskId":"…","expectedUpdatedAt":1794990000000,"at":1795000400000}
```

`op` 取值：`view`、`timer.start`、`timer.pause`、`timer.resume`、`timer.stop`、`task.complete`；第 2 步增加 `task.create`、`record.add`、`stats.today`。`id` 同时是请求关联号和写操作的 `commandId`。

手机 → 手表：

```json
{
  "v": 1,
  "re": "c-8f2a",
  "ok": true,
  "stale": false,
  "at": 1795000000500,
  "timer": {
    "id": "…",
    "act": "学习",
    "color": "#357a9e",
    "runningSince": 1795000000000,
    "spansMs": 0,
    "endAt": 1795001500000
  },
  "tasks": [{ "id": "…", "t": "交实验报告", "u": 1794990000000 }],
  "acts": [{ "id": "…", "n": "学习", "c": "#357a9e" }],
  "presets": [5, 30, 45, 60]
}
```

失败时 `ok:false`，`err` 取 `offline`、`conflict`、`invalid`、`not_found` 之一，`msg` 为可直接显示的中文短句。

## 第 0 步结果

2026-11-22（K70 手机时间）在 Gadgetbridge 2026.11.16/code272 和探针 `com.meta.s4probe` 1.1.0 上实测。探针首页为「通道测试」，手机端由 `S4-Vela-Probe/tools/channel_responder.py` 读取 Gadgetbridge 日志，再经 Intent API 应答。

- 手表→手机：快应用前台时每次请求都送到 Gadgetbridge。单条 1 KB、2 KB、4 KB（4126 字节）可达，8 KB 和 16 KB 没有到达。协议单条消息应控制在 4 KB 以内，待办等列表要分页。
- 应答延迟：Mac 收到请求后约 0.1 秒交给 Gadgetbridge（经无线 adb；实际 WatchBridge 在手机本地，会更快）。
- 快应用未打开时手机主动发送：Gadgetbridge 拉起应用，约 1.6 秒后手表回报打开，消息随即发出。
- 快应用前台时手机回包：Gadgetbridge 每次重新发拉起命令，手表不再回报打开，10 次回包全部超时，直到下次打开应用才一并送达（手表显示为「意外消息」）。这就是上面的 Gadgetbridge 修复要解决的问题。
- 未完成：装入修复后的 Gadgetbridge 重跑「回包 ×10」「回包大小」；手机→手表单条上限和往返延迟尚未测得。用户要求修复先不部署。

## 分阶段与验收

0. 通道验证（阻塞后续）：用 `S4-Vela-Probe` 测手机→手表回包、快应用已打开时再次投递是否成功、单条消息大小上限与往返延迟；并做 Gadgetbridge 定向广播改动。通过标准：快应用前台时连续 10 次请求-回复全部收到，记录上限与延迟。
1. 中心 `/watch`（`view` 与计时操作）、TS `watchView`、Android WatchBridge 与本地快照、快应用计时页和只读待办。
2. 完成/新建待办、补记、今日统计。

验收沿用项目交付规则：源码与手表界面预览先给用户审核，获准后才构建、升级中心、安装 K70 与 S4。中心须先于手机升级。测试用隔离 profile；Node 测试覆盖 `/watch` 的信封、命令台账重放、409 映射和 `watchView` 时区边界；Android JVM 测试覆盖接收器过滤、离线排队和快照回退。真实手表交互、断网重发和通知转发单独实机验收。

## 以后

- 语音新建待办：复用 Gadgetbridge 已打通的小爱音频通道（SPP Opus → PCM），本机离线识别后把文字交给 Dayweave。需要另行设计唤醒与意图识别，不在本稿范围。
- S4 是否支持快应用卡片或表盘组件尚未查证。
- 方案依赖 Gadgetbridge 连接手表，切回小米运动健康时不可用。
