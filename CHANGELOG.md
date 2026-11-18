# Changelog

Elke versie heeft een nummer major.minor.patch ([Semantic Versioning](https://semver.org/lang/nl/)):

- **major** (2.0.0): iets werkt anders dan je gewend bent, of oude data of links werken niet meer zonder een stap van jou;
- **minor** (1.3.0): iets nieuws erbij, alles wat er was werkt nog zoals het werkte;
- **patch** (1.2.1): alleen reparaties en kleine verbeteringen.

Het nummer staat in het bestand `VERSION`, onder in het accountmenu en op het inlogscherm. Elke versie krijgt een git-tag `vX.Y.Z`.

## 2.3.0 (2026-11-18)
Nieuw
- Aanvullen: na het uploaden van meerdere releases loop je ze één voor één langs om style en lyrics te plakken, met een knop om te luisteren. De BPM en de YouTube-tekst gaan vanzelf mee. Je vindt het bij Te doen op de startpagina en na "Meerdere releases".
- Ongedaan maken: na het verwijderen van een release staat er even "Ongedaan maken" in de melding. Een uur lang kan hij terug, met bestanden en plekken in playlists; daarna is hij echt weg.
- Vorige en volgende release onderaan elke release-pagina.
- De releases op de startpagina ook als compacte lijst, met een volgorde naar keuze (nieuwste, oudste, titel, langste). Je keuze wordt onthouden.
- Te doen toont nu alles: de eerste vijf, de rest met "Toon alle".

Beter
- De startpagina toont de voortgang één keer: Te doen voor de admin, de tabel "Wat elke release al heeft" alleen nog voor luisteraars.
- Enter in een veld slaat het releaseformulier op; met alleen het toetsenbord is er geen onzichtbare tussenstop meer, en de focus blijft in een venster en komt daarna terug.
- Zonder internet zegt de app dat in het Nederlands, in plaats van "Failed to fetch".
- Een lange naam zonder spaties (zoals een link) maakt een scherm op de telefoon niet meer breder dan het beeld.
- "Spotify nog niet" overal, in plaats van soms "niet uit".

Reparaties
- Twee tabbladen tegelijk: een ouder tabblad overschreef zonder waarschuwing wat je in het andere had opgeslagen. Nu zegt de app "Deze release is intussen gewijzigd" en blijft het nieuwste staan. Dat geldt ook voor de YouTube-kit.
- Downloads toonde een releasedatum een dag te vroeg op computers ten westen van Nederland (zoals New York).
- Snel van scherm wisselen gaf soms een scriptfout.

Beveiliging
- Onder een YouTube-video staat nu dat YouTube je IP-adres ziet zodra je op afspelen drukt.
- De PHP-versie van de server staat niet meer in elk antwoord; een ongebruikt ontwikkelpakket is weg.

## 2.2.0 (2026-11-17)
Nieuw
- De YouTube-titel, -beschrijving en -tags staan meteen klaar als je een release opslaat (met het template). Pas je daarna titel, style of lyrics aan, dan gaat de tekst vanzelf mee, tot je hem zelf wijzigt. Releases van vóór deze versie krijgen hun tekst bij de update. Claude kan de tekst in de YouTube-kit nog altijd herschrijven.
- In de YouTube-kit wordt alles wat je aanpast vanzelf bewaard. De link van je video plakken is genoeg om hem als "op YouTube" te markeren.
- Het releaseformulier haalt de titel uit de naam van je WAV. Sleep je meerdere bestanden tegelijk erin, dan gaat elk naar zijn eigen vak. Je laatste collectie en video-type worden onthouden.

Beter
- Niets meer dubbel: één opslaanknop, de tags één keer in de YouTube-kit, één zijkaart in plaats van twee, en geen tweede statusregel op de telefoon.
- Bestaat een release al, dan zegt het formulier dat (met een link ernaar). Bij meerdere tegelijk wordt die release standaard overgeslagen; met "Toch uploaden" komt hij er alsnog bij.
- Beter contrast in licht en donker: duidelijkere randen, lichtere grijze tekst, invulvelden met een eigen kleur en panelen die loskomen van de achtergrond.

## 2.1.0 (2026-11-17)
Nieuw
- Meerdere releases tegelijk uploaden (Nieuwe release → "Meerdere releases tegelijk"): sleep al je bestanden in één keer erin. Elke WAV wordt een release; een MP4, MP3 of cover met dezelfde naam gaat er vanzelf bij. De titels komen uit de bestandsnamen en kun je nog aanpassen; collectie, video-type en concept stel je voor allemaal tegelijk in. Gaat er één mis, dan gaan de andere gewoon door.
- Een YouTube-link in plaats van de MP4: staat je video al op YouTube, plak dan de link bij de release. De app speelt hem af via YouTube, op de release-pagina en in de speler. YouTube laadt pas als je op afspelen drukt.

Beter
- Een release met een YouTube-link telt als "op YouTube" en staat niet meer bij Te doen als "Video uploaden".

Beveiliging
- Alleen de video-code uit de link gaat naar de YouTube-speler (de privacyversie, youtube-nocookie.com); de app laat geen andere ingesloten pagina's toe.

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
