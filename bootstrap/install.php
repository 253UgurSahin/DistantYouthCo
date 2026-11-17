<?php

/*
 * The first visit on a host without a terminal: the app makes its own .env (from .env.example) with a
 * key of its own, the folders it writes to and the database file. The tables follow in
 * AppServiceProvider (migrations run once per version). Plain PHP: it runs before the framework.
 */
(function (string $base): void {
    foreach (['storage/app/private', 'storage/framework/cache/data', 'storage/framework/sessions', 'storage/framework/views', 'storage/logs', 'bootstrap/cache'] as $dir) {
        if (! is_dir("$base/$dir")) {
            @mkdir("$base/$dir", 0775, true);
        }
    }
    $env = "$base/.env";
    if (is_file($env) && ! preg_match('/^APP_KEY=\s*$/m', (string) file_get_contents($env))) {
        return; // installed
    }
    $lock = @fopen("$base/storage/app/.install.lock", 'c');
    if (! $lock) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'De app kan niet schrijven in de map distantyouth/storage. Zet die map (en bootstrap/cache) op schrijfbaar (775) in je hostingpaneel.']);
        exit;
    }
    flock($lock, LOCK_EX);
    clearstatcache();
    // Written whole and then renamed, so another visitor never reads half a file.
    $text = is_file($env) ? (string) file_get_contents($env) : (string) @file_get_contents("$base/.env.example");
    if (preg_match('/^APP_KEY=\s*$/m', $text) || ! is_file($env)) {
        $text = preg_replace('/^APP_KEY=\s*$/m', 'APP_KEY=base64:'.base64_encode(random_bytes(32)), $text, 1);
        // Docker keeps .env in its volume through a symlink: write where it points.
        $target = is_link($env) ? (str_starts_with(readlink($env), '/') ? readlink($env) : dirname($env).'/'.readlink($env)) : $env;
        $tmp = "$target.".bin2hex(random_bytes(4)).'.tmp';
        if (file_put_contents($tmp, $text) !== false) {
            @chmod($tmp, 0600);
            rename($tmp, $target);
        }
    }
    if (! is_file("$base/storage/app/database.sqlite")) {
        touch("$base/storage/app/database.sqlite");
    }
    flock($lock, LOCK_UN);
    fclose($lock);
})(dirname(__DIR__));
