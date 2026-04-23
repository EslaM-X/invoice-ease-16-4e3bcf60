import { useEffect, useRef } from "react";

type Props = { onScan: (text: string) => void; onClose: () => void };

export function QrScanner({ onScan, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<any>(null);

  useEffect(() => {
    let stopped = false;
    (async () => {
      const { Html5Qrcode } = await import("html5-qrcode");
      if (!ref.current || stopped) return;
      const id = "qr-reader-" + Math.random().toString(36).slice(2);
      ref.current.id = id;
      const sc = new Html5Qrcode(id, { verbose: false });
      scannerRef.current = sc;
      try {
        await sc.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (text: string) => { onScan(text); },
          () => {},
        );
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      stopped = true;
      const sc = scannerRef.current;
      if (sc) {
        try { sc.stop().then(() => sc.clear()).catch(() => {}); } catch {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3">
      <div ref={ref} className="overflow-hidden rounded-xl border bg-black/80" style={{ minHeight: 280 }} />
      <button onClick={onClose} className="w-full rounded-md border bg-card px-3 py-2 text-sm">Close</button>
    </div>
  );
}
