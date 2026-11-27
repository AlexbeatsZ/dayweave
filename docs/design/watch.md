# 小米手表 S4 快应用（设计稿，未实现）

状态：2026-11-26 已部署 ROG 中心 Server 0.2.16、K70 客户端 0.5.19 和 Gadgetbridge 2026.11.18；手表应用 rpk 等手机解锁后安装。真表交互、第 0 步复测和离线排队尚未实测。

## 目标与范围

- 手表上查看当前计时（手机、电脑或手表任一端开始的），并能开始、暂停、继续、结束、开倒计时。
- 查看今日待办并完成；以后补新建待办、补记记录和今日统计。
- 不在手表上复制业务规则：手表只显示中心或手机算好的精简视图，写操作全部走现有领域校验。
- 目标设备是 Xiaomi Watch S4（Vela / HyperOS 2，466×466 圆屏，型号 M2425W1），手机为 Redmi K70，连接手表的是个人 Gadgetbridge 分支（`/Users/meta/Project/Workspaces/Gadgetbridge`），不是小米运动健康。

## 已确认的约束

来源：Gadgetbridge `docs/design/xiaomi-wear-app-interconnect.md` 和任务日志 `~/.agents/xiaomi-watch-s4--custom-apps-voice-assistant/AGENTS.md`。

- 第三方软件只能是 Vela JS 快应用 `.rpk`。Gadgetbridge 可直接安装 debug 签名的 rpk，无需官方 App。
- 快应用不能后台运行（只允许 audio/request/geolocation），`@system.record` 为 null（无麦克风），原生 `@system.fetch` 连不上网络。与外界通信只有 `@system.interconnect`。
- interconnect 在 Gadgetbridge 中是命令类型 20：手表打开 interconnect 发子命令 6，手机回子命令 7 CONNECTED 后手表才能 `send`；手表消息是子命令 9，手机消息是子命令 8。手表→手机已实测；手机→手表未实测。
- Gadgetbridge 收到手表消息后，只在设备设置开启「第三方应用收发手表应用消息」时广播 `nodomain.freeyourgadget.gadgetbridge.WATCH_APP_MESSAGE_RECEIVED`（extras `device`、`appId`、`payload` UTF-8）。它是隐式广播，不限接收方。
- 发往手表用 Intent API `nodomain.freeyourgadget.gadgetbridge.command.SEND_WATCH_APP_MESSAGE`（extras `device`、`appId`、`payload`，同一开关授权）。Gadgetbridge 的实现是先 `CMD_RPK_LAUNCH`，等手表回子命令 6，再发消息并结束会话，所以每次发送都会把快应用拉到前台。
- Dayweave Android 后台不运行 WebView，也不做业务同步；`DayweaveFilesPlugin.saveState` 每次保存会把完整状态原子写入私有 `data.json`，并顺带刷新课程组件快照。原生代码可以读，但不能绕过 TS 领域层写。
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
- 打开或回到页面时发 `view` 请求，之后只在用户操作后再请求，不轮询。显示时长根据 `runningSince` 和 `spansMs` 每秒算出，不依赖手机推送。每次成功回复带中心时间 `at`，手表记下与本机时钟的差值，显示和命令的 `at` 都按中心时间，避免手表时钟偏差（`common/channel.js`）。
- 超时（8 秒）的命令用同一 `id` 重发一次，由中心台账去重；`view` 不重发。
- 手机主动推送会强制拉起快应用，所以不推送。倒计时到点的提醒依赖手机端的系统通知（Gadgetbridge 会转发到手表）。线上 0.5.18 还没有倒计时到期通知，该功能在 `codex/behavior-rule-goals` 待审核；在它上线前，倒计时到点手机和手表都不会提醒。

页面（用户 2026-11-25 指定：和手机一样，上下翻页共三页，顺序固定）。入口 `pages/main` 用纵向 `swiper`（不循环，右侧页码点），打开时在第 1 页。用上下翻页而不是左右，避免与系统右滑返回冲突。圆屏内容控制在约 340 px 宽的内接区域，主要点击区域不小于 44 px。

1. 今日待办：显示前 4 项未完成待办，点一次变绿提示「再点一次完成」，再点完成并振动。超过 4 项时显示「全部 N 项」，进入可滚动的 `pages/tasks`。首页不放可滚动列表，避免和上下翻页抢手势。
2. 计时：同一个 Dayweave 计时同时支持正计时和倒计时。
   - 未开始：顶部「正计时 | 倒计时」切换。倒计时下显示前 3 个 `timerPresets` 和「自定」，「自定」打开 `picker` 滚轮选 1–180 分钟。最后点 6 个常用活动之一开始（每行 3 个）。
   - 进行中：外圈为活动颜色（暂停时灰色），活动名、大字时长（倒计时显示剩余，正计时显示已计时长）、暂停/继续、结束（再点一次确认）。倒计时下另有「+5′」「正计时」（取消倒计时），正计时下有「倒计时」（打开滚轮，从现在起算）。两种都有「换活动」：保存当前这段为记录，以新活动继续。
3. 课程：正在上课的课（还剩多久、时间、地点）、下一节（还有多久、哪天、时间、地点）和再下一节的一行摘要。只取类型为课程的日程，一周内没有课时提示。

旋钮：Vela 文档没有表冠或按键事件，系统可能让它滚动列表，需在表上实测。
预览在 `.local/preview/watch/`（`render.mjs` 用 HTML 按同样样式模拟 466×466 圆屏，`sheet.png` 为总览），不是表上真实渲染。记录页和补记留到第 2 步。

手表上没有可靠的文字输入，新建待办先用手机上配置的常用短语；语音输入留给后续，见「以后」。

### Gadgetbridge 改动（个人分支）

- 收到手表消息时，若已安装与 `appId` 同名的包，则 `setPackage(appId)` 定向发送；否则保持原来的隐式广播。这样 Dayweave 用清单静态接收器就能收到（Android 8+ 静态接收器收不到隐式广播），其他应用也看不到 Dayweave 的消息。
- 快应用已在前台时 `LAUNCH` 不会再触发子命令 6（第 0 步实测），所以快应用最近 30 秒内发过子命令 6 或 9 时直接发 8+7，不再拉起。Gadgetbridge `feat/xiaomi-voice-inject` 提交 e975dc29ae 已实现，与定向广播一并提交。

### Dayweave Android：WatchBridge

- `WatchBridge.java`：清单静态 `BroadcastReceiver` 只接受 `appId == org.dayweave.mobile`、负载不超过 4000 字符的消息，`goAsync()` 后交给单线程执行器，保存 `device` 作为回复目标。任何应用都能显式发广播给它，所以它只做协议内的有限操作，所有写入仍经中心领域校验。
- 读请求：先问中心 `/watch`（连接 2.5 秒、读取 4 秒，留在广播时限内）；不可达时用本地快照应答，并标注 `stale: true`。没有快照时回 `offline`。
- 写请求：先写入私有 `watch-outbox.json`（最多 64 条），再发给中心；中心有任何回复（接受或拒绝）就出队。中心不可达时回 `err: offline`、`msg: 已保存，联网后同步`，并用 WorkManager 在有网络时按顺序重发。命令时间来自手表，晚送达不改变开始/结束时刻；冲突由中心返回。
- 本地快照：由 TS 的同一个 `watchView(state, now)` 生成，随 `saveState` 一起传给原生代码写入 `watch-view.json`，和课程组件快照一样，刷新失败不影响保存。不在 Java 中重写今日待办、重复和时区逻辑。
- 回复通过 Gadgetbridge Intent API 发出，单条回复控制在第 0 步测得的上限内，超出时分页。
- 地址、`clientId` 和密钥复用 `SyncEndpoint` 与 `UsageSync` 读取的同一份配对配置，不新增令牌或公网路由。

### 中心：`/watch` 加密交换

- 在 `electron/sync.ts` 的同一 HTTP 入口加 `/watch` 路由，信封格式、AAD 和密钥与 `/usage` 相同（`dayweave:1:/watch:<clientId>`）。
- 实现：`src/watch/protocol.ts`（请求 schema、`watchView`、`applyWatchCommand`）和 `electron/watch.ts`（`WatchHub`）。命令直接调用 UI 与 REST 共用的领域函数 `startTimer`、`toggleTimer`、`finishTimer`、`toggleTask`，经 `StateService.mutate` 写入，所以 occupancy 等提交校验一致。没有走 `handleApi`，因为它的暂停/结束只用服务器当前时间，排队命令需要用手表记录的时间。
- 时间：命令时间取 `min(at, 中心当前时间)`，早于 7 天拒绝（`invalid`）。计时 id 不符、已有计时、领域校验失败都回 `conflict`；暂停已暂停、继续正在计时、完成已完成的待办都按成功处理。待办的 `updatedAt` 与手表看到的不同回 `conflict`，手表随后刷新。
- 防重放：`/watch` 不占用 WebView 业务同步的 `seq`（两者会争用同一序号）。中心按客户端在 profile 的 `watch.json` 保存最近 512 个命令 id 及结果，同一 id 重放：成功则返回当前视图，失败返回原错误。`WatchHub` 内部串行，原命令与其重放同时到达也只执行一次。
- 读操作返回 `watchView(state, now)`，"今天"按 Dayweave 日程时区计算，不使用手表或 Gadgetbridge 的时区覆盖。
- 写到中心后，Mac 托盘约 2 秒内可见；手机 WebView 下次打开时经业务同步获得。
- 新字段只存在于中心私有状态（命令台账），不进入同步文档，不需要提升同步协议版本，也不需要检查 `isDocumentKey`。

## 消息协议 v1

所有消息为 UTF-8 JSON，键名尽量短。手表 → 手机：

```json
{"v":1,"id":"c-8f2a","op":"view"}
{"v":1,"id":"c-8f2b","op":"timer.start","activityId":"…","at":1795000000000,"countdownMin":25}
{"v":1,"id":"c-8f2c","op":"timer.pause","timerId":"…","at":1795000300000}
{"v":1,"id":"c-8f2d","op":"task.complete","taskId":"…","expectedUpdatedAt":1794990000000,"at":1795000400000}
```

`op` 取值：`view`、`timer.start`（可带 `countdownMin`）、`timer.pause`、`timer.resume`、`timer.stop`、`timer.countdown`（`minutes`，null 改回正计时，只能在计时运行中设定）、`timer.extend`（`minutes`，只对倒计时）、`timer.next`（`activityId`，换活动）、`task.complete`；第 2 步再加 `task.create`、`record.add`、`stats.today`。回复中的 `classes` 最多 4 项，为一周内正在进行或将要开始的课程，`d`（今天/明天/周X）和 `hm` 由中心按课表时区格式化，`s`/`e` 为毫秒时间戳。`id` 同时是请求关联号和写操作的 `commandId`。

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
  "tasks": [{ "id": "…", "t": "交实验报告", "u": "2026-11-25T01:00:00.000Z" }],
  "acts": [{ "id": "…", "n": "学习", "c": "#357a9e" }],
  "presets": [5, 30, 45, 60],
  "classes": [
    {
      "n": "物理化学",
      "l": "H3109",
      "c": "#4f8fd6",
      "s": 1795000000000,
      "e": 1795006000000,
      "d": "今天",
      "hm": "09:55–11:35"
    }
  ]
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

## 第 1 步实现状态（2026-11-25）

- 分支 `feat/watch-s4`（基于线上 0.5.18）：中心 `/watch`、共享协议、Android WatchBridge 与快照、手表快应用 `watch/vela`（`org.dayweave.mobile` 0.2.0，上下三页）。
- 已验证：Node 248 项（含 `tests/watch.test.ts` 7 项：今日待办按业务日、最近活动优先、命令时间与幂等、冲突/过期、台账重放与并发、倒计时设定/取消/延长与换活动、课程按课表时区、含计时与课程的满载回复小于 4000 字节）、类型检查、格式检查；Android `compileDebugJavaWithJavac` 与 JVM 单测；快应用 `npm run build` 成功。
- 未验证：真实表上渲染与触控、Gadgetbridge 定向广播到 WatchBridge、手机到中心的 `/watch` 实际交换、离线排队重发、Android 打包与签名。按交付规则，界面审核前不构建发布；中心须先升级。

## 分阶段与验收

0. 通道验证（阻塞后续）：用 `S4-Vela-Probe` 测手机→手表回包、快应用已打开时再次投递是否成功、单条消息大小上限与往返延迟；并做 Gadgetbridge 定向广播改动。通过标准：快应用前台时连续 10 次请求-回复全部收到，记录上限与延迟。
1. 中心 `/watch`（`view` 与计时操作）、TS `watchView`、Android WatchBridge 与本地快照、快应用计时页和只读待办。
2. 完成/新建待办、补记、今日统计。

验收沿用项目交付规则：源码与手表界面预览先给用户审核，获准后才构建、升级中心、安装 K70 与 S4。中心须先于手机升级。测试用隔离 profile；Node 测试覆盖 `/watch` 的信封、命令台账重放、409 映射和 `watchView` 时区边界；Android JVM 测试覆盖接收器过滤、离线排队和快照回退。真实手表交互、断网重发和通知转发单独实机验收。

## 以后

- 语音新建待办：复用 Gadgetbridge 已打通的小爱音频通道（SPP Opus → PCM），本机离线识别后把文字交给 Dayweave。需要另行设计唤醒与意图识别，不在本稿范围。
- S4 是否支持快应用卡片或表盘组件尚未查证。
- 方案依赖 Gadgetbridge 连接手表，切回小米运动健康时不可用。

## 手表图标（2026-11-26）

用户反馈安装的Dayweave图标没有圆形边框。原`common/logo.png`只有透明底绿色图案，Vela应用列表不会替它补Android自适应图标的底板。`node scripts/make-watch-icon.mjs`复用`assets/icons/Shizhi_Windows.svg`的图案，渲染192×192白色圆板、浅色细边、四角透明，图案放在124×124安全区。脚本使用项目已有Playwright与已安装Chrome，不安装工具；只改变手表PNG，桌面/Android图标不变。用户于2026-11-26审阅圆形图标并授权部署。RPK升为0.2.1/code3，沿用原aiot debug证书；K70/GB安装后S4回报完成，刷新出13个快应用。包内图标与构建已核对，真表应用列表图标的目测验收仍待用户确认。

同轮用户要求的每周非睡眠时段提醒由Gadgetbridge的S4设备设置「保持清醒」管理，退出Dayweave快应用不影响启用的监测。设计在Gadgetbridge仓库`docs/design/xiaomi-wake-guard.md`；本轮不新增Dayweave领域状态、中心接口或ICS订阅。

## Gadgetbridge 保持清醒纯振动（2026-11-26）

0.2.2/code4增加`common/wake-guard.js`控制消息，不改变页面、图标或业务状态。S4拒绝GB的System/59命令，改用快应用已有的`@system.vibrator`本地执行3次long（间隔1秒），需要短暂前台。GB仍拥有监测与周规则；中心、Android WatchBridge和领域API不改。

控制命名空间`gadgetbridge.wake_guard.v1`在`channel.js`业务应答之前消费：`prepare(id)`仅回ready，3秒内匹配`vibrate(id)`才执行，每id至多一次；cancel/销毁清理后续timer。执行完回executed（只代表API调用）；GB在10秒内收到ready才直接提交、不把motor命令放进启动队列，取消/超时后拒绝迟到ready。无网络中心也可执行，不发送计时/待办写命令。手机版本需GB2026.11.22/code277。

测试：`npx tsx --test tests/watch-wake-guard.test.ts tests/watch.test.ts`，覆盖未准备/过期/重复/cancel/销毁与原业务协议。2026-11-26 RPK已经原GB安装服务装S4并收到安装完成。
