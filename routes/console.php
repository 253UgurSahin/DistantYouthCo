<?php

use App\Models\User;
use App\Services\ReleaseFiles;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

// Forgot a password? On the server (a terminal or SSH): php artisan studio:password <name>
Artisan::command('studio:password {username : the account}', function (string $username) {
    $user = User::where('username', $username)->first();
    if (! $user) {
        $this->error("Er is geen account \"$username\".");

        return 1;
    }
    $password = $this->secret('Nieuw wachtwoord (minstens 8 tekens)');
    if ($err = User::credentialsError($user->username, $password)) {
        $this->error($err);

        return 1;
    }
    $user->update(['password' => $password]);
    DB::table('sessions')->where('user_id', $user->id)->delete();
    $this->info("Het wachtwoord van {$user->username} is gewijzigd; die is overal uitgelogd.");

    return 0;
})->purpose('Zet een nieuw wachtwoord voor een account');

// Started by the app itself after an upload (where the answer cannot go first): the MP3 and the cover.
Artisan::command('studio:process {id : the release}', function (string $id) {
    app(ReleaseFiles::class)->heavyWork((int) $id);
})->purpose('Maak de MP3 en cover van een release (ffmpeg)');
