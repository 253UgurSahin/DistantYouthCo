<?php

namespace App\Services;

use App\Exceptions\ApiError;
use App\Models\Upload;
use Illuminate\Support\Str;

/**
 * Large files in pieces, for a server with a small upload limit (shared hosting). The browser starts
 * an upload, sends pieces in order and then names the token in the release form. A piece sent twice
 * is not written twice; what is on disk is the truth.
 */
class Uploads
{
    public static function find(mixed $token): Upload
    {
        if (! is_string($token) || ! preg_match('/^[a-f0-9]{32}$/', $token)) {
            throw ApiError::notFound('Upload niet gevonden.');
        }

        return Upload::find($token) ?? throw ApiError::notFound('Upload niet gevonden.');
    }

    public function start(string $name, int $size): Upload
    {
        $this->purgeStale();
        $upload = Upload::create(['token' => Str::lower(bin2hex(random_bytes(16))), 'name' => $name, 'size' => $size, 'received' => 0]);
        touch($upload->partPath());

        return $upload;
    }

    /** Appends one piece from $in at $offset; returns how many bytes the server has now. */
    public function append(Upload $upload, int $offset, $in): int
    {
        $path = $upload->partPath();
        $part = fopen($path, 'c+b');
        if (! $part || ! flock($part, LOCK_EX)) {
            throw new ApiError(503, 'De upload is even bezet. Probeer opnieuw.');
        }
        try {
            $upload->refresh();
            $received = $upload->received;
            clearstatcache(true, $path);
            if ((int) fstat($part)['size'] !== $received) {
                ftruncate($part, $received); // a write that never got counted
            }
            if ($offset < $received) {
                return $received; // a retry after a lost answer
            }
            if ($offset > $received) {
                throw new ApiError(409, 'Dit stuk sluit niet aan; de upload gaat verder waar hij was.');
            }
            fseek($part, $received);
            $max = $upload->size - $received;
            $n = 0;
            while (! feof($in)) {
                $buf = fread($in, 1048576);
                if ($buf === false || $buf === '') {
                    break;
                }
                $n += strlen($buf);
                if ($n > $max) {
                    ftruncate($part, $received);
                    throw ApiError::bad('Er kwam meer binnen dan het bestand groot is.');
                }
                if (fwrite($part, $buf) !== strlen($buf)) {
                    ftruncate($part, $received);
                    throw new ApiError(507, 'De server kon het stuk niet opslaan (is de schijfruimte op?).');
                }
            }
            if ($n === 0) {
                throw ApiError::bad('Dit stuk was leeg.');
            }
            fflush($part);
            $upload->forceFill(['received' => $received + $n])->save();

            return $received + $n;
        } finally {
            flock($part, LOCK_UN);
            fclose($part);
        }
    }

    /** Pieces left behind for a day are thrown away. */
    public function purgeStale(): void
    {
        foreach (Upload::where('updated_at', '<', now()->subDay())->get() as $old) {
            @unlink($old->partPath());
            $old->delete();
        }
    }
}
