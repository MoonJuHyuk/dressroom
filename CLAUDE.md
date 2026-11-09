# Dressroom — notes for Claude

Read `docs/작업안내서.md` first. The owner is a non-developer; reply in Korean, keep explanations plain, and do browser/PC setup work yourself where you can.

- Static PWA, no build step, GitHub Pages from `main` (repo `MoonJuHyuk/dressroom`). Same architecture as `MoonJuHyuk/sool-gotgan`.
- Data: Google Sheet "Dressroom" (tab `Items`, `요약`) via the Apps Script web app in `apps-script/Code.gs` (POST text/plain JSON with `secret`). Photos in Drive folder "Dressroom 사진"; `photos` column = comma-separated Drive file IDs.
- AI (optional, Claude API key in script properties): `js/ai.js` — `lookupModel` (model name → suggestions only, never auto-saved; blank beats guess) and `matchShopping` (shop photo vs home thumbnails from the `thumbs` action).
- The owner explicitly does NOT want AI to fill fields from photos. Entry is manual.
- On every app change bump `VERSION` in both `js/app.js` and `sw.js`.
- New sheet columns go at the end of `FIELDS` only; then save script → insert column → deploy new version of the same deployment.
- The live Code.gs in the Apps Script editor has `WEB_APP_URL` filled in; the repo copy keeps it blank. Never commit the connect link or secret.
