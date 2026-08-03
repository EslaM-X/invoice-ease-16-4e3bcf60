// Electron main process — wraps the Steinheim company system into a
// Windows / macOS desktop app.
//
// The desktop build is ONLINE-FIRST: it loads the live company system so every
// device shares the exact same realtime data. There is no local database.
//
// Build steps (run on a Windows or macOS machine — see CAPACITOR_BUILD.md):
//   npm run electron:setup            # one-time: installs electron + packager
//   npm run electron:dev              # try the desktop window locally
//   npm run electron:build:win        # Windows x64 folder + .exe
//   npm run electron:build:mac        # macOS universal .app

const {
  app,
  BrowserWindow,
  Menu,
  shell,
  Notification,
  dialog,
} = require("electron");
const path = require("path");
const fs = require("fs");

const PROD_URL = process.env.STEINHEIM_URL || "https://admin.steinheim-eg.com";
const STATE_FILE = () => path.join(app.getPath("userData"), "window-state.json");

app.setAppUserModelId("com.steinheim.app");

/* ---------------------------------- state --------------------------------- */

function readWindowState() {
  try {
    const raw = fs.readFileSync(STATE_FILE(), "utf8");
    const s = JSON.parse(raw);
    if (typeof s.width === "number" && typeof s.height === "number") return s;
  } catch {
    /* first launch */
  }
  return { width: 1400, height: 900 };
}

function saveWindowState(win) {
  try {
    if (win.isDestroyed()) return;
    const b = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
    fs.writeFileSync(
      STATE_FILE(),
      JSON.stringify({ ...b, maximized: win.isMaximized() }),
      "utf8",
    );
  } catch {
    /* ignore */
  }
}

/* ------------------------------ offline screen ----------------------------- */

function offlineHtml(message) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`
<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Steinheim</title>
<style>
  html,body{height:100%;margin:0}
  body{background:#0a0a0a;color:#f5f5f5;display:grid;place-items:center;
       font-family:system-ui,"Segoe UI",Tahoma,sans-serif;text-align:center}
  .card{max-width:420px;padding:32px}
  .dot{width:56px;height:56px;border-radius:50%;margin:0 auto 20px;
       background:radial-gradient(circle at 30% 30%,#d4af37,#8a6d1f);
       box-shadow:0 0 40px rgba(212,175,55,.35)}
  h1{font-size:20px;margin:0 0 8px}
  p{color:#a3a3a3;font-size:14px;line-height:1.8;margin:0 0 24px}
  button{background:#d4af37;color:#0a0a0a;border:0;border-radius:10px;
         padding:11px 26px;font-size:14px;font-weight:700;cursor:pointer}
  small{display:block;margin-top:18px;color:#525252;font-size:11px}
</style></head><body><div class="card">
  <div class="dot"></div>
  <h1>لا يوجد اتصال بالإنترنت</h1>
  <p>نظام الشركة بيشتغل بالبيانات اللحظية من السحابة.<br/>راجع الاتصال والتطبيق هيرجع تلقائيًا.</p>
  <button onclick="location.reload()">إعادة المحاولة</button>
  <small>${message || ""}</small>
</div></body></html>`)}`;
}

/* --------------------------------- window --------------------------------- */

let mainWindow = null;
let retryTimer = null;

function loadApp(win) {
  // Local build (dist/index.html) is only used when it exists — normally the
  // desktop app points at the live system so data stays shared and realtime.
  const localIndex = path.join(__dirname, "..", "dist", "index.html");
  if (process.env.STEINHEIM_LOCAL === "1" && fs.existsSync(localIndex)) {
    return win.loadFile(localIndex);
  }
  return win.loadURL(PROD_URL);
}

function scheduleRetry(win) {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    if (!win.isDestroyed()) loadApp(win).catch(() => {});
  }, 5000);
}

function createWindow() {
  const state = readWindowState();

  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#0a0a0a",
    autoHideMenuBar: true,
    show: false,
    title: "Steinheim",
    icon: path.join(__dirname, "..", "public", "favicon.ico"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false, // keep realtime sockets alive when minimized
    },
  });

  mainWindow = win;
  if (state.maximized) win.maximize();

  win.once("ready-to-show", () => win.show());

  // Grant camera / microphone / notifications for our own origin only
  // (voice + video calls and push alerts inside the app).
  win.webContents.session.setPermissionRequestHandler((wc, permission, cb) => {
    const url = wc.getURL() || PROD_URL;
    const sameOrigin = url.startsWith(PROD_URL);
    const allowed = ["media", "notifications", "clipboard-sanitized-write", "fullscreen"];
    cb(sameOrigin && allowed.includes(permission));
  });

  // Screen sharing picker support (LiveKit): allow display capture on our origin.
  if (win.webContents.session.setDisplayMediaRequestHandler) {
    win.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
      callback({ video: request.frame, audio: "loopback" });
    });
  }

  // External links open in the default browser; in-app navigation stays inside.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(PROD_URL)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(PROD_URL) && !url.startsWith("data:")) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Network failure → friendly offline screen + automatic retry.
  win.webContents.on("did-fail-load", (_e, code, description, validatedURL, isMainFrame) => {
    if (!isMainFrame || code === -3 /* aborted */) return;
    win.loadURL(offlineHtml(`${description} (${code})`));
    scheduleRetry(win);
  });

  win.on("close", () => saveWindowState(win));
  win.on("closed", () => {
    if (retryTimer) clearTimeout(retryTimer);
    mainWindow = null;
  });

  loadApp(win).catch((error) => {
    win.loadURL(offlineHtml(String(error)));
    scheduleRetry(win);
  });

  return win;
}

/* ---------------------------------- app ----------------------------------- */

// Single instance — clicking the shortcut again focuses the open window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    createWindow();

    if (Notification.isSupported()) {
      // Warms up the Windows toast channel so the first in-app notification
      // is delivered immediately instead of being dropped.
      new Notification({ title: "Steinheim", body: "التطبيق جاهز", silent: true });
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  process.on("uncaughtException", (error) => {
    try {
      dialog.showErrorBox("Steinheim", String(error && error.stack ? error.stack : error));
    } catch {
      /* ignore */
    }
  });
}
