{{-- The app shell: one page, the screens are drawn by public/js/main.js. --}}
<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Distant Youth Studio</title>
<meta name="theme-color" content="#08090b" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#08090b">
<link rel="icon" href="/img/favicon.png">
<script src="/js/theme-init.js"></script>
<link rel="stylesheet" href="/fonts/inter/index.css">
<link rel="stylesheet" href="/fonts/montserrat/index.css">
<link rel="stylesheet" href="/css/tokens.css">
<link rel="stylesheet" href="/vendor/depth.css">
<link rel="stylesheet" href="/css/app.css">
<script type="module" src="/js/main.js"></script>
</head>
<body>
<a class="skip" href="#main">Naar de inhoud</a>
<div id="shell"></div>
<main id="main" tabindex="-1"></main>
<div id="player-root"></div>
<div id="toasts" role="status" aria-live="polite"></div>
<noscript><p class="noscript">Distant Youth Studio heeft JavaScript nodig.</p></noscript>
</body>
</html>
