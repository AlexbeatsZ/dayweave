# ROG 公网同步入口

## Vultr 标准 HTTPS 443 日历入口

2026-11-16 新增 `https://45.77.68.130/dayweave` 作为日历订阅中心基址。该入口仅处理上述精确只读 ICS 路径，不是客户端业务同步地址。原 Sakura 63573 网关与已有 Google/Apple 链接保持可用；Outlook 从 Web 订阅已添加成功。更换入口同时改变了公网节点与端口，不能据此断言原故障只由端口造成。

Vultr Debian 13 上 HAProxy 拥有公网 TCP 443，以 TLS ClientHello SNI 将 `www.cloudflare.com` 原样交给原 Xray REALITY 的回环 7443，其他 TLS 进入回环 8443 的日历后端。日历后端验证 IP SAN 证书，允许 GET/HEAD、拒绝查询串及其他路径和方法，再通过已校验的 HTTPS 回源原 Sakura63573。原代理客户端凭据与服务器密钥不变，访客端口/UDP443不变。用户批准安装 HAProxy/python3-venv 并开放 TCP80；80仅供 ACME HTTP-01。

短期 Let's Encrypt IP 证书约160小时有效，不能按90天管理。`dayweave-ics443-renew.timer` 每天两次检查；hook 验证配置后 reload HAProxy，失败恢复前一张 PEM。运维源码、服务和恢复规则在 `ops/calendar-https443/README.md`。服务器工作目录 `/opt/dayweave-ics443`，原配置位于 `recovery/xray-config.json`，包含密钥，禁止上传整个目录。独立切换单元带90秒运行上限与120秒回滚计时器，真实原代理与日历校验通过后写入完成标记。生产切换已完成，不要再次运行首次安装/切换脚本。

当前入口仍依赖 Sakura 隧道和原 ROG 中心在线。Microsoft、Google 的服务端拉取节奏由各自决定，首次显示不代表长期修改/删除刷新已经验收。

## 账号日历授权回调

2026-11-14 曾增加的 `/dayweave/calendar-accounts` 与 `/dayweave/calendar-oauth/callback` 已于 2026-11-16 随账号连接功能从源码移除；已部署网关在下次更新 Dayweave 模块前仍保留这两条路由，中心已不再响应。日历只保留 `/dayweave/calendar/<密钥>.ics` 只读转发。

## 安排重构的日程订阅接口

精确 `GET/HEAD /dayweave/calendar/<64位十六进制密钥>.ics` 转发至中心 `49732/calendar/<密钥>.ics`。中心核对可撤销日历密钥后只输出 Event ICS。网关拒绝其他方法、查询串和不匹配的自动路径，原同步路由继续要求 POST。该 ICS 路由已随 0.5.9 与 Server 0.2.6 交付，Google/Outlook/Apple 使用用户复制的 HTTPS 订阅链接。实际公网账户订阅验收单独记录。数据与映射契约见 arrangements.md。

## OMEN 文件 MCP

`/omen-files/mcp` 和精确 OAuth 路由转发至 ROG 回环 18784。OMEN 使用既有 SSH 连接将该回环端口转发至本机文件服务。认证、目录授权和文件读取均由 OMEN 的独立服务负责。网关拒绝该命名空间未明确登记的路径，请求体限制为 1 MiB。AI Decision 拥有独立的回环 18783。2026-11-21 已在原 ROG 任务下验证这两条公网 MCP 路径的未授权响应均为 401，新路由的 OAuth 元数据为 200。

## 2026-11-08 AI Decision MCP

复用当前 Web 隧道的 HTTPS 入口，固定将 `/ai-decision/mcp` 转发到回环 `18783/mcp`，并转发该命名空间的 authorize/token/register/revoke/consent 与 OAuth 发现元数据。参数查询串和 OAuth/MCP 请求头原样保留，未列出的 `/ai-decision` 路径返回404，请求体限制1MiB。只有经过独立 MCP OAuth 验证的调用才能访问原业务工具；没有路由到 decisiond 的8766端口。

当前 `DayweaveHttpsGateway` 任务入口为 ROG `webobsidian-sync/sync-server/shared-gateway.mjs`，传入现有 Dayweave 网关模块和 Mojian 路由模块。WebObsidian 与 Mojian 由包装器转发，Dayweave 模块处理同步、MCP 和订阅路由。2026-11-11 KeePass 退役后，旧入口仍读取已经移除的私有配置，导致重启时整个网关退出。恢复时只替换原任务的 Action，保留 SYSTEM 开机触发器。网关源码作为独立 https-gateway 发行。

## 现场拓扑与所有者

2026-10-28：Sakura 账户允许两条隧道，现有 Web 与 Tailscale 已用满。不新增隧道、不购买额度，也不改 Tailscale 的服务、节点、端口或启动目标。

- Web `29675319`：节点 85，自动 HTTPS，公网 TCP 63573，仍指向 ROG `127.0.0.1:18781`。
- Tailscale `29674979`：节点 202，UDP 45278，仍指向 `127.0.0.1:40000`；由原 `SakuraFrpService` 管理。
- 公网同步地址：`https://cdn.u3146344.nyat.app:63573/dayweave`。客户端只更换同一中心的 endpoint，保留 deviceId、hubId、密钥、序号、基线与冲突。

`scripts/sync-gateway.mjs` 是固定路由的 loopback 网关，不拥有配对密钥、业务数据或订阅文件。运行副本在 ROG 的 `C:/Users/Meta/Project/Workspaces/dayweave/.local/https-gateway/`；独立 SYSTEM 启动任务 `DayweaveHttpsGateway` 使用现有 Node 运行它。

| 公网请求                    | 本机目标                                 |
| --------------------------- | ---------------------------------------- |
| 精确 `POST /dayweave/pair`  | `127.0.0.1:49732/pair`                   |
| 精确 `POST /dayweave/sync`  | `127.0.0.1:49732/sync`                   |
| 精确 `POST /dayweave/usage` | `127.0.0.1:49732/usage`                  |
| 其他非 `/dayweave` 请求     | 原订阅发布器 `127.0.0.1:18782`，路径不变 |

`/dayweave` 下其他路径、查询串及带 Origin 的同步请求拒绝；不开放 loopback AI API。只转发固定 loopback 目标，移除逐跳头，限制请求体与超时；不解密业务载荷，不记录请求路径、密钥、标题或订阅内容。认证、邀请有效期、防重放及自动事件所有权仍由 Dayweave 中心负责。没有部署独立的公网速率限制或抗攻击设施。

## 订阅兼容与启动

原 `Meta-Subscription-Distributor` 仍拥有订阅发布及独立 Web frpc 子进程。只修改该任务的 Node 启动参数：通过 `--import file:///C:/Users/Meta/Project/Workspaces/dayweave/.local/https-gateway/subscription-port.mjs` 将本进程 `SUBSCRIPTION_PORT` 设为 `18782`，然后运行原 `server.mjs`。不修改系统环境变量、原服务器源码、订阅清单、私有文件或 frpc 凭据。Windows 的 `--import` 必须使用 file URL，不能直接传 `C:\...`。

Web frpc 原本验证并连接 18781，保持不变，前面由网关分流。发布器与网关独立启动，允许启动时顺序不同；后端短时不可用返回 502，客户端保留待同步数据并重试。原 Web 任务为切换端口短暂重启过；未重启 Tailscale 服务。

## 恢复

切换前的订阅任务 XML 保存于 ROG `%TEMP%/.agents/dayweave-https-gateway-20261028-004547/publisher-task.xml`。若需撤回网关：停止两个相关任务，只停止原发布器自己的 `tools/subscription-frpc.exe` 子进程；恢复此 XML 注册的原任务，再启动订阅任务。它会重新独占 18781。不要停止 SakuraFrpService 或其他 Node/frpc 进程。已升级客户端可将 endpoint 改回同一 ROG 的 LAN 地址，不解除配对。撤回属于后续显式操作，本轮未执行。

## 已验证与边界

2026-11-08独立网关v0.1.1已部署，仅网关进程3164→10164重启，任务Action及包装器保持；DayweaveHub42292、订阅47848、KeePass22764均未重启。Google已通过原Sakura63573完成OAuth关联、导入36工具并在Gemini读取AI Decision信息。该结果证明当前端口可用，不代表后台排程或业务写入已验收；本次没有升级Dayweave客户端/中心。

普通域名 TLS 校验、HTTPS 订阅健康检查及 8 个原订阅的逐字节比较通过。公网 `/dayweave/sync` 拒绝未认证请求，未知自动路径返回 404。真实已配对 OMEN 保持身份和两个原有冲突，通过公网 HTTPS 完成手动协议交换与自动记录交换。

记录大批历史同步、原生新增采集、离线/重启及其他设备安装的结果分别写入项目日志；不能用网关连通替代物理设备验收。
