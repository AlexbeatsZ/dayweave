import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openEnvelope, syncEndpoint, type Envelope } from '../src/sync/crypto.js';
import { courseOccurrences, emptySchedule } from '../src/schedule.js';
import {
  FUDAN_LOGIN_URL,
  FUDAN_TABLE_URL,
  fudanCaptureError,
  isFudanNavigation,
} from '../src/fudan-capture.js';

/**
 * The same fixture is read by android/app/src/test/.../PlatformContractTest.java. Android runs
 * these rules natively (background usage sync, widget, school browser), so both implementations
 * are held to one file instead of drifting separately.
 */
const contract = JSON.parse(
  readFileSync(new URL('./fixtures/platform-contract.json', import.meta.url), 'utf8'),
);

test('sync address parsing matches the shared contract', () => {
  for (const { input, output } of contract.syncEndpoints as {
    input: string;
    output: string | null;
  }[])
    if (output === null) assert.throws(() => syncEndpoint(input), input);
    else assert.equal(syncEndpoint(input), output, input);
});

test('the shared encrypted usage reply opens with the TypeScript implementation', async () => {
  const { key, path, plaintext, envelope } = contract.usageEnvelope;
  assert.deepEqual(await openEnvelope(envelope as Envelope, key, path), plaintext);
});

test('course expansion matches the shared contract used by the Android widget', () => {
  const { courses, now, occurrences, ...schedule } = contract.courses;
  const expanded = courseOccurrences(
    {
      ...emptySchedule(),
      ...schedule,
      totalWeeks: 20,
      courses: courses.map((course: object, index: number) => ({
        id: `c${index}`,
        color: '#326559',
        updatedAt: 0,
        ...course,
      })),
      events: [],
    } as never,
    now,
  );
  assert.deepEqual(
    expanded.map(({ name, start, end }) => ({ name, start, end })),
    occurrences,
  );
});

test('school browser constants and error texts match the shared contract', () => {
  assert.equal(FUDAN_LOGIN_URL, contract.fudan.loginUrl);
  assert.equal(FUDAN_TABLE_URL, contract.fudan.tableUrl);
  for (const host of contract.fudan.hosts) assert.ok(isFudanNavigation(`https://${host}/x`));
  for (const [input, message] of Object.entries(contract.fudan.errors))
    assert.equal(fudanCaptureError(input), message);
});
