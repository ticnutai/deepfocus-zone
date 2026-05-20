import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Brain } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  getSrsAlgorithm, setSrsAlgorithm,
  getRetentionTarget, setRetentionTarget,
  type SrsAlgorithm,
} from "@/lib/study/srs";

export function SrsAlgorithmSettings() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [algo, setAlgo] = useState<SrsAlgorithm>("sm2");
  const [retention, setRetention] = useState(0.9);

  useEffect(() => {
    setAlgo(getSrsAlgorithm(userId));
    setRetention(getRetentionTarget(userId));
  }, [userId]);

  if (!userId) return null;

  return (
    <Card className="gold-frame p-5 space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-bold flex items-center gap-2">
          <Brain className="h-5 w-5 text-gold" />
          אלגוריתם חזרה
        </h3>
      </div>

      <div className="space-y-2">
        <Label>אלגוריתם</Label>
        <Select
          value={algo}
          onValueChange={(v) => {
            const a = v as SrsAlgorithm;
            setAlgo(a);
            setSrsAlgorithm(userId, a);
          }}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="sm2">SM-2 (קלאסי, פשוט ויציב)</SelectItem>
            <SelectItem value="fsrs">FSRS (חכם, מבוסס מודל זיכרון)</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {algo === "fsrs"
            ? "FSRS מתאים מרווחים לפי קושי כרטיס וזמן מהחזרה האחרונה — דיוק חיזוי גבוה יותר."
            : "SM-2 (Anki-style) — איזון בין פשטות ליציבות."}
        </p>
      </div>

      {algo === "fsrs" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-foreground">{Math.round(retention * 100)}%</span>
            <Label>יעד שמירה (Retention Target)</Label>
          </div>
          <Slider
            min={0.7}
            max={0.97}
            step={0.01}
            value={[retention]}
            onValueChange={(vals) => {
              const v = vals[0];
              setRetention(v);
              setRetentionTarget(userId, v);
            }}
          />
          <p className="text-xs text-muted-foreground">
            יעד גבוה = מרווחים קצרים יותר, יותר חזרות, פחות שכחה. מומלץ 85%-92%.
          </p>
        </div>
      )}
    </Card>
  );
}
