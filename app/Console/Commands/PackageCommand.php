<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\File;
use Symfony\Component\Process\Process;
use ZipArchive;

/**
 * The ZIP for shared hosting: "public_html" (what visitors load) and "distantyouth" (the app itself,
 * with its packages, next to public_html). Built from this folder; nothing of yours (.env, the
 * database, your music) goes in.
 */
class PackageCommand extends Command
{
    protected $signature = 'studio:package';

    protected $description = 'Maak dist/distantyouth-shared-host-vX.Y.Z.zip om op je shared host te uploaden';

    private const APP = ['app', 'bootstrap/app.php', 'bootstrap/install.php', 'bootstrap/providers.php', 'config', 'database/migrations', 'database/factories', 'database/seeders',
        'resources', 'routes', 'artisan', 'composer.json', 'composer.lock', 'VERSION', 'CHANGELOG.md', '.env.example'];

    private const STORAGE = ['storage/app/private', 'storage/framework/cache/data', 'storage/framework/sessions', 'storage/framework/views', 'storage/logs', 'bootstrap/cache'];

    public function handle(): int
    {
        $version = trim((string) file_get_contents(base_path('VERSION')));
        $out = base_path('dist/shared-host');
        File::deleteDirectory($out);
        $app = "$out/distantyouth";
        $web = "$out/public_html";

        foreach (self::APP as $item) {
            $from = base_path($item);
            File::ensureDirectoryExists(dirname("$app/$item"));
            is_dir($from) ? File::copyDirectory($from, "$app/$item") : File::copy($from, "$app/$item");
        }
        foreach (self::STORAGE as $dir) {
            File::ensureDirectoryExists("$app/$dir");
            file_put_contents("$app/$dir/.gitignore", "*\n!.gitignore\n");
        }
        // If the host only allows one folder, distantyouth may sit inside public_html: then it is shut.
        file_put_contents("$app/.htaccess", "Require all denied\nDeny from all\n");

        $this->info('Pakketten zonder de testgereedschappen...');
        File::copyDirectory(base_path('vendor'), "$app/vendor");
        $composer = new Process(['composer', 'install', '--no-dev', '--optimize-autoloader', '--no-interaction', '--no-scripts', '--quiet'], $app, null, null, 600);
        $composer->run();
        if (! $composer->isSuccessful()) {
            $this->error('composer install --no-dev mislukte: '.$composer->getErrorOutput());

            return 1;
        }

        // Packages fetched as source bring their own tests and docs: not needed on the host.
        foreach (glob("$app/vendor/*/*/{tests,Tests,test,docs,doc,.github}", GLOB_BRACE | GLOB_ONLYDIR) ?: [] as $dir) {
            File::deleteDirectory($dir);
        }
        foreach (glob("$app/vendor/*/*/{phpunit.xml*,.git*,.editorconfig,phpstan*}", GLOB_BRACE) ?: [] as $file) {
            is_dir($file) ? File::deleteDirectory($file) : @unlink($file);
        }

        File::copyDirectory(public_path(), $web);
        File::copy(resource_path('LEESMIJ.txt'), "$out/LEESMIJ.txt");

        $zipPath = base_path("dist/distantyouth-shared-host-v$version.zip");
        @unlink($zipPath);
        $zip = new ZipArchive();
        if ($zip->open($zipPath, ZipArchive::CREATE) !== true) {
            $this->error("Kan $zipPath niet maken.");

            return 1;
        }
        $count = 0;
        foreach (File::allFiles($out, true) as $file) {
            $name = str_replace(DIRECTORY_SEPARATOR, '/', $file->getRelativePathname());
            $zip->addFile($file->getPathname(), $name);
            $count++;
        }
        $zip->close();
        $this->info("dist/shared-host/ en dist/".basename($zipPath)." ($count bestanden, versie $version)");

        return 0;
    }
}
