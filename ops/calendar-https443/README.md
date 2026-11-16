# Calendar HTTPS 443 gateway 0.1.0

2026-11-16 在用户 Vultr Debian 13 VPS `45.77.68.130` 部署。此目录是该现场的运维源码，固定 IP、Xray 路径和 SNI，不是通用安装器。没有日历密钥、代理凭据或证书。无需重建 Dayweave 客户端或服务器。

## 路由

- HAProxy 监听公网 TCP 443；SNI `www.cloudflare.com` 原样转发到原 Xray REALITY 的 `127.0.0.1:7443`。
- 其他 TLS 进入回环 8443，使用 Let's Encrypt IP SAN 证书，仅允许精确 `GET/HEAD /dayweave/calendar/<64位十六进制密钥>.ics`。
- 回源原 Sakura HTTPS 63573，保留原日历生成逻辑与可撤销密钥。原同步 API、其他订阅、代理访客端口和 UDP 443 不经过这个日历后端。
- 该入口仍依赖原 Sakura 隧道与 ROG 中心在线；不是离线日历缓存。

## 首次部署顺序

仅适用于已经确认拥有该服务器、批准安装 HAProxy/python3-venv 与开放 TCP 80 的现场。**生产已完成，不要重新执行首次切换。** `install.sh` 会屏蔽 HAProxy，不能当作日常更新命令。

1. 以 root 建立 `/opt/dayweave-ics443`（0700），子目录 `recovery`、`tls`、`acme`。备份原 `/etc/vps-vless-fallback/config.json` 为 `recovery/xray-config.json`；保存原服务与防火墙状态。所有包含凭据的文件保持 0600。
2. 上传本目录源码。运行 `install.sh`。仅增加本机公网 IP 的 TCP 80 入站供 HTTP-01 验证；已有 TCP 443 保留。运行 `certificate.sh`，先 staging dry-run，再正式签发。
3. 从原 Xray JSON 生成私有 `xray-candidate.json`，只将 tag 为 `vless-fallback-in` 的入站改为 `listen=127.0.0.1, port=7443`，其余字段原样保留。将用户现有订阅的路径写入私有 `feed-path`，格式为 `/dayweave/calendar/<密钥>.ics`，不要把真实值提交到 Git。
4. 在回环 9443 启动临时 HAProxy 配置，保留原公网 443 所有者；校验 HAProxy/Xray 配置，通过 `probe.py` 的原 REALITY 连接；用 curl `--connect-to 45.77.68.130:443:127.0.0.1:9443` 在保持 IP SAN 校验的情况下完成日历读取、原文比较及拒绝路径预检。完成后停止预检进程，创建 `preflight.complete`。
5. 用独立 systemd 单元运行 `cutover.sh`，RuntimeMaxSec=90s，标准输出与错误写入 root 目录的 `cutover.log`。它先注册独立 120 秒回滚计时器，再切换原 Xray 与 HAProxy，真实代理和日历检查全部通过后才写 `cutover.complete` 并取消计时器。控制端会因代理短暂重启断开，脚本仍独立完成。
6. 将 `renew.service`、`renew.timer` 分别安装为 `/etc/systemd/system/dayweave-ics443-renew.service`、同名 timer，daemon-reload 后 enable --now timer。`renew-hook.sh` 必须可执行。使用与服务相同目录参数运行 Certbot `renew --dry-run --run-deploy-hooks` 验证。

## 日常状态与恢复

`systemctl is-active haproxy vps-vless-fallback dayweave-ics443-renew.timer`；切换结果在 `cutover.result`。`probe.py` 验证真正的原 REALITY 公网连接，临时 SOCKS 仅监听回环且运行结束删除临时凭据。`verify-calendar.py` 比较原入口和新入口 ICS，并检查路径、查询串与写入方法拒绝规则，不打印密钥或日程正文。

证书为短期 IP 证书，自动续期是必要运行条件。timer 每天 00:00/12:00 加最多一小时随机延迟。hook 原子替换组合 PEM，验证配置后 reload HAProxy，失败恢复原 PEM。无需重启 Xray。首次证书有效期约 160 小时，不能按普通 90 天证书管理。

自动回滚脚本在存在 `cutover.complete` 时不执行。确需人工撤回时，先保存并移走该标记，再运行 `rollback.sh`：停止/禁用 HAProxy、恢复原 Xray 配置并启动原服务。这会短暂中断当前代理连接，必须通过独立服务器脚本执行，不能依赖控制端始终在线。撤回后 Google/Apple 的原 Sakura 订阅仍可用，新 IP 443 订阅需恢复入口。

不要发布服务器目录的整体压缩包：它包含 feed-path、Xray 密钥、ACME 账号和私钥。发行包仅包含本仓库此目录源码。
