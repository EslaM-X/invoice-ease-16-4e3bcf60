import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor config for Steinheim app.
 *
 * Build pipeline:
 *   1. `bun run build`              → produces /dist (web bundle)
 *   2. `npx cap sync`               → copies /dist into android/ios native projects
 *   3a. Android:  `npx cap open android`  → Android Studio → Build APK
 *   3b. iOS:      `npx cap open ios`      → Xcode → Archive → IPA
 *   3c. Desktop:  `bun run build:desktop` (Electron) → Windows .exe / macOS .dmg
 *
 * OTA updates (Capgo) ship the latest /dist over-the-air without re-installing.
 * See /download in the app for end-user install instructions.
 */
const config: CapacitorConfig = {
  appId: "com.steinheim.app",
  appName: "Steinheim",
  webDir: "dist",
  bundledWebRuntime: false,
  server: {
    androidScheme: "https",
    // WARNING: If "url" is set, Capacitor loads that remote site instead of the 
    // local bundled files in /dist. This bypasses Capgo OTA updates for local files.
    // To use local files + Capgo OTA: comment out the "url" line below.
    // url: "https://admin.steinheim-eg.com",
    cleartext: false,
  },
  ios: {
    contentInset: "always",
    backgroundColor: "#0a0a0a",
  },
  android: {
    backgroundColor: "#0a0a0a",
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: "#0a0a0a",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    CapacitorUpdater: {
      // Capgo OTA — set autoUpdate=true once CAPGO_APP_ID env is wired
      autoUpdate: true,
      directUpdate: true,
      resetWhenUpdate: false,
    },
  },
};

export default config;
