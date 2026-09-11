import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const failures = [];
const requireText = (source, text, description) => {
  if (!source.includes(text)) failures.push(description);
};
const forbid = (source, pattern, description) => {
  if (pattern.test(source)) failures.push(description);
};

const moderation = read("src/components/admin/UserQuestionsTab.tsx");
const users = read("src/components/admin/UsersTab.tsx");
const identity = read("src/lib/admin/userIdentity.ts");
const latestOfflineMigration = read("supabase/migrations/20260911123000_preserve_offline_question_location.sql");
const canonicalPublisher = read("supabase/migrations/20260809120000_fix_offline_question_moderation.sql");
const themeProvider = read("src/theme/ThemeProvider.tsx");
const themeStudio = read("src/theme/ThemeStudioProvider.tsx");
const themeSwitcher = read("src/components/ThemeSwitcher.tsx");

requireText(moderation, 'supabase.rpc("publish_user_question"', "חסר תהליך האישור הקנוני publish_user_question");
requireText(moderation, "replaceCategoryTagsWithShasLocation", "עריכת מנהל אינה מסנכרנת את מיקום השאלה עם עץ הקטגוריות הקיים");
requireText(moderation, "publicUserIdentity", "מסך שאלות המשתמשים אינו משתמש במציג הזהות הקנוני");
requireText(users, "publicUserIdentity", "מסך המשתמשים אינו משתמש במציג הזהות הקנוני");
requireText(identity, "@users.local", "מסנן הזהויות הטכניות אינו מגן מפני כתובות אופליין פנימיות");
forbid(moderation, /profile\?\.email\s*\|\|\s*sourceId|id\.slice\(0,\s*8\)/, "מסך השאלות עדיין עלול להציג מזהה פנימי למנהל");

for (const field of ["masechta", "daf", "amud"]) {
  requireText(latestOfflineMigration, `${field}=excluded.${field}`, `סנכרון שאלה אופליין אינו מעדכן את ${field}`);
}
requireText(canonicalPublisher, "v_original.masechta,v_original.daf,v_original.amud", "פעולת האישור אינה מעתיקה את מיקום השאלה למאגר המרכזי");

const publishCalls = (moderation.match(/supabase\.rpc\("publish_user_question"/g) ?? []).length;
if (publishCalls !== 1) failures.push(`נמצאו ${publishCalls} קריאות אישור יחיד במקום מקור אמת אחד`);

requireText(themeProvider, 'THEME_PREFERENCES_EVENT', "חסר מקור אמת אחד לסנכרון בחירת ערכת הנושא");
requireText(themeStudio, 'PUBLISHED_KEY = "published_theme_system_v1"', "חסר מפתח קנוני יחיד לפרסום ערכת ברירת המחדל");
requireText(themeStudio, 'design-mode-overrides', "חסרה שכבת CSS קבועה נפרדת לעריכה החיה");
requireText(themeStudio, 'design-mode-live-preview', "חסרה שכבת CSS נפרדת לתצוגה המקדימה");
forbid(themeSwitcher, /localStorage\.(?:setItem|getItem)\([^)]*theme/i, "בורר הערכות עוקף את ThemeProvider ויוצר שמירה מקבילה");

if (failures.length) {
  console.error("בדיקת כפילויות והתנגשויות נכשלה:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("תקין: זהות משתמש, סיווג שאלות, תהליך האישור וערכות הנושא משתמשים במקורות האמת הקיימים ללא זרימה מקבילה.");
