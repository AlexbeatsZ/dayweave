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

## 账号登录与首次配置

本节为 2026-11-14 新增源码，等待界面审阅后构建交付。入口为“日程操作 → 连接日历账号”。Google、Microsoft 使用系统浏览器 OAuth 授权码流程，支持 PKCE、十分钟有效的一次性 state、离线授权和 refresh token 续期。Apple 使用已开启双重认证的 Apple 账户和应用专用密码，经 tsdav 发现私人 CalDAV 日历。

首次使用 Google 或 Microsoft 需要在连接界面配置自己的登录应用。设置会自动选择已配对中心的 HTTPS 地址，显示完整回调地址，并提供打开 Google Cloud、Google Calendar API、Microsoft Entra 的按钮。回调地址为 `<中心HTTPS基址>/calendar-oauth/callback`。

- Google Cloud 启用 Google Calendar API，配置 OAuth 同意屏幕，创建 Web 应用类型的 OAuth 客户端，将完整回调地址加入已获授权的重定向 URI。将客户端 ID 和密钥填入时织。测试模式将本人邮箱加入测试用户，日历等权限的 refresh token 通常在七天后过期，需要重新登录。
- Microsoft Entra 注册支持组织账号与个人 Microsoft 账号的应用，添加 Web 平台及完整回调地址，创建客户端密钥，将应用客户端 ID 和密钥值填入时织。登录时请求 `offline_access User.Read Calendars.ReadWrite`。
- iCloud 连接界面可打开 Apple 账户页面，在“登录和安全 → 应用专用密码”生成密码后填入。凭据用于服务器持续访问私人日历。Apple 的第三方账户授权资格与公开接入条件另行确认，当前交付路径使用应用专用密码。

OAuth 应用配置、access/refresh token、Apple 应用专用密码与外部发布映射，由中心唯一所有者保存到原 profile 的 `calendar-accounts.json`，沿用 `writeAtomic` 和 0600 权限。该文件随原 profile 的完整运维恢复副本保留。常规业务 JSON、用户导出备份、业务同步和渲染进程状态只持有导入的 Event 或已去除凭据的账号状态。

客户端使用已配对的加密通道 `POST /calendar-accounts`，沿用 peer 序号验证、回复身份核对与有序地址故障转移。重试保留同一请求 UUID，中心缓存操作结果以免重复开始授权。账号请求的网络阶段位于原业务队列外。公网网关只增加该精确 POST 路径，以及带查询串的精确 GET `/calendar-oauth/callback`。回调核对最初设备仍有权限，再接受授权。

连接后按账号选择导入的日历与发布目标。只读日历可导入，发布下拉只显示可写日历。中心每五分钟刷新一次，提供“立即同步”。Google 与 Microsoft 拉取展开后的发生实例并保留其原生身份，单次改期继续沿用内部 ID。全天、Windows/IANA 时区、原生毫秒和取消状态适配到原有 `previewCalendar → applyCalendarImport → StateService.mutate` 路径。分页或网络失败保留已导入数据。Apple 沿用 iCalendar 的系列和例外解释。

账号发布将时织创建及课程迁移的日程写入所选目标，日历来源的导入项继续由来源管理。发布中的 Event 规则按既有台账扩展未来 366 天，Task 继续沿用原窗口。Google 使用由内部 ID 确定的事件 ID，Microsoft 使用私有扩展属性查询已提交事件，CalDAV 使用固定对象 URL。网络已提交而本地未确认时可以重试，外部副本变更由时织的后续修改更新。导入会过滤自己的发布标记。切换发布目标或断开账号会保留既有本地和外部日程，断开完成前取消并等待在途刷新。

OAuth 复用 oauth4webapi，CalDAV 复用 tsdav，Windows 时区映射复用 windows-iana。新入口沿用 JSON 2 和同步协议 3，使用账号连接需要中心、客户端和公网网关配套升级。真实账户注册、同意授权、外部长期刷新与提醒分别验收。

参考 Google 官方 [Web Server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)、Microsoft 官方 [Authorization Code Flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)、Apple 官方 [应用专用密码](https://support.apple.com/102654)、[oauth4webapi](https://github.com/panva/oauth4webapi) 与 [tsdav](https://github.com/natelindev/tsdav)。

## 单向导出到日历

主要入口为“日程操作 → 导出到 Google / Microsoft / Apple 日历”。用户可下载 ICS 文件，或开启持续更新的专用 Dayweave 日历订阅。Google、Outlook 和 Apple 通过自己的网址订阅入口接入。账号授权和供应商 API 由上方的连接入口管理。

中心提供精确 `GET/HEAD /calendar/<64位随机密钥>.ics`，共享 HTTPS 网关只转发相应的 `/dayweave/calendar/<密钥>.ics` 路径。密钥仅能读取 Event 日历，可关闭或重置，保存在现有加密业务状态的 `settings.calendarFeed` 中。用户需要填写其中心的可达 HTTPS 基址。网关与中心均要升级后才能使用公网订阅。

ICS 每个已持久化实例的 UID 固定为 `<完整内部ID>@dayweave`，这构成稳定的外部映射。单次改期或属性修改继续使用同 UID，删除保留 CANCELLED 状态。外部每项时间范围为首段开始至末段结束，描述保存全部时间段与备注。全天使用 DATE 和不含结束日的 DTEND，定时使用 UTC instant 并附原始时区。导出展开后的实例，保留其单次例外，外部订阅无需再次分配系列实例。

对外只读取 Event 集合，Task 不进入日历。订阅刷新由各日历服务决定。专用日历便于分开显示和提醒。开启发布和复制链接需要用户正常操作，其账户的真实订阅、提醒及刷新情况单独验收。

## 可选的反向日历导入

用户随后确认保留已经实现的导入功能。Google/Microsoft/Apple 的 iCalendar HTTPS/webcal 订阅地址由中心每 15 分钟读取，导入范围为过去和未来各 366 天。ICS 文件也先预览再确认。保留源 UID、原始 RECURRENCE-ID、全天、时区和单次例外，复用同一实例分配台账。已独立编辑或删除的导入实例保留，来源正常撤回会软删除未独立修改的实例。停用订阅保留已导入日程。

此入口使用可访问的日历订阅地址。账号登录入口通过供应商 API 或 CalDAV 读取私人日历。订阅地址可能包含访问密钥，会随加密业务同步和备份保存，错误消息会隐去原 URL。网络读取发生在中心保存队列外，结果在原事务中核对最新配置后写入。失败保留数据，关闭时取消并等待在途读取。

## 同步和验证边界

业务 JSON 仍为 version 2 的可兼容扩展，加密业务交换协议升到 3，防止旧端丢失新增集合。Event 复用 Task 的三方字段合并及删除优先语义，delta 同样按实体处理。新旧业务协议混写会拒绝，配对密钥和自动记录通道继续使用原机制。

验收覆盖领域、浏览器 UI、隔离 HTTP 与加密多端交换。真实账户订阅、安装后的系统通知、手机与平板手势、后台及实际生产迁移分别记录。交付遵守仓库既有的界面审阅门禁。
