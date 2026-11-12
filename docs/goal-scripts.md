# 目标脚本规范

目标的判定方式选“自动化脚本”时，由脚本库中的一个 JavaScript 模块判断每个周期（天或周）是否达成。脚本可以读取时织采集到的全部数据（计时记录、自动记录、待办、日计划时段、课表、其他目标），做任意复杂的判断。

脚本库随同步到所有设备。“新建脚本”可以从模板开始，“导入脚本”读取 `.js` 文件，编辑器里可以导出和试运行。**判定结果只由同步中心计算**（未配对的桌面端自己计算），随同步分发到所有设备，所以每台设备看到的结果完全一致；各设备只修改脚本和参数。模板本身就是可以直接参考的示例：`src/timelog/script-templates/`。

## 模块格式

```js
export const name = '休息前不娱乐'; // 可选，导入时作为默认名称
export const description = '决定休息之前出现娱乐活动就算失败。'; // 可选，显示在脚本库

// 可选：每个目标可以填写不同的值
export const params = {
  restTag: { label: '休息标签', type: 'text', default: '决定休息' },
  fun: { label: '娱乐活动', type: 'list', default: [], hint: '逗号分隔' },
  graceMinutes: { label: '允许分钟', type: 'number', default: 0 },
  strict: { label: '严格模式', type: 'boolean', default: false },
};

export default async function judge(ctx) {
  // …
  return { met: true, progress: 1, note: '显示在卡片上的一句话' };
}
```

- 参数类型：`text`（字符串）、`number`、`list`（字符串数组，界面中用逗号分隔）、`boolean`。
- 返回值：`true` / `false`，`null`（无法判定，例如还没有数据），或对象 `{ met, progress, note }`。
  - `met`：`true` / `false` / `null`。
  - `progress`：0 到 1，用于热力图深浅和进度条；省略时达成为 1，否则为 0。
  - `note`：最多 200 字，显示在目标卡片和热力图提示中。
- 与其他目标一样，只有周期结束后的结果才算“达成 / 未达成”；进行中的周期只显示当前结果。`met: null` 或脚本出错时，这个周期记为无法判定，不算失败。

## ctx

所有时间都是毫秒时间戳（UTC epoch）。日期是 `YYYY-MM-DD` 的业务日：按设置里的“每天开始时间”切分，例如 04:00 开始时，03:00 仍属于前一天。

### ctx.period

| 字段                      | 说明                                             |
| ------------------------- | ------------------------------------------------ |
| `key`                     | 周期标识：每日目标为当天日期，每周目标为周一日期 |
| `kind`                    | `'day'` 或 `'week'`                              |
| `start`、`end`            | 周期范围（含 start，不含 end）                   |
| `settled`                 | 周期是否已结束                                   |
| `now`                     | 本次运行的当前时间                               |
| `timeZone`、`dayStartsAt` | 日程时区、每天开始时间                           |
| `days`                    | 周期内每一天：`[{ date, start, end }]`           |

### ctx.params

本目标填写的参数；未填写的使用 `params` 声明里的默认值。

### 数据接口

都是异步函数（需要 `await`），结果是普通对象数组的副本，修改它们不会影响数据。带 `start` / `end` 的查询默认是本周期，可以指定任意范围，但单次最多 62 天。

| 调用                                                                 | 返回                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ctx.records({ activities, tags, excludeTags, nature, start, end })` | 计时记录（含正在计时，算到当前），按开始时间排序。`activities` 是活动名或 ID（任一），`tags` 须全部带有，`excludeTags` 都不能带，`nature` 为 `positive` / `neutral` / `negative`。每条：`{ id, activity, activityId, nature, tags, note, taskId, running, start, end, spans, minutes }`，`spans` 已裁剪到查询范围      |
| `ctx.usage({ apps, search, kinds, devices, start, end })`            | 自动记录（各设备采集并同步的观测）。`apps` 是应用名的不区分大小写的片段（任一，例如 `bilibili`、`tencent.mm`），`search` 匹配窗口标题或网址，`kinds` 为 `app` / `web` / `unlock` / `media`，`devices` 是设备名或 ID。每条：`{ app, title, url, category, kind, device, deviceId, platform, start, end }`，已裁剪到范围 |
| `ctx.tasks({ tag, dueFrom, dueTo, completed })`                      | 待办（不含已删除）。每条：`{ id, title, notes, tags, list, dates, slots, estimatedMinutes, actualMinutes, difficulty, subtasks, createdAt, completedAt }`，`createdAt` / `completedAt` 为时间戳                                                                                                                        |
| `ctx.slots({ from, to })`                                            | 日计划时段，默认本周期的日期。每条：`{ id, date, title, note, minutes, until, start, end }`，设置了结束时间才有 `end`，同时有时长才有 `start`                                                                                                                                                                          |
| `ctx.classes({ start, end })`                                        | 课表中的上课时段：`{ name, teacher, location, start, end }`                                                                                                                                                                                                                                                            |
| `ctx.activities()`                                                   | 当前可用活动：`{ id, name, nature, color, archived }`                                                                                                                                                                                                                                                                  |
| `ctx.goals()`                                                        | 其他非脚本目标在本周期的状态：`{ id, name, group, kind, period, met, within, progress, target }`                                                                                                                                                                                                                       |

### ctx.util

同步的辅助函数。时间段是 `{ start, end }`，参数可以是一个或一组时间段。

| 函数                              | 说明                                            |
| --------------------------------- | ----------------------------------------------- |
| `union(spans, gapMinutes = 0)`    | 合并重叠（以及间隔不超过 `gapMinutes`）的时间段 |
| `intersect(a, b)`                 | a 中同时落在 b 内的部分                         |
| `subtract(a, b)`                  | a 中不在 b 内的部分                             |
| `clip(spans, range)`              | 裁剪到范围                                      |
| `minutes(spans 或毫秒数)`         | 总分钟数，重叠只算一次                          |
| `overlaps(a, b)`                  | 是否有重叠                                      |
| `sessions(spans, gapMinutes = 2)` | 合并后的使用段，`.length` 即“次数”              |
| `clock(ms)`                       | 日程时区的 `HH:mm`                              |
| `date(ms)`                        | 时间戳所属的业务日                              |
| `at(date, 'HH:mm')`               | 某个日历日期的某个时刻的时间戳                  |
| `matches(text, patterns)`         | 文本是否包含任一片段（不区分大小写）            |

### ctx.log(...values)

输出调试信息，试运行时显示在编辑器中（最多 200 行）。

## 运行环境与限制

- 脚本在 QuickJS（编译为 WebAssembly 的独立 JavaScript 引擎）中运行，除 `ctx` 外没有任何宿主能力：没有 `fetch`、网络、文件、`require`/`process`，也不能 `import` 其他模块；只能读取数据，不能写入。
- 每次运行（包括数据调用）最多 5 秒，内存 64 MB，超时会停止；超时的脚本在修改脚本或参数之前不再重试。脚本代码最多 200 KB，脚本库最多 200 个脚本。
- 同步中心为每个脚本目标保留最近 56 天（每周目标 14 周）的结果，写入同步数据分发；只有结果变化时才写入。当前周期和 36 小时内结束的周期每 5 分钟、以及数据变化后重算（覆盖其他设备晚到的自动记录）；更早的周期在记录、待办、时段、课表或其他目标变化，以及脚本或参数修改后重算。
- 修改脚本或参数后，在同步中心重算前，目标显示“等待同步中心判定”；改名、分组或排序不影响结果。
- 编辑器的“试运行”在本机用同一引擎运行，只使用本机已有的数据（自动记录可能比中心少），仅用于调试；保存后以同步中心的结果为准。
- AI 接口读取脚本目标时，`met` 等字段来自中心的结果，另返回 `scriptName`、`scriptNote`、`scriptError`。
- 删除仍被目标使用的脚本会被拒绝；先改掉或删除这些目标。

任务模型 v2：ctx.tasks 的日期投影是 dates 映射，slots 是按日期的时段标题映射；difficulty 为手动难度。兼容查询参数 dueFrom/dueTo 现在匹配任一有限日期，表示安排范围，不表示截止。单次实例用完整 ID，系列可从末尾整数之前的 ID 前缀派生，不按标题聚合。
