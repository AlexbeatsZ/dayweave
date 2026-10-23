# 结构与状态归属

## 原则

用户要求最终架构尽可能简单干净，减少重复功能函数。新行为优先并入已有领域、校验和保存路径，替换时删除旧实现。只有集中真实复杂行为或服务多个调用方时才抽取模块；不建立只转发的层、假想扩展框架或为了减行数而拆文件。

保存数据只有一个所有者，展示从数据派生：统一 store 拥有任务、清单、标签颜色、记录、活动、目标、计时、课程与节次；共用应用壳拥有导航；时间线拥有历史窗口；表单只拥有未保存草稿。不能通过订阅和 effect 再复制一份业务状态。

## 模块边界

| 模块                                                | 所属行为                                                        | 主要接口                                                      |
| --------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------- |
| `model.ts`                                          | 统一状态、任务范围/顺序、清单活动映射与任务启动计时             | `stateSchema` / `selectTasks` / `startTaskTimer`              |
| `store.ts` / `state-delta.ts`                       | 唯一前台状态、校验、增量保存队列、并发合并与错误恢复            | `useStore` / `transact` / `diffState` / `applyDelta`          |
| `electron/state-service.ts`                         | 桌面、AI API、同步中心共用写入队列与倒计时截止调度              | `snapshot` / `mutate` / `patch`                               |
| `runtime.ts`                                        | 全应用一个秒时钟、主题响应、前台倒计时到期收尾                  | `useClock` / `useApplicationTheme` / `useCountdownCompletion` |
| `phone/MobileApp.tsx`                               | 全宽共用主导航、待办范围、选中任务与子页协调                    | App 唯一页面入口；响应式布局不重挂载                          |
| `phone/Navigation.tsx`                              | 共用顶栏、子页点击/水平手势与加号                               | `PhoneTopbar` / `PhoneTabs` / `useSwipeTabs` / `FloatingAdd`  |
| `phone/DateNavigator.tsx`                           | 日计划、周计划、时间线和每日统计共用日期控件                    | `DateNavigator` / `calendarWeek`                              |
| `phone/Sidebar.tsx`                                 | 按当前模块显示清单/标签或活动/标签及设置入口                    | 同一个分类组件在手机抽屉、PC 常驻侧栏内呈现                   |
| `phone/TaskComposer.tsx`                            | 新建和编辑任务的同一个草稿与显式保存流程                        | `TaskComposer`，可传已有 task                                 |
| `components/TaskRow.tsx` / `phone/useTaskDrag.ts`   | 共用任务行、清单色确认框、紧急竖线、视图序号与长按排序手势      | 行操作及排序回调                                              |
| `components/ColorPicker.tsx`                        | 清单、课程和两类标签共用颜色选择；活动沿用原生颜色输入          | `ColorPicker`                                                 |
| `components/Modal.tsx`                              | 原生 modal 生命周期、焦点、最顶层 Android 返回                  | `Modal` 的普通/底部/侧栏呈现                                  |
| `phone/Statistics.tsx`                              | 每日任务与记录汇总、全部待办/记录统计入口                       | `PhoneStatistics`                                             |
| `timelog/Workspace.tsx`                             | 时间模块事务协调、编辑与受控子页                                | `TimeLog` 传入子页，所有宽度共用时间线/计时/目标              |
| `timelog/components/TimerPanel.tsx`                 | 一个计时面板：活动选择/长按编辑、运行控制、预设、关联、下一活动 | 已保存 state 与共用 commit 回调                               |
| `phone/useTimelineDays.ts`                          | 历史窗口锚点、追加天数、跳转与可见日投影                        | `list` / `dates` / `jump`                                     |
| `timelog/components/TimelineEntries.tsx`            | 手机和桌面共用时间边界、空档与运行记录                          | entries、明确日期、编辑回调                                   |
| `timelog/components/Goals.tsx`                      | 当前日/周分组、目标卡片与进度展示                               | state、date、edit、remove                                     |
| `timelog/domain.ts` / `timeline.ts` / `timezone.ts` | 片段、截止、积分、并集、空档和日程日期的唯一计算                | 共用领域函数                                                  |
| `sync/document.ts`                                  | 统一实体与未结束记录的同步表示、三方合并                        | `toDocument` / `fromDocument` / `mergeDocuments`              |

Workspace 直接使用统一 store，不建立 `readState → setState → subscribe` 的异步副本。`timelog/storage.ts` 仅适配原模块事务/导入，不能再创建独立数据库或第二条写入通道。手机与桌面共享整个页面、任务编辑、时间线、计时和目标，而非保留两套页面再分别修补。`App.tsx` 只安装应用级运行逻辑并渲染一个应用壳；700 px 断点只改变呈现，不能重新挂载应用或复制导航状态。PC 常驻侧栏、不提供折叠，主导航与上下文分类保持可见；手机使用底部主导航与分类抽屉。宽屏样式集中在 `desktop.css`。

`components/Timetable.tsx` 集中周网格、共用课程草稿和节次设置，不保存课程展示副本。`schedule.ts` 校验课程与节次，改变标尺不重写课程 HH:mm。网站导入由 `fudan-capture.ts` 一份提取脚本、`fudan-import.ts` 纯转换与原生窗口承载组成；它只生成已有 ImportPreview，确认后走同一个 mergeSchedule/store，不另建学校数据库。本机订阅元数据和更新生命周期分别由 fudan-refresh.ts / useFudanRefresh.ts 拥有，不复制业务课表；自动更新和确认导入复用 store 事务与所有权恢复记录，失败队列未恢复前不得根据乐观视图缩小该记录。详见 fudan-import.md。

## 合并功能的规则

- 新建和编辑任务都使用 `TaskComposer`，以同一字段解析和保存，不并存另一套手机详情表单。编辑检查打开时的 `updatedAt`，不通过逐字段自动保存掩盖并发覆盖。
- 待办箱是 `due=null` 的任务范围，与所属清单独立；默认清单 ID `inbox` 仅保留兼容含义“未分组”。日计划、自然周、四象限和统计都从原任务派生，不复制计划实体。
- 任务序号由当前可见未完成任务顺序计算，不持久化另一份编号。长按拖动只更新任务顺序；完成项只在日/周计划以灰色勾选沉底，其他范围隐藏。
- 清单活动映射放入清单的 `activityId`，任务 UI 与 AI API 都调用 `startTaskTimer`，不再各写一段按清单名选择活动的逻辑。
- 清单和活动复用各自已有 `color`；标签字符串仍存于任务/记录中，颜色元数据集中在 `tagColors.tasks/records`。其增量保存、备份和同步都属于统一状态，不创建独立标签数据库。
- 正计时与倒计时是同一计时实体的可选 `plannedEndAt`，共用暂停、继续、结束、调整和相关任务/标签。默认预设集中于 `timelog.settings.timerPresets`，不能另建番茄钟状态机。旧番茄字段只读兼容，不提供新入口。
- `finishDueTimer` 统一前台与中心的截止规则；`nextActivity` 原子衔接旧记录和新计时。显示圆环、秒时钟与动画不负责保存业务状态。未运行时不保存预设起止草稿或建立第二个准备态；选活动后直接创建同一个计时实体，控件仅在运行时展开。活动长按和“＋”复用既有 Editor，删除独立管理活动弹窗。
- 删除是实体删除或为历史引用保留删除标记；不能把 UI 删除改成归档，也不为兼容字段重开归档/回收站页面。

## 历史浏览与派生统计

跳到某天与正在看某天不同：`jump(date)` 重设历史窗口锚点并回到顶部，普通滚动只更新可见日期，不能反复重设窗口。顶部日期、时长、积极时长和积分从同一可见日派生；加载上一天不修改记录，也不能把今天积分带到过去。

接近底部自动追加一天，初始较短时继续填充，没有手动加载或七天上限。编辑、补空档和填满条目都显式携带所属日期，追加历史不改变操作目标。目标固定使用当前日/周，日期控件只服务历史浏览与每日统计等需要指定日期的页面。

统计页计算每日任务加记录、全部待办、全部已保存记录，不保存计数副本。目标继续使用活动有效区间并集，不增加截图中的结算、收入或奖励状态。历史积分和计时 ID 不因界面重构而变化。

## 兼容与验证

统一状态维持 schema 版本 1，新字段在读取旧备份时补默认值；这不表示旧程序能接受带新字段的状态。部署必须同时考虑 ROG 中心和手机/平板版本，详见 sync.md。

当前不另建手机状态管理库、路由框架、手势依赖或分页服务。只有实际性能证据需要时才引入历史窗口虚拟化，并保留同一日期与操作接口。领域测试、浏览器交互、打包、真实设备和实际同步分别记录；源码或配置不能代替设备验收。
