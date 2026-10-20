import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';
const server = await createServer();
await server.listen();
const env = { ...process.env, DAYWEAVE_DEV_URL: 'http://127.0.0.1:5178' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { env, stdio: 'inherit', windowsHide: true });
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
process.on('SIGINT', () => child.kill());
