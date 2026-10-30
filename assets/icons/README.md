# 时织图标源文件

本目录保存用户提供的 `Mojian_Shizhi_all_icons.zip` 中八个 `Shizhi_*` 原始文件，未修改图案、颜色、尺寸或文件内容；不含 Mojian 素材。应用名、包名、bundle ID 和数据目录继续使用现有 Dayweave 身份。

在项目根目录运行 `npm run icons` 可复现平台资源，不需要安装额外工具：

| 原始素材                  | 实际资源与入口                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| `Shizhi_Windows.ico`      | `build/icon.ico`，Windows EXE、安装/卸载程序及开始菜单入口沿用 electron-builder 图标设置 |
| `Shizhi_macOS.icns`       | `build/icon.icns`，macOS 应用包、Dock 与 DMG                                             |
| `Shizhi_Windows_1024.png` | `build/icon.png`，通用打包图像                                                           |
| `Shizhi_Windows.svg`      | `public/icon.svg`，Web favicon；原始路径转换为 Android 自适应前景                        |
| 两个 `*_256.png`          | `public/tray.png` / `public/tray-macos.png`，按平台选择桌面窗口与托盘图标                |
| `Shizhi_macOS.svg`        | Android 24–25 的 `drawable/app_icon.xml`，保留原素材的深绿底板与全部路径                 |

Android 26+ 将 Windows 透明图案置于原 macOS 素材的 `#0B403B` 背景上；仅等比缩放前景到安全区域，由系统决定圆形或方形等外轮廓。启动页引用同一个 launcher。项目最低 Android 24，使用现有 anydpi 矢量入口，不再保留旧的多密度图案、Clearlist 矢量或未引用的 Capacitor 默认启动图。

不要恢复旧脚本的代码绘图实现，也不要把功能按钮、活动类别或第三方应用图标替换成品牌图标。生成资源检查与安装后系统缓存、真实启动屏、托盘及设备验收分别记录。
