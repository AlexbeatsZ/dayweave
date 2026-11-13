import { z } from 'zod';
import { usageEventSchema, type UsageEvent } from './domain.js';
import type { SyncClient } from '../sync/client.js';
import { openEnvelope, seal } from '../sync/crypto.js';

export const usageExchangeSchema = z.object({
  requestId: z.string().uuid(),
  events: z.array(usageEventSchema).max(500),
  cursor: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(500),
});
export type UsageExchange = z.infer<typeof usageExchangeSchema>;
export const usageReplySchema = z.object({
  requestId: z.string().uuid(),
  accepted: z
    .array(z.object({ id: z.string(), revision: z.number().int().nonnegative() }))
    .max(500),
  events: z.array(usageEventSchema).max(500),
  cursor: z.number().int().nonnegative(),
  more: z.boolean(),
});
export type UsageReply = z.infer<typeof usageReplySchema>;
export interface UsageReplica {
  pending(limit: number): Promise<UsageEvent[]>;
  cursor(hubId: string): Promise<number>;
  receive(hubId: string, reply: UsageReply): Promise<void>;
  exchange(owner: string, request: UsageExchange): Promise<UsageReply>;
}
const running = new WeakMap<SyncClient, Promise<void>>();
/**
 * Serialized per client but independent of the business-sync lock: an observation backlog never
 * delays task exchanges. Credentials are captured once; re-pairing or disconnecting stops the run.
 */
export function syncUsage(client: SyncClient, replica: UsageReplica) {
  const task = (running.get(client) ?? Promise.resolve()).then(() => exchange(client, replica));
  running.set(
    client,
    task.catch(() => {}),
  );
  return task;
}
async function exchange(client: SyncClient, replica: UsageReplica) {
  const config = client.config;
  if (!config.enabled || config.hub || !config.key || !config.endpoint || !config.hubId) return;
  const { key, deviceId, hubId } = config;
  const endpoints = config.endpoints ?? [config.endpoint];
  for (let batch = 0; batch < 20; batch++) {
    const current = client.config;
    if (!current.enabled || current.key !== key || current.hubId !== hubId) return;
    const request: UsageExchange = {
      requestId: crypto.randomUUID(),
      events: await replica.pending(300),
      cursor: await replica.cursor(hubId),
      limit: 500,
    };
    const reply = await client.request(
      '/usage',
      () => seal(request, key, '/usage', deviceId),
      async (result) => {
        if (result.clientId !== deviceId) throw new Error('自动记录回执身份不符');
        const value = usageReplySchema.parse(await openEnvelope(result, key, '/usage:reply'));
        if (value.requestId !== request.requestId) throw new Error('自动记录回执不匹配');
        if (value.cursor < request.cursor || (value.more && value.cursor === request.cursor))
          throw new Error('自动记录同步游标无进展');
        const sent = new Map(request.events.map((event) => [event.id, event.revision]));
        if (value.accepted.some((item) => sent.get(item.id) !== item.revision))
          throw new Error('自动记录回执包含未发送的记录');
        return value;
      },
      endpoints,
    );
    await replica.receive(hubId, reply);
    if (!reply.more && request.events.length < 300) break;
  }
}
