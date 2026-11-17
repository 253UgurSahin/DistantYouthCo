# Changelog

Elke versie heeft een nummer major.minor.patch ([Semantic Versioning](https://semver.org/lang/nl/)):

- **major** (2.0.0): iets werkt anders dan je gewend bent, of oude data of links werken niet meer zonder een stap van jou;
- **minor** (1.3.0): iets nieuws erbij, alles wat er was werkt nog zoals het werkte;
- **patch** (1.2.1): alleen reparaties en kleine verbeteringen.

Het nummer staat in `package.json`, onder in het accountmenu en op het inlogscherm. Elke versie krijgt een git-tag `vX.Y.Z`.

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
