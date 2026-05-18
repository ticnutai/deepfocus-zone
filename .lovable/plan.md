## מטרה
להוסיף בחירה-מרובה אחידה עם toolbar צף "בחר הכל / נקה הכל" בכל מקום שמוצגות שאלות, קטגוריות, גיבויים או פריטים אחרים.

## ארכיטקטורה משותפת
קובץ חדש: `src/hooks/useMultiSelect.ts`
```ts
useMultiSelect<T>(items, getId) → {
  selected, toggle, toggleAll, clear, isSelected, count, allSelected, anySelected
}
```

קומפוננטה חדשה: `src/components/study/MultiSelectToolbar.tsx`
- צף בראש הרשימה (sticky top), מופיע רק כש-`anySelected`
- כפתורים: בחר הכל / נקה / מחק / שכפל / ייצא / חזרה (Undo) + actions מותאמים
- תומך RTL, מציג "X נבחרו"

## מיקומים שיקבלו את המערכת

### 1. `CardsManager.tsx` (כרטיסיות)
- צ'קבוקס בכל שורה
- toolbar עם: מחיקה, שכפול, ייצוא JSON/CSV, העברה לדק אחר, Undo

### 2. `CategoryExplorerView.tsx` + `CategoryBrowseView.tsx` (עץ קטגוריות)
- צ'קבוקס ליד כל קטגוריה (כולל ענפים)
- toolbar עם: מחיקה מרובה, מיזוג, ייצוא, Undo

### 3. `BackupRestorePage.tsx` — סקציית ענן
- צ'קבוקס בכל שורת גיבוי בענן
- toolbar עם: מחיקה מרובה, הורדה מרוכזת (ZIP), שחזור מרובה

### 4. `BackupRestorePage.tsx` — סקציית היסטוריה
- אותו דבר על הגיבויים המקומיים

### 5. תצוגות שאלות נוספות
חיפוש: `CardsListView`, `DeckCardsList`, `StudySession` היסטוריה — כל מקום שמציג שורות שאלות יקבל את אותו hook + toolbar.

## פעולות שיתמכו (לפי בקשת המשתמש)
| פעולה | אייקון | תיאור |
|---|---|---|
| בחר הכל / נקה הכל | CheckSquare | toggle — לחיצה חוזרת מבטלת |
| מחיקה מרובה | Trash2 | עם dialog אישור |
| שחזור מרובה | Upload | מתוך גיבויים |
| ייצוא/הורדה | Download | JSON/CSV/ZIP |
| העתקה | Copy | שכפול הפריטים |
| ביטול (Undo) | Undo2 | stack של 5 פעולות אחרונות |

## מנגנון Undo
`src/lib/study/undoStack.ts` — מחזיק את 5 הפעולות האחרונות (מחיקה/שכפול/וכו') עם snapshot של המצב לפני. כפתור Ctrl+Z / כפתור Undo ב-toolbar.

## תנאי תצוגה
ה-toolbar יוצג **רק כשנבחר לפחות פריט אחד** (לפי בחירת המשתמש). כפתור "בחר הכל" יהיה תמיד נגיש דרך header קטן בכל רשימה.

## סדר ביצוע (אינקרמנטלי)
1. צור hook + toolbar + undoStack משותפים
2. החל על CardsManager (העיקרי)
3. החל על סקציית ענן ב-BackupRestorePage
4. החל על עץ הקטגוריות
5. החל על שאר התצוגות

זה ייעשה בהדרגה — נתחיל ב-3 הראשונים ונבדוק תוצאה לפני המשך.