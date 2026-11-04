import { existsSync } from 'node:fs';
import type { ExpoConfig } from 'expo/config';

// Firebase config for FCM push. Dropped in by the owner (gitignored); builds without it simply have no push token.
const googleServices = './google-services.json';

const config: ExpoConfig = {
  name: 'NIGHTSHIFT',
  slug: 'nightshift',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/brand/icon.png',
  scheme: 'nightshift',
  userInterfaceStyle: 'dark',
  backgroundColor: '#05040e',
  android: {
    package: 'tech.getnightshift.app',
    // scripts/build-release.sh sets a rising number for every upload
    versionCode: Number(process.env.NIGHTSHIFT_VERSION_CODE ?? 1),
    adaptiveIcon: {
      backgroundColor: '#05040e',
      foregroundImage: './assets/brand/adaptive-foreground.png',
      backgroundImage: './assets/brand/adaptive-background.png',
      monochromeImage: './assets/brand/adaptive-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    ...(existsSync(googleServices) ? { googleServicesFile: googleServices } : {}),
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.SYSTEM_ALERT_WINDOW',
    ],
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: 'getnightshift.tech', pathPrefix: '/app' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#05040e',
        image: './assets/brand/splash-icon.png',
        imageWidth: 180,
      },
    ],
    'expo-secure-store',
    'expo-font',
    'expo-sharing',
    [
      'expo-notifications',
      {
        icon: './assets/brand/notification-icon.png',
        color: '#7b61ff',
      },
    ],
    [
      'expo-build-properties',
      {
        // Expo 58 libraries compile against API 37; the app targets API 36 (Play's requirement for new apps).
        android: {
          compileSdkVersion: 37,
          targetSdkVersion: 36,
        },
      },
    ],
    // The NDK already installed in the build toolchain.
    ['./plugins/with-ndk-version.js', { version: '27.3.13750724' }],
    './plugins/with-wallet-queries.js',
    // Windows' path limit: CMake hashes long object names instead of failing
    './plugins/with-short-object-paths.js',
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
