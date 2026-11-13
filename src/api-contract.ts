import { z } from 'zod';
import { extraPaths } from './extra-contract.js';
import { taskSchema, listSchema, planGroupSchema, stateFields, subtaskSchema } from './model.js';
import { eventInputSchema, eventChangesSchema, recurrenceInputSchema } from './event-contract.js';
import { calendarEventSchema, calendarSubscriptionSchema } from './event-model.js';

export const taskInputSchema = taskSchema
  .pick({
    title: true,
    notes: true,
    estimatedMinutes: true,
    actualMinutes: true,
    difficulty: true,
    priority: true,
    listId: true,
    dates: true,
    tags: true,
    subtasks: true,
    pinned: true,
    order: true,
  })
  .partial()
  .required({ title: true })
  .extend({
    id: taskSchema.shape.id
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(0|[1-9]\d*)$/i)
      .refine((value) => Number.isSafeInteger(Number(value.slice(value.lastIndexOf('-') + 1))))
      .optional(),
    subtasks: z
      .array(subtaskSchema.pick({ id: true, title: true, done: true }))
      .max(200)
      .optional(),
  })
  .strict();
export const taskPatchSchema = taskInputSchema
  .omit({ id: true })
  .partial()
  .extend({
    difficulty: taskSchema.shape.difficulty.removeDefault().optional(),
  })
  .strict();
export const repeatInputSchema = z
  .object({
    cron: z.string().min(9).max(120),
    dateOffsets: z.array(z.number().int().min(0).max(365)).min(1).max(366),
  })
  .strict();
export const subtaskInputSchema = subtaskSchema
  .pick({ title: true, done: true })
  .partial()
  .extend({ id: z.string().min(1).max(100).optional() })
  .strict();
export const planGroupInputSchema = planGroupSchema
  .pick({ date: true, title: true, minutes: true, until: true, note: true, order: true })
  .partial()
  .required({ date: true, title: true })
  .strict();
export const planGroupPatchSchema = planGroupInputSchema.omit({ date: true }).partial().strict();
export const listInputSchema = listSchema
  .omit({ id: true })
  .partial()
  .required({ name: true })
  .strict();
export const settingsPatchSchema = stateFields.shape.settings
  .omit({ focusMinutes: true, breakMinutes: true })
  .partial()
  .strict();

const json = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { target: 'openapi-3.0', unrepresentable: 'any', io: 'output' });
const response = {
  description: '成功。JSON 包含 data 与 revision；ETag 可用于后续 If-Match。',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['data', 'revision'],
        properties: { data: {}, revision: { type: 'string' } },
      },
    },
  },
  headers: { ETag: { schema: { type: 'string' }, description: '当前会话中的状态版本' } },
};
function operation(summary: string, schema?: z.ZodType, pathId: boolean | string[] = false) {
  return {
    summary,
    ...(pathId
      ? {
          parameters: (pathId === true ? ['id'] : pathId).map((name) => ({
            in: 'path',
            name,
            required: true,
            schema: { type: 'string' },
          })),
        }
      : {}),
    ...(schema
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: json(schema) } },
          },
        }
      : {}),
    responses: {
      '200': response,
      '400': { description: '参数或 JSON 无效' },
      '401': { description: '缺少或错误的 Bearer 令牌' },
      '403': { description: '拒绝跨站或非本机请求' },
      '404': { description: '未找到对象' },
      '409': {
        description: '版本或操作冲突。error.reason=TIME_OVERLAP 表示新增时间占用重叠，请调整区间。',
      },
    },
  };
}
export const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'Dayweave AI API',
    version: '2.3.0',
    description:
      '时织 Windows/macOS 本机接口。应用运行时可用；实际地址与令牌见设置或用户数据目录 api.json。默认不对局域网开放。所有写入先持久化再通知界面；DELETE 任务为软删除。',
  },
  servers: [
    {
      url: 'http://127.0.0.1:49731/api/v1',
      description: '默认地址；被占用时使用 api.json 的实际地址',
    },
  ],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
    parameters: {
      IfMatch: {
        in: 'header',
        name: 'If-Match',
        required: false,
        schema: { type: 'string' },
        description: '可选的 ETag；过期时返回 409，避免盲目覆盖其他修改。',
      },
    },
    schemas: {
      Task: json(taskSchema),
      Event: json(calendarEventSchema),
      List: json(listSchema),
      PlanGroup: json(planGroupSchema),
      State: json(stateFields),
    },
  },
  paths: {
    ...extraPaths,
    '/health': {
      get: operation(
        '检查应用状态与版本；capabilities.taskRecordLinks 支持任务/计时关联，timeOverlapProtection 表示写入时禁止新增时间占用重叠',
      ),
    },
    '/openapi.json': { get: operation('读取当前 OpenAPI 文档') },
    '/tasks': {
      get: {
        ...operation('列出任务'),
        parameters: [
          {
            in: 'query',
            name: 'view',
            schema: {
              type: 'string',
              default: 'all',
              description: 'all/today/upcoming/inbox/completed/trash 或 list:<id>、tag:<tag>',
            },
          },
          {
            in: 'query',
            name: 'date',
            schema: { type: 'string', format: 'date' },
            description: '精确业务日（today/upcoming）',
          },
          { in: 'query', name: 'q', schema: { type: 'string' } },
          {
            in: 'query',
            name: 'limit',
            schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
          },
          { in: 'query', name: 'offset', schema: { type: 'integer', minimum: 0, default: 0 } },
        ],
      },
      post: operation(
        '创建任务；可指定随机UUID前缀+整数后缀的id，同ID（含已删除）返回409；完成用 /complete',
        taskInputSchema,
      ),
    },
    '/tasks/{id}': {
      get: operation('读取单个任务，含已完成和回收站状态', undefined, true),
      patch: operation('更新任务属性', taskPatchSchema, true),
      delete: operation('将任务移入回收站', undefined, true),
    },
    '/tasks/{id}/complete': {
      post: operation(
        '幂等完成任务及现存子任务；空子任务列表也可完成，完成时间由服务端本次操作生成，不接受回填',
        undefined,
        true,
      ),
    },
    '/tasks/{id}/reopen': { post: operation('重新打开已完成任务', undefined, true) },
    '/tasks/{id}/restore': { post: operation('从回收站恢复任务', undefined, true) },
    '/tasks/{id}/repeat': {
      put: operation('配置该系列 Cron 与日期偏移；生成由同步中心负责', repeatInputSchema, true),
      delete: operation('停止以后生成，保留已有实例', undefined, true),
    },
    '/tasks/{id}/subtasks': {
      post: operation('按稳定 ID 增量新增子任务', subtaskInputSchema, true),
    },
    '/tasks/{id}/subtasks/{subtaskId}': {
      patch: operation('增量修改子任务标题或完成状态', subtaskInputSchema.omit({ id: true }), [
        'id',
        'subtaskId',
      ]),
      delete: operation('软删除子任务', undefined, ['id', 'subtaskId']),
    },
    '/repeat-rules': { get: operation('读取重复规则与触发实例对应关系') },
    '/events': {
      get: operation('读取独立日程，支持 date 日期过滤'),
      post: operation('创建日程实例', eventInputSchema),
    },
    '/events/{id}': {
      get: operation('读取日程实例', undefined, true),
      patch: operation(
        '修改单次日程，scope=all&confirm=true 可显式批量修改系列属性',
        eventChangesSchema,
        true,
      ),
      delete: operation('取消日程并保留原始发生标识与排除记录', undefined, true),
    },
    '/events/{id}/recurrence': {
      put: operation(
        '配置同系列 RRULE、RDATE、EXDATE，保留已生成实例',
        recurrenceInputSchema,
        true,
      ),
      delete: operation('停止日程系列的后续生成', undefined, true),
    },
    '/tasks/{id}/recurrence': {
      put: operation('配置待办 RRULE、RDATE、EXDATE，保留多日期偏移', recurrenceInputSchema, true),
      delete: operation('停止待办系列的后续生成', undefined, true),
    },
    '/recurrences': { get: operation('读取共用重复规则与稳定实例账本') },
    '/arrangements/migration': { get: operation('读取课程迁移计数及无法确定语义的待核对任务') },
    '/calendar-subscriptions': {
      get: operation('读取日历订阅'),
      post: operation(
        '添加由中心自动导入 Event 的日历订阅',
        calendarSubscriptionSchema.omit({
          id: true,
          updatedAt: true,
          checkedAt: true,
          error: true,
        }),
      ),
    },
    '/calendar-subscriptions/{id}': {
      delete: operation('停用订阅并保留已导入日程', undefined, true),
    },
    '/repeat-rules/generate': {
      post: operation('请求中心扩展生成窗口', z.object({ through: z.string() }).strict()),
    },
    '/plan-groups': {
      get: {
        ...operation('列出某个业务日的计划分组（默认今天），按顺序'),
        parameters: [{ in: 'query', name: 'date', schema: { type: 'string', format: 'date' } }],
      },
      post: operation('在某天的日计划中新建分组', planGroupInputSchema),
    },
    '/plan-groups/{id}': {
      patch: operation('修改分组标题、持续时间、截止时刻、备注或顺序', planGroupPatchSchema, true),
      delete: operation('删除分组；其中任务保留在当天、变为未分组', undefined, true),
    },
    '/lists': { get: operation('列出清单'), post: operation('创建清单', listInputSchema) },
    '/lists/{id}': {
      patch: operation('更新清单名称、颜色与排序', listInputSchema.partial(), true),
      delete: operation('删除清单并将任务移到默认清单', undefined, true),
    },
    '/settings': {
      get: operation('读取偏好'),
      patch: operation('更新外观与日程偏好', settingsPatchSchema),
    },
    '/stats': { get: operation('读取近七天统计与累计值') },
    '/export': { get: operation('导出完整 v2 JSON 数据（不含 API 令牌）') },
    '/import': { post: operation('合并导入 v2 或迁移 v1 JSON 数据', stateFields) },
  },
};
for (const path of Object.values(openapi.paths))
  for (const [method, value] of Object.entries(path)) {
    if (method !== 'get') {
      const operation = value as { parameters?: unknown[] };
      operation.parameters = [
        ...(operation.parameters ?? []),
        { $ref: '#/components/parameters/IfMatch' },
      ];
    }
  }
