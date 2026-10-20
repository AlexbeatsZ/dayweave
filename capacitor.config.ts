import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.dayweave.mobile',
  appName: '时织',
  webDir: 'dist',
  backgroundColor: '#182230',
  android: { allowMixedContent: false, webContentsDebuggingEnabled: false },
  plugins: { SystemBars: { insetsHandling: 'css' } },
};
export default config;
