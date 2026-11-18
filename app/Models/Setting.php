<?php

namespace App\Models;

use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Log;

/** The fixed parts of every YouTube description, and the Claude key (encrypted with APP_KEY). */
class Setting extends Model
{
    public const DEFAULTS = [
        'artist_name' => 'Distant Youth Co.',
        'spotify_artist_url' => 'https://open.spotify.com/artist/7hbil2HXkg0OniGTxMUHeo',
        'youtube_channel_url' => 'https://www.youtube.com/@DistantYouthCo',
        'ai_disclosure' => '🧪 Made with AI — Suno AI (AI-assisted, human-directed).',
        'default_hashtags' => '#aimusic #sunoai #bassmusic #electronicmusic #distantyouthco',
        'default_video_type' => 'Official Visualizer',
        'anthropic_api_key' => '',
        // Direct upload to YouTube
        'youtube_client_id' => '',
        'youtube_client_secret' => '',
        'youtube_refresh_token' => '',
        'youtube_channel_id' => '',
        'youtube_channel_title' => '',
        'youtube_default_privacy' => 'private',
        'youtube_ai_label' => '1',
    ];

    public const SECRETS = ['anthropic_api_key', 'youtube_client_secret', 'youtube_refresh_token'];

    protected $primaryKey = 'key';
    public $incrementing = false;
    protected $keyType = 'string';
    public $timestamps = false;
    protected $fillable = ['key', 'value'];

    /** Every setting, with the defaults for what was never saved. */
    public static function current(): array
    {
        $out = self::DEFAULTS;
        foreach (self::query()->get() as $row) {
            if (! array_key_exists($row->key, self::DEFAULTS)) {
                continue;
            }
            $out[$row->key] = in_array($row->key, self::SECRETS, true) ? self::open($row->value) : $row->value;
        }

        return $out;
    }

    public static function put(array $values): void
    {
        foreach ($values as $key => $value) {
            if (! array_key_exists($key, self::DEFAULTS) || ! is_string($value)) {
                continue;
            }
            $stored = in_array($key, self::SECRETS, true) && $value !== '' ? Crypt::encryptString($value) : $value;
            self::query()->updateOrCreate(['key' => $key], ['value' => $stored]);
        }
    }

    private static function open(string $value): string
    {
        if ($value === '') {
            return '';
        }
        try {
            return Crypt::decryptString($value);
        } catch (DecryptException) {
            Log::warning('Een opgeslagen geheim kon niet worden geopend (andere APP_KEY?). Sla de API key opnieuw op.');

            return '';
        }
    }
}
