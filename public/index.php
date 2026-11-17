<?php

use Illuminate\Foundation\Application;
use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

// Where the app lives: one folder up (the project as it is), or "distantyouth" next to public_html
// (shared hosting, see LEESMIJ.txt), or inside it as a last resort.
$base = null;
foreach ([__DIR__.'/..', __DIR__.'/../distantyouth', __DIR__.'/distantyouth'] as $dir) {
    if (is_file($dir.'/bootstrap/app.php')) {
        $base = realpath($dir);
        break;
    }
}
if ($base === null || PHP_VERSION_ID < 80200) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => $base === null
        ? 'De map "distantyouth" is niet gevonden. Zet hem naast public_html (zie LEESMIJ.txt).'
        : 'Deze app heeft PHP 8.2 of nieuwer nodig (nu '.PHP_VERSION.'). Kies een nieuwere PHP-versie in je hostingpaneel.']);
    exit;
}

if (file_exists($maintenance = $base.'/storage/framework/maintenance.php')) {
    require $maintenance;
}

require $base.'/bootstrap/install.php';
require $base.'/vendor/autoload.php';

/** @var Application $app */
$app = require_once $base.'/bootstrap/app.php';
$app->usePublicPath(__DIR__);

$app->handleRequest(Request::capture());
