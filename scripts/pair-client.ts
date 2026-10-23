import { FileStore } from '../electron/storage.js';
import { StateService } from '../electron/state-service.js';
import { syncFiles } from '../electron/sync.js';
import { SyncClient, fetchEnvelope } from '../src/sync/client.js';
import os from 'node:os';

const [directory, invite, endpoint] = process.argv.slice(2);
if (!directory || !invite) {
  console.error('Usage: tsx scripts/pair-client.ts <directory> <invite> [endpoint]');
  process.exit(1);
}

console.log('Loading store from:', directory);
const store = new FileStore(directory);
const loaded = await store.load();
const service = new StateService(store, loaded.state);
const client = new SyncClient(syncFiles(directory), service, fetchEnvelope, os.hostname());
await client.load();

console.log('Current client status:', client.status());
console.log('Pairing with invite, endpoint:', endpoint || 'auto');
const pairedStatus = await client.pair(invite, endpoint);
console.log('Pair status:', pairedStatus);

console.log('Running sync now...');
const syncStatus = await client.now();
console.log('Sync status:', syncStatus);

const snapshot = await service.snapshot();
console.log('Synced successfully:');
console.log('  Tasks count:', snapshot.state.tasks.length);
console.log('  Courses count:', snapshot.state.schedule?.courses?.length ?? 0);
console.log('  Timelog records count:', snapshot.state.timelog?.records?.length ?? 0);
