<?php
// Distant Youth Studio: the door for /api, /media and /downloads on a shared host.
// The app's code and your data live in the folder "distantyouth", next to public_html (not in it),
// so nobody can download the database or your music directly.
declare(strict_types=1);

// Warnings go to the host's error log, never into the app's answers.
ini_set('display_errors', '0');
ini_set('log_errors', '1');

$candidates = array_filter([
    getenv('DYC_APP_DIR') ?: null,
    dirname(__DIR__) . '/distantyouth',
    __DIR__ . '/distantyouth',
]);
foreach ($candidates as $dir) {
    if (is_file("$dir/app/bootstrap.php")) {
        define('DYC_APP', realpath($dir));
        break;
    }
}
if (!defined('DYC_APP')) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'De map "distantyouth" is niet gevonden. Zet hem naast public_html (zie LEESMIJ.txt).']);
    exit;
}
if (PHP_VERSION_ID < 80100) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Deze app heeft PHP 8.1 of nieuwer nodig (nu ' . PHP_VERSION . '). Kies een nieuwere PHP-versie in je hostingpaneel.']);
    exit;
}
require DYC_APP . '/app/bootstrap.php';
handle_request();
