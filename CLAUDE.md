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

De app toont de versie (`/api/session` geeft `version`, uit `package.json` via `backend/node/config.js` en `backend/php/app/bootstrap.php`).

## Mappen
`frontend/` (schermen), `backend/node/`, `backend/php/`, `tests/{node,php,e2e}/`, `scripts/`. Nieuwe code komt in een van deze mappen; zie README.md voor het overzicht.

## Twee servers, één app
De schermen (`frontend/`) praten met een van twee servers met precies dezelfde API:
- `backend/node/` in Node.js (Docker, een VPS, lokaal);
- `backend/php/` in PHP 8.1+ voor shared hosting (de gebruiker host zo). `npm run build:shared-host` maakt `dist/shared-host/` en de ZIP om te uploaden.
Elke wijziging aan de API gaat in beide, met dezelfde paden, antwoorden en meldingen.

## Controleren voor een versie
- `npm test` (Node) en `npm run test:php` (PHP, met de limieten van een shared host);
- de end-to-end tests (`npm run test:e2e`, met `FORGE_BASE_URL`) tegen beide servers;
- de wandeling langs alle schermen.
