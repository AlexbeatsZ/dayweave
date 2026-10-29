# 设置界面与状态边界

## 分类与布局

设置保持一个原生 Modal；桌面使用左侧分类和右侧内容，700px 及以下改为顶部四列分类。沿用应用灰阶、蓝色强调和系统字体，不创建另一套主题。分类固定为「通用」「自动记录」「设备同步」「接口与关于」，默认通用；收到配对邀请自动转到设备同步。

分类内容使用 hidden 隐藏而不卸载，切换分类或屏幕断点保留采集配置、隐私规则输入和配对表单草稿。关闭设置后仍沿用原有丢弃未保存草稿行为。分类栏不随内容滚动，内容区独立滚动，不出现横向滚动条。

## 状态与复用

- Settings 只编排分类、外观和日程时区；外观与时区继续通过统一 store 更新。
- UsageSettingsPanel 拥有本机采集草稿及显式保存，SyncSettings 拥有配对和同步操作，ApiSettings 拥有接口信息、剪贴板与错误。三者不共享错误状态，不增加业务数据副本。
- 保存采集配置期间禁用整个配置 fieldset，避免请求返回覆盖保存期间的新编辑。系统权限仍只能由用户在系统界面授予。
- ListModal 是独立任务清单编辑器，由 Sidebar 直接引用，不经由设置页导出。
- Modal 统一焦点恢复、原生 Escape 和 Android 返回。嵌套 dialog 的 cancel 必须阻止 React 事件传播，不能让父层跟着关闭。
- Settings.css 拥有分类、输入框、按钮尺寸、外观选项及响应式规则；不在 phone.css 复制设置样式。自动记录行保持 flex，禁止用更高优先级的泛 label 规则将开关改成纵向布局。

## 本次审查与后续解耦顺序

本次检查设置、应用壳、课程表、时间记录 Workspace、前台 store 和自动记录 client；不是全仓安全审计。已落地设置范围内的复用、状态隔离、样式归属和嵌套弹窗修复，其余保持现有行为。

1. **课程表导入流程（已整理）**：components/CourseImport.tsx 的 useCourseImport 与 CourseImportDialog 拥有「导入→预览→确认持久化→恢复刷新」完整生命周期，Timetable 仅启动流程并处理导入后的周导航。保留 fudan-import.md 的 ownership 恢复日志与失败重试边界，不另造持久化层。保存期间返回/关闭不得提前取消预览；卸载后的迟到读取结果不重开界面。
2. **重叠排布算法（已复用）**：interval-lanes.ts 是课程和自动记录共用的纯函数，返回以原对象为键的分道结果，避免同源多次 occurrence 被 ID 映射覆盖。先按真实起止排序再由视图裁剪，保留课程同起点短区间优先、自动记录长区间优先及 ID 平局排序。相同起点、跨日、多实例、相邻不重叠已有测试；弹性时间轴和来源合并仍归自动记录模块。
3. **异步动作的状态**：ListModal、SyncSettings、StorageRecovery 都有 busy/error/try-finally，但成功后的关闭、刷新和恢复语义不同；Workspace 还用 pendingWrites 计数处理并发。暂不抽一个泛用 save hook，以免把同步刷新失败、磁盘失败和业务校验混为一谈。真正统一的仍是 store.transact 和 StateService，而不是一套重复写入队列。
4. **保持已有单一所有者**：MobileApp 已同时服务手机与桌面，useClock、DateNavigator、Modal 和 timelog/domain 已复用；不用按设备另拆壳，不给设置添加自己的计时器、路由或全局 store。自动记录 SQLite 与手动记录业务 JSON 的分离是设计边界，不应为了代码复用合并数据库。

## 验证与交付

运行 npm run check、npm test，以及 usage-settings、sync-settings、integration、import-persistence 的浏览器测试。分类、开关对齐、主题、草稿保留、嵌套返回和焦点恢复使用隔离的浏览器状态；360/390/700/1440px 预览保存在忽略目录 .local/preview/settings。浏览器截图不等于已安装设备验收。用户确认界面前不构建、发布、部署或推送触发 CI。
