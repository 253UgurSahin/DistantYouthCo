# Distant Youth Studio: werkafspraken

## Versies: altijd major.minor.patch
Elke wijziging die de gebruiker krijgt, krijgt een versie volgens Semantic Versioning:
- patch (x.y.Z): alleen reparaties en kleine verbeteringen;
- minor (x.Y.0): iets nieuws, alles wat er was blijft werken;
- major (X.0.0): iets werkt anders, of oude data/links vragen een stap van de gebruiker.

Bij elke versie, in één commit `release: vX.Y.Z`:
1. `version` in `package.json` (en `package-lock.json` via `npm version X.Y.Z --no-git-tag-version`);
2. een blok bovenaan in `CHANGELOG.md` (Nederlands, in gewone woorden: Nieuw / Beter / Reparaties / Beveiliging);
3. een annotated git-tag `vX.Y.Z` op die commit. Pushen (ook van tags) alleen als de gebruiker het vraagt.

De app toont de versie (`/api/session` geeft `version`, uit `package.json` via `src/config.js`).

## Controleren voor een versie
`npm test`, de end-to-end tests (`cd e2e && npx playwright test --project=chromium`) en de wandeling langs alle schermen moeten slagen.
