import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { HDate } from "@hebcal/core";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const HEB_WEEKDAYS = ["יום ראשון", "יום שני", "יום שלישי", "יום רביעי", "יום חמישי", "יום שישי", "שבת"];

/**
 * Formats a date as a Hebrew calendar date string with gematriya
 * (e.g. "כ״ב אייר תשפ״ו"). Pass withWeekday=true to prepend the
 * Hebrew day name (e.g. "יום שלישי, כ״ב אייר תשפ״ו").
 */
export function toHebrewDate(date: Date | number | string, withWeekday = false): string {
  const d =
    typeof date === "number" ? new Date(date)
    : typeof date === "string" ? new Date(date.length === 10 ? date + "T00:00:00" : date)
    : date;
  let core = "";
  try {
    const hd = new HDate(d);
    // renderGematriya returns e.g. "כ״ב אייר תשפ״ו"
    core = hd.renderGematriya(true);
  } catch {
    core = new Intl.DateTimeFormat("he-u-ca-hebrew", {
      day: "numeric", month: "long", year: "numeric",
    }).format(d);
  }
  return withWeekday ? `${HEB_WEEKDAYS[d.getDay()]}, ${core}` : core;
}

/**
 * Returns a Hebrew year in gematria format, e.g. 5786 → "תשפ״ו".
 * Omits the millennium (5000) as is conventional.
 */
export function hebrewYearGematriya(year: number): string {
  try {
    const hd = new HDate(1, 7, year); // א׳ תשרי
    const full = hd.renderGematriya(true); // e.g. "א׳ תשרי תשפ״ו"
    const parts = full.trim().split(/\s+/);
    return parts[parts.length - 1];
  } catch {
    return String(year);
  }
}

/** Hebrew months ordered from Tishrei (civil new year) */
export const HEB_MONTHS = [
  { num: 7, name: "תשרי" },
  { num: 8, name: "חשון" },
  { num: 9, name: "כסלו" },
  { num: 10, name: "טבת" },
  { num: 11, name: "שבט" },
  { num: 12, name: "אדר א׳" },
  { num: 13, name: "אדר ב׳" },
  { num: 1,  name: "ניסן" },
  { num: 2,  name: "אייר" },
  { num: 3,  name: "סיון" },
  { num: 4,  name: "תמוז" },
  { num: 5,  name: "אב" },
  { num: 6,  name: "אלול" },
] as const;

/**
 * Converts a Hebrew date (day 1-30, month number per HDate enum, Hebrew year)
 * to a Gregorian YYYY-MM-DD string. Returns null on invalid input.
 */
export function fromHebrewDate(day: number, month: number, year: number): string | null {
  try {
    const hd = new HDate(day, month, year);
    const d = hd.greg();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  } catch {
    return null;
  }
}

/**
 * Calculates the calendar date after `daysNeeded` active study days,
 * skipping the specified weekdays (0=Sun…6=Sat) and recurring MM-DD dates.
 */
export function calcEtaDate(
  daysNeeded: number,
  skipWeekdays: number[] = [],
  skipDates: string[] = [],
): Date {
  if (daysNeeded <= 0) return new Date();
  const d = new Date();
  let remaining = daysNeeded;
  let safety = 0;
  while (remaining > 0 && safety < 3650) {
    d.setDate(d.getDate() + 1);
    safety++;
    if (skipWeekdays.includes(d.getDay())) continue;
    const mmdd = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (skipDates.includes(mmdd)) continue;
    remaining--;
  }
  return d;
}
