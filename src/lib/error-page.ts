// Self-contained HTML error page. MUST NOT import any app code — it's the
// last-resort fallback when the SSR bundle itself fails to initialize.
export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Steinheim Suite — حدث خطأ مؤقت</title>
<style>
  :root { color-scheme: dark; }
  html, body { margin:0; padding:0; height:100%; background:#0b0b0c; color:#f5f5f5;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
  .wrap { min-height:100%; display:flex; align-items:center; justify-content:center; padding:24px; }
  .card { max-width:420px; text-align:center; }
  .icon { width:64px; height:64px; border-radius:9999px; background:rgba(239,68,68,.12);
    display:flex; align-items:center; justify-content:center; margin:0 auto 20px; color:#ef4444; font-size:32px; }
  h1 { margin:0 0 8px; font-size:22px; font-weight:700; }
  p { margin:0 0 24px; color:#a1a1aa; font-size:14px; line-height:1.6; }
  .btns { display:flex; gap:10px; justify-content:center; flex-wrap:wrap; }
  button, a.btn { appearance:none; border:0; border-radius:10px; padding:10px 18px; font-size:14px;
    font-weight:600; cursor:pointer; text-decoration:none; display:inline-block; }
  .primary { background:#f5f5f5; color:#0b0b0c; }
  .secondary { background:transparent; color:#f5f5f5; border:1px solid rgba(255,255,255,.18); }
</style>
</head>
<body>
  <div class="wrap"><div class="card">
    <div class="icon">⚠️</div>
    <h1>حدث خطأ مؤقت</h1>
    <p>السيرفر مش قادر يجاوب دلوقتي. جرّب تحدّث الصفحة، ولو المشكلة استمرّت رجع للصفحة الرئيسية.</p>
    <div class="btns">
      <button class="primary" onclick="(async()=>{try{if('caches' in window){const ks=await caches.keys();await Promise.all(ks.map(k=>caches.delete(k)));}if('serviceWorker' in navigator){const rs=await navigator.serviceWorker.getRegistrations();await Promise.all(rs.map(r=>r.unregister()));}}catch(e){}location.reload();})()">تحديث الصفحة</button>
      <a class="btn secondary" href="/">الصفحة الرئيسية</a>
    </div>
  </div></div>
</body>
</html>`;
}
