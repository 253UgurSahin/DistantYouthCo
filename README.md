# Distant Youth Studio

Je eigen studio-app voor de muziek van Distant Youth Co.: per release je WAV (verplicht), MP3, MP4,
titel, style-omschrijving en lyrics uploaden; luisteren zoals in een muziekapp; met één klik de
YouTube-titel, -beschrijving en -tags maken in jouw vaste opmaak; bijhouden wat al op YouTube en
Spotify staat; releases ordenen in collecties en playlists, en Claude een albumnaam laten voorstellen.

## Zo zit het project in elkaar

```
frontend/          de schermen: HTML, CSS, JavaScript en plaatjes, voor beide servers hetzelfde
backend/
  node/            de server in Node.js (Docker, een VPS of je eigen computer)
  php/             dezelfde server in PHP, voor shared hosting
    app/           de code
    public_html/   index.php en .htaccess: de deur naar de server op je host
    LEESMIJ.txt    de installatiestappen voor je host
tests/
  node/            tests van de Node-server        npm test
  php/             tests van de PHP-server         npm run test:php
  e2e/             tests in de browser, voor beide npm run test:e2e
scripts/           bouwen: de ZIP voor shared hosting, de iconen
dist/              wat het bouwen oplevert (niet in git)
data/              je database en bestanden bij de Node-server (niet in git)
```

Welke server je gebruikt, hangt af van je hosting: alles wat Node.js kan draaien (Docker, VPS) gebruikt
`backend/node`, shared hosting gebruikt `backend/php`. De schermen zijn bij allebei dezelfde.

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

## Op shared hosting (PHP)

Kan je host geen Node.js draaien, gebruik dan de PHP-versie: dezelfde app, dezelfde schermen.
Nodig: PHP 8.1 of nieuwer met pdo_sqlite, openssl en curl (bijna altijd aanwezig).

```bash
npm ci
npm run build:shared-host
```

Dat maakt `dist/distantyouth-shared-host-vX.Y.Z.zip`. Pak die uit en volg `LEESMIJ.txt`: de inhoud van
`public_html` gaat in de webmap van je (sub)domein, de map `distantyouth` ernaast. Grote WAV- en
MP4-bestanden gaan in stukjes naar de server, dus de uploadlimiet van je host maakt niet uit.
Zonder ffmpeg (meestal op shared hosting) komt er geen automatische MP3 en cover: upload die zelf.

## Starten met Docker (aanbevolen)

```bash
cp .env.example .env        # vul eventueel ANTHROPIC_API_KEY in
docker compose up -d --build
```

Open http://localhost:3000. Bij het eerste bezoek maak je je admin-account aan. Database en uploads
staan in het Docker-volume `studio-data`: maak daar een back-up van.

## Starten zonder Docker

Nodig: Node.js 22.13 of nieuwer, en ffmpeg (voor de automatische MP3 en cover).

```bash
npm ci
npm start
```

De data komt dan in `./data` (of waar `DATA_DIR` naar wijst).

## Online zetten

Zet de app achter een reverse proxy met HTTPS (bijvoorbeeld Caddy of Nginx) en zet dan in `.env`
`COOKIE_SECURE=1` en `TRUST_PROXY=1`. Grote uploads: geef de proxy ook een hoge upload-limiet
(Nginx: `client_max_body_size 4g;`).

## Claude

Zet je Anthropic API key in `.env` (`ANTHROPIC_API_KEY`) of in de app bij **Instellingen**. Een key die je in de app opslaat, wordt versleuteld bewaard met `SECRET_KEY` uit `.env`, of anders met `data/secret.key`: maak van die map dus altijd in zijn geheel een back-up. De app
gebruikt het model `claude-opus-5-5` (te wijzigen met `CLAUDE_MODEL`). Een beschrijving of een rij
albumnamen kost een paar cent.

## Ontwikkelen

```bash
npm run dev               # de Node-server, herstart bij elke wijziging
npm test                  # tests van de Node-server
npm run test:php          # tests van de PHP-server (bouwt eerst de ZIP-map)
npm run test:e2e          # tests in de browser (zet FORGE_BASE_URL op de server die draait)
npm run build:shared-host # de ZIP voor shared hosting in dist/
node scripts/build-icons.mjs   # na het toevoegen van een Lucide-icoon
```

Het ontwerp (concept "Maanfasen") staat in `frontend/css/tokens.css`; de iconen komen uit Lucide (ISC),
de lettertypes Montserrat en Inter (SIL OFL) worden lokaal geserveerd, zonder externe CDN.
