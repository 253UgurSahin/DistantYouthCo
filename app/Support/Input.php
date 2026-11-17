<?php

namespace App\Support;

use App\Exceptions\ApiError;

/** Checks of form and JSON input, with the app's own Dutch messages. */
final class Input
{
    public static function text(mixed $v, int $max, string $name): string
    {
        if ($v === null) {
            return '';
        }
        if (! is_string($v)) {
            throw ApiError::bad("$name is ongeldig.");
        }
        $s = trim(str_replace("\r\n", "\n", $v));
        if (mb_strlen($s) > $max) {
            throw ApiError::bad("$name is te lang (max $max tekens).");
        }

        return $s;
    }

    public static function intOrNull(mixed $v, int $min, int $max, string $name): ?int
    {
        if ($v === null || $v === '') {
            return null;
        }
        $n = is_int($v) ? $v : (is_string($v) && preg_match('/^-?\d+$/', trim($v)) ? (int) trim($v) : null);
        if ($n === null || $n < $min || $n > $max) {
            throw ApiError::bad("$name moet een heel getal tussen $min en $max zijn.");
        }

        return $n;
    }

    public static function dateOrNull(mixed $v): ?string
    {
        if (! $v) {
            return null;
        }
        if (! is_string($v) || ! preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $v, $m) || ! checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
            throw ApiError::bad('Datum is ongeldig.');
        }

        return $v;
    }

    public static function urlOrEmpty(mixed $v, string $name): string
    {
        $s = self::text($v, 500, $name);
        if ($s === '') {
            return '';
        }
        $p = parse_url($s);
        if ($p === false || empty($p['scheme']) || empty($p['host'])) {
            throw ApiError::bad("$name is geen geldige link.");
        }
        if (! in_array(strtolower($p['scheme']), ['http', 'https'], true)) {
            throw ApiError::bad("$name moet met https:// beginnen.");
        }

        return $s;
    }

    public static function bool(mixed $v): bool
    {
        return $v === true || $v === 1 || $v === '1' || $v === 'true' || $v === 'on';
    }

    /** A positive id from the URL or a body; anything else is "not found". */
    public static function id(mixed $v): int
    {
        if (is_int($v) && $v > 0) {
            return $v;
        }
        if (is_string($v) && preg_match('/^[1-9]\d{0,15}$/', $v)) {
            return (int) $v;
        }
        throw ApiError::notFound();
    }

    /** php.ini sizes such as "8M", in bytes. */
    public static function iniBytes(string $key): int
    {
        $v = trim((string) ini_get($key));
        if ($v === '' || $v === '0' || $v === '-1') {
            return PHP_INT_MAX;
        }
        $n = (int) $v;

        return match (strtolower(substr($v, -1))) {
            'g' => $n * 1024 ** 3,
            'm' => $n * 1024 ** 2,
            'k' => $n * 1024,
            default => $n,
        };
    }

    /** The size of one upload piece: well under this server's limits, at most 8 MB. */
    public static function uploadChunk(): int
    {
        $limit = min(self::iniBytes('upload_max_filesize'), self::iniBytes('post_max_size'));

        return (int) max(256 * 1024, min(8 * 1024 * 1024, floor($limit * 0.8)));
    }
}
