import { z } from 'zod';
import { extraPaths } from './extra-contract.js';
import { taskSchema, listSchema, stateSchema } from './model.js';

export const taskInputSchema = taskSchema
  .pick({
    title: true,
    notes: true,
    estimatedMinutes: true,
    actualMinutes: true,
    listId: true,
    due: true,
    priority: true,
    tags: true,
    subtasks: true,
    repeat: true,
    pinned: true,
    order: true,
  })
  .partial()
  .required({ title: true })
  .strict();
export const taskPatchSchema = taskInputSchema.partial().strict();
export const listInputSchema = listSchema
  .omit({ id: true })
  .partial()
  .required({ name: true })
  .strict();
export const settingsPatchSchema = stateSchema.shape.settings
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
function operation(summary: string, schema?: z.ZodType, pathId = false) {
  return {
    summary,
    ...(pathId
      ? { parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }] }
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
      '409': { description: '版本或操作冲突，读取最新数据后再决定是否重试' },
    },
  };
}
export const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'Dayweave AI API',
    version: '0.4.1',
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
      List: json(listSchema),
      State: json(stateSchema),
    },
  },
  paths: {
    ...extraPaths,
    '/health': { get: operation('检查应用状态与版本') },
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
          { in: 'query', name: 'q', schema: { type: 'string' } },
          {
            in: 'query',
            name: 'limit',
            schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
          },
          { in: 'query', name: 'offset', schema: { type: 'integer', minimum: 0, default: 0 } },
        ],
      },
      post: operation('创建任务', taskInputSchema),
    },
    '/tasks/{id}': {
      get: operation('读取单个任务，含已完成和回收站状态', undefined, true),
      patch: operation('更新任务属性', taskPatchSchema, true),
      delete: operation('将任务移入回收站', undefined, true),
    },
    '/tasks/{id}/complete': {
      post: operation('完成任务；重复任务只生成一次下一项', undefined, true),
    },
    '/tasks/{id}/reopen': { post: operation('重新打开已完成任务', undefined, true) },
    '/tasks/{id}/restore': { post: operation('从回收站恢复任务', undefined, true) },
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
    '/export': { get: operation('导出完整 v1 JSON 数据（不含 API 令牌）') },
    '/import': { post: operation('合并导入完整 v1 JSON 数据', stateSchema) },
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
