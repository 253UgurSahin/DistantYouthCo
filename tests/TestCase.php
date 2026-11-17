<?php

namespace Tests;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

abstract class TestCase extends BaseTestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        // A fresh key per test run (nothing key-like is kept in the repository).
        config(['app.key' => 'base64:'.base64_encode(random_bytes(32))]);
        Storage::fake('local');
    }

    /** The app's header: every change through the API needs it. */
    protected function app_(): static
    {
        return $this->withHeader('X-Requested-With', 'dyc');
    }

    /** A random password per name for this run, so no password is written in the tests. */
    protected static function pw(string $name): string
    {
        static $made = [];

        return $made[$name] ??= bin2hex(random_bytes(8));
    }

    protected function admin(): User
    {
        return User::factory()->admin()->create(['username' => 'admin']);
    }

    protected function listener(string $name = 'luisteraar'): User
    {
        return User::factory()->create(['username' => $name]);
    }

    /** A real WAV of $seconds of silence: 8 kHz, 16 bit, mono. */
    protected static function wav(int $seconds = 1): string
    {
        $data = str_repeat("\x01\x00", 8000 * $seconds);
        $fmt = pack('vvVVvv', 1, 1, 8000, 16000, 2, 16);

        return 'RIFF'.pack('V', 36 + strlen($data)).'WAVE'.'fmt '.pack('V', 16).$fmt.'data'.pack('V', strlen($data)).$data;
    }

    protected static function mp4(int $bytes = 3000): string
    {
        return "\x00\x00\x00\x18ftypisom".str_repeat("\x02", $bytes);
    }

    protected static function file(string $name, string $content): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, $content);
    }
}
