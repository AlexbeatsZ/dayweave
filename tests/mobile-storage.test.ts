import test from 'node:test';
import assert from 'node:assert/strict';
import { JsonRepository } from '../src/persistence';
import { emptyState, newTask } from '../src/model';
import { resolveTheme } from '../src/theme';

function memoryFiles() {
  const files = new Map<string, string>();
  return {
    files,
    read: async (name: string) => files.get(name) ?? null,
    write: async (name: string, content: string) => {
      files.set(name, content);
    },
  };
}
test('Android repository persists full schema and recovers from an intact previous snapshot', async () => {
  const disk = memoryFiles();
  const repository = new JsonRepository(disk);
  await repository.load();
  const data = { ...emptyState(), tasks: [newTask('Mobile task')] };
  await repository.save(data);
  await repository.save({ ...data, tasks: [...data.tasks, newTask('Newer')] });
  disk.files.set('data.json', 'corrupt');
  const recovered = await new JsonRepository(disk).load();
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.state.tasks.length, 1);
  assert.ok([...disk.files.keys()].some((key) => key.startsWith('data.corrupt-')));
});
test('unreadable mobile data never falls back to an empty store and restore preserves both files', async () => {
  const disk = memoryFiles();
  disk.files.set('data.json', 'bad');
  disk.files.set('data.backup.json', 'also bad');
  const repository = new JsonRepository(disk);
  await assert.rejects(repository.load());
  await assert.rejects(repository.save(emptyState()));
  await repository.restore({ ...emptyState(), tasks: [newTask('Recovered')] });
  assert.equal([...disk.files.keys()].filter((key) => key.includes('before-restore')).length, 2);
  assert.equal((await new JsonRepository(disk).load()).state.tasks[0].title, 'Recovered');
});
test('mobile read permission failures propagate and do not overwrite data', async () => {
  let writes = 0;
  const repository = new JsonRepository({
    read: async () => {
      throw new Error('permission denied');
    },
    write: async () => {
      writes++;
    },
  });
  await assert.rejects(repository.load(), /permission denied/);
  assert.equal(writes, 0);
});
test('theme follows the system only when requested', () => {
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
});
test('native replace keeps the backup on the device side and receives the saved state', async () => {
  const disk = memoryFiles();
  const replaced: string[] = [];
  const repository = new JsonRepository({
    ...disk,
    replace: async (content, state) => {
      assert.equal(state.tasks.at(-1)?.title, JSON.parse(content).tasks.at(-1).title);
      replaced.push(content);
    },
  });
  await repository.load();
  await repository.save({ ...emptyState(), tasks: [newTask('First')] });
  await repository.save({ ...emptyState(), tasks: [newTask('Second')] });
  assert.equal(replaced.length, 2);
  assert.equal(disk.files.has('data.backup.json'), false);
});
