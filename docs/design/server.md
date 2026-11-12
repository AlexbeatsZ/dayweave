# Dayweave Server：独立发行与原 profile 接管

## 范围和所有者

Server `0.2.2` 与客户端 `0.5.4` 独立版本/发行；它复用 `electron/headless-runtime.ts` 的初始化和关闭路径，底层仍是 FileStore → StateService → DesktopSync、UsageStore → DesktopUsage、startApi。业务写入、计时截止、同步合并和 usage 接收不建立第二个实现或文件同步库。原 `electron/headless.ts` / AI-tools 入口继续默认遵循桌面采集设置，保留环境变量、`--invite` 和默认 profile。0.2.2只增加 OpenAPI2.1.0 任务/计时关联及预存任务ID能力，沿用状态/协议2，与已安装0.5.4客户端兼容，不要求本轮GUI升级；历史版本验收保留于下文。

2026-11-06用户在AI Decision协调对话明确授权“现在协调部署并启用”，本对话负责仅ROG原中心的构建/测试/Release及随后切换。阶段门槛：先完成新包准备，等待协调对话明确确认AI已暂停、排空后，再正常关闭原server并更新程序；不停止AI/Node/Meta/Muse/其他Docker服务，不创建源码快照，不恢复旧业务数据库。原数据恢复使用既有离线更新脚本保留当前profile，只作恢复证据而不覆盖回退。关联纯写入/并发/能力标志的详细契约见api.md；生产验收只读能力、身份、计数/原记录与健康，不拿真实任务/计时试写。

`server/package.json` 拥有服务器版本与 Node 要求。`scripts/package-server.mjs` bundle 所有非 Node 内置依赖，并附入配置读取、CLI、启动及离线更新脚本、操作手册和许可；生成元数据保留客户端领域版本、源 commit。客户端主版本、图标和平台包不随服务器发行变化。独立 `server-v*` tag，Release 使用 `--latest=false`，不改变客户端 latest；Check 工作流忽略此 tag，Server 工作流只测试 Node 服务端。

## 路径与配置

生产强制显式 profile；相对路径相对于 server.json。原 Windows `%APPDATA%\Dayweave` 原位使用，配置不随程序 current 更新。默认 `createProfile:false` 要求原 data/backup、sync.json 和 api.json 存在，然后仍由原所有者校验/恢复。原身份、密钥、序号、基线、incoming 恢复日志、冲突、usage.db/WAL/游标及令牌保留。不得把节点换成空 profile。

`hub:preserve` 保留角色和端口；显式 `hub:enable` 只允许已有规则下的开启，不解除客户端配对。initialHubPort 仅在原先无 hub 时使用。API 仍 loopback 默认49731，server 端口冲突直接失败；原桌面/AI-tools 仍允许空闲端口回退，api.json 保存实际地址供 AI 动态读取。中心49732与公网 `/dayweave` 的三个精确路由不变。

## 本机采集策略

DesktopUsage 的 `localCapture` 参数默认 true；正式 server 传 false，在设置判断和路径检查之前跳过 applyCollector。保留 SQLite 中的原采集设置，报告明确服务器禁用状态，不启动或依赖 native-bin，不把缺少二进制当配置错误。服务器包不含 collector、Electron 或 UI。

独立的15秒同步仍导入原 collector 缓存、已配置的 Work Review SQLite 和 AW 目录，并复用原 usage 交换。各来源扫描单独捕获失败；完成其他来源和远端交换后再返回聚合错误，健康接口显示逐来源最近扫描/错误/是否存在。没有新增来源写入管理API。AW文件mtime可能包含小数毫秒，而事件revision必须是整数；入口向下取整，文件签名仍保留完整mtime/大小。

## 唯一写入者、退出与恢复

共用 owner.lock 与已安装旧桌面互斥。Windows 增加基于 realpath 的内核命名管道保护同一 profile 的启动/旧锁回收，进程崩溃后自动释放；仍检查原 owner.lock PID，以兼容未升级桌面。无效锁拒绝启动并保留，不覆盖活动锁。Linux/macOS 沿用已有排他创建/PID锁，本次本地重点验证 Windows，跨平台CI单独记录。

runtime.close 幂等；API 先拒绝新管理请求并关闭listener、等待已有业务请求；同步停止调度/发现/中心listener并等待唯一串行队列；usage停止周期、等待导入/交换并关闭SQLite；StateService dispose截止调度，flush业务保存后才释放锁。启动任一步失败复用同一路径释放已经取得的资源，进程非零退出；关闭失败不假装成功释放 profile。SIGINT/SIGTERM和受认证管理停机复用该路径，Windows后台通过API停机。

`POST /server/shutdown` 的响应只确认请求受理，CLI还等待 owner.lock 释放；生产运维需确认原PID退出。CLI先核对 `/health.mode=server`，避免拿旧桌面令牌误停桌面。没有无认证停机或系统taskkill实现。旧桌面无该接口，第一次切换必须由部署方正常退出旧唯一writer；WM_CLOSE可能只是隐藏窗口，不能作为停机证据。

2026-11-11 ROG 异常重启后，Windows 将旧 owner.lock 的 PID 复用给 Memory Compression，中心沿用的 PID 存活判定因此拒绝启动。原 DayweaveHub 开机任务现在通过 `.local/server/start-with-boot-recovery.ps1` 启动原 Node、服务程序和配置。只有锁的修改时间早于本次开机，且该 PID 的当前进程明确在本次开机后启动，脚本才在重新核对锁后将它移存到 `%TEMP%\.agents\dayweave-boot-locks`。其余情况交给原服务的锁处理。用同一 S4U 账户和隔离 profile 验证了当前开机周期的锁保持、跨开机 PID 复用的锁恢复和认证停机退出 0。线上任务已用新入口重启并恢复同步，整机再次开机尚未复验。

## 本机管理与迁移

新增管理端点继续放在已有 startApi 的 Host/Origin/Bearer保护之后。status只派生现有所有者的计数/健康，不保存管理状态。设备撤销复用 DesktopSync.revoke，不删除历史。邀请复用原有效期和单次密钥；只有显式 invite命令输出密钥。服务器status/usage/shutdown只在server模式安装。

stage-update.mjs 不停止/启动进程或写计划任务：先验证路径隔离和包结构，获取原profile锁，复制完整已停止profile和WAL到显式恢复目录，复制候选到current的同级stage，rename旧程序到恢复目录再切换current。失败时尽量恢复旧程序；无任何业务profile覆盖。配置保持current外。脚本输出activated=false。任务/账户/防火墙/网关变动由部署方另行处理；完整步骤见 server/README.md。

## 验证边界

隔离测试覆盖原备份恢复、跨进程profile互斥、保留身份/密钥/序号/冲突/令牌/原采集设置、API任务与计时截止、两客户端业务与usage加密交换、设备撤销、真实正常退出/重启、强制崩溃及非空WAL恢复、来源失败时继续交换、停止排空和离线更新脚本。所有合成数据仅在临时.agents。

共享API/计时/同步/usage回归与原AI-tools烟测单独执行。本实现对话未部署ROG；父对话的生产证据在下节独立记录，不将隔离测试等同于真实客户端公网、未登录开机或资源收益验收。

0.1.1独立发行的Windows/Ubuntu CI41284031226均通过7项server集成、47项相关回归与原AI-tools smoke。100000条约200MiB合成历史在扫描/详细聚合期间health/export各30次返回，最大Windows21.0ms/Ubuntu26.5ms，停止37.7ms/141.6ms；跨周期采样仍使用1500ms阈值且不重试失败请求。正式ZIP的解压PowerShell启动、关闭stdin、不同cwd及认证stop退出0/profile释放通过。早期Windows测试发现同步夹具写锁/DELETE journal和VACUUM后的空闲连接复用干扰，最终夹具明确WAL且性能探测每次独立连接；产品实现未为测试放宽响应要求。tag server-v0.1.1和正式manifest来源为7abd5ed650ffb2f1a6efe6f3adf785f115dd97a7，Release非latest，客户端latest仍v0.4.10。

## 大历史诊断与运维约束

0.1.0 的详细 status 每次调用 UsageStore.status，执行设备分组、带 JSON 条件的记录计数和pending计数；这些同步聚合与旧来源扫描都可能占用主事件循环。`void sync()` 也不能保证其同步前缀不阻塞。健康探测只用 `/health`，请求串行并退避；详细status在就绪后单次读取，不能以两秒轮询堆积重查询。业务本身的同步调度不因此改变。

2026-10-31 本地合成100000条/214614016字节usage库，原实现status约943ms、health约25ms、停机约15ms；临时数据库已清理，只有无业务内容的基准脚本和结果保留于.local/server-0.1.1/。部署对话随后报告：同一原profile副本普通SSH启动及停机正常，status约1533ms；S4U/原Priority7任务的单次status约17031ms，但health约90ms、正常停机。此前生产反复重型探测的积压是待核查的解释，不能将慢响应直接判定为数据损坏。

微软任务Priority官方映射为6=Normal/IoPriorityNormal/Medium memory，7=BelowNormal/IoPriorityLow/Low memory；默认7。资源优先级和登录类型是不同维度，真实S4U验收需保留两者记录。父对话以Priority6完成0.1.0接管及有序重启后，18次轻量health均返回200但最大16777ms，另有8539ms峰值，证明仍有周期性同步阻塞，不能归结为探测积压或宣布性能通过。

0.1.1用更小的分页修复替代worker：Work Review每页读取200行，再由UsageStore.importMissing在原写入连接上事务提交；不再执行可能扫描完整来源的跨库NOT EXISTS/ORDER BY/LIMIT2000。每页让出I/O，每轮最多接入2000个新增事件；游标仅在当前扫描有效，重新扫描从实际首行开始，BigInt支持负数/完整64位rowid，稳定事件ID才是去重依据。WITHOUT ROWID显式报source error；其他来源和远端交换继续。collector同样分200行，仅确认已进入usage.db的本应用缓存；外部SQLite只读。AW只把事务分成200条批次，全部批次完成才写文件签名，关闭中途不推进签名。

服务器先启动API再启动后台扫描；详细usage状态由UsageStore在独立只读连接/BEGIN快照中每页256条聚合，页间让出，并发调用共享进行中读取，完成不长期缓存。设置/lastSync仍来自主owner，无第二份持久业务状态。runtime关闭前先设置停止扫描标志；API排空后，usage还要drainReads，finally关闭快照连接后才能关闭主数据库。关闭期间取消未处理页，保留已提交批次。既有桌面小型同步status路径仍兼容。

## 父部署对话的生产验收

父对话报告03:06:57Z切到server0.1.0/Meta/S4U/Session0/Priority6；03:09:17Z通过admin stop使原serverPID33268退出0，再由原应用任务启动PID47556。记录1198任务/1048手动记录、5peer、conflicts0，原deviceId/API令牌/peer密钥/序号保留；usage224002/pending0、localCapture=false、settings.enabled=true保留，collector-cache/work-review均存在无错，没有Dayweave.exe及该appcollector。

第一次Priority7候选任务因低I/O优先级和高频重型status探测出现积压/停机超时后，父对话精确停止候选、保留当前data/sync/usage.db和WAL快照并恢复旧任务；没有还原旧业务数据。先在原profile完整副本上验证普通SSH/S4U对照及正常退出，再重试生产。该恢复经过与最终正常退出分开记录，不把精确强停称为优雅退出。

父对话后来报告AI adapter实际snapshot/query及OMEN已配对密钥的Tailscale/公网usage加解密通过，0.1.0业务序号109632→109830、usage224085/pending0、5key保留；但跨周期health16.777秒峰值使最终性能验收暂缓。0.1.1由实现对话完成独立发行后，父对话先在ROG原profile副本跨周期采样，再有序升级生产。S4U/Session0运行及任务重启不等同于整机无人登录开机验收。
