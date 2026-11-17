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
    $lock = fopen("$base/storage/app/.install.lock", 'c');
    flock($lock, LOCK_EX);
    clearstatcache();
    if (! is_file($env) && is_file("$base/.env.example")) {
        copy("$base/.env.example", $env);
        @chmod($env, 0600);
    }
    if (is_file($env)) {
        $text = (string) file_get_contents($env);
        if (preg_match('/^APP_KEY=\s*$/m', $text)) {
            $key = 'base64:'.base64_encode(random_bytes(32));
            file_put_contents($env, preg_replace('/^APP_KEY=\s*$/m', "APP_KEY=$key", $text, 1), LOCK_EX);
        }
    }
    if (! is_file("$base/storage/app/database.sqlite")) {
        touch("$base/storage/app/database.sqlite");
    }
    flock($lock, LOCK_UN);
    fclose($lock);
})(dirname(__DIR__));
