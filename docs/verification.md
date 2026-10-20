# 验证记录

## Dayweave 0.3.0 当前检查

日期：2026-10-20（America/New_York）。自动检查使用隔离 profile 或浏览器上下文；真机联动使用明确标记的测试课程/记录，结束后清理。

- 49 项领域、持久化、API 与同步测试通过；加密真实双客户端离线合并、跨设备停止、并发开始、重放/撤销、请求期间编辑均覆盖。包括 UTC−4/UTC+8 跨日、IANA 夏令时 23/25 小时日界线、单双周/停课、CSV/ICS 重复与移动课程、旧备份迁移、任务关联计时及模块并发冲突。
- 11 组浏览器桌面与手机流程通过。固定设备纽约时区并冻结到 2026-09-06T23:30Z，北京时间周一 08:00 课程正确显示为设备周日 20:00，并倒计时 30 分钟。
- Windows 真实 Electron UI/API/CLI、界面/API 字段合并、关闭刷新落盘、重启、损坏主文件恢复通过。
- 独立 Node API 包无 npm 运行依赖；启动、Bearer、CLI、任务持久化、上下文及第二个进程拒绝占用同一 profile 均通过。
- 新项目独立身份与数据目录；原 Clearlist/Open Timelog 仓库与 profiles 均未写入。
- Android assembleRelease、lintRelease 和 3 项 Java 课程计算测试通过；已用稳定密钥签名并安装 Redmi K70 / Android 16 与 Pad 6 Pro / Android 15，已查看实际界面。记录页绿色主题已改为共用蓝灰变量，系统主题切换检查通过。
- 最终源码 59c254a 的 [四平台 CI](https://github.com/AlexbeatsZ/dayweave/actions/runs/39471586657) 全通过：Windows、Android、macOS arm64 和 Intel。桌面两平台均执行隐藏启动/唤出/关闭回托盘/API 持久化检查；Windows 最终便携包和两种 Mac 最终 app API 通过。实际 Apple Silicon Mac 桌面/打包应用 API 与恢复、DMG 和签名基线检查另已通过。
- 实体 ROG、Redmi K70、Pad 6 Pro 完成单次邀请配对。手机开始 Learning 计时，平板约两秒后读到同一 ID；平板停止保存后，ROG 中相同 ID 补上 endAt，手机停止运行显示，记录总长 16.333 秒。课程通过 ROG API 创建后在两台移动设备出现；手机纽约时区显示北京时间跨日课程与设备时间。
- Windows 源码运行时和最终 win-unpacked 程序均通过托盘检查：启动窗口隐藏、第二次普通启动显示、关闭后隐藏、API 继续工作且编辑已落盘。ROG 已将原无界面中心迁移到实际桌面默认 profile，DayweaveHub 当前用户登录任务直接启动 --tray，任务为 Running，全部 Dayweave 主窗口句柄为 0，原有配对/加密密钥保留。仅更新用户已批准的两条规则至专用桌面进程。没有重启或注销系统。
- Pad 6 Pro / Android 15 从「小组件 → 安卓小部件 → 时织」添加 4×2 和 2×2 原生组件成功，均显示同步后的当前/下一节课、日期/教室/时区与一致倒计时；点击打开课程表通过。APK 覆盖更新后组件恢复且深色资源正确。测试组件放在新桌面页，原有平板组件保留。用户要求手机继续使用后，停止全部手机操作。
- 用户随后要求更新手机；最终签名 APK 已覆盖安装到手机与平板，保留数据/配对。手机此次仅执行安装与包版本读取，没有打开界面或操作桌面。两次课程和一条计时测试数据均已清理；平板组件继续保留。ROG 最终桌面包已替换并恢复同一任务/profile，隐藏窗口和 AI/sync 接口再次通过。

### 公开发布

[v0.3.0](https://github.com/AlexbeatsZ/dayweave/releases/tag/v0.3.0) 已公开，非草稿、非预发布，标签与最终四平台 CI 指向同一完整提交 59c254ae63c0e32259dfcb7eb121e3c601a7754d。13 个附件的名称、uploaded 状态和大小逐一匹配本地；源码 ZIP 由该提交 git archive 生成。独立 AI 目录重新打包为 ZIP，许可文本使用当前依赖版本重新汇总，避免复用旧归档。安装包和中文使用说明已复制到本轮 outputs。

未验收：手机组件添加；小米商店组件分发/曝光专用路径；锁屏、系统重启和长期后台；实际 LAN 的 mDNS 自动发现（地址配对与加密同步已通过）；下载后的 Gatekeeper；用户实体 Intel Mac；现有 ROG AI 系统实际接入。Android 网络同步仅前台/恢复时运行。macOS 使用 ad-hoc 签名，未 Apple 公证；Windows 未商业代码签名。

以下为 Clearlist 来源历史，不代表 Dayweave 同版本验收。

## 0.2.0 本地检查

日期：2026-10-19。Windows 11 x64 / Node 24.14.1 / Electron 44.9.0，手机触摸场景使用 390 × 844 的隔离 Edge 上下文。

- 30 项自动测试通过：保留原有 17 项领域与文件存储测试，新增 API 认证、Origin/Host 拒绝、任务/清单 CRUD、分页搜索、严格输入、ETag 过期冲突、字段合并与冲突、重复完成幂等、专注动作、导入导出、失败写入不广播、Android 存储恢复与主题解析。
- 真实 Electron 进程检查通过：关闭前保存、重启读回、损坏备份恢复、上下文隔离和沙箱。
- 真实 UI/API/CLI 联动通过：AI 创建任务出现在界面，API 修改优先级与标题反映到已打开详情，界面备注从 API 读回，同时修改不同字段均保留；完成和暗色设置传播到 UI，最终文件内容正确。
- 手机浏览器触摸检查通过：底部导航、清单创建、全屏任务详情、备注保存、主题记忆、日历、无横向溢出，以及系统外观变化和手动偏好覆盖。
- 已生成并查看暗色桌面和手机界面截图，控制台无脚本错误。

### 平台构建与运行

[GitHub Actions 39362864928](https://github.com/AlexbeatsZ/clearlist/actions/runs/39362864928) 在同一代码提交 `9e8f010` 上全部通过：Windows、Android、macOS arm64 和 macOS Intel 四个 job 均成功。

| 平台        | 已完成检查                                                                                                                                                                                       | 实际边界                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Windows x64 | 生产构建、30 项测试、7 组浏览器流程、桌面恢复、UI/API/CLI、最终便携 EXE 启动写入关闭；本机和 CI 均通过                                                                                           | 未替代用户长期工作流体验                                             |
| macOS arm64 | CI 和实体 Mac 的桌面恢复、UI/API/CLI；最终 `.app` 的 API 联动、关闭窗口后 API 继续可用、activate 重开后主题保留；本机 codesign strict/deep 与 DMG 校验通过                                       | 未人工验收浏览器下载后的 Gatekeeper；包仅 ad-hoc 签名、未公证        |
| macOS Intel | Intel runner 上原生构建、30 项测试、桌面恢复、UI/API/CLI、最终 `.app` 联动与关闭重开，DMG/ZIP 生成并上传                                                                                         | 未在用户实体 Intel Mac 上验收                                        |
| Android     | Linux CI 编译 release APK、原生 Java 与资源、lint 通过；本机使用稳定私钥签名，apksigner v2/v3 验证通过；包名 `org.clearlist.mobile`、versionCode 2、versionName 0.2.0、min SDK 24、target SDK 36 | 未安装到实体手机，原生返回键、系统栏、文件选择器和后台行为未人工验收 |

实体 Mac 环境为 macOS 26.6.2 / Apple Silicon / Node 26.11.1。所有检查使用临时隔离数据，未读取原 Todo清单或个人任务。Android 当前没有连接的实体设备或现成模拟器镜像。

本机 Windows Gradle 构建曾遇到缓存元数据损坏及临时工作区重命名失败；项目支持独立 Gradle 缓存，最终发布 APK 从上述同源 CI 的未签名 release 构建取得，在本机签名。首轮签名凭据未完整落盘且从未发布，其材料保留在忽略的隔离目录；当前密钥和凭据已配对验证，未来升级须保留 `.local/android-signing/`，不公开上传。

### 公开发布

[v0.2.0](https://github.com/AlexbeatsZ/clearlist/releases/tag/v0.2.0) 已公开发布，非草稿、非预发布，标签指向 `9e8f01050fe77bb26d9aee5e6090085dd955dd5b`。九个附件均为 uploaded，远端文件名与大小逐一匹配本地：Windows EXE、Android APK、Mac 两个架构各自 DMG/ZIP、源码 ZIP、独立 API 客户端与 OpenAPI JSON。源码包使用该标签对应的 Git 文件生成，不包含 `.local/`、签名私钥、个人数据或依赖缓存。

从云端下载的最终 Windows EXE 在本机再次完成启动、创建任务落盘和关闭检查。四个平台安装包、API 文件、截图及中文快速使用说明也已复制到本次任务的 `outputs/` 交付目录。

## 0.1.0 历史记录

日期：2026-10-19。Windows 11 x64（系统报告构建 26300）、Node.js 24.14.1、Electron 44.9.0。浏览器工作流在本机 Edge 的隔离上下文中运行。

## 已通过

| 层级               | 检查内容                                                                                                                                                                                      | 结果         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 静态检查           | TypeScript 渲染器与 Electron 主进程                                                                                                                                                           | 通过         |
| 数据逻辑与文件存储 | 17 项测试：本地日期、闰年、月底重复锚点、重复生成去重、筛选与搜索、四象限、合并导入、非法数据拒绝、计时结算、真实统计、并发保存、损坏备份恢复和手动恢复                                       | 17 / 17 通过 |
| 浏览器工作流       | 清单创建、任务与子任务编辑、重复完成、回收站恢复、重载保存；JSON 导入去重与无效输入保护及导出；专注暂停恢复与结算去重；日历拖动改期与删除清单保留任务；全部视图、主题记忆与 390 px 布局和搜索 | 5 / 5 通过   |
| 真实桌面进程       | 在隔离目录中启动 Electron，检查进程隔离与沙箱，写文件，编辑后直接关闭窗口，重启读回，损坏主文件后自动恢复并保留原文件                                                                         | 通过         |
| 构建               | Vite 生产构建、Electron TypeScript 编译和 Windows x64 便携打包                                                                                                                                | 通过         |
| 视觉查看           | 今天、任务详情、四象限、月历与深色专注截图                                                                                                                                                    | 已查看       |
| 生产依赖           | `npm audit --omit=dev`                                                                                                                                                                        | 0 项通报     |

桌面检查使用 `%TEMP%\.agents\clearlist-*` 下的全新数据；测试结束后删除该临时目录。测试和截图未读取个人任务。

对 `release/win-unpacked/Clearlist.exe` 也运行了同一套桌面隔离检查并通过，产品名与 0.1.0 版本信息正确。

最终单文件 `Clearlist-0.1.0-Windows-x64.exe` 已通过独立启动检查：便携解压后显示主界面，创建任务写入指定隔离目录，关闭窗口后启动器以 0 退出。测试期间通过临时调试端口连接，结束后关闭并清理；正常启动不启用该端口。

## 实现边界

- 浏览器工作流覆盖实际 UI 操作；桌面进程检查覆盖真实文件读写和窗口关闭，但不等同于用户长期使用验收。
- 尚未在另一台实体 Windows 设备上运行；未验证 macOS、Linux、Android 或 iOS 安装包。
- 专注计时的跨重载由自动化时钟推进验证。真实长时间睡眠、跨系统时间调整和 Windows 通知显示仍待实际使用反馈。
- 原生导入导出使用 Electron 文件选择器；JSON 的校验与合并、浏览器文件输入和导出内容经过自动检查，原生选择器的人工操作尚未验收。
- 便携版没有代码签名。源码与 v0.1.0 已公开发布到 [GitHub](https://github.com/AlexbeatsZ/clearlist)，云端检查记录见 [Actions](https://github.com/AlexbeatsZ/clearlist/actions)。
- 项目完整开发依赖审计报告 8 个 moderate 项，沿 electron-builder 的下载与日志依赖链传播，根项为 sprintf-js 的格式化拒绝服务通报。本次未强制降级打包工具；生产 Node 依赖审计为 0。这是依赖通报的范围说明，不代表已对整套软件完成安全审计。

## GitHub 首次发布

2026-10-19 创建公开仓库 `AlexbeatsZ/clearlist`，配置 HTTPS `origin` 和 `main` 上游分支，发布 [v0.1.0](https://github.com/AlexbeatsZ/clearlist/releases/tag/v0.1.0) 及 Windows x64 便携程序、源码压缩包。仓库与 Windows 下载链接均通过未登录 HTTP 200 检查。

首个云端运行在桌面测试读取首份数据文件时抛出 ENOENT。`main` 中的 `e8242fb` 已修正测试等待逻辑，仅把文件尚不存在视为未就绪；产品持久化代码未改变。[运行 39350266827](https://github.com/AlexbeatsZ/clearlist/actions/runs/39350266827) 全部通过，覆盖依赖安装、格式、17 项领域与存储测试、生产构建、5 组浏览器工作流、真实桌面进程、便携打包、最终 EXE 检查和构建产物上传。`v0.1.0` 标签保持首版发布提交，未改写已发布历史。

## 本地复现

electron-builder 的默认运行时解压流程在本机连续出现最终目录重命名 EPERM。空闲时同目录移动可成功，具体句柄占用来源未确认；打包脚本改用其支持的 `electronDist` 配置复用项目已准备的 Electron 运行时，绕过重复解压步骤，已构建出带正确图标和版本信息的桌面宿主。

```powershell
npm ci
npm run format:check
npm test
npm run test:e2e
npm run test:desktop
npm run dist:win
npm run test:portable
```

检查已打包的桌面宿主时，可在项目目录运行：

```powershell
$env:CLEARLIST_EXECUTABLE = "$PWD\release\win-unpacked\Clearlist.exe"
node scripts/smoke-desktop.mjs
Remove-Item Env:CLEARLIST_EXECUTABLE
```
