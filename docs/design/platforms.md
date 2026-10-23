# 多平台与主题

## 共用产品逻辑

React / TypeScript 负责任务、日期、重复、活动计时、课程、统计和 v1 JSON 格式。Windows 和 macOS 使用 Electron，Android 使用 Capacitor 加载随 APK 打包的静态页面，不依赖远程网页。各端使用同一个响应式应用壳和页面树；宽度超过 700 px 时左侧栏常驻且不折叠，主导航、上下文分类与设置始终显示；较窄时使用底部导航与抽屉，跨断点不丢失页面、计时或草稿。各端保留离线数据；配对 ROG 后通过局域网加密同步，协议和冲突处理见 sync.md。Android 当前只在前台/恢复前台时同步。

## Android

- 包名固定 `org.dayweave.mobile`，Android 私有文件目录保存数据。自有 Capacitor 插件只接受预设文件名，不向网页暴露任意文件路径。
- 原生 `AtomicFile` 完成临时文件同步和替换；JavaScript 用共用 Zod 格式校验主文件、备份和导入内容。上一份有效快照作为独立备份，损坏文件保留再恢复。只有主文件和备份都不存在时才创建空状态。
- JSON 导入导出使用系统文件选择器，不申请全盘存储权限，不启动其他应用发送内容。文件读取限制为 50 MB。取消选择器是正常结果。
- 700 px 及以下使用手机布局：待办/记录/安排/统计一条底部导航，各模块包含可点击/滑动的子页，分类从左侧抽屉进入。新建和编辑共用底部面板，PC 以相同表单居中呈现。返回键先关闭最顶层弹窗，再关闭编辑，再返回日计划或将应用切到后台。具体交互见 mobile-interface.md。
- 签名私钥与密码仅存放在被忽略的 `.local/` 中，不进入 Git、源码包或 Release。公开安装包使用稳定签名以支持覆盖升级。

## macOS

- 使用固定 bundle ID `org.dayweave.desktop`，数据保存到 `app.getPath('appData')/Dayweave`，遵循当前用户的系统目录。
- 保留原生菜单及 Cmd+Q、Cmd+W、复制粘贴、最小化等行为；关闭最后一个窗口后应用保留在 Dock，点击 Dock 可重新打开窗口。
- Apple Silicon 与 Intel 分别构建 DMG / ZIP；没有 Developer ID 时提供 ad-hoc 签名并明确未公证。构建验证与真实 Mac 运行、下载后的 Gatekeeper 体验分别报告。
- 运行时最低 macOS 13，与 Electron 44 的支持范围一致，不能只修改 Info.plist 来宣称支持更旧系统。

## 托盘启动

桌面以 `--tray` 启动时创建隐藏主窗口和系统托盘，后台 API/同步继续运行。点击托盘或不带 `--tray` 的第二次启动可显示窗口；关闭窗口先完成保存，再隐藏回托盘。托盘提供打开、设置与配对、立即同步及显式退出。普通启动保留原平台关闭行为。Windows 登录任务直接指向稳定安装路径的 `Dayweave.exe --tray`，使用当前用户交互会话和最低权限，不启动可见终端。

## 暗色与触摸

- 单一主题偏好仍为 light / dark / system；把解析与应用集中到独立模块，启动时先应用上次主题，数据加载后使用真实设置。系统跟随模式持续响应变化。
- CSS 原生颜色方案、输入控件、浏览器主题色、Electron nativeTheme 与 Android 系统栏统一更新。暗色使用低亮度背景和独立的表面层次，避免浅色闪屏。
- 普通容器使用中性灰阶，暗色正文白/浅灰，冰蓝色只突出操作与选中状态。预加载/桌面/WebView/启动屏的底色保持一致；原生组件共用中性灰与冰蓝资源。具体色值与分工见 mobile-interface.md。
- 手机界面遵守 safe-area 和动态视口；输入至少 16 px，主要点击区域至少 44 px。桌面侧栏常驻；手机通过抽屉访问当前模块的清单/活动与标签。各颜色与映射走统一状态，不能复制一份桌面配置。

## Dayweave 课程组件

CourseWidgetProvider / CompactCourseWidgetProvider 放在 :widgetProvider。主进程每次持久化后生成只含 schedule 的小快照，组件只读快照并用 CourseSchedule/java.time 计算实例，不加载 React/Capacitor。组件刷新遵循 Android 与小米官方规范（https://dev.mi.com/xiaomihyperos/documentation/detail?pId=1584）。不申请精确闹钟权限；后台省电可能延迟边界刷新，曝光、写入与打开应用会刷新。

侧载 APK 使用标准 Android provider 注册，不设置小米商店的 miuiWidget/miuiWidgetVersion 标记。Pad 6 Pro 实测可在「小组件 → 安卓小部件 → 时织」找到并添加；之前带商店标记时在已检查的选择器中不可见。保留独立进程与曝光事件兼容。requestPinAppWidget 返回成功但未显示确认，因此界面始终提供手动路径。组件用 values/values-night 共用灰阶与冰蓝资源，内容垂直居中，较高的平板单元格放大标题和倒计时。
