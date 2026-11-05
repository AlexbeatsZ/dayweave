# 目标脚本

用户 2026-11-04 要求：目标增加“自动化脚本”判定方式，脚本存放在可导入、会同步的脚本库中，可以利用时织采集的各种数据做复杂判断（例如“决定休息前不能有娱乐”“学习时使用无关软件的时长和次数不超过阈值”）。语言与规范由实现决定。随后要求结果由同步中心统一计算并分发：其他设备只改脚本和参数，避免不同设备算出不同结果。对外规范见 `docs/goal-scripts.md`。

## 选择

- **语言：JavaScript ES 模块。** `export default async function judge(ctx)` 加可选的 `name` / `description` / `params` 导出；参数声明直接生成目标编辑表单，一个脚本可以被多个目标用不同阈值复用。
- **引擎：QuickJS（`quickjs-emscripten-core` + 单文件同步变体，WASM 内嵌在 JS 中）。** 中心（Node）与编辑器试运行（WebView/浏览器）共用 `script-engine.ts`，行为一致。它是真正的沙箱：除 `__host` 桥外没有宿主能力，可设内存上限与中断截止时间。脚本来自任一已配对设备而在中心运行，Node `vm` / worker_threads 都不是安全边界，所以不用它们；最初的浏览器 Worker 方案也已删除。
- **结果由所有者计算并写入同步状态。** 所有者是同步中心，或未配对（同步关闭）的桌面端/服务器（`startScriptJudge` 中的规则）。结果是同步集合 `timelog.goalResults`（`{ id: goalId@period, goalId, period, met, progress, note, error?, basis, updatedAt }`），只有所有者写入，其他设备从不修改，因此合并不会冲突。`basis = [scriptId, script.updatedAt, period, params]`：脚本或参数变化即视为过期，改名、分组和排序不影响。`goalStatus` 直接读取未过期的结果，卡片、热力图、上期统计和 API 共用。
- **脚本库就是同步状态。** `timelog.scripts`（`{ id, name, code, order?, updatedAt }`）。没有另设磁盘文件夹，否则会与同步状态形成两个所有者；导入/导出使用 `.js` 文件。
- 浏览器版和 Android 不运行判定（没有 Node 所有者）；未配对时一直显示“等待同步中心判定”。

## 结构

| 文件                         | 职责                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `timelog/domain.ts`          | `GoalScript`、`ScriptGoal`、`GoalResult` 类型与校验，`scriptBasis` / `scriptResult` / `RESULT_PERIODS`，`goalStatus` 的脚本分支                                          |
| `timelog/script-api.ts`      | `ctx` 的全部数据方法（纯函数）、`scriptHost`（按方法名分派，自动记录由调用方提供）、`resultPeriods`、`dataStamp`                                                         |
| `timelog/script-util.ts`     | `ctx.util` 时间段运算与时区格式化（宿主侧执行），导出/参数/返回值检查                                                                                                    |
| `timelog/script-engine.ts`   | QuickJS 加载与运行：前导代码捕获并删除 `__host`，模块加载器只允许 `user.js`，单调时钟 5 秒中断，64 MB 内存，同步 JSON 桥                                                 |
| `electron/script-judge.ts`   | 所有者上的判定服务：订阅状态变化（3 秒防抖，忽略自己的写入）与 5 分钟定时；按保留窗口决定重算；超时脚本按 basis 熔断；只在结果变化时写入，并清理已删除目标和窗口外的结果 |
| `timelog/script-runner.ts`   | 编辑器侧：`inspectScript` 读取导出，`testScript` 用本机数据试运行（自动记录按需读取后重跑）                                                                              |
| `timelog/script-templates/`  | 空白、休息前不娱乐、学习时少用无关软件三个模板（真实 `.js`，单元测试经引擎运行）                                                                                         |
| `components/GoalScripts.tsx` | 目标编辑器中的脚本库、参数表单，以及脚本编辑器（模板、试运行、导出、删除）                                                                                               |

## 约束与经验

- 运行是同步的：中心的数据全部在内存或 SQLite（同步 API）中。客户端试运行的自动记录来自异步桥：遇到未读取的范围时抛出并记录范围，读取后整段重跑（脚本只读，重跑无副作用）。
- 中断截止时间必须用 `performance.now()`：Playwright 固定 `Date` 时，按 `Date.now()` 的截止时间永远不会到，死循环会卡住。
- `pass()` 先 `await` 一次再执行：没有工作时异步函数会同步跑完并在赋值前清掉 `running`，之后每次调用都返回同一个已完成的 Promise。
- 页面 CSP 需要 `script-src 'wasm-unsafe-eval'` 才能实例化 QuickJS。
- 状态增量把 `scripts`、`goalResults` 按行合并，避免中心写结果与本机编辑在整字段层面冲突。
- 新集合与新目标类型要求中心与所有客户端同时升级：旧中心的 `isDocumentKey` 不认识 `scripts/`、`goalResults/`，旧客户端会拒绝 `kind: 'script'`。部署时先升级中心。
- 判定在中心的事件循环中同步执行；单次最多 5 秒，超时后该 basis 不再重试，所以一个坏脚本最多阻塞约 5 秒。
