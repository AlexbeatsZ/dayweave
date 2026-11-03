# 时织 / Dayweave Server

独立版本 `0.1.2`，共享客户端 `0.4.11` 的业务、计时、同步及 SQLite 所有者。需要 **Node 24.14.1 或更高的 24.x**，本版在 Windows Node 24.14.1 上验证。包已含 JavaScript 依赖，不需要 npm install、编译、Electron、React、Rust 或本机采集程序。Node 运行时由运行机器提供。

0.1.2采用0.4.11任务/目标结构（预计分钟、显式四象限、无积分、周期结束结算）；与客户端同批升级，旧严格客户端不能读取不含priority的新任务。

## 配置与启动

解压后把 `Dayweave-Server` 中的程序放到稳定的专用目录，例如：

```text
C:\Users\Meta\Project\Workspaces\dayweave-server\current\
```

在程序目录外创建私有配置 `C:\Users\Meta\Project\Workspaces\dayweave-server\server.json`，从 `server.example.json` 复制并核对：

```json
{
  "profile": "C:\\Users\\Meta\\AppData\\Roaming\\Dayweave",
  "createProfile": false,
  "apiPort": 49731,
  "discovery": false,
  "hub": "preserve"
}
```

`profile` 相对路径相对于配置文件目录解析，不依赖当前工作目录；生产建议使用绝对路径。`createProfile:false` 要求原目录已有 `sync.json`、`api.json` 和主数据或有效备份，避免因账户或 APPDATA 变化创建空身份。仅首次独立初始化/测试时显式设 `true`。`hub:preserve` 沿用 `sync.json` 的中心角色、端口、身份、配对和冲突；首次新中心可设 `hub:enable`，可选 `initialHubPort` 默认 49732，仅用于尚无中心配置的 profile。已有中心端口不被覆盖。

先正常退出原桌面程序，再在原 Meta 用户身份运行：

```powershell
& 'C:\Users\Meta\scoop\apps\nodejs\current\node.exe' 'C:\Users\Meta\Project\Workspaces\dayweave-server\current\server.mjs' --config 'C:\Users\Meta\Project\Workspaces\dayweave-server\server.json'
```

使用机器上实际的 Node 绝对路径；该示例不安装或更改 Node。也可运行包内 `start.ps1 -Config <绝对配置路径> -Node <node.exe绝对路径>`。没有窗口、托盘或标准输入依赖。正常启动只输出不含令牌的 ready JSON；stderr 记录失败原因。API 固定 loopback，默认 49731；server 模式端口冲突直接失败。中心保留 49732、`/pair`、`/sync`、`/usage`，原公网 `/dayweave` 网关无需变动。

本机采集在 server 模式下强制关闭，无论原 `settings.enabled` 是什么；原设置原样保存在 SQLite，回到桌面仍可使用。不会生成 collector 配置或启动采集器，不会因缺少 native-bin 反复报错。已有 collector 缓存及配置过的外部 Work Review SQLite、ActivityWatch 目录继续导入，外部来源只读；一个旧来源失败仍会尝试其他来源和远端 usage 交换，健康接口报告失败。不会自动建立新的旧来源。远端自动记录接收、分发及游标不受本机采集开关影响。

## 本机维护与停机

从任意工作目录执行，命令会动态读取原 profile/api.json，不在参数或输出中展示令牌：

```powershell
node .\admin.mjs --config 'C:\Users\Meta\Project\Workspaces\dayweave-server\server.json' status
node .\admin.mjs --config 'C:\Users\Meta\Project\Workspaces\dayweave-server\server.json' usage
node .\admin.mjs --config 'C:\Users\Meta\Project\Workspaces\dayweave-server\server.json' invite
node .\admin.mjs --config 'C:\Users\Meta\Project\Workspaces\dayweave-server\server.json' sync
node .\admin.mjs --config 'C:\Users\Meta\Project\Workspaces\dayweave-server\server.json' revoke '<准确的设备ID>'
node .\admin.mjs --config 'C:\Users\Meta\Project\Workspaces\dayweave-server\server.json' stop
```

邀请包含短期配对密钥，仅在明确调用 invite 时输出，应私下传给需配对的设备。revoke 删除该设备的认证授权，保留它已同步的历史数据和冲突。

`stop` 先发送受认证停机请求，再等待 owner.lock 释放；进程排空本机 API、中心请求、同步队列和导入任务，关闭 SQLite，flush 文件保存后释放 profile，正常退出码为 0。SIGINT/SIGTERM 走相同关闭路径；Windows 非交互运行请使用 admin stop，不能用强制终止代替正常停机。停机超时/非零退出必须查看日志，不能仅凭 HTTP accepted 判断已经安全退出。

原 `api.mjs --profile <profile> GET /context` 及所有任务/计时 API 继续可用。AI Decision 仍动态读取同一个 `%APPDATA%\Dayweave\api.json`，无需静态复制令牌。

额外端点均沿用 loopback、Host、Origin、Bearer 校验：

| 方法与路径（相对于 /api/v1） | 内容                                                              |
| ---------------------------- | ----------------------------------------------------------------- |
| GET /health                  | 真实 server version、appVersion、sourceCommit、mode 和存储状态    |
| GET /server/status           | PID、正常运行秒数、profile、恢复标记、业务计数、同步及 usage 健康 |
| GET /usage/status            | 来源路径、是否存在、最近扫描错误、设备和待交付数                  |
| POST /server/shutdown        | 有序停机，只在正式 server 模式提供                                |
| POST /sync/invite            | 现有短期邀请                                                      |
| DELETE /sync/peers/{id}      | 撤销指定设备                                                      |

不提供 Web 管理界面，不把 AI API 经过公网网关暴露。

## 健康探测与 Windows 任务优先级

就绪探测使用认证 `GET /api/v1/health`，一次只保留一个请求；完成或超时后再按退避间隔重试。就绪后仅取一次 `/server/status` 做详细检查。`admin status`、`/server/status` 和 `/usage/status` 需要统计全部 usage 历史，不用于两秒一次的存活探测；0.1.1 已改为异步分页及合并并发读取，仍应避免无意义的高频重查询。

2026-10-31 的隔离对照中，同一 ROG 原 profile 副本经普通 SSH 进程运行时，详细 status 约1533ms；经 S4U/原 Priority7 任务运行时约17031ms。部署对话随后以该应用任务 Priority6 完成0.1.0接管和有序重启，但后续仅用轻量 health 跨周期采样仍观察到最大16777ms延迟，不能把优先级调整视为最终性能修复。0.1.1 保留任务策略，针对长同步来源扫描和状态聚合做有界分页；生产效果须在原 profile 副本及升级后单独验证。

微软 [Priority (settingsType) 官方映射](https://learn.microsoft.com/en-us/windows/win32/taskschd/taskschedulerschema-priority-settingstype-element)：

| 任务 Priority | 进程优先级  | I/O 优先级       | 内存优先级 |
| ------------- | ----------- | ---------------- | ---------- |
| 6             | Normal      | IoPriorityNormal | Medium     |
| 7（默认）     | BelowNormal | IoPriorityLow    | Low        |

S4U/Session0 并不自动表示这些资源优先级相同。部署时记录任务 XML 的 Priority 和实际进程优先级；需要正常交互响应的服务器可先在临时任务中验证 Priority6，再由部署方受控调整生产任务。不通过启动脚本改全局优先级，也不更改业务同步轮询规则。

0.1.1 的 Work Review/collector 扫描每页200行，逐页按稳定事件ID核对并由原 UsageStore 事务写入，页间让出事件循环。rowid仅为本轮内的游标，不持久化；每轮从实际首行开始，支持显式负数及64位rowid，旧时间戳晚到和轮间VACUUM仍可重新去重。WITHOUT ROWID来源明确报告source error并继续其他来源和远端交换，不静默当空表。collector只确认本应用缓存里已提交的事件；外部来源不修改。

服务器 API 先就绪，再启动后台扫描。服务器详细状态使用独立只读WAL快照，每页256条、页间让出；并发状态请求共用一个进行中读取，不保存第二份业务状态。关闭时停止新扫描、取消剩余页、排空已受理API和同步，再等待只读连接释放并关闭主SQLite；已经提交的页保留，未完成AW文件不推进文件签名。

## 受控更新与 ROG 切换

本包不自动注册/修改计划任务、不停止生产程序、不改防火墙或系统环境。ROG 的生产切换由运维对话执行。

1. 先在独立临时 profile 验证新包。记录原 DayweaveHub 任务 XML、实际 Node 路径、API/中心健康、设备/冲突计数。
2. 正常退出原唯一写入者。桌面版用其正常退出机制；已有 server 用 `admin stop` 并确认进程退出。保持旧任务暂时不再启动，不能让桌面和 server 同时争用 profile。
3. 用候选包内的离线脚本备份并切换程序目录。它获取同一个 profile 锁，拒绝在线复制；完整复制原 profile（包含存在的 WAL/SHM、backup、collector、所有私有配置），不移动或改写生产数据。新程序复制到 sibling stage 后 rename 为 current，旧程序保存在本次临时恢复目录。

```powershell
node 'C:\staging\Dayweave-Server\stage-update.mjs' `
  --package 'C:\staging\Dayweave-Server' `
  --current 'C:\Users\Meta\Project\Workspaces\dayweave-server\current' `
  --config 'C:\Users\Meta\Project\Workspaces\dayweave-server\server.json' `
  --recovery 'C:\Users\Meta\AppData\Local\Temp\.agents\dayweave-server-update-20261031-unique'
```

恢复目录必须尚不存在，其父目录必须存在。各目标互相独立，配置保存在 current 外。脚本只准备程序并输出 `activated:false`，不启动新进程、恢复数据或管理任务。完整备份包含敏感数据和配对密钥，保留原用户访问权限。

4. 沿用 Meta 用户、显式 profile，把原 DayweaveHub 任务动作改成 Node + server.mjs + `--config`。可使用“未登录也运行”的任务方式；需由运维在该真实身份下验证目录权限和网络可达性，不能改成 SYSTEM 并依赖其 APPDATA。工作目录无需参与路径解析。启用任务失败重试（例如一分钟、三次），不要反复并行创建 writer；开机/未登录的真实验收单独记录。
5. 检查 `/health` 为 mode=server、版本0.1.2、appVersion0.4.11，API 49731、中心49732，原身份/客户端授权/序号/冲突与旧记录还在；跨至少两个15秒导入周期串行采样health/export，再单次检查详细状态及真实同步、AI Decision。共享网关、订阅、Tailscale以及其他程序的任务不随本包改动。
6. 需要回退时先有序关闭新 writer，保留新数据，先恢复原程序/任务入口并使用当前兼容 profile。只有证据表明数据损坏且明确授权时才从本次完整 profile 恢复；不要单独覆盖 usage.db、丢弃 WAL 或用旧备份回滚已确认的新业务数据。

`owner.lock` 与桌面共用，Windows 另用由规范化 profile 路径派生的内核命名管道串行化恢复，防止同时启动时竞争移除旧锁。崩溃退出后通过死亡 PID 恢复；无法确定锁所有者时失败并要求检查，不删除活动锁。SQLite 沿用 WAL 恢复，坏 data.json 只从通过校验的 data.backup.json 恢复并保留损坏原件，没有有效数据则拒绝启动。

## ROG 已记录的接管结果

以下为父部署对话提供的生产证据，本实现对话未操作 ROG。server0.1.0 已以 Meta/S4U、Session0、Priority6 接管原 profile。父对话记录03:06:57Z切换成功，03:09:17Z通过admin stop正常退出旧PID33268（退出码0），再由任务启动新PID47556。

- 1198任务、1048手动记录、5个已配对设备、0冲突；原deviceId、API令牌、各设备密钥及序号保留。
- usage224002、pending0；localCapture=false，原settings.enabled=true保留；collector-cache和已配置work-review来源均存在且无错误。
- Dayweave.exe及该应用本机collector进程均为0。上述是0.1.0接管时的快照，不能替代0.1.1副本/生产性能验收。

首次Priority7候选曾在两秒一次重型status探测下出现health/停机超时；部署方精确停止该候选任务，保留当时全部data/sync/usage.db及WAL快照后恢复原任务，没有用旧数据覆盖当前profile。完成原profile副本的普通SSH与S4U对照及正常停机后，才以Priority6和轻量探测重试生产。该诊断过程不作为常规强制停止流程；正常停机仍使用admin stop并确认退出。

父对话随后报告真实AI adapter的snapshot/query、已配对设备的Tailscale/公网usage加解密均通过，业务序号自然推进；但0.1.0跨周期health仍有16.777秒峰值，性能最终验收暂缓。S4U/Session0任务已经运行不等于已发生整机重启且无人登录。0.1.1由父对话先在原profile副本验收，再有序升级。

## 构建与发行

仓库中 `npm run bundle:server` 只 bundle 服务端；Windows `npm run dist:server` 同时生成 `release/Dayweave-Server-0.1.1.zip`。包里只有运行文件、示例配置与许可，不含 Node 运行时、profile 或源码依赖目录。`npm run test:server` 在隔离临时 profile 中验证，包含约200MiB合成历史及跨导入周期采样，需先 bundle。

独立 tag `server-v0.1.1`，Release 指定 `--latest=false`，客户端仍为0.4.10。服务端后续升级独立递增 server/package.json；不重建 APK/EXE/DMG。生产ROG的0.1.0接管证据见上；0.1.1副本/生产性能、整机重启及资源收益按各自证据单独记录。
