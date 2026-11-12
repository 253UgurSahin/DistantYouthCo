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
- **Direct naar YouTube**: koppel je kanaal één keer en upload de MP4 met die tekst en je cover als
  thumbnail rechtstreeks vanuit de kit, privé, verborgen, openbaar of ingepland. Zie
  [Direct uploaden naar YouTube](#direct-uploaden-naar-youtube).
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

## Direct uploaden naar YouTube

Met je kanaal gekoppeld upload je een release vanuit de YouTube-kit rechtstreeks naar YouTube. Dat
gaat met de titel, beschrijving en tags uit de kit, in de categorie Muziek, met "niet voor kinderen" en
desgewenst het AI-label van YouTube. Je cover wordt de thumbnail (JPG of PNG, max 2 MB). Je kiest
privé, verborgen, openbaar of een moment waarop hij live gaat. De upload loopt op de server en kan
tegen een haperende verbinding. Daarna staat de link bij de release. Zodra de video openbaar is,
springt de maan op vol. Een release heeft wel een MP4 nodig: de app maakt zelf geen video.

Eenmalig instellen (in je eigen Google-account, gratis):

1. Maak een project in [Google Cloud](https://console.cloud.google.com/projectcreate) en zet de
   [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com) aan.
2. Stel het [OAuth-toestemmingsscherm](https://console.cloud.google.com/apis/credentials/consent) in:
   type extern, met jezelf als testgebruiker. Zet het daarna op **In productie**. In de testfase
   vervalt de koppeling na 7 dagen. Google toont dan bij het koppelen een waarschuwing dat de app
   niet geverifieerd is. Voor je eigen gebruik klik je die weg via "Geavanceerd".
3. Maak bij [Inloggegevens](https://console.cloud.google.com/apis/credentials) een OAuth-client-ID van
   het type **Webapplicatie**. Zet bij "Geautoriseerde omleidings-URI's" precies het adres dat de app
   bij **Instellingen → YouTube-kanaal** toont, bijvoorbeeld `http://localhost:3000/oauth/youtube/callback`.
4. Plak de Client ID en het Client secret bij **Instellingen** (of zet `YOUTUBE_CLIENT_ID` en
   `YOUTUBE_CLIENT_SECRET` in `.env`) en klik op **Koppel YouTube-kanaal**.

Goed om te weten:

- **Audit.** Video's die je via een eigen, nog niet goedgekeurd Google-project uploadt, zet YouTube
  vast op privé. Vraag de [audit](https://support.google.com/youtube/contact/yt_api_form) aan om dat op
  te heffen. Tot die tijd werkt alles, maar blijven je uploads privé.
- **Quotum.** Je project krijgt per dag een vast aantal API-punten. Een upload kost er veel, het
  ophalen van de status maar één. Voor een paar releases per dag is het ruim genoeg. Het quotum gaat
  rond middernacht (Amerikaanse westkusttijd) opnieuw in.
- **Eigen thumbnail.** Die mag pas als je kanaal geverifieerd is met je telefoonnummer
  (youtube.com/verify). Lukt het niet, dan staat de video er toch en zegt de app waarom de thumbnail
  ontbreekt.
- **Achter een proxy of op een domein.** Zet `PUBLIC_URL` in `.env` (bijvoorbeeld
  `https://studio.jouwdomein.nl`). De omleidings-URI wordt dan `PUBLIC_URL/oauth/youtube/callback`.
- **Rechten.** De app vraagt alleen om uploaden en meelezen (`youtube.upload`, `youtube.readonly`),
  niet om bestaande video's te wijzigen of te verwijderen. Ontkoppelen trekt de toegang bij Google in.

## Claude

Zet je Anthropic API key in `.env` (`ANTHROPIC_API_KEY`) of in de app bij **Instellingen**. De app
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
