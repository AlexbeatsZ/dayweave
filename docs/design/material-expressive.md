# Material 3 Expressive 前端试验

2026-11-26，分支 `codex/material-3-expressive`，基于客户端 0.5.20 / Server 0.2.17。用户要求先看预览，再决定构建。本分支只修改共享前端表现，不改变持久化 schema、领域行为、同步、AI API、OpenAPI 或 CLI。当前所有业务操作继续调用同一 store 和领域实现，因此无头接口契约保持原版本。

## 规范与取舍

以 Google Material 3 / Material 3 Expressive 为依据，而不是从 Pixel 截图推测尺寸。网页仍使用 React 与原生 HTML；不是将 Android Compose 控件嵌入 Electron。复用来源与具体版本：

| 内容                       | 依据 / 实现                                                                                                             | 本分支落点                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 语义色与 HCT               | Google `material-foundation/material-color-utilities` 0.4.0，`SchemeTonalSpot`，source `#3f5f90`，contrast 0            | `scripts/generate-material-theme.ts` → `src/material/tokens.css`、`colors.ts`                      |
| 导航、surface、shape、type | https://m3.material.io/；navigation rail/bar、tabs、FAB、dialogs、lists 的规范                                          | `src/material/expressive.css`，原组件继续拥有 DOM、焦点和业务                                      |
| 动效                       | https://m3.material.io/styles/motion/overview/specs；Expressive fast spatial ζ=.6 / k=800；fast effects ζ=1 / k=3800    | `@kyralabs/m3e-motion` 1.8.0 的 `springToLinear`，位移与透明度分别动画，不将弹性曲线用于透明度     |
| 加载                       | https://developer.android.com/develop/ui/compose/components/loading-indicator；Compose 七形状插值、旋转与弹簧的社区移植 | `@kyralabs/m3e-react` / `m3e-css` 1.8.0。社区项目：https://github.com/kyra-labs/m3exp-web          |
| 图标                       | Google Material Symbols Rounded，Apache-2.0                                                                             | 四个原始本地 SVG，`MaterialSymbol` 用于主要导航；领域内现有图标继续沿用                            |
| 字体                       | Google Roboto Flex，SIL OFL 1.1                                                                                         | Fontsource 5.3.0 本地 Latin variable font；中文回退 Noto Sans SC / 苹方 / 微软雅黑，不访问远端字体 |

颜色并非手写两组“近似”主题：浅色与深色角色均由 Google 库生成。关键浅色为 primary `#3f5f90`、primary-container `#d6e3ff`、surface `#f9f9ff`、surface-container `#ededf4`、on-surface `#191c20`、tertiary-container `#f8d8fe`。运行 `npm run theme:generate` 可重现角色与弹簧 CSS；生成物保留在 Git，因此 renderer 不需要运行颜色生成算法。`public/appearance.js` 的启动背景与同一 surface 匹配，有测试防止初始主题闪烁。

这是规范驱动的 Web 实现，不宣称 Google 官方组件或逐像素认证。现有任务圆形完成控件、真实时间网格、活动图标和统计图属于 Dayweave 业务组件，保留交互语义后应用相同的角色、形状和文字层级。未将所有领域组件替换为第三方组件库，避免复制状态与破坏已验收的操作。

## 页面与布局

采用产品工作区布局：左侧导航 → 当前范围分类 → 右侧当前业务页面。桌面主标题 36/44，正文 14/20 和任务标题 16/24；手机标题 24，中文跟随平台字形。桌面默认侧栏 280px，701–1100px 压到 232px，右侧填充 24–64px；700px 以下回到原有底部四入口。断点前后保持同一页面树、timer、草稿与 tab owner，不按设备复制前端。

签名元素集中在七天日期容器与相连时段列表。主选择使用 primary / secondary container；下一个日程使用 tertiary container；普通列表和分组靠 surface 层级区分，不堆叠阴影。28px 外容器、24px 分组、20/16px 内项按嵌套层级使用；主按钮和导航选中态用 full corner。FAB 56px，桌面扩展文字，手机只显示图标；所有模块复用原 `FloatingAdd`。

2026-11-26 用户审阅后要求任务列表只用手动排序：桌面与手机共用的列表固定传入 `manual`，删除日期/难度选项、排序选择控件及其状态和专用样式。排序直接使用原拖动手势，不增加“手动排序”按钮；继续沿原 `reorderTasks` / store 保存 `order`。

覆盖共享壳、任务列表/分组、日期导航、加载页、记录卡片、活动选择/计时、目标、安排工具栏、统计、设置、编辑 dialog / bottom sheet、计时 dock 和 snackbar。`expressive.css` 是集中表现层，放在既有布局 CSS 之后加载；不在各模块中复制一套业务或主题状态。旧设计文档的中性灰/冰蓝视觉描述在此试验分支由本文件替代，其领域要求继续适用。

## 动效、可达性与状态

仅改变原内容节点的位移和透明度，不 key/remount 页面。Expressive fast spatial 的 `linear()` 近似持续 420ms，fast effects 149ms。按下时的形状变化使用相同空间曲线；颜色仍为无回弹的短过渡。`prefers-reduced-motion` 下不执行页面空间动画，加载组件冻结在第一帧。支持系统高对比与键盘 focus-visible。

加载组件仅出现在实际 `snapshot.loaded=false` 且无错误时，不作为品牌装饰常驻，也不延迟加载以展示动画。失败时仍显示原有错误和恢复入口。组件自带 progressbar 语义；实际延迟加载测试检查形状路径变化、48px 大小及减弱动画策略。

原 `Modal` 继续负责焦点恢复、Escape、Android 返回和嵌套对话框。原 TaskComposer、DateNavigator、TaskCheck、TimerPanel、Settings 均保留状态与保存路径。只改颜色/形状，不能削弱并发检查、错误保留草稿、计时 ID、无头 API 或实体拖动的规则。

## 预览与验收

1. `npm run dev:web`，本机开发入口 `http://127.0.0.1:5178/`。
2. 本机 `PLAYWRIGHT_BROWSERS_PATH="$PWD/.local/playwright" npm run preview:material`。使用 `tests/fixtures/material-preview.ts` 的固定日期与合成数据，在私有浏览器 context 生成桌面/手机、浅/深色 16 张图，保存在忽略目录 `.local/preview/material-expressive/`。不读安装中的 profile，不连中心，不在应用中加入 demo 持久化入口。
3. `npm run check`、`npm test`、`PLAYWRIGHT_BROWSERS_PATH="$PWD/.local/playwright" npx playwright test tests/e2e/material-expressive.spec.ts tests/e2e/desktop.spec.ts tests/e2e/phone.spec.ts tests/e2e/usage-settings.spec.ts tests/e2e/sync-settings.spec.ts`。

原 desktop regression 的截图也放入 `.local/preview/material-expressive/regression`，不再写旧版本号的 release 子目录。测试只验证浏览器预览，不能代替实际 Android / Electron / 三端打包与设备体验。用户审阅前不运行构建、不发版、不安装；客户端与中心版本均维持 0.5.20 / 0.2.17。
