# 0.2 平台与本机 API

## 主题

颜色由 `src/styles.css` 中的语义变量统一提供，浅色与暗色共用组件规则。
偏好为跟随系统、浅色、暗色，保存在当前设备的 `open-timelog-theme`，不改变 v1
备份的业务 schema。`public/theme.js` 在首屏样式之前读取偏好，React 接管后监听系统变化。
Electron 原生外观接收偏好而非最终颜色，防止将系统模式锁死为一次解析结果。

## Android

Capacitor 8 承载同一套业务 UI，应用 ID `io.github.alexbeatsz.opentimelog`，
API 24+，固定本地来源 `https://localhost`。不注册 PWA Service Worker，Web 资源
直接打包；存储仍为应用独立的 IndexedDB。后台不依赖 JS tick，返回前台会重读数据。
暂不提供前台服务或持续通知，不能声称系统强停后自动恢复运行；重开后按时间戳恢复。

自定义 TimelogFiles 插件通过 Android Storage Access Framework 选择读写文件，
不申请存储目录权限。单次文件选择互斥、读取上限 10 MiB。取消备份时中止导入，
选择器打开期间如果 UI/API 写入业务数据，恢复事务拒绝覆盖，要求重新预览。
原生窗口使用 system bars/cutout/IME insets，避免底部导航和键盘覆盖。
关闭系统自动备份以免上传私人记录，迁移使用手动 JSON。

项目签名材料存于忽略目录 `.local/`，不进入源码、GitHub Release、构建日志或网页包。
没有配置签名时不得将 unsigned APK 当作可安装发行版。后续更新保持同一应用 ID 和签名。

## macOS

Electron 同源桌面壳分别打包 arm64 / x64，固定 bundle ID。
`.app` 由 macOS 的 codesign 做 ad-hoc 签名，并以 `codesign --verify --deep --strict`
检查；这不是 Developer ID 签名或公证。保留 Electron 自身的框架与运行资源。
macOS 常规关闭窗口会退出本应用，进行中的计时仍然保留。真实运行验证与 Intel 构建
验证分开报告。不修改用户安全策略或自动移除 quarantine 属性。

## 本机 HTTP API

Windows / macOS 桌面应用启动后监听 127.0.0.1，优先端口 43127，冲突则选择空闲端口。
用户数据目录中的 `api.json` 记录真实地址、稳定随机令牌和 PID；文件仅本机使用。
启动失败不阻止普通 UI。手机和网页当前不启动 HTTP 服务。

每次请求使用 Bearer 认证；拒绝带 Origin 的浏览器跨站请求和非本机 Host。只允许
GET / POST / PATCH / DELETE，请求体上限 1 MiB，不提供任意脚本、文件路径或 shell 执行。
主进程验证 IPC 的 WebContents、顶层 frame 和本地 URL；preload 仅开放固定桥接方法。
渲染进程的 `src/api.ts` 通过现有 `mutateState` 事务更新数据，不绕过领域校验。

写操作遵守：

- 编辑/删除必须携带刚读取的 `expectedUpdatedAt`，冲突 409，缺少前置条件 428。
- 对现有计时的操作须携带其 `timerId`，避免控制另一个窗口刚开始的计时。
- 支持最多 256 个进程内 `Idempotency-Key` 结果缓存，同键不同请求返回 409；
  重启后不保留缓存。需要跨重启去重时，创建记录可传入调用方稳定的 `id`。
- 超时不能保证写入没有发生；AI 应先查询当前状态，再决定是否重试。
- 删除为软删除/归档。API 不开放完整状态覆盖、奖励兑换或永久删除。

接口文档：`docs/api.md` 与 `public/openapi.json`；CLI 不向终端打印连接令牌。
