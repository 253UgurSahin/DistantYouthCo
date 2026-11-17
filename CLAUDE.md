# Distant Youth Studio: werkafspraken

## Versies: altijd major.minor.patch
Elke wijziging die de gebruiker krijgt, krijgt een versie volgens Semantic Versioning:
- patch (x.y.Z): alleen reparaties en kleine verbeteringen;
- minor (x.Y.0): iets nieuws, alles wat er was blijft werken;
- major (X.0.0): iets werkt anders, of oude data/links vragen een stap van de gebruiker.

Bij elke versie, in één commit `release: vX.Y.Z`:
1. het bestand `VERSION`, en `version` in `package.json` (en `package-lock.json` via `npm version X.Y.Z --no-git-tag-version`);
2. een blok bovenaan in `CHANGELOG.md` (Nederlands, in gewone woorden: Nieuw / Beter / Reparaties / Beveiliging);
3. een annotated git-tag `vX.Y.Z` op die commit. Pushen (ook van tags) alleen als de gebruiker het vraagt.

De app toont de versie (`/api/session` geeft `version`, uit `VERSION` via `config/studio.php`).

## Mappen: een Laravel 12-app
De gewone Laravel-indeling: `app/` (Http/Controllers/Api, Middleware, Resources, Models, Services,
Console/Commands), `bootstrap/`, `config/` (eigen instellingen in `studio.php`), `database/migrations/`,
`public/` (index.php en de schermen: css, js, fonts, img), `resources/views/app.blade.php`, `routes/`,
`storage/`, `tests/{Feature,Unit,e2e}/`, `scripts/` (iconen en lettertypes). Zie README.md.

## Eén server, ook op shared hosting
De gebruiker host op shared hosting zonder terminal en zonder Node.js. Daarom:
- PHP 8.2+, SQLite in `storage/app/database.sqlite`, geen queue-worker of cron nodig;
- het eerste bezoek maakt `.env` met APP_KEY zelf (`bootstrap/install.php`), migraties draaien één keer per versie;
- grote bestanden gaan in stukjes (`/api/uploads`), wijzigen gaat ook als POST met `X-HTTP-Method-Override`;
- ffmpeg is optioneel;
- `php artisan studio:package` maakt `dist/distantyouth-shared-host-vX.Y.Z.zip` (public_html + distantyouth).
Node.js is alleen gereedschap (de e2e-tests, iconen, lettertypes), nooit nodig om de app te draaien.

## Controleren voor een versie
- `composer test` (PHPUnit);
- de end-to-end tests (`npm run test:e2e`, met `FORGE_BASE_URL`) tegen de uitgepakte ZIP van `studio:package`,
  met de limieten van een shared host (`php -d upload_max_filesize=2M -d post_max_size=8M -S ...`);
- de wandeling langs alle schermen.
