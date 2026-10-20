# 时织 · Dayweave

把待办、时间记录和课程表放在一个离线程序里。基于本人的开源项目 [Clearlist](https://github.com/AlexbeatsZ/clearlist) 和 [Open Timelog](https://github.com/AlexbeatsZ/open-timelog) 整合，MIT 许可。

## 下载

[GitHub Releases](https://github.com/AlexbeatsZ/dayweave/releases) 提供 Windows x64 便携 EXE、Android APK、macOS Apple Silicon / Intel DMG 与 ZIP，以及独立 AI 接口工具包。

Windows 直接运行 EXE；macOS 将应用拖入 Applications；Android 安装 APK 后打开时织。macOS 包使用 ad-hoc 签名，未做 Apple Developer ID 公证；Windows 包未购买代码签名证书。

## 一个程序，三种安排

- **待办**：清单、标签、备注、子任务、优先级、重复任务、月历、四象限、搜索、回收站、番茄专注和统计。
- **时间记录**：正向计时、暂停与继续、活动分类、时间线、补空档、目标与时长分析。从任务详情点击「开始记录时间」会关联该任务，结束后写入同一份时间线。
- **课程表**：按周浏览，设置开学周一和学期周数，支持单双周、指定教学周、教师、教室、全校停课与单课停课日期。显示当前课程、下一节课及倒计时。
- **桌面小组件**：Android 2×2 下一节课与 4×2 课程表卡片；适配小米独立组件进程、曝光刷新、点击跳转和系统重启。可在课程表中请求添加，也可长按桌面 → 小组件 → 时织。
- **AI 控制**：统一 REST API、OpenAPI、命令行客户端、独立无界面服务。ROG 上的决策系统可以查询上下文、管理任务、控制计时器和修改课程。
- **浅色 / 深色 / 跟随系统**；所有数据保存在本地，无需账号。

## UTC−4 设备，UTC+8 课程

首次启动默认将日程时区设为 `Asia/Shanghai`。任务的「今天」、时间记录日界线和统计按这个时区计算，**不修改操作系统时区**。

「课程表 → 学期设置」还可以独立设置课程时区。例：课程是北京时间周一 08:00，设备为固定 UTC−4，则同一节课的设备时间为周日 20:00。上课时刻和倒计时保持一致。

支持 IANA 地区时区（如 `Asia/Shanghai`、`America/New_York`）与固定偏移（如 `-04:00`）。纽约时区自动跟随夏令时；固定 `-04:00` 永远是 UTC−4。

## 导入与迁移

先在原 Clearlist 与 Open Timelog 中导出各自的 JSON 备份，再在时织「设置 → 数据与备份」逐一导入。相同 ID 按更新时间合并，保留本地设置。计时中的 Open Timelog 备份请先结束计时再导出。

时织使用独立桌面数据目录 `Dayweave` 和 Android 包名 `org.dayweave.mobile`。旧程序和旧数据不会被覆盖。新版完整 JSON 备份包含待办、时间记录、课程、计时与时区设置。各设备保留离线数据，配对后通过 ROG 同步中心自动合并。

课程导入支持：

1. **CSV**：从课表下载模板，支持中文或英文表头。字段 `name,weekday,start,end,weeks,location,teacher`；星期 1–7，时间如 `08:00`，周次如 `1-16`、`1-15单`、`2-16双`、`1,3,5-7`。重复导入相同课程不会新增副本。
2. **JSON**：时织导出的课程表，保留学期、周次、时区和例外日期。
3. **ICS**：日历导出文件，在当前学期范围内展开重复规则、排除日期和移动课程。浮动时间采用课程时区；带时区或 UTC 的事件保留真实时刻。

所有课程导入先预览，确认后合并。学校教务网站、截图或小爱课表的私有数据格式暂未提供直接转换。

## 设备同步

在常在线的 ROG 开启「设置 → 设备同步 → 将本机作为同步中心」，生成配对邀请。在其他电脑、手机和平板打开同一设置，查找局域网中心，再粘贴邀请配对。邀请五分钟内有效且只能使用一次；配对后自动连接同一个中心，IP 变化时会重新发现。发现失败可填写局域网 IP 或 Tailscale 地址。

打开应用时每两秒交换变更；没有改动时只传版本号。离线修改按实体和字段三方合并，同一字段冲突会保留中心版本并在设置中保留本地候选。不同设备同时离线开始的计时会全部保留，记录页提示分别处理。

计时就是一条尚无结束时间的记录：保存开始时刻与暂停片段，各端按当前时刻计算；停止时给相同 ID 补结束时间。不会每秒写入或同步计数，迟到的旧设备消息也不会重新开启已停止的计时。

传输载荷使用 AES-256-GCM；配对和设备密钥保存在私有配置，不进入导出的业务备份或 Android 云端备份。手机和平板被系统冻结后台时暂停同步，下次打开补齐；计时时长仍正确恢复，组件独立显示本机最后同步的课表。本版没有保证后台即时同步的常驻服务。

ROG 无界面模式可设置进程环境变量 DAYWEAVE_SYNC_HUB=1 后运行独立工具包 headless.mjs，AI 与同步设备共用中心数据。防火墙规则和开机启动须由用户明确设置；项目提供仅允许专用 Wi-Fi 本地子网的 scripts/enable-lan.ps1，不自动修改系统设置。

## AI / ROG 接入

桌面运行时提供 `http://127.0.0.1:49731/api/v1`，实际端口和随机令牌保存于用户数据目录 `api.json`，可用 CLI 自动读取。

```powershell
node scripts/api.mjs GET /context
node scripts/api.mjs GET /schedule/next
node scripts/api.mjs GET /timelog/timer
```

`GET /context` 一次返回日程时区、今天任务、两类计时器、正在上的课、下一节课以及未来七天课程。写请求可携带响应 ETag 作为 `If-Match`，冲突返回 409。

[完整接口说明与 ROG 用法](docs/api/README.md) · [OpenAPI](docs/api/openapi.json)

独立 AI 工具包只需 Node.js 24，运行 `node headless.mjs` 即可，不需要安装 Electron。桌面程序和独立服务不能同时占用同一数据目录；远程访问可用 SSH 本地端口转发。Android 本版不运行 HTTP 服务。

## 开发与构建

```powershell
npm ci
npm run dev
npm test
npm run build
npm run test:e2e
npm run test:api
npm run dist:win
npm run dist:android
```

macOS 上执行 `npm run dist:mac`，Intel 包执行 `npm run dist:mac -- x64`。Android 使用 Java 21、SDK 36，签名材料仅保存在忽略的 `.local/` 内。CI 在 Windows、Android 和两种 Mac 架构上分别构建。

构建、自动化场景与真实设备验收分别记录于 [验证记录](docs/verification.md)。小米商店中的组件分发仍需开发者账号和平台审核；随 APK 安装的桌面组件可以从系统组件选择器添加。系统省电策略可能延迟后台课程边界刷新，组件曝光或手动打开应用时会重新计算。

## 来源

保留 Clearlist 的 Git 历史、任务持久化与 API 并发契约，保留 Open Timelog 完整时间记录领域实现和交互；二者统一到同一份可验证状态。本项目没有使用原版 Todo清单、UpTimer 或小米应用的专有代码、素材、账户或数据库。

[许可证](LICENSE) · [来源说明](THIRD_PARTY_NOTICES.md)
