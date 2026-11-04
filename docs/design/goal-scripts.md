# 目标脚本

用户 2026-11-04 要求：目标增加“自动化脚本”判定方式，脚本存放在可导入、会同步的脚本库中，可以利用时织采集的各种数据做复杂判断（例如“决定休息前不能有娱乐”“学习时使用无关软件的时长和次数不超过阈值”）。语言与规范由实现决定。对外规范见 `docs/goal-scripts.md`。

## 选择

- **语言：JavaScript ES 模块。** Electron、Android WebView、浏览器和 Node 都能直接运行，无需额外解释器；`export default async function judge(ctx)` 加可选的 `name` / `description` / `params` 导出，参数声明直接生成目标编辑表单，一个脚本可以被多个目标用不同阈值复用。
- **脚本库就是同步状态。** `timelog.scripts`（`{ id, name, code, order?, updatedAt }`）是 `TIMELOG_COLLECTIONS` 中的集合，每个脚本是独立的同步文档 `scripts/<id>`，冲突规则与其他集合相同。没有另设文件夹：磁盘文件夹会与同步状态形成两个所有者。“导入”读取 `.js` 文件写入脚本库，“导出”写出 `.js` 文件。
- **结果不存储。** `ScriptGoal = { kind: 'script', scriptId, params }`。结果由每台设备运行后保存在内存中（`script-runner.ts` 的缓存），`goalStatus(..., outcome)` 与其他目标走同一判定路径：只有周期结束且无错误、`met !== null` 时才有 `met`。不写入同步数据，是为了避免多台设备同时写同一个目标文档造成冲突，同时自动记录在各设备可能暂时不完整。代价：中心和 AI 接口读不到结果（`met=null`，返回 `scriptName`）。若以后需要，可以在中心用 Node worker_threads 复用同一套 `script-api` 计算。

## 结构

| 文件                         | 职责                                                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `timelog/domain.ts`          | `GoalScript`、`ScriptGoal`、`ScriptOutcome` 类型，校验（参数名、200 KB 代码上限、200 个脚本），`goalStatus` 的脚本分支                                             |
| `timelog/script-api.ts`      | `ctx` 的全部数据方法（纯函数，测试与运行共用）：周期、记录、待办、时段、课表、目标状态、自动记录过滤；62 天查询上限                                                |
| `timelog/script-util.ts`     | `ctx.util` 时间段运算、时区格式化；脚本导出（`scriptMeta`）、参数（`resolveParams`）和返回值（`scriptOutcome`）的检查                                              |
| `timelog/script-worker.ts`   | Worker 入口：设置时区/日起点，移除网络与存储全局后以 blob URL 动态 import 用户模块，构造 `ctx`，数据调用经消息转给主线程                                           |
| `timelog/script-runner.ts`   | 主线程：每个脚本源码一个 Worker（空闲 2 分钟回收）、10 秒超时终止、数据调用应答（自动记录按范围缓存）、`useScriptResults` 结果缓存、`inspectScript` / `testScript` |
| `timelog/script-templates/`  | 空白、休息前不娱乐、学习时少用无关软件三个模板（真实 `.js` 文件，单元测试直接运行）                                                                                |
| `components/GoalScripts.tsx` | 目标编辑器中的脚本库、参数表单，以及脚本编辑器（模板、试运行、导出、删除）                                                                                         |

## 约束与经验

- Worker 由 Vite `?worker&inline` 生成，构建后是 blob URL；开发模式是同源 URL。CSP 因此为 `script-src 'self' blob:; worker-src 'self' blob:`，blob Worker 继承页面 CSP，`connect-src 'self'` 让脚本无法联网。Electron `file://` 页面已由 `smoke-desktop` 覆盖；Android WebView 尚未在真机验收。
- 脚本编辑器自带表单，不能嵌在目标表单里；它通过 portal 渲染到目标对话框元素内（不在 `<form>` 中，但仍在 `.timelog-module` 作用域内，样式才生效）。
- 缓存键：脚本 `updatedAt`、目标参数、数据戳（记录/待办/时段的最大 `updatedAt` 与数量、计时、课表数量），当前周期另加分钟刻度。自动记录的变化只通过分钟刻度反映到当前周期；已结束周期在其他数据变化时重算。
- 新集合与新目标类型要求中心和所有客户端同时升级：旧中心的 `isDocumentKey` 不认识 `scripts/`、旧客户端的 `validateState` 会拒绝 `kind: 'script'`。部署时先升级中心。
