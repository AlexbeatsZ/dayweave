# Dayweave Server：独立发行与原 profile 接管

## 范围和所有者

Server `0.1.0` 与客户端 `0.4.10` 独立版本/发行；它复用 `electron/headless-runtime.ts` 的初始化和关闭路径，底层仍是 FileStore → StateService → DesktopSync、UsageStore → DesktopUsage、startApi。业务写入、计时截止、同步合并和 usage 接收不建立第二个实现或文件同步库。原 `electron/headless.ts` / AI-tools 入口继续默认遵循桌面采集设置，保留环境变量、`--invite` 和默认 profile。

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

## 本机管理与迁移

新增管理端点继续放在已有 startApi 的 Host/Origin/Bearer保护之后。status只派生现有所有者的计数/健康，不保存管理状态。设备撤销复用 DesktopSync.revoke，不删除历史。邀请复用原有效期和单次密钥；只有显式 invite命令输出密钥。服务器status/usage/shutdown只在server模式安装。

stage-update.mjs 不停止/启动进程或写计划任务：先验证路径隔离和包结构，获取原profile锁，复制完整已停止profile和WAL到显式恢复目录，复制候选到current的同级stage，rename旧程序到恢复目录再切换current。失败时尽量恢复旧程序；无任何业务profile覆盖。配置保持current外。脚本输出activated=false。任务/账户/防火墙/网关变动由部署方另行处理；完整步骤见 server/README.md。

## 验证边界

隔离测试覆盖原备份恢复、跨进程profile互斥、保留身份/密钥/序号/冲突/令牌/原采集设置、API任务与计时截止、两客户端业务与usage加密交换、设备撤销、真实正常退出/重启、强制崩溃及非空WAL恢复、来源失败时继续交换、停止排空和离线更新脚本。所有合成数据仅在临时.agents。

共享API/计时/同步/usage回归与原AI-tools烟测单独执行。未部署ROG，不将隔离测试等同于生产数据、真实客户端公网、未登录开机或资源收益验收。
