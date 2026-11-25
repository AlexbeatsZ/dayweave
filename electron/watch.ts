// Hub side of the watch channel: applies commands from paired phones relaying the Xiaomi watch
// quick app, through the same StateService queue as the UI and REST API (docs/design/watch.md).
import { directoryFiles } from './files.js';
import type { StateService } from './state-service.js';
import {
  applyWatchCommand,
  watchFailure,
  watchReply,
  watchRequestSchema,
  watchView,
  WatchError,
  type WatchReply,
} from '../src/watch/protocol.js';

/** Per phone, the outcome of its last commands: a replayed envelope must not apply twice. */
const LEDGER_SIZE = 512;
type Outcome = { id: string; ok: boolean; err?: WatchReply & { ok: false } };
type Ledger = Record<string, Outcome[]>;

export class WatchHub {
  private ledger?: Ledger;
  /** Commands run one at a time so a replay racing its original still sees the ledger entry. */
  private queue: Promise<unknown> = Promise.resolve();
  private readonly files;
  constructor(
    private readonly service: StateService,
    directory: string,
    private readonly now = () => Date.now(),
  ) {
    this.files = directoryFiles(directory);
  }

  private async load() {
    if (this.ledger) return this.ledger;
    const raw = await this.files.read('watch.json');
    this.ledger = raw ? (JSON.parse(raw) as Ledger) : {};
    return this.ledger;
  }

  /** Answers one relayed watch request for a paired phone; never throws for bad input. */
  exchange(clientId: string, input: unknown): Promise<WatchReply> {
    const run = this.queue.then(() => this.answer(clientId, input));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async answer(clientId: string, input: unknown): Promise<WatchReply> {
    const re =
      typeof (input as { id?: unknown })?.id === 'string' ? (input as { id: string }).id : '';
    const parsed = watchRequestSchema.safeParse(input);
    if (!parsed.success) return watchFailure(re, new WatchError('invalid', '请求无效'));
    const request = parsed.data;
    if (request.op === 'view')
      return watchReply(re, watchView((await this.service.snapshot()).state, this.now()));
    const ledger = await this.load();
    const history = (ledger[clientId] ??= []);
    const previous = history.find((row) => row.id === request.id);
    if (previous) {
      if (previous.err) return previous.err;
      return watchReply(re, watchView((await this.service.snapshot()).state, this.now()));
    }
    let reply: WatchReply;
    try {
      const snapshot = await this.service.mutate((state) =>
        applyWatchCommand(state, request, this.now()),
      );
      reply = watchReply(re, watchView(snapshot.state, this.now()));
    } catch (error) {
      // Domain validation (for example TIME_OVERLAP from commitState) is a conflict for the watch.
      reply = watchFailure(
        re,
        error instanceof WatchError
          ? error
          : new WatchError('conflict', error instanceof Error ? error.message : String(error)),
      );
    }
    history.push(
      reply.ok ? { id: request.id, ok: true } : { id: request.id, ok: false, err: reply },
    );
    if (history.length > LEDGER_SIZE) history.splice(0, history.length - LEDGER_SIZE);
    await this.files.write('watch.json', JSON.stringify(ledger));
    return reply;
  }
}
