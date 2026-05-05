import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Database, Loader2 } from "lucide-react";
import { toast } from "sonner";

export function BackupButton() {
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/public/hooks/daily-backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggered_by: "manual" }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Backup failed");
      toast.success(`✅ نسخة احتياطية: ${json.tables} جدول · ${json.rows} سجل`);
    } catch (e: any) {
      toast.error("فشل: " + e.message);
    }
    setLoading(false);
  };

  return (
    <Button onClick={run} disabled={loading} variant="outline" className="gap-2">
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
      نسخة احتياطية الآن
    </Button>
  );
}
