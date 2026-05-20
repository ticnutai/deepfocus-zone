import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { DateField, DateRangeFilter } from "@/lib/study/dateFilter";

const DAY = 24 * 60 * 60 * 1000;

const PRESETS: { label: string; from: () => Date; to: () => Date }[] = [
  { label: "היום", from: () => new Date(Date.now() - 0), to: () => new Date() },
  { label: "אתמול", from: () => new Date(Date.now() - DAY), to: () => new Date(Date.now() - DAY) },
  { label: "7 ימים אחרונים", from: () => new Date(Date.now() - 7 * DAY), to: () => new Date() },
  { label: "מלפני שבועיים עד אתמול", from: () => new Date(Date.now() - 14 * DAY), to: () => new Date(Date.now() - DAY) },
  { label: "מלפני חודש עד אתמול", from: () => new Date(Date.now() - 30 * DAY), to: () => new Date(Date.now() - DAY) },
  { label: "מלפני חודש עד לפני שבועיים", from: () => new Date(Date.now() - 30 * DAY), to: () => new Date(Date.now() - 14 * DAY) },
  { label: "מלפני 3 חודשים", from: () => new Date(Date.now() - 90 * DAY), to: () => new Date() },
];

interface Props {
  value: DateRangeFilter;
  onChange: (v: DateRangeFilter) => void;
}

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const endOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

export function DateRangePicker({ value, onChange }: Props) {
  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen, setToOpen] = useState(false);

  const fromDate = value.from ? new Date(value.from) : undefined;
  const toDate = value.to ? new Date(value.to) : undefined;

  const isActive = value.from !== null || value.to !== null;

  return (
    <div dir="rtl" className="rounded-xl border-2 border-gold/40 bg-card p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold">סינון תאריכים</h4>
          <Filter className="h-4 w-4 text-gold" />
        </div>
        {isActive && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange({ ...value, from: null, to: null })}
            className="text-destructive hover:text-destructive h-7"
          >
            <X className="h-3 w-3" /> נקה
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">סנן לפי</Label>
          <Select value={value.field} onValueChange={(v) => onChange({ ...value, field: v as DateField })}>
            <SelectTrigger className="h-8 text-xs border-2 border-gold/40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="createdAt">תאריך הכנסת השאלה</SelectItem>
              <SelectItem value="lastReviewedAt">תאריך חזרה אחרון</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">קיצורי דרך</Label>
          <Select
            value=""
            onValueChange={(v) => {
              const preset = PRESETS.find((p) => p.label === v);
              if (preset) {
                onChange({
                  ...value,
                  from: startOfDay(preset.from()).getTime(),
                  to: endOfDay(preset.to()).getTime(),
                });
              }
            }}
          >
            <SelectTrigger className="h-8 text-xs border-2 border-gold/40">
              <SelectValue placeholder="בחר טווח מהיר..." />
            </SelectTrigger>
            <SelectContent>
              {PRESETS.map((p) => (
                <SelectItem key={p.label} value={p.label}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">מתאריך</Label>
          <Popover open={fromOpen} onOpenChange={setFromOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full h-8 justify-end text-xs font-normal border-2 border-gold/40",
                  !fromDate && "text-muted-foreground",
                )}
              >
                {fromDate ? format(fromDate, "dd/MM/yyyy") : "בחר..."}
                <CalendarIcon className="h-3 w-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={fromDate}
                onSelect={(d) => {
                  onChange({ ...value, from: d ? startOfDay(d).getTime() : null });
                  setFromOpen(false);
                }}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">עד תאריך</Label>
          <Popover open={toOpen} onOpenChange={setToOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full h-8 justify-end text-xs font-normal border-2 border-gold/40",
                  !toDate && "text-muted-foreground",
                )}
              >
                {toDate ? format(toDate, "dd/MM/yyyy") : "בחר..."}
                <CalendarIcon className="h-3 w-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={toDate}
                onSelect={(d) => {
                  onChange({ ...value, to: d ? endOfDay(d).getTime() : null });
                  setToOpen(false);
                }}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  );
}
