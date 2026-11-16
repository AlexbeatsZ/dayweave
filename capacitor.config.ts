import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.dayweave.mobile',
  appName: 'Dayweave',
  webDir: 'dist',
  backgroundColor: '#182230',
  android: { allowMixedContent: false, webContentsDebuggingEnabled: false },
  plugins: { SystemBars: { insetsHandling: 'css' } },
};
export default config;
