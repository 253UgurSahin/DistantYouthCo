# Distant Youth Studio

Je eigen studio-app voor de muziek van Distant Youth Co.: per release je WAV (verplicht), MP3, MP4,
titel, style-omschrijving en lyrics uploaden; luisteren zoals in een muziekapp; met één klik de
YouTube-titel, -beschrijving en -tags maken in jouw vaste opmaak; bijhouden wat al op YouTube en
Spotify staat; releases ordenen in collecties en playlists, en Claude een albumnaam laten voorstellen.

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
npm run dev     # herstart bij elke wijziging
npm test        # API- en beschrijvingstests
node scripts/build-icons.mjs   # na het toevoegen van een Lucide-icoon
```

Het ontwerp (concept "Maanfasen") staat in `public/css/tokens.css`; de iconen komen uit Lucide (ISC),
de lettertypes Montserrat en Inter (SIL OFL) worden lokaal geserveerd, zonder externe CDN.
