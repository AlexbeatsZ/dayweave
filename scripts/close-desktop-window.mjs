/** Exercise the renderer's save handshake before the Electron inspector disconnects. */
export async function closeDesktopWindow(app) {
  const closed = app.waitForEvent('close', { timeout: 30000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  if (process.platform === 'darwin') await app.evaluate(({ app }) => app.quit());
  await closed;
}
