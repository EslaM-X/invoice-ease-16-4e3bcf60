// Electron main process — wraps the web app into a Windows/macOS desktop app.
//
// Build steps (run on a Windows or macOS machine):
//   1. npm install --save-dev electron @electron/packager
//   2. Set base: './' in vite.config.ts  (already required for file:// loading)
//   3. bun run build
//   4. npx @electron/packager . "Steinheim" \
//        --platform=win32  --arch=x64 --out=electron-release --overwrite   # Windows .exe
//      npx @electron/packager . "Steinheim" \
//        --platform=darwin --arch=universal --out=electron-release --overwrite  # macOS .app
//   5. Zip the output folder and upload to Storage, then publish via /download.

const { app, BrowserWindow, Menu, shell } = require("electron");
const path = require("path");

const PROD_URL = "https://admin.steinheim-eg.com";

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#0a0a0a",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "..", "public", "favicon.ico"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Load the production URL so users always get the latest deployed build
  // (acts like an always-fresh shell + native notifications / shortcuts).
  win.loadURL(PROD_URL);

  // Open external links in the user's default browser, keep app navigation in-app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(PROD_URL)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
