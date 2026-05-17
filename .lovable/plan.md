## מה בודקים ומתקנים

### 1. דראג אנד דרופ ברור וגלוי במצב עריכה
- כיום ב-`WidgetGrid` (mode ברירת מחדל `inlineDrag=true`) משתמשים ב-`@dnd-kit` עם `useSortable`, אבל ידית הגרירה ממוקמת רק בצד אחד וסביר שלא ניתן לזהות אותה.
- אוסיף **ידית גרירה גדולה וברורה** בראש כל ווידג'ט במצב עריכה (אייקון `GripVertical` + רקע זהב + tooltip "גרור לסדר מחדש").
- כל הווידג'ט יקבל `cursor: grab` במצב עריכה, ו-`cursor: grabbing` בזמן גרירה.
- אנימציית "ריחוף" עדינה במצב עריכה כדי להמחיש שאפשר לגרור.

### 2. שמירת פריסה/גודל אמינה אחרי רענון ובין מכשירים
- בודק את הצינור הקיים: `setWidgetLayout` → `state.widgetLayout` → `user_settings.widget_layout` בענן + `localStorage` cache + IndexedDB cache.
- ה-IndexedDB נשמר כחלק מ-`saveStudyStateCache` (כל ה-state). אוסיף **debounce + write מיידי** ל-`widgetLayout` בלבד כדי שגם גרירות מהירות לא יתפספסו.
- אוודא שב-hydrate הראשון (`bootstrap`) ה-`widget_layout` מהענן מנצח אם `widget_layout_updated_at` חדש יותר מהקאש המקומי (last-write-wins לפי timestamp).
- במכשיר חדש: בטעינה ראשונה הענן מנצח תמיד; משם, IndexedDB משמש כקאש מיידי לרענון.

### 3. מיגרציה
- העמודה `user_settings.widget_layout` (jsonb) + `widget_layout_updated_at` (timestamptz) — **כבר קיימות**. אין צורך במיגרציה חדשה.
- IndexedDB store `study_state_cache` — **כבר קיים**. גרסת ה-DB לא משתנה.

### 4. בדיקות
- גרור ווידג'ט → לרענן את הדף → לוודא שהסדר נשמר.
- לשנות גודל (חצי↔מלא, גובה) → לרענן → לוודא שמירה.
- להיכנס מאותו משתמש במכשיר/דפדפן אחר → לוודא שאותה פריסה נטענת.

## קבצים שישתנו

- `src/components/study/WidgetGrid.tsx` — שדרוג חוויית ה-DnD: ידית גרירה גדולה, סמן עכבר, אינדיקציה ויזואלית.
- `src/lib/study/store.ts` (פונקציה `setWidgetLayout`) — לוודא כתיבה מיידית ל-IndexedDB + debounce לענן (כבר קיים, אוסיף לוג + לוודא תקינות).

## מה לא נוגעים בו

- סכימת DB (כבר תומכת).
- שאר ה-state ו-sync flow.
