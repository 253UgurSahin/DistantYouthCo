<?php
// For testing with PHP's built-in server only (it does not read .htaccess):
//   php -S 127.0.0.1:3200 -t <public_html> php/dev-router.php
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (preg_match('#^/(api|media|downloads)(/|$)#', $path)) {
    require $_SERVER['DOCUMENT_ROOT'] . '/index.php';
    return true;
}
if (str_starts_with(basename($path), '.') || str_ends_with($path, '.php')) { http_response_code(404); return true; }
$file = $_SERVER['DOCUMENT_ROOT'] . $path;
if ($path === '/') { header('Content-Type: text/html; charset=utf-8'); readfile($_SERVER['DOCUMENT_ROOT'] . '/index.html'); return true; }
if (is_file($file)) {
    header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    return false; // the built-in server sends the file itself
}
http_response_code(404);
return true;
