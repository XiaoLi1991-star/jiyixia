import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.jiyixia.app',
  appName: '记一下',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
}

export default config
