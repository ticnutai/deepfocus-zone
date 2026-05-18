## מטרה

להפוך את "גיבוי ושחזור" למערכת מלאה שמגבה במפורש: **קטגוריות**, **כרטיסיות**, ו**השיוך ביניהן** (טבלת `card_categories` שעד היום לא נכללה כלל), עם גיבוי יומי אוטומטי, שמירה כפולה (ענן + JSON להורדה), ושאלה לפני כל שחזור.

---

## 1. הרחבת מודל המצב (state)

קובץ: `src/lib/study/types.ts`, `src/lib/study/store.ts`

הוספת מערך חדש למצב:
```ts
cardCategories: { id: string; cardId: string; categoryId: string; sortOrder: number }[]
```
- טעינה מ-`public.card_categories` ב-bootstrap (הוספה ל-`get_bootstrap_snapshot` RPC או query נפרד).
- סינכרון דו-כיווני: כשמוסיפים/מסירים שיוך → insert/delete בענן.

זה הכרחי כי הכרטיסים שזה עתה ייבאנו (13,207 שיוכים) לא מופיעים באפליקציה — המודל המקומי לא יודע עליהם.

---

## 2. הרחבת ה-Snapshot

קובץ: `src/lib/study/backup.ts`

```ts
export interface BackupSnapshot {
  version: 2;                       // bump
  data: {
    cards, categories, decks, goals, ...   // קיים
    cardCategories: CardCategoryLink[];    // ← חדש
  }
}
```
- `buildSnapshot` יכלול את `state.cardCategories`.
- `parseJsonBackup` ידע להתמודד גם עם v1 (ללא שיוכים) וגם v2.

---

## 3. גיבוי סלקטיבי (לפי בקשת המשתמש)

קומפוננטה חדשה: `src/components/study/BackupScopeDialog.tsx`

תיבת דו-שיח עם 3 צ'קבוקסים:
- ☑ קטגוריות בלבד (`categories`)
- ☑ כרטיסיות בלבד (`cards`)
- ☑ שיוכים בלבד (`cardCategories`)
- או "הכל" (ברירת מחדל)

הכפתורים בעמוד `BackupRestorePage` ירוצו דרך הדיאלוג הזה.

---

## 4. גיבוי יומי אוטומטי

קובץ: `src/lib/study/autoBackup.ts` (קיים — נרחיב)

- בכל טעינת אפליקציה: בדוק `lastAutoBackupAt` ב-`user_settings.ui_prefs`.
- אם חלפו ≥24 שעות: צור snapshot ושמור ל-`user_backups` עם `name = "אוטומטי YYYY-MM-DD"`.
- שמירה על מקסימום 7 גיבויים אוטומטיים (FIFO — מחק ישנים).
- אינדיקטור קטן בסטטוס למעלה: "✓ גובה היום ב-08:34".

---

## 5. הורדת JSON

קיים כבר — נוודא שכולל את `cardCategories` ב-v2 ושיש כפתור נפרד "📥 הורד כ-JSON".

---

## 6. שחזור עם אישור

קומפוננטה: `src/components/study/RestoreConfirmDialog.tsx`

לפני כל שחזור:
- הצג סיכום: "X כרטיסיות, Y קטגוריות, Z שיוכים יישוחזרו"
- בחירת אסטרטגיה:
  - 🔁 **החלפה מלאה** — מוחק הכל ומחליף
  - ➕ **מיזוג חכם** — מוסיף רק חסרים
  - 🎯 **בחירה ידנ