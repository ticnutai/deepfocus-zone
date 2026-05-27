תיקון: בעמוד הבית (`src/pages/Index.tsx`) הסינון של טאבי הטופ-בר לפי חסימה משתמש ב-roles של המשתמש בפועל ומדלג כשהוא אדמין — לכן בעריכת תפקיד (`previewRole` ב-URL) כלום לא מוסתר.

מה אעשה:
1. לקרוא את `previewRole` מה-query string.
2. כשקיים `previewRole`: להשתמש ב-`[previewRole]` עבור `roleIdsForBlocklist` במקום ה-roles של האדמין.
3. בסינון `visibleTabs`: כשקיים `previewRole`, להחיל את חסימת הסיידבר גם על אדמין (לעקוף את `!isAdmin`).
4. אימות שהשינוי משפיע גם על הטופ-בר וגם על הסיידבר (הסיידבר כבר מטפל ב-previewRole).