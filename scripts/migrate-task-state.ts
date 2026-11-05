import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stateSchema } from '../src/model.js';

const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw new Error('用法：npx tsx scripts/migrate-task-state.ts <原始备份.json> <新的输出目录>');
const source = JSON.parse(await readFile(path.resolve(input), 'utf8'));
const state = stateSchema.parse(source);
const directory = path.resolve(output);
if (path.dirname(path.resolve(input)) === directory)
  throw new Error('请使用独立输出目录，原始备份保持不变');
await mkdir(directory, { recursive: true, mode: 0o700 });
const report = {
  sourceVersion: source.version,
  targetVersion: state.version,
  tasks: state.tasks.length,
  records: state.timelog.records.length,
  repeatRules: state.repeatRules.length,
  identities: source.tasks.map((task: { id: string }, index: number) => ({
    before: task.id,
    after: state.tasks[index].id,
  })),
};
await writeFile(path.join(directory, 'state.json'), JSON.stringify(state, null, 2), {
  flag: 'wx',
  mode: 0o600,
});
await writeFile(path.join(directory, 'identity-map.json'), JSON.stringify(report, null, 2), {
  flag: 'wx',
  mode: 0o600,
});
console.log(
  JSON.stringify({
    sourceVersion: source.version,
    targetVersion: state.version,
    tasks: report.tasks,
    records: report.records,
    repeatRules: report.repeatRules,
    output: directory,
  }),
);
