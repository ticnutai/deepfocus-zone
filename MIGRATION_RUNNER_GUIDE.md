# 🚀 מדריך הרצת מיגרציות — deepfocus-zone

## פרטי הפרויקט
- **תיקייה:** `c:\Users\jj121\OneDrive\שולחן העבודה\deepfocus-zone`
- **Supabase URL:** `https://elfxevuxhffxskooppca.supabase.co`
- **Project ID:** `elfxevuxhffxskooppca`
- **Admin:** `jj1212t@gmail.com` / `543211`

## מה זה עושה?
הכלי מריץ SQL על Supabase דרך RPC בשם `exec_sql`.

הכלי הרשמי הוא:

```text
scripts/run-migration.mjs
```

## שלב 1: כניסה לתיקיית הפרויקט

```powershell
cd "c:\Users\jj121\OneDrive\שולחן העבודה\deepfocus-zone"
```

## שלב 2: הרצת מיגרציה מקובץ SQL

```powershell
node scripts/run-migration.mjs file "supabase/migrations/<filename>.sql"
```

זה השימוש הכי מומלץ למיגרציות אמיתיות.

## שלב 3: הרצת SQL ישיר (מהיר)

```powershell
node scripts/run-migration.mjs sql "SELECT now();" "health_check"
```

השם בסוף (`health_check`) הוא אופציונלי ונועד ללוגים.

## איך מזינים פרטי התחברות?

ברירת מחדל הכלי משתמש ב-`jj1212t@gmail.com` / `543211` אוטומטית.
אפשר לדרוס עם Environment Variables:

```powershell
$env:ADMIN_EMAIL="jj1212t@gmail.com"; $env:ADMIN_PASSWORD="543211"
node scripts/run-migration.mjs file "supabase/migrations/<filename>.sql"
```

## פקודות נתמכות

1. `file <path>`
2. `sql "..." [name]`

## איפה שמים קבצי מיגרציה?

```text
supabase/migrations/
```

דוגמה לשם טוב:

```text
20260528120000_add_some_feature.sql
```

## בדיקה אחרי הרצה

אם הצליח תראה:

```text
✅ Migration completed successfully!
🏁 Done!
```

## פתרון תקלות מהיר

1. `Login failed` — הסיסמה/אימייל לא נכונים
2. `exec_sql returned failure: Admin access required` — המשתמש לא ב-whitelist של exec_sql
3. `syntax error` — יש שגיאת SQL בקובץ

## סיכום קצר

1. תמיד להריץ מה-root של הפרויקט.
2. הכי טוב לעבוד עם `file` ולא עם `sql` למיגרציות קבועות.
3. לפני הרצה בפרודקשן, לבדוק קודם בסביבת dev/staging.
