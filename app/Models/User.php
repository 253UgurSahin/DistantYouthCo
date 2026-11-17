<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;

/** An account: the admin (the artist) or a listener. */
class User extends Authenticatable
{
    use HasFactory;

    public const ADMIN = 'admin';
    public const LISTENER = 'listener';

    protected $fillable = ['username', 'password', 'role'];

    protected $hidden = ['password', 'remember_token'];

    protected function casts(): array
    {
        return ['password' => 'hashed'];
    }

    public function isAdmin(): bool
    {
        return $this->role === self::ADMIN;
    }

    public function playlists(): HasMany
    {
        return $this->hasMany(Playlist::class);
    }

    /** The checks of the sign-up form; null when fine. */
    public static function credentialsError(mixed $username, mixed $password): ?string
    {
        if (! is_string($username) || ! preg_match('/^[a-zA-Z0-9_.-]{3,32}$/', $username)) {
            return 'Gebruikersnaam: 3–32 tekens (letters, cijfers, _ . -).';
        }
        if (! is_string($password) || mb_strlen($password) < 8) {
            return 'Wachtwoord moet minstens 8 tekens zijn.';
        }

        return null;
    }
}
