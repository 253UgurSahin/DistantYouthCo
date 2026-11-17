<?php

namespace App\Providers;

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
    }

    public function boot(): void
    {
        $this->migrateOncePerVersion();
    }

    /**
     * On a host without a terminal the tables are made (and updated after an upgrade) by the first
     * request of each version. On a server with a terminal `php artisan migrate` does the same.
     */
    private function migrateOncePerVersion(): void
    {
        if ($this->app->runningInConsole() || $this->app->runningUnitTests()) {
            return;
        }
        $marker = storage_path('app/.schema-version');
        $version = (string) config('studio.version');
        if (@file_get_contents($marker) === $version) {
            return;
        }
        $lock = fopen(storage_path('app/.migrate.lock'), 'c') ?: throw new \RuntimeException('storage/app is not writable');
        flock($lock, LOCK_EX);
        if (@file_get_contents($marker) !== $version) {
            Artisan::call('migrate', ['--force' => true]);
            file_put_contents($marker, $version);
        }
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}
