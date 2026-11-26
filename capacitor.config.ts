import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.momo.ledger',
  appName: 'MoMo Ledger',
  webDir: 'www',
  server: {
    url: 'https://momo-ledger-ojiit6tsz-ghana-first-streaming-network.vercel.app',
    cleartext: false,
    androidScheme: 'https',
    allowNavigation: ['momo-ledger-ojiit6tsz-ghana-first-streaming-network.vercel.app']
  },
  android: {
    backgroundColor: '#004F71',
    allowMixedContent: false
  }
};

export default config;
