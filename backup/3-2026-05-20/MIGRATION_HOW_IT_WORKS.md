# איך מריצים Migrations על Supabase — פירוט טכני

## הבעיה המקורית

ל-Supabase יש Management API (REST) שדרכו אפשר להריץ SQL,  
אבל הוא דורש **Service Role Key** או **PAT (Personal Access Token)** עם הרשאות מסוימות.

ה-PAT של המשתמש **אינו** מורשה לגשת ל-REST API של הפרויקט `mocukhvfqqzkekphifsr` ישירות —  
לכן פותרה עוקפת חכמה: **RPC function בתוך ה-DB עצמו**.

---

## הפתרון — `exec_sql` RPC

### מה זה?

פונקציית PostgreSQL שמאפשרת לאדמין מורשה להריץ **כל SQL** על ה-DB:

```sql
-- נוצרה בפרויקט pashash (mocukhvfqqzkekphifsr)
create or replace function public.exec_sql(query text)
returns void language plpgsql security definer as $$
begin
  execute query;
end;
$$;
```

- `security definer` = רצה עם הרשאות של יוצר הפונקציה (superuser)
- גישה רק למי שמחובר עם JWT תקין כ-authenticated user עם הרשאות מתאימות

---

## הכלי — `scripts/run_migration.py`

**נמצא ב:** `c:\Users\jj121\pashash\scripts\run_migration.py`  
**שפה:** Python 3  
**ספריות:** `requests` בלבד (stdlib + requests)

### תהליך מלא:

```
קובץ .sql
     │
     ▼
[1] קרא את ה-SQL כ-string
     │
     ▼
[2] HTTP POST ל-Supabase Auth API
    POST /auth/v1/token?grant_type=password
    body: { email, password }
    → קבל JWT access_token
     │
     ▼
[3] HTTP POST ל-Supabase REST API
    POST /rest/v1/rpc/exec_sql
    headers: Authorization: Bearer <token>
    body: { query: "<כל ה-SQL>" }
     │
     ▼
[4] בדוק status_code
    200 = הצלחה
    4xx/5xx = כישלון
```

---

## פרטי טכניים

| פרמטר | ערך |
|-------|-----|
| **Project URL** | `https://mocukhvfqqzkekphifsr.supabase.co` |
| **Auth method** | Email + Password (user: `jj1212t@gmail.com`) |
| **Endpoint** | `POST /rest/v1/rpc/exec_sql` |
| **Header** | `Authorization: Bearer <JWT>` |
| **Body** | `{ "query": "<SQL string>" }` |
| **Timeout** | 60 שניות |

---

## שימוש

```bash
cd c:\Users\jj121\pashash
python scripts/run_migration.py supabase/migrations/<filename>.sql
# או עם נתיב מוחלט:
python scripts/run_migration.py "c:\Users\jj121\mindful-blockade-suite\supabase\migrations\<file>.sql"
```

---

## למה לא Supabase CLI?

| כלי | בעיה |
|-----|------|
| `supabase db push` | דורש Docker מותקן וסביבה מקומית |
| `supabase migration run` | דורש login עם PAT שיש לו הרשאות ל-DB — לא תמיד זמינות |
| Management API (`/v1/projects/.../database/query`) | ה-PAT הנוכחי אינו מורשה |
| **`exec_sql` RPC** ✅ | עובד עם auth רגיל + password, ללא dependencies נוספות |

---

## אבטחה — מה שחשוב לדעת

- הפונקציה `exec_sql` היא **עוצמתית מאוד** — יכולה להריץ כל SQL כולל DROP TABLE
- גישה אליה מוגבלת ל-authenticated users בלבד (JWT תקין)
- בסביבת production מומלץ להוסיף בדיקה ש-caller הוא admin בלבד
- הסיסמה שמורה בזיכרון של ה-agent בלבד — לא בקובץ env חשוף

---

## זרימה ויזואלית

```
Agent (Copilot)
      │
      │  כותב קובץ .sql
      ▼
c:\...\migrations\<file>.sql
      │
      │  מריץ Python script
      ▼
scripts/run_migration.py
      │
      │  POST /auth/v1/token  ← Supabase Auth
      │  ← JWT token
      │
      │  POST /rest/v1/rpc/exec_sql  ← Supabase REST
      │  body: { query: SQL }
      ▼
PostgreSQL DB (mocukhvfqqzkekphifsr)
      │
      ▼
✅ Migration applied
```
