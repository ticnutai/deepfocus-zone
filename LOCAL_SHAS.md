# ש"ס מקומי — ברירת המחדל של האפליקציה (Offline-First)

האפליקציה טוענת את טקסט הגמרא **מהמאגר המקומי** שמצורף לה, ורק אם עמוד חסר —
נופלת ל-Sefaria אונליין. באלקטרון זה עובד **אופליין מלא** כחלק מקובץ ההתקנה.

---

## 1. הנתונים

```
public/shas/
├── index.json            ← אינדקס ניווט: 37 מסכתות, דפים, עמודים, פירושים
└── {Slug}/{daf}{a|b}.json  ← עמוד אחד לקובץ, למשל Bava_Kamma/2a.json
```

- 37 מסכתות · 5,375 עמודים · ~128MB (JSON ממוזער).
- מקור: Sefaria (מהדורת וילנא), הורדה מקומית מלאה.
- כל עמוד: `gemara[]` + `commentaries[]` (רש"י, תוספות, רשב"ם, ר"ן, ר"י מיגאש,
  רבינו גרשום, רמב"ן, רשב"א, ריטב"א, יד רמה — לפי המסכת) +
  `available_commentaries` + `segment_counts`.
- ה-`Slug` זהה לפלט `masechtaSlug()` שב-`src/lib/study/sefaria.ts` (למשל `Rosh_Hashanah`).

### עדכון/יצירה מחדש של הנתונים
המקור: `gemaraca/שס_ספריא` (ראה שם `BUILD.md` להסבר איך הוא נבנה).
```bash
node scripts/import-local-shas.mjs
# או ממקור אחר:
node scripts/import-local-shas.mjs --source "D:\path\to\שס_ספריא"
```

## 2. שכבת הטעינה — `src/lib/study/localShas.ts`

- `fetchLocalAmud(slug, daf, "a"|"b")` → העמוד המלא (גמרא+פירושים) או `null`.
- `fetchLocalShasIndex()` → אינדקס הניווט או `null`.
- `parseBavliRef("Berakhot.2a")` → זיהוי ref של בבלי.
- `stripTags()` → ניקוי תגיות HTML.

סדר נסיונות בכל טעינה:
1. **אלקטרון:** `shas://local/<path>` (פרוטוקול מקומי, ראה §4).
2. **Web/dev/PWA:** `fetch(BASE_URL + "shas/<path>")` — מוגש מ-public/.
3. `null` → הקורא נופל ל-Sefaria אונליין.

## 3. נקודות החיבור (מה שונה)

| קובץ | פונקציה | התנהגות עכשיו |
|---|---|---|
| `src/lib/study/sefaria.ts` | `fetchSefariaDaf()` | מקומי → אונליין. משרת את `GemaraViewer` (טאב לימוד דף). |
| `src/lib/ai/sefariaClient.ts` | `fetchSefariaText()` | עברית מקומית; תרגום אנגלי מושלם אונליין אם זמין (best-effort). משרת את מחולל השאלות AI. |
| `src/components/study/SefariaTextViewer.tsx` | `fetchSefariaText(ref)` | refs של בבלי → מקומי קודם; משנה/תנ"ך → אונליין (אין אותם במאגר). |

לא שונו: קישורי "פתח ב-Sefaria" (חיצוניים), משנה/חומש/נ"ך (אונליין), שו"ע.

## 4. אלקטרון — אופליין מלא

- `vite build` מעתיק את `public/shas` אל `dist/shas`; electron-builder אורז את
  `dist/**` לתוך ה-asar → **הנתונים חלק מקובץ ההתקנה** (אין תלות ברשת).
- דף שנטען מ-`file://` לא יכול לעשות `fetch` לקבצים מקומיים, לכן
  `electron/main.cjs` רושם פרוטוקול `shas://` שמגיש את הקבצים מתוך החבילה
  (`fs.readFile` — קורא גם מתוך asar). ב-dev הוא מגיש מ-`public/shas`.
- הזיהוי ברנדרר: userAgent מכיל "Electron" → מנסה `shas://local/...` קודם.

## 5. Web / PWA

- ה-JSONים מוגשים סטטית מ-`/shas/...` (נכללים ב-deploy).
- **לא** ב-precache של ה-service worker (הוחרגו ב-`vite.config.ts`) כדי לא
  להוריד 128MB בהתקנת PWA; במקום זה `CacheFirst` בזמן ריצה — עמוד שנצפה
  נשמר לאופליין.

## 6. הערות

- **תמיד** אינה במאגר (לא בסט ההורדה) → תיפול תמיד לאונליין.
- **שקלים** קיימת אך ללא רש"י/תוספות (מבוססת ירושלמי).
- **אנדרואיד (Capacitor):** `dist` נארז ל-APK — יגדיל אותו ב-~128MB. אם זה
  בעיה ל-Play, אפשר להחריג את `dist/shas` בבניית אנדרואיד ולהישאר שם אונליין.
- להצגת פירושים (רש"י/תוספות/…) ב-UI: `fetchLocalAmud()` כבר מחזיר את הכל —
  `available_commentaries` אומר מה קיים בעמוד, מוכן לבניית טוגלים.
