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
- **Direct naar YouTube**: koppel je kanaal één keer en upload de MP4 met de tekst uit de kit en je
  cover als thumbnail rechtstreeks vanuit de app. Zie [Direct uploaden naar YouTube](#direct-uploaden-naar-youtube).
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

## Direct uploaden naar YouTube

Met je kanaal gekoppeld upload je een release vanuit de YouTube-kit rechtstreeks naar YouTube. Je kiest
privé, verborgen, openbaar of een moment waarop hij live gaat. De video gaat erop met de titel,
beschrijving en tags uit de kit, in de categorie Muziek, als "niet voor kinderen", en desgewenst met
het AI-label van YouTube. Je cover wordt de thumbnail (JPG of PNG, max 2 MB). Daarna staat de link bij
de release, en zodra de video openbaar is, springt de maan op vol.

De upload gaat in stukjes van 8 MB, één per verzoek, zodat de tijdslimiet van een shared host hem niet
afbreekt. Valt de verbinding even weg, dan gaat hij verder waar YouTube was. Laat de pagina open tot
het klaar is; ga je toch weg, dan staat er bij terugkomst "Verder uploaden". Een release heeft wel een
eigen MP4 nodig: met alleen een YouTube-link valt er niets te uploaden.

Eenmalig instellen (in je eigen Google-account, gratis):

1. Maak een project in [Google Cloud](https://console.cloud.google.com/projectcreate) en zet de
   [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com) aan.
2. Stel het [OAuth-toestemmingsscherm](https://console.cloud.google.com/apis/credentials/consent) in:
   type extern, met jezelf als testgebruiker. Zet het daarna op **In productie**; in de testfase vervalt
   de koppeling na 7 dagen. Google waarschuwt dan dat de app niet geverifieerd is: voor je eigen
   gebruik klik je die weg via "Geavanceerd".
3. Maak bij [Inloggegevens](https://console.cloud.google.com/apis/credentials) een OAuth-client-ID van
   het type **Webapplicatie**. Zet bij "Geautoriseerde omleidings-URI's" precies het adres dat de app
   bij **Instellingen → YouTube-kanaal** toont (`https://jouwdomein/oauth/youtube/callback`).
4. Plak de Client ID en het Client secret bij **Instellingen** (of zet `YOUTUBE_CLIENT_ID` en
   `YOUTUBE_CLIENT_SECRET` in `.env`) en klik op **Koppel YouTube-kanaal**.

Goed om te weten:

- **Audit.** Video's die je via een eigen, nog niet goedgekeurd Google-project uploadt, zet YouTube
  vast op privé. Vraag de [audit](https://support.google.com/youtube/contact/yt_api_form) aan om dat op
  te heffen; tot dan werkt alles, maar blijven je uploads privé.
- **Quotum.** Je project krijgt per dag een vast aantal API-punten; een upload kost er veel. Voor een
  paar releases per dag is het genoeg. Het gaat rond middernacht (Amerikaanse westkusttijd) opnieuw in.
- **Eigen thumbnail.** Mag pas als je kanaal geverifieerd is met je telefoonnummer (youtube.com/verify).
  Lukt het niet, dan staat de video er toch en zegt de app waarom de thumbnail ontbreekt.
- **Rechten.** De app vraagt alleen om uploaden en meelezen (`youtube.upload`, `youtube.readonly`),
  niet om video's te wijzigen of te verwijderen. Ontkoppelen trekt de toegang bij Google in.
- **Achter een proxy.** Zet `TRUST_PROXY=1`, zodat de omleidings-URI met `https://` en je eigen domein begint.

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
