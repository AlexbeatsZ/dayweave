const result = {
  description: '成功，返回 data 和 revision。时间为 UTC epoch 毫秒，课程墙上时间按课程时区。',
};
const input = (schema: unknown) => ({
  required: true,
  content: { 'application/json': { schema } },
});
const op = (summary: string, schema?: unknown) => ({
  summary,
  responses: { 200: result, 400: { description: '输入无效' }, 409: { description: '版本冲突' } },
  ...(schema ? { requestBody: input(schema) } : {}),
});
const free = { type: 'object', additionalProperties: true };
const id = [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }];
export const extraPaths: Record<string, unknown> = {
  '/sync/status': { get: op('同步状态与已配对设备，不返回密钥') },
  '/sync/invite': { post: op('在已开启的中心生成单次五分钟配对邀请；邀请含密钥') },
  '/sync/hub': { post: op('开启本机局域网同步中心') },
  '/sync/now': { post: op('立即同步本机修改') },
  '/time-records': {
    get: op('统一时间记录；endAt=null 表示未结束，plannedEndAt 为倒计时截止；最近 1000 条'),
    post: op('只给 startAt 即正向计时；未来 endAt 开始倒计时；过去 endAt 创建结束记录', {
      type: 'object',
      required: ['startAt'],
      properties: {
        startAt: { type: 'number', description: 'UTC epoch 毫秒' },
        endAt: {
          type: ['number', 'null'],
          description: '未来时刻设为 plannedEndAt；null/缺省正向计时，过去时刻保存历史记录',
        },
        activityId: { type: 'string' },
        taskId: { type: 'string' },
        note: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    }),
  },
  '/time-records/{id}/stop': {
    parameters: id,
    post: op('给原 ID 补结束时间；不创建另一条记录', {
      type: 'object',
      properties: { endAt: { type: 'number' } },
      additionalProperties: false,
    }),
  },
  '/context': { get: op('AI 决策上下文：今天任务、活动计时、当前和下一节课以及未来七天课程') },
  '/tasks/{id}/track': {
    parameters: id,
    post: op('从任务开始正向计时，与现有时间线共用计时器', {
      type: 'object',
      properties: { activityId: { type: 'string' } },
    }),
  },
  '/schedule': {
    get: op('读取学期、周课程、日历课程及例外日期'),
    patch: op('设置学期与课程时区', {
      type: 'object',
      properties: {
        semesterStart: { type: 'string', format: 'date' },
        totalWeeks: { type: 'integer', minimum: 1, maximum: 60 },
        timeZone: { type: 'string', example: 'Asia/Shanghai' },
        holidays: { type: 'array', items: { type: 'string', format: 'date' } },
        periods: {
          type: 'array',
          minItems: 1,
          maxItems: 30,
          items: {
            type: 'object',
            required: ['start', 'end', 'section'],
            additionalProperties: false,
            properties: {
              start: { type: 'string', example: '08:00' },
              end: { type: 'string', example: '08:45' },
              section: { type: 'string', enum: ['morning', 'afternoon', 'evening'] },
            },
          },
        },
      },
    }),
  },
  '/schedule/next': { get: op('当前课程和下一节课，使用真实时刻比较') },
  '/schedule/occurrences': {
    get: {
      ...op('展开课程实例'),
      parameters: [
        { in: 'query', name: 'from', schema: { type: 'number' } },
        { in: 'query', name: 'until', schema: { type: 'number' } },
      ],
    },
  },
  '/schedule/import': {
    post: op('预览或合并 CSV、JSON、ICS（默认 preview=true）', {
      type: 'object',
      required: ['content', 'name'],
      properties: {
        content: { type: 'string' },
        name: { type: 'string' },
        preview: { type: 'boolean', default: true },
      },
    }),
  },
  '/schedule/courses': {
    post: op('新建周课程：name weekday start end weeks location teacher color excludedDates', free),
  },
  '/schedule/courses/{id}': {
    parameters: id,
    patch: op('修改周课程', free),
    delete: op('删除周课程'),
  },
  '/schedule/events': {
    get: op('读取单次或 ICS 导入的课程实例'),
    post: op('新建单次课程：name courseId start end timeZone location teacher color', free),
  },
  '/schedule/events/{id}': {
    parameters: id,
    patch: op('修改单次课程实例', free),
    delete: op('删除单次课程实例'),
  },
  '/timelog/activities': { get: op('读取活动'), post: op('创建活动', free) },
  '/timelog/activities/{id}': {
    parameters: id,
    get: op('读取活动'),
    patch: op('更新活动，需 expectedUpdatedAt', free),
    delete: op('删除活动及其目标；历史记录保留；需 expectedUpdatedAt', free),
  },
  '/timelog/records': {
    get: op('读取记录（date/activityId/q/offset/limit）'),
    post: op('创建记录', free),
  },
  '/timelog/records/{id}': {
    parameters: id,
    get: op('读取记录'),
    patch: op('修改记录，需 expectedUpdatedAt', free),
    delete: op('软删除记录，需 expectedUpdatedAt', free),
  },
  '/timelog/records/{id}/fill': {
    parameters: id,
    post: op('填充相邻空档，需 date direction spanIndex expectedUpdatedAt', free),
  },
  '/timelog/timer': { get: op('当前计时：plannedEndAt 非空为倒计时；elapsedMs 为有效时长') },
  '/timelog/timer/start': {
    post: op('开始同一活动计时器，可指定开始及未来结束时刻', {
      type: 'object',
      required: ['activityId'],
      properties: {
        activityId: { type: 'string' },
        note: { type: 'string' },
        startAt: { type: 'number', description: 'UTC epoch 毫秒，不晚于现在' },
        fromPreviousRecord: {
          type: 'boolean',
          description: '从上一条记录末尾开始；不能与 startAt 同用',
        },
        endAt: { type: ['number', 'null'], description: '未来 UTC epoch 毫秒；null/缺省正向计时' },
        taskId: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    }),
  },
  '/timelog/timer/configure': {
    post: op('调整运行中计时的起止、任务、描述和标签；保留原记录 ID 及暂停片段', {
      type: 'object',
      required: ['timerId'],
      properties: {
        timerId: { type: 'string' },
        startAt: { type: 'number' },
        fromPreviousRecord: { type: 'boolean' },
        endAt: {
          type: ['number', 'null'],
          description: '未来 UTC epoch 截止；null 清除截止并转正向计时',
        },
        taskId: { type: ['string', 'null'] },
        note: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    }),
  },
  '/timelog/timer/next': {
    post: op('结束当前计时并从同一时刻开始下一个活动', {
      type: 'object',
      required: ['timerId', 'activityId'],
      properties: { timerId: { type: 'string' }, activityId: { type: 'string' } },
      additionalProperties: false,
    }),
  },
  ...Object.fromEntries(
    ['pause', 'resume', 'stop', 'cancel'].map((action) => [
      '/timelog/timer/' + action,
      {
        post: op('计时操作，需匹配 timerId；倒计时暂停后继续会顺延截止时刻', free),
      },
    ]),
  ),
  '/timelog/settings': {
    get: op('读取记录偏好与倒计时预设 timerPresets（分钟）'),
    patch: op('替换倒计时预设；设置同步到已配对设备', {
      type: 'object',
      required: ['expectedUpdatedAt', 'timerPresets'],
      properties: {
        expectedUpdatedAt: { type: 'number' },
        timerPresets: {
          type: 'array',
          maxItems: 30,
          items: { type: 'integer', minimum: 1, maximum: 10080 },
        },
      },
      additionalProperties: false,
    }),
  },
  '/timelog/timeline': { get: op('按日程时区展开时间线，date=YYYY-MM-DD') },
  '/timelog/stats': { get: op('记录统计，date=YYYY-MM-DD') },
  '/timelog/goals': { get: op('读取目标'), post: op('创建目标', free) },
  '/timelog/goals/{id}': {
    parameters: id,
    get: op('读取目标'),
    patch: op('更新目标，需 expectedUpdatedAt', free),
    delete: op('删除目标，需 expectedUpdatedAt', free),
  },
  '/timelog/backup': { get: op('导出兼容 Open Timelog 的备份') },
};
