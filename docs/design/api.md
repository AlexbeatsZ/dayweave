# AI REST API 与并发

Windows / macOS 桌面进程提供 `http://127.0.0.1:<port>/api/v1`，默认端口 49731。端口被占用时选择空闲端口，并将实际地址写入用户数据目录 `api.json`。`DAYWEAVE_API_PORT` 可为当前进程指定端口；`DAYWEAVE_API_DISABLE=1` 可关闭接口。移动端暂不运行 HTTP 服务。

每个数据目录生成独立随机令牌，保存为仅当前用户可读的 `api.json`，不进入 Git 或导出备份。请求使用 `Authorization: Bearer <token>`。所有端点均需认证；拒绝带 Origin 的跨站请求，校验 Host，固定监听 loopback，不提供 CORS 或远程代码执行。令牌可在设置中查看和复制供本机 AI 使用。

`electron/state-service.ts` 是桌面的唯一内存状态和写入队列，UI 与 API 都在持久化成功后提交修改并广播。UI 发送字段级增量，按变更前值做并发检查：修改不同字段可合并；同一字段冲突则拒绝，保留未保存的 UI 内容以供导出，禁止静默覆盖。API 写请求可使用 `If-Match` 指定响应中的 ETag；过期版本返回 409。

任务默认软删除；完成与恢复使用显式幂等动作。重复任务由共用领域逻辑生成下一次。禁止通过普通 PATCH 改写身份、创建时间、完成时间和重复链；这些由专门动作管理。导入使用现有合并规则。整个事务必须通过 Zod 格式与引用校验。

OpenAPI 文档由 `src/api-contract.ts` 生成到 `docs/api/openapi.json`，运行服务也通过 `/openapi.json` 返回同一份文档。命令行客户端默认从当前平台的用户数据目录读取地址和令牌，不输出令牌。

`/health` 从运行包元数据读取真实版本。独立服务器的 version 为服务器版本、appVersion 为共享客户端领域版本，并携带 mode=server/sourceCommit。服务器扩展受认证的 `/server/status`、`/usage/status`、`/server/shutdown`，撤销设备用 `DELETE /sync/peers/{id}` 调用原 revoke；其余完整业务API不变。服务器端口冲突失败，桌面保持原空闲端口回退；管理与CLI的具体契约见 `server/README.md` 和 `server.md`。

0.3 新增 /context、/schedule/_、/timelog/_ 与 /tasks/{id}/track。ROG 独立服务使用相同状态队列和 profile 进程锁；见 docs/api/README.md。
