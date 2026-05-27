## הבעיה

ב-`site_settings` הערך של `guest_view_profiles_v1` שמור כ-`[]` ריק, למרות ש-`guest_view_default_profile_id_v1` מצביע על מזהה פרופיל קיים. כלומר ה-`upsert` ל-`site_settings` נכשל בשקט – אבל הקוד לא בודק את `error` שמוחזר מ-Supabase, אז מוצגת הודעת "פרופיל אורח נוצר" למרות שבפועל לא נשמר כלום בענן (רק ב-localStorage המקומי).

## הגורם

הפונקציה `saveGuestViewProfilesToSiteSettings` (ב-`src/lib/auth/guestViewProfile.ts`) דוחפת את כל הפרופילים, **כולל `studySeed` המלא** (כל הקטגוריות/חפיסות/כרטיסים של המשתמש כ-JSON). אצל משתמש עם הרבה כרטיסים זה עובר את גבול גודל הבקשה של PostgREST ומוחזרת שגיאה (לרוב 413/500), אבל בקוד יש:

```ts
await supabase.from("site_settings").upsert([...]);  // לא בודקים error
```

לכן הכישלון נבלע, ה-localStorage כן מתעדכן, וה-UI מציג הצלחה.

## הפתרון

1. **לזרוק שגיאה כשה-upsert נכשל** – בכל הפונקציות שכותבות ל-`site_settings` (`saveGuestViewProfilesToSiteSettings`, `saveGuestDefaultProfileIdToSiteSettings`, ובאופן דומה גם ב-`featureBlocklist` אם רלוונטי), להחזיר `{ error }` ולעשות `if (error) throw new Error(error.message)`. כך המשתמש יראה את הסיבה האמיתית במקום toast "הצלחה" מטעה.

2. **לא לדחוף `studySeed` ל-`site_settings`** – זה הגורם המרכזי לכשלון. נשנה את `saveGuestViewProfilesToSiteSettings` כך שלפני ה-upsert נשמיט את שדה `studySeed` מכל פרופיל (`{ studySeed, ...rest }`). ה-`studySeed` ימשיך להישמר בצד הלקוח (localStorage / IndexedDB) דרך `setGuestProfilesLocal`/`saveGuestViewProfile` ו-`hydrateGuestProfilesFromSiteSettings` כבר ממזג seed מקומי לפרופילים שנמשכו מהענן (יש שם בדיוק לוגיקת `local.studySeed` שמוסיפה אותו חזרה).

3. **תיקון נקודתי גם ב-`GuestProfilesTab.submit`** – אחרי שהאמת תחזור מ-Supabase, ה-`catch` כבר יציג את ההודעה הנכונה. אין צורך לשנות עוד שם.

לאחר התיקון: יצירה של פרופיל חדש תיצור רשומה חוקית ב-`site_settings` (קלת משקל), ה-default יוכל להצביע על פרופיל קיים, ובהיכשלות אמיתית (הרשאות וכו') תוצג שגיאה אמיתית למשתמש במקום הצלחה כוזבת.

## קבצים שיתעדכנו

- `src/lib/auth/guestViewProfile.ts` – הסרת `studySeed` לפני upsert + בדיקת `error` בשתי פונקציות ה-upsert.
