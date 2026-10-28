# ROG 公网同步入口

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

普通域名 TLS 校验、HTTPS 订阅健康检查及 8 个原订阅的逐字节比较通过。公网 `/dayweave/sync` 拒绝未认证请求，未知自动路径返回 404。真实已配对 OMEN 保持身份和两个原有冲突，通过公网 HTTPS 完成手动协议交换与自动记录交换。

记录大批历史同步、原生新增采集、离线/重启及其他设备安装的结果分别写入项目日志；不能用网关连通替代物理设备验收。
