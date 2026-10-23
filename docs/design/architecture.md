# 结构与状态归属

## 原则

用户要求最终架构尽可能简单干净，减少重复功能函数。新行为优先并入已有领域与持久化路径，替换时删除旧实现；只在能集中真实复杂度或已有多个调用方时抽取 Module，不建立假想 Adapter、通用框架或仅转发的层次。

## 当前模块

| Module                                              | 状态/行为归属                                  | 主要 Interface                         |
| --------------------------------------------------- | ---------------------------------------------- | -------------------------------------- |
| `store.ts`                                          | 唯一的持久化数据源、校验、增量队列、错误恢复   | useStore / transact                    |
| `runtime.ts`                                        | 全应用一个秒时钟与主题响应                     | useClock / useApplicationTheme         |
| `phone/MobileApp.tsx`                               | 手机顶层导航、待办范围、详情与更多入口         | App 的窄屏入口                         |
| `phone/Navigation.tsx`                              | 共同的子页、水平手势与加号视觉                 | PhoneTabs / useSwipeTabs / FloatingAdd |
| `components/Modal.tsx`                              | 原生 modal 生命周期、焦点、最顶层 Android 返回 | Modal（Sheet 仅选择底部呈现）          |
| `timelog/Workspace.tsx`                             | 时间模块编辑/事务协调、可见日期和分析页        | TimeLog 传入受控子页；桌面使用本地子页 |
| `phone/useTimelineDays.ts`                          | 历史窗口锚点、追加天数、跳转、滚动投影         | list / dates / jump                    |
| `timelog/components/TimelineEntries.tsx`            | 手机和桌面共用的时间边界、空档、运行记录渲染   | entries + 明确日期 + 编辑回调          |
| `timelog/components/Goals.tsx`                      | 日/周分组、活动目标卡片与进度展示              | state / date / edit / archive          |
| `timelog/domain.ts` / `timeline.ts` / `timezone.ts` | 时间片段、积分、并集、空档和日程日期的唯一计算 | 原有领域函数                           |

Workspace 直接通过 useStore 读取统一数据，禁止再建立 readState → setState → subscribe 的异步副本。`timelog/storage.ts` 只保留原模块导入/事务所需 Adapter；没有独立数据库或第二条写入通道。手机与桌面共用时间线条目和目标卡片，只在布局与入口上适配。

## 历史浏览

“跳到某天”和“正在看某天”是两个不同概念。`jump(date)` 重设历史窗口锚点并回到顶部；普通滚动只更新 Workspace 的可见日期，不能重设窗口。顶部日期、时长与积分从同一个可见日期派生；加载上一天不修改记录，也不将今天的积分带到过去。

列表接近底部时自动追加一天，初始较短时填充可滚动空间；没有手动“更早一天”按钮或七天上限。每个条目的编辑、补空档、日界线都显式携带所属日期，追加历史不改变这些操作的目标。

## 保留的语义

目标采用已有每日/每周规则分组，不引入截图中的结算、收入或虚假奖励状态。进度依然来自已保存记录的活动区间并集；历史积分和计时 ID 不随展示重构变化。存储、API、同步和课程规则沿用 integration.md 与 sync.md。

当前没有另建手机状态管理库、路由框架、手势依赖或分页服务。后续只有出现实际性能证据时才考虑历史窗口虚拟化，并保留同一日期/操作 Interface。
