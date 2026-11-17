# Distant Youth Studio

Je eigen studio-app voor de muziek van Distant Youth Co.: per release je WAV (verplicht), MP3, MP4,
titel, style-omschrijving en lyrics uploaden; luisteren zoals in een muziekapp; met één klik de
YouTube-titel, -beschrijving en -tags maken in jouw vaste opmaak; bijhouden wat al op YouTube en
Spotify staat; releases ordenen in collecties en playlists, en Claude een albumnaam laten voorstellen.

## Zo zit het project in elkaar

Een Laravel 12-app (PHP 8.2+), met de mappen zoals elke Laravel-ontwikkelaar ze kent:

```
app/
  Http/Controllers/    Api/ (de JSON-API onder /api), MediaController, DownloadController
  Http/Middleware/     inloggen, admin, beveiligingskoppen, het app-kenmerk tegen CSRF
  Http/Resources/      hoe een release, collectie of playlist eruitziet in de API
  Models/              User, Release, Folder, Playlist, Setting, Upload
  Services/            YoutubeKit, Claude, AlbumNames, Stats, ZipStream, ReleaseFiles, Uploads
  Console/Commands/    studio:package (de ZIP voor shared hosting)
bootstrap/             app.php (middleware, foutmeldingen), install.php (het eerste bezoek)
config/                studio.php (versie, Claude, limieten) naast de Laravel-instellingen
database/migrations/   de tabellen
public/                index.php en de schermen: css/, js/, fonts/, img/, icons/
resources/views/       app.blade.php, de ene pagina die de schermen laadt
resources/LEESMIJ.txt  de installatiestappen voor je host (gaat mee in de ZIP)
routes/                api.php, web.php (/, /media, /downloads), console.php
storage/app/           database.sqlite en private/releases/ met je muziek (niet in git)
tests/Feature, Unit/   PHPUnit                                    composer test
tests/e2e/             tests in de browser (Playwright)           npm run test:e2e
scripts/               de iconen en lettertypes opnieuw bouwen
VERSION                het versienummer (major.minor.patch)
```

## Wat erin zit

- **Releases**: WAV verplicht (de inhoud wordt gecontroleerd, niet alleen de naam), MP3, MP4 en cover
  optioneel. Zonder MP3 maakt de app er een van 320 kbps uit je WAV; zonder cover pakt hij een frame
  uit je video (beide met ffmpeg).
- **YouTube-kit**: titel (max 100), beschrijving (max 5.000) en tags (max 500) met tellers en
  kopieerknoppen. Met een Claude API key schrijft Claude het verhaal zoals in je voorbeeld
  ("Lanterns in the Rain"); zonder key vult een template de vaste delen in. Spotify-link,
  AI-vermelding en standaard-hashtags stel je één keer in bij **Instellingen**.
- **Status als maanfase**: nieuw = concept, wassend = klaar voor YouTube, vol = live.
- **Speler**: wachtrij, video, lyrics, vergrendelscherm-bediening; op de telefoon een volledig scherm.
- **Collecties** (albums, EP's, reeksen; jij beheert ze) en **playlists** (iedereen maakt eigen
  playlists, privé of gedeeld). Bij allebei: **Albumnaam voorstellen** met Claude.
- **Accounts**: jij bent admin. Luisteraars kunnen alleen luisteren en eigen playlists maken; releases
  die je als concept markeert zien zij niet.

## Op shared hosting

Nodig: PHP 8.2 of nieuwer met pdo_sqlite, openssl, mbstring, fileinfo en zip (bijna altijd aanwezig).
Geen Node.js, geen terminal, geen aparte database.

```bash
composer install
php artisan studio:package
```

Dat maakt `dist/distantyouth-shared-host-vX.Y.Z.zip`. Pak die uit en volg `LEESMIJ.txt`: de inhoud van
`public_html` gaat in de webmap van je (sub)domein, de map `distantyouth` ernaast. Bij het eerste
bezoek maakt de app zelf `.env` met een eigen sleutel, de database en de tabellen; daarna maak je je
admin-account aan (er is geen standaard gebruiker). Grote WAV- en MP4-bestanden gaan in stukjes naar
de server, dus de uploadlimiet van je host maakt niet uit. Zonder ffmpeg (meestal op shared hosting)
komt er geen automatische MP3 en cover: upload die zelf.

## Met Docker

```bash
docker compose up -d --build
```

Open http://localhost:3000. Apache, PHP 8.3 en ffmpeg zitten in de image. De database, je bestanden en
`.env` met de sleutel staan in het volume `studio-storage`: maak daar een back-up van.

## Lokaal

```bash
composer install
php artisan serve
```

## Online zetten

Zet de app achter HTTPS. De inlogcookie wordt dan vanzelf Secure. Staat er een proxy voor
(Cloudflare, Nginx), zet dan `TRUST_PROXY=1` in `.env`.

## Claude

Zet je Anthropic API key in de app bij **Instellingen** (of als `ANTHROPIC_API_KEY` in `.env`). Een key
die je in de app opslaat, wordt versleuteld bewaard met `APP_KEY` uit `.env`: bewaar `.env` dus bij je
back-ups en verander `APP_KEY` niet. De app gebruikt het model `claude-opus-5-5` (te wijzigen met
`CLAUDE_MODEL`). Een beschrijving of een rij albumnamen kost een paar cent.

## Ontwikkelen

```bash
composer test                  # PHPUnit: tests/Feature en tests/Unit
npm run test:e2e               # in de browser (zet FORGE_BASE_URL op de server die draait)
php artisan studio:package     # de ZIP voor shared hosting in dist/
php artisan studio:password <naam>   # een nieuw wachtwoord voor een account
npm run build:icons            # na het toevoegen van een Lucide-icoon
```

Het ontwerp (concept "Maanfasen") staat in `public/css/tokens.css`; de iconen komen uit Lucide (ISC),
de lettertypes Montserrat en Inter (SIL OFL) worden lokaal geserveerd, zonder externe CDN.
