# 时织图标源文件

2026-11-16 起使用 Pixel 2026 渐变风格的新图标：一根深绿丝线上下穿过三条长短不一的时间块（白色底）。替换了 2026-10-30 的沙漏图标。应用名、包名、bundle ID 和数据目录继续使用现有 Dayweave 身份。

在项目根目录运行 `npm run icons` 可复现平台资源，不需要安装额外工具：

| 源文件                            | 实际资源与入口                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| `Shizhi_Windows.ico`              | `build/icon.ico`，Windows EXE、安装/卸载程序及开始菜单入口沿用 electron-builder 图标设置 |
| `Shizhi_macOS.icns`               | `build/icon.icns`，macOS 应用包、Dock 与 DMG（白色圆角底板）                              |
| `Shizhi_Windows_1024.png`         | `build/icon.png`，通用打包图像                                                           |
| `Shizhi_Windows.svg`              | `public/icon.svg`，Web favicon                                                           |
| 两个 `*_256.png`                  | `public/tray.png` / `public/tray-macos.png`，按平台选择桌面窗口与托盘图标                |
| `Shizhi_Android_legacy.xml`       | Android 24–25 的 `drawable/app_icon.xml`：白色圆形底 + 图案                              |
| `Shizhi_Android_foreground.xml`   | Android 26+ 自适应图标前景 `drawable/app_icon_foreground.xml`（108dp，图案在 66dp 安全区内） |
| `Shizhi_Android_monochrome.xml`   | Android 13+ 主题图标单色层 `drawable/app_icon_monochrome.xml`                            |

新图案带渐变，Android 矢量直接以成品 XML 提供，脚本只复制并加上来源注释，不再从 SVG 转换。自适应图标背景为 `#FFFFFF`，由系统决定圆形或方形等外轮廓；启动页引用同一个 launcher。

不要把功能按钮、活动类别或第三方应用图标替换成品牌图标。生成资源检查与安装后系统缓存、真实启动屏、托盘及设备验收分别记录。
