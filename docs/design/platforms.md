# 多平台与主题

## 共用产品逻辑

React / TypeScript 继续负责任务、日期、重复、专注、统计和 v1 JSON 格式。Windows 和 macOS 使用 Electron，Android 使用 Capacitor 加载随 APK 打包的静态页面，不依赖远程网页。各端离线数据独立，导入导出是显式的数据交换方式，不承诺自动同步。

## Android

- 包名固定 `org.dayweave.mobile`，Android 私有文件目录保存数据。自有 Capacitor 插件只接受预设文件名，不向网页暴露任意文件路径。
- 原生 `AtomicFile` 完成临时文件同步和替换；JavaScript 用共用 Zod 格式校验主文件、备份和导入内容。上一份有效快照作为独立备份，损坏文件保留再恢复。只有主文件和备份都不存在时才创建空状态。
- JSON 导入导出使用系统文件选择器，不申请全盘存储权限，不启动其他应用发送内容。文件读取限制为 50 MB。取消选择器是正常结果。
- 底部导航和侧边抽屉适合单手操作；任务详情全屏呈现；返回键按弹窗、详情、搜索、导航抽屉的层次关闭，再返回今天或将应用切到后台。
- 签名私钥与密码仅存放在被忽略的 `.local/` 中，不进入 Git、源码包或 Release。公开安装包使用稳定签名以支持覆盖升级。

## macOS

- 使用固定 bundle ID `org.dayweave.desktop`，数据保存到 `app.getPath('appData')/Dayweave`，遵循当前用户的系统目录。
- 保留原生菜单及 Cmd+Q、Cmd+W、复制粘贴、最小化等行为；关闭最后一个窗口后应用保留在 Dock，点击 Dock 可重新打开窗口。
- Apple Silicon 与 Intel 分别构建 DMG / ZIP；没有 Developer ID 时提供 ad-hoc 签名并明确未公证。构建验证与真实 Mac 运行、下载后的 Gatekeeper 体验分别报告。
- 运行时最低 macOS 13，与 Electron 44 的支持范围一致，不能只修改 Info.plist 来宣称支持更旧系统。

## 暗色与触摸

- 单一主题偏好仍为 light / dark / system；把解析与应用集中到独立模块，启动时先应用上次主题，数据加载后使用真实设置。系统跟随模式持续响应变化。
- CSS 原生颜色方案、输入控件、浏览器主题色、Electron nativeTheme 与 Android 系统栏统一更新。暗色使用低亮度背景和独立的表面层次，避免浅色闪屏。
- 手机界面遵守 safe-area 和动态视口；输入至少 16 px，主要点击区域至少 44 px。桌面侧栏仍保留完整导航；手机通过抽屉访问全部清单和标签。

## Dayweave 课程组件

CourseWidgetProvider / CompactCourseWidgetProvider 放在 :widgetProvider。主进程每次持久化后生成只含 schedule 的小快照，组件只读快照并用 CourseSchedule/java.time 计算实例，不加载 React/Capacitor。组件刷新遵循 Android 与小米官方规范（https://dev.mi.com/xiaomihyperos/documentation/detail?pId=1584）。不申请精确闹钟权限；后台省电可能延迟边界刷新，曝光、写入与打开应用会刷新。
