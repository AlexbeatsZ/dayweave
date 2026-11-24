# 安排、日程与统一重复

## 页面和数据归属

安排通过日期工具栏中的“切换”小按钮切换待办、日程，周视图按钮位于“本周”左侧，月视图位于“今天”左侧。每个模式分别记住月视图或周视图，页面顶部保留月、周视图切换。Task 保留多日期、日计划时段、子任务、难度、预计与实际用时、完成历史、标签和置顶顺序，新增可选的 0–3 优先级。周视图按完成状态、优先级、置顶和手动顺序排列，复用原指针拖动逻辑，拖至其他优先级的任务时采用目标优先级。月视图沿用原日期移动和完整日计划入口。

日程保存在统一状态的 `calendarEvents` 中。`type` 支持 `course/exam/presentation/meeting/other`。演讲涵盖本人展示、报告、答辩或发言。标题、地点、教师或主持人、备注、颜色和时区对全部类型开放。月视图只读该集合。周视图按每天一列和共享真实时间纵轴对齐，卡片位置由开始时间确定，高度由首段开始至末段结束的完整活动时长确定，内部休息包含在卡片范围内。左侧恢复原版节次标尺，显示节号及上课、下课时间，各列保留对应节次的起止参考线。点击任意节次或日程操作中的“节次设置”进入原设置面板，上午、下午、晚上节数与参考时间沿用 schedule.periods 的持久化和同步。全天日程放在统一对齐的顶部区域，跨天定时日程在各日边界裁剪，重叠项目复用原 interval-lanes 分道。详情表单使用现有 Modal、颜色选择和保存队列。

周视图标题在日期范围后显示「第N周」教学周，取 `schedule.semesterStart/totalWeeks`。默认档案的学期只是占位，只有存在复旦订阅、旧课程或课程类日程时才显示，所在周超出学期范围时不显示。学期可通过订阅、导入或「学期与时区」设置。

手机待办与日程周视图每屏显示五天，整周七天保存在横向滚动容器内，通过原生左右滑动查看。日程的节次栏固定在容器左侧，整列同时覆盖日期表头、全天区域与时间轴，保持不透明的页面背景。安排页允许原生横向和纵向触摸滚动，表格使用 data-no-swipe 标记。桌面日程周视图保留原五天、七天及自动偏好，自动模式按已持久化日程的实际周末覆盖计算。固定五天时周末数据仍保留在月视图、API 与日历导出中。共享时间范围覆盖已配置节次，并扩展到本周日程的最早和最晚起止时刻，布局采用每分钟 1.35 CSS px。左侧标尺桌面宽 54 px、手机宽 36 px。窄屏使用相同时间比例，标题和每行信息超宽时使用省略号，完整信息可点开编辑面板查看。表格、节次栏、今天表头与卡片背景统一使用页面 canvas 颜色，日程顶部色条取 Event.color，并通过编辑面板的“顶部标记颜色”更改。

预设标签和用户标签使用同一字符串与颜色机制。名称为“事件”的标签也保持普通标签语义。现有模型没有事件专用标记或可靠起止时间，迁移报告列出这些待办供核对，保留原 Task 的全部属性。

## 时间段

`periods` 为本地墙钟的 `[开始 HH:mm, 结束 HH:mm][]`，按开始时间排序，区间互不重叠，可相接或有休息间隔。定时日程至少一个时间段，全天日程使用空数组。一个 Event 对应一次活动，卡片内以文字列出时间段。

`date` 为日程时区的民用日期，`durationDays` 默认为 1。全天结束日期为 `date + durationDays`，采用不含结束日的约定。跨日定时日程使用一个时间段，其结束时间位于 `date + durationDays - 1`。旧数据中存在的秒和毫秒通过可选 `precision.start/end` 保留，转换与导出以 `eventBounds` 为准。修改时间段时清除旧精度偏移，修改地点或标题保留精度。

日程民用日期独立于待办的业务日边界。Temporal 负责 IANA 时区、固定偏移和夏令时转换。安排中的显示时区使用现有 `schedule.timeZone`，每个日程继续保存自己的时区。

## 身份、发生台账与中心

新 Task 和 Event 共用 UUID 前缀与非负序号，独立项目也为 `prefix-0`。完整 ID 跨两种实体校验唯一。前缀表示系列，模型没有额外的系列 ID。`recurrences` 以该前缀为键，`target` 选择 task 或 event，复用原同步实体展开、delta、文件保存和中心事务。

一个规则可以含多个 `definitions`，每个定义保存 `dtstart/rrule/rdate/exdate/timeZone`。课程不同星期的时间段可通过各定义的 `eventTemplate` 表达，共用同一前缀及实例台账。无规则的有限系列仍可按前缀关联。

`ical.js` 负责 RFC 5545 发生日期，Temporal 负责时区。支持 DAILY/WEEKLY/MONTHLY/YEARLY、INTERVAL、BYDAY、BYMONTHDAY、BYSETPOS、COUNT 和 UNTIL 等合法组合。单双教学周以真实首次发生日为 DTSTART，并以 `FREQ=WEEKLY;INTERVAL=2` 计算。年度默认月日显式补齐，避免当前 ical.js 将非闰年的隐式 2 月 29 日归一化至 3 月 1 日。

中心沿既有 `generateRepeatedTasks → StateService.mutate` 入口生成，客户端只保存规则或请求扩展窗口。任务与日程调用同一 `nextInstanceId`，检查 Task、Event、全部发生台账和删除标记后分配下一个序号。新实例和台账在同一写入中提交。事件规则默认展开未来 42 天，每轮最多 512 项，发布日历订阅时日程扩展到未来 366 天。后续轮次继续已有台账。

台账键保存不可变的原始发生日期或墙钟及其时区。Event 同时保存 `recurrenceId`。移动日期、修改标题或类型均保留这个标识。删除事件写软删除与 EXDATE，Task 原有删除标记及台账继续防止再生。规则编辑仅影响以后尚未生成的实例，已分配的 ID 和历史台账保留。

## 单次与系列修改

日程表单默认仅本次，可选择本次与后续生成模板，或关联系列的全部已生成实例和模板。全部修改必须确认包含独立修改。批量操作只应用本次实际改动的属性，其他实例自己的属性继续保留。批量移动日期按日期差移动各实例，原始发生标识保持稳定。规则定义编辑单独保留已生成实例。

Task 表单保留单次编辑，同时提供明确确认的系列属性修改。当前批量字段包括标题、备注、清单、标签、难度、优先级和预计用时。各实例的日期、子任务与完成历史仍从该实例编辑。Task 的 RRULE 使用同一编辑器与发生台账，多日期通过 `dateOffsets` 生成。

## 旧数据和导入适配

旧 `schedule.courses/events/periods` 保留为导入来源和恢复输入。周课程的实际教学日期展开为 Event，连续每周或隔周转成带 COUNT 的 RRULE，不规则日期使用 RDATE，假日和排除日期写 EXDATE。已知的旧固定日期课程保留精确起止。迁移使用确定性 UUID，重读、重启与同步后保持原 ID。

同名同教师且处于同一学期的旧周课程建立关联前缀，原课程 ID、发生日及来源指纹保留。原始课程行发生变化时，仅更新保持来源指纹的实例。已经独立编辑或取消的实例继续保留。复旦原生登录、所选学期刷新、导入预览、所有权恢复日志和事务入口继续使用原实现。schedule.periods 共用于周视图参考标尺和旧课表文件解释，Event 的真实时间段保存在各实例中。

旧五字段 Cron 和 `repeatRules` 保留。经过等价验证的每天、指定星期和月日形式获得 `recurrence` 定义，执行时使用同一 RRULE 日期展开器。无法等价转换的 Cron 保留兼容引擎，并保存 `migrationWarning`，不会静默丢弃。新 UI 和 `/tasks/{id}/recurrence` 使用 RRULE，旧调用方仍可沿用 Cron API。

带时间的 Task DTSTART 沿业务日边界分配任务日期，DATE 类型直接对应所选日期。窗口计算包含下一民用日边界前的触发。v1 的有效数字优先级在身份迁移中保留。

读取尚无 Event 集合的原文件时，桌面和 Android 保存 `data.before-arrangements.json` 原字节。Web 保存对应 localStorage 检查点。同步配置保存 `sync.before-arrangements.json`。迁移报告由 `/arrangements/migration` 和日程操作菜单提供。备份合并包含 Event、规则、台账和订阅配置，冲突的发生映射拒绝导入。

## 设置中的日程分类

2026-11-16 用户要求“日程操作”菜单（•••）不再放在安排页，并统一界面。设置新增“日程”分类（ScheduleSettings），包含课程导入（复旦网站、CSV/JSON/ICS 文件、CSV 模板与复旦自动更新）、学期与节次（含 Android 小组件）、日历订阅和课表数据导出/迁移报告，全部使用设置页的 section 与 `.data-actions` 按钮行样式。安排页只保留周视图节次标尺的就地节次编辑与复旦更新失败提示。导出时取消保存对话框不再显示为错误。

## 单向 ICS 日历订阅

2026-11-16 用户要求精简：日历只需 ICS 自动导入到其他日历，配置写在设置中，不要额外控件。账号登录（Google/Microsoft OAuth、iCloud CalDAV）、外部日历导入/订阅、ICS 文件下载及“日程操作”中的三个日历入口全部移除，连同 oauth4webapi/tsdav/windows-iana、中心 `calendar-accounts.json` 命令通道、`/calendar-accounts`、`/calendar-oauth/callback`、`/calendar-subscriptions` 接口。生产账号从未完成授权，外部订阅数为 0。

入口为“设置 → 日程 → 日历订阅”。`settings.calendarFeeds` 最多 20 条，每条有 `id`、名称（写入 X-WR-CALNAME）、启用、64 位十六进制密钥、日程类型筛选 `types`（空为全部，可选课程/考试/演讲/会议/其他）和独立的中心基址 `baseUrl`。不同外部日历可用不同入口，例如 Google/Apple 用原网关 `https://cdn.u3146344.nyat.app:63573/dayweave`，Outlook 用 Vultr 443 的 `https://45.77.68.130/dayweave`；两者都按通用的 64 位密钥路径转发，新增订阅无需改网关。重置链接更换密钥，删除或停用即 404。

旧版单条 `settings.calendarFeed` 在 `stateSchema` 预处理中迁移为 `id=default`、名称 `Dayweave · 时织` 的第一条，密钥与基址原样保留，已在 Google/Apple 添加的订阅继续有效。同步 preferences 携带 `calendarFeeds`，缺少该键表示全部删除；旧端发来的 `calendarFeed` 同样迁移。旧中心的严格 schema 不认识 `calendarFeeds`，必须先升级中心再升级客户端。无订阅时不写该键，旧端不受影响。AI 通过 `PATCH /settings` 整体替换 `calendarFeeds`，health 以 `capabilities.calendarFeeds` 标明支持。

中心提供精确 `GET/HEAD /calendar/<密钥>.ics`，按密钥常量时间匹配启用中的订阅，并按“修订+名称+类型”缓存内容。ICS 每个已持久化实例的 UID 固定为 `<完整内部ID>@dayweave`，单次改期沿用 UID，删除保留 CANCELLED。外部时间为首段开始至末段结束，描述保存全部时间段与备注。全天使用 DATE 和不含结束日的 DTEND，定时使用 UTC instant 并附原始时区。存在启用订阅时 Event 规则展开未来 366 天。

每条未取消日程带两个 VALARM（DISPLAY，开始前 30 分钟与 15 分钟），日历级附 `REFRESH-INTERVAL`/`X-PUBLISHED-TTL` 为 1 小时。外部日历是否采用 ICS 内的提醒由其自身决定：Google 订阅日历忽略 VALARM，需在该日历的通知设置中添加；Apple 订阅需取消“移除提醒”；Outlook 网页订阅通常也不采用。只读 `calendarSubscriptions` 集合与 `source.kind='calendar'` 为同步兼容而保留读取，不再有写入者。

## 同步和验证边界

业务 JSON 仍为 version 2 的可兼容扩展，加密业务交换协议升到 3，防止旧端丢失新增集合。Event 复用 Task 的三方字段合并及删除优先语义，delta 同样按实体处理。新旧业务协议混写会拒绝，配对密钥和自动记录通道继续使用原机制。

验收覆盖领域、浏览器 UI、隔离 HTTP 与加密多端交换。外部日历的实际刷新与提醒、安装后的系统通知、手机与平板手势、后台及实际生产迁移分别记录。交付遵守仓库既有的界面审阅门禁。

## 2026-11-24 学习休息参考背景订阅

每条订阅增加可选content：events（缺省，原实际日程）、reference（只发布参考背景）、combined（两者）。设置→日程→日历订阅可选择，API仍通过PATCH /settings整体替换calendarFeeds；原链接、类型和提醒默认不变。旧端不认识扩展字段，先更新中心和可达客户端再配置。

reference-calendar.ts保存与CodingWindowGuard/schedule.json一致的固定UTC+8参考轴。仅导出时派生未来43天，无新持久Event、不生成任务/目标/学习记录。先从每段参考时间扣除所有未删除calendarEvents的实际时间包络（含全天/跨天、所有类型，即使该feed只筛某类型）；其余空白可任意截断和拆分，不补齐45分钟，不保留被占用部分。UID由日期、原段和片段边界稳定生成；参考片段TRANSPARENT表示空闲。没有精确起止的待办/日计划组无法作为时间占用，实际有时间安排应保存日程。

实际日程仍前30/15分钟VALARM，参考片段VALARM=0到点。Google可以对每个自有日历设默认提醒、单个原生事件覆盖；ICS订阅是否使用VALARM以及刷新时效受外部日历控制，不能宣称即时取消。需要可靠地同步主脑临时暂停与Google原生提醒时，必须单独建立授权的Google日历写入桥，并对具体事件设置useDefault=false、minutes=0；本轮未获授权前不恢复已退役OAuth/账号功能或改变Muse发送。
