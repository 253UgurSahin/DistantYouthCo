<?php

namespace App\Services;

use App\Exceptions\ApiError;
use App\Models\Release;
use App\Models\Upload;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

/** The files of a release: checked by their real content, stored under fixed names, and processed. */
class ReleaseFiles
{
    public const LABEL = ['wav' => 'WAV', 'mp3' => 'MP3', 'video' => 'MP4', 'cover' => 'cover'];
    private const BASENAME = ['wav' => 'master', 'mp3' => 'audio', 'video' => 'video', 'cover' => 'cover'];

    /** The extension to store a file under, from its first bytes (never its name), or null. */
    public static function sniff(string $kind, string $file): ?string
    {
        $f = @fopen($file, 'rb');
        if (! $f) {
            return null;
        }
        $b = (string) fread($f, 16);
        fclose($f);
        if (strlen($b) < 12) {
            return null;
        }

        return match ($kind) {
            'wav' => in_array(substr($b, 0, 4), ['RIFF', 'RF64', 'BW64'], true) && substr($b, 8, 4) === 'WAVE' ? 'wav' : null,
            'mp3' => substr($b, 0, 3) === 'ID3' || (ord($b[0]) === 0xFF && (ord($b[1]) & 0xE0) === 0xE0) ? 'mp3' : null,
            'video' => substr($b, 4, 4) === 'ftyp' ? 'mp4' : null,
            'cover' => match (true) {
                substr($b, 0, 3) === "\xFF\xD8\xFF" => 'jpg',
                substr($b, 0, 4) === "\x89PNG" => 'png',
                substr($b, 0, 4) === 'RIFF' && substr($b, 8, 4) === 'WEBP' => 'webp',
                default => null,
            },
            default => null,
        };
    }

    /**
     * The files sent with a release form: each a normal file field, or "<kind>_upload", the token of a
     * file sent in pieces. Every one is checked before anything is stored.
     *
     * @return array<string, array{path: string, ext: string, upload: ?Upload}>
     */
    public function fromRequest(Request $request): array
    {
        $found = [];
        foreach (array_keys(Release::FILE_COLUMNS) as $kind) {
            $token = $request->input($kind.'_upload');
            if (is_string($token) && $token !== '') {
                $upload = Uploads::find($token);
                if (! $upload->isComplete()) {
                    throw ApiError::bad("{$upload->name} is nog niet helemaal geüpload.");
                }
                $ext = self::sniff($kind, $upload->partPath());
                if (! $ext) {
                    throw ApiError::bad("{$upload->name} is geen geldig ".self::LABEL[$kind].'-bestand.');
                }
                $found[$kind] = ['path' => $upload->partPath(), 'ext' => $ext, 'upload' => $upload];

                continue;
            }
            $file = $request->file($kind);
            if (! $file instanceof UploadedFile) {
                continue;
            }
            if (in_array($file->getError(), [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) {
                throw new ApiError(413, "{$file->getClientOriginalName()} is te groot voor deze server (max ".ini_get('upload_max_filesize').').');
            }
            if (! $file->isValid()) {
                throw ApiError::bad('Upload mislukt.');
            }
            $ext = self::sniff($kind, $file->getPathname());
            if (! $ext) {
                throw ApiError::bad("{$file->getClientOriginalName()} is geen geldig ".self::LABEL[$kind].'-bestand.');
            }
            $found[$kind] = ['path' => $file->getPathname(), 'ext' => $ext, 'upload' => null];
        }

        return $found;
    }

    /** Moves a checked file into the release's folder; returns the stored name. */
    public function store(Release $release, string $kind, array $file): string
    {
        $disk = Storage::disk('local');
        $disk->makeDirectory($release->directory());
        foreach ($disk->files($release->directory()) as $old) {
            if (str_starts_with(basename($old), self::BASENAME[$kind].'.')) {
                $disk->delete($old);
            }
        }
        $name = self::BASENAME[$kind].'.'.$file['ext'];
        if (! rename($file['path'], $disk->path($release->directory().'/'.$name))) {
            throw new ApiError(500, 'Het bestand kon niet worden opgeslagen.');
        }
        $file['upload']?->delete();

        return $name;
    }

    public function remove(Release $release, string $kind): void
    {
        $path = $release->filePath($kind);
        if ($path) {
            @unlink($path);
        }
    }

    // ---------- after an upload ----------

    /** The length of a WAV from its header, without any tool. */
    public static function wavDuration(string $file): ?float
    {
        $f = @fopen($file, 'rb');
        if (! $f) {
            return null;
        }
        $head = (string) fread($f, 12);
        if (strlen($head) < 12 || substr($head, 0, 4) !== 'RIFF' || substr($head, 8, 4) !== 'WAVE') {
            fclose($f);

            return null;
        }
        $byteRate = null;
        $dataSize = null;
        while (! feof($f)) {
            $h = fread($f, 8);
            if ($h === false || strlen($h) < 8) {
                break;
            }
            $id = substr($h, 0, 4);
            $size = unpack('V', substr($h, 4, 4))[1];
            if ($id === 'fmt ') {
                $fmt = (string) fread($f, $size);
                if (strlen($fmt) >= 12) {
                    $byteRate = unpack('V', substr($fmt, 8, 4))[1];
                }
                if ($size % 2) {
                    fseek($f, 1, SEEK_CUR);
                }
            } elseif ($id === 'data') {
                // A WAV still being written can say 0 or too much: then the rest of the file is the data.
                $rest = filesize($file) - ftell($f);
                $dataSize = ($size === 0 || $size > $rest) ? $rest : $size;
                break;
            } else {
                fseek($f, $size + ($size % 2), SEEK_CUR);
            }
        }
        fclose($f);

        return $byteRate && $dataSize ? round($dataSize / $byteRate, 3) : null;
    }

    public static function hasFfmpeg(): bool
    {
        static $has = null;
        if ($has !== null) {
            return $has;
        }
        if (env('DYC_NO_FFMPEG') || ! function_exists('exec') || in_array('exec', array_map('trim', explode(',', (string) ini_get('disable_functions'))), true)) {
            return $has = false;
        }
        $code = 1;
        $out = [];
        @exec('ffmpeg -version 2>&1', $out, $code);

        return $has = $code === 0;
    }

    private static function ffmpeg(array $args): bool
    {
        $code = 1;
        $out = [];
        @exec('ffmpeg '.implode(' ', array_map('escapeshellarg', $args)).' 2>&1', $out, $code);

        return $code === 0;
    }

    /** The duration at once (quick); later, with ffmpeg, an MP3 from the WAV and a cover from the video. */
    public function quickInfo(Release $release): void
    {
        $wav = $release->filePath('wav');
        if ($wav && ! $release->duration && ($d = self::wavDuration($wav))) {
            $release->forceFill(['duration' => $d])->saveQuietly();
        }
    }

    public function heavyWork(int $releaseId): void
    {
        if (! self::hasFfmpeg()) {
            return;
        }
        $release = Release::find($releaseId);
        if (! $release) {
            return;
        }
        $disk = Storage::disk('local');
        // One conversion per release at a time.
        $lock = fopen($disk->path($release->directory().'/.processing'), 'c');
        if (! $lock || ! flock($lock, LOCK_EX | LOCK_NB)) {
            return;
        }
        @set_time_limit(900);
        $dir = $disk->path($release->directory());
        $wav = $release->filePath('wav');
        if ($wav && ! $release->mp3_file && self::ffmpeg(['-y', '-v', 'error', '-i', $wav, '-codec:a', 'libmp3lame', '-b:a', '320k', "$dir/audio.mp3"])) {
            $release->forceFill(['mp3_file' => 'audio.mp3', 'mp3_generated' => true])->save();
        }
        $video = $release->filePath('video');
        if ($video && ! $release->cover_file) {
            $vf = "crop='min(iw,ih)':'min(iw,ih)',scale=600:600";
            $ok = self::ffmpeg(['-y', '-v', 'error', '-ss', '1', '-i', $video, '-frames:v', '1', '-vf', $vf, '-q:v', '3', "$dir/cover.jpg"])
                || self::ffmpeg(['-y', '-v', 'error', '-i', $video, '-frames:v', '1', '-vf', $vf, '-q:v', '3', "$dir/cover.jpg"]);
            if ($ok) {
                $release->forceFill(['cover_file' => 'cover.jpg', 'cover_generated' => true])->save();
            }
        }
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}
