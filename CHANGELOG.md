# Changelog

Elke versie heeft een nummer major.minor.patch ([Semantic Versioning](https://semver.org/lang/nl/)):

- **major** (2.0.0): iets werkt anders dan je gewend bent, of oude data of links werken niet meer zonder een stap van jou;
- **minor** (1.3.0): iets nieuws erbij, alles wat er was werkt nog zoals het werkte;
- **patch** (1.2.1): alleen reparaties en kleine verbeteringen.

Het nummer staat in het bestand `VERSION`, onder in het accountmenu en op het inlogscherm. Elke versie krijgt een git-tag `vX.Y.Z`.

## 2.0.0 (2026-11-17)
Anders
- De app is opnieuw gebouwd op Laravel 12 (PHP 8.2 of nieuwer), met de gewone Laravel-mappen: één server voor shared hosting, Docker en je eigen computer. De Node.js-server en de losse PHP-versie zijn weg.
- Een installatie van versie 1 neemt zijn data niet mee: begin met een nieuwe installatie en upload je releases opnieuw (zie LEESMIJ.txt).
- De ZIP voor shared hosting maak je nu met `php artisan studio:package`. De app heeft PHP 8.2 nodig in plaats van 8.1.

Nieuw
- Bij het eerste bezoek maakt de app zelf zijn instellingen (`.env`) met een eigen sleutel, de database en de tabellen. Na een update werkt hij de tabellen vanzelf bij.
- `php artisan studio:password <naam>` zet een nieuw wachtwoord als je het vergeten bent (als je host een terminal heeft).
- Docker draait nu met Apache, PHP 8.3 en ffmpeg; database, bestanden en sleutel staan samen in één volume.

Beter
- Alles wat je kende werkt zoals het werkte: dezelfde schermen, dezelfde knoppen, dezelfde meldingen.

Beveiliging
- Inloggen, sessies en versleuteling via Laravel; je opgeslagen Claude-key is versleuteld met de sleutel uit `.env`.
- Wachtwoorden met Argon2id waar de server dat kan.

## 1.3.0 (2026-11-17)
Nieuw
- Een PHP-versie voor shared hosting, waar Node.js niet kan draaien: dezelfde app en dezelfde schermen. `npm run build:shared-host` maakt een ZIP met `public_html` en `distantyouth` en een LEESMIJ met de stappen.
- Grote WAV- en MP4-bestanden gaan in stukjes van een paar MB naar de server, als de server daarom vraagt. Zo maakt de uploadlimiet van een host niet uit, en een weggevallen verbinding gaat verder waar hij was.
- De PHP-versie leest de duur van een WAV zelf, ook zonder ffmpeg.

Beter
- Wijzigen en verwijderen gaan als gewone POST met een extra kenmerk, zodat ook hosts die PUT en DELETE blokkeren werken.

## 1.2.1 (2026-11-17)
Reparaties
- Het inlogscherm scrolde een stukje (er werd ruimte vrijgehouden voor de muziekspeler, die daar niet is). Het past nu precies in het venster, ook op een telefoon.

## 1.2.0 (2026-11-17)
Nieuw
- Downloads: alle video's van je releases op één plek, één MP4 per klik of de gekozen video's samen als één ZIP, elk bestand genoemd naar zijn release. Filter op "nog niet op YouTube". Werkt ook boven de 4 GB.
- Te doen op de startpagina: per release die nog niet live is de volgende stap (video uploaden, YouTube-tekst maken, op YouTube zetten), met één klik naar de plek waar je het doet.
- Het versienummer onder in het accountmenu en op het inlogscherm.

Beter
- Inloggen: één kaart, je naam wordt onthouden op dit apparaat (alleen je wachtwoord nog), een oogje om te zien wat je typt.
- Vier tabbladen passen op een telefoon; een release zonder cover houdt zijn rondje.

## 1.1.0 (2026-11-12)
Beveiliging
- De inlogcookie is Secure zodra de verbinding HTTPS is; HSTS over HTTPS.
- Een in de app opgeslagen Claude-key staat versleuteld in de database (zet `SECRET_KEY`, of bewaar `data/secret.key` bij je back-ups).
- Na een update ziet je browser de nieuwe schermen meteen.

Uiterlijk
- Concept Maanfasen op niveau 3 afgemaakt: een eigen videospeler in 16:9, de releasepagina in lagen, de statuskaart die met je muis meedraait, manen bij de titels van de beheerschermen.

Reparaties
- De statuskaart op de releasepagina schoof bij scrollen over de knoppen (B012).

## 1.0.0 (2026-11-12)
De eerste versie: releases met WAV, MP3, MP4, cover, style en lyrics; een speler; de YouTube-kit met beschrijving in jouw vaste opmaak (template of Claude); collecties en playlists met naamvoorstellen; accounts met admin en luisteraars; het dashboard "De stand van de nacht".
