<?php

namespace App\Services;

/**
 * Streams a ZIP of stored videos without packing it in memory or on disk first. The files are stored
 * as they are (MP4 does not compress further), each followed by a data descriptor with its CRC, and
 * ZIP64 records are written when the archive passes 4 GB.
 */
final class ZipStream
{
    public const MAX32 = 0xffffffff;

    /** A file name for inside the archive: no path parts, no characters that trouble Windows or macOS. */
    public static function safeName(string $s): string
    {
        $s = trim((string) preg_replace('/\s+/u', ' ', (string) preg_replace('/[\\\\\/:*?"<>|\x00-\x1f]/u', ' ', $s)));
        $s = mb_substr($s, 0, 120);

        return $s !== '' ? $s : 'video';
    }

    /**
     * Writes [['name' => ..., 'path' => ...]] as one ZIP. ($limit is only lowered by tests, to reach ZIP64.) $out receives each piece and returns false
     * when the reader left (default: echo and flush). Returns false then, true when complete.
     */
    public static function write(array $entries, ?callable $out = null, int $limit = self::MAX32): bool
    {
        $now = getdate();
        $time = ($now['hours'] << 11) | ($now['minutes'] << 5) | intdiv($now['seconds'], 2);
        $date = (($now['year'] - 1980) << 9) | ($now['mon'] << 5) | $now['mday'];
        $offset = 0;
        $central = [];
        $emit = $out ?? function (string $b): bool {
            echo $b;
            flush();

            return ! connection_aborted();
        };
        $out = function (string $b) use (&$offset, $emit): bool {
            $offset += strlen($b);

            return $emit($b);
        };
        foreach ($entries as $e) {
            $name = $e['name'];
            $start = $offset;
            // Version 20, flags: a data descriptor follows, the name is UTF-8; stored; CRC and sizes come after.
            if (!$out(pack('VvvvvvVVVvv', 0x04034b50, 20, 0x0808, 0, $time, $date, 0, 0, 0, strlen($name), 0) . $name)) return false;
            $ctx = hash_init('crc32b');
            $size = 0;
            $f = fopen($e['path'], 'rb');
            while (!feof($f)) {
                $chunk = fread($f, 1048576);
                if ($chunk === false || $chunk === '') break;
                hash_update($ctx, $chunk);
                $size += strlen($chunk);
                if (!$out($chunk)) { fclose($f); return false; }
            }
            fclose($f);
            $crc = hexdec(hash_final($ctx));
            if (!$out(pack('VVVV', 0x08074b50, $crc, $size, $size))) return false;
            $central[] = ['name' => $name, 'crc' => $crc, 'size' => $size, 'start' => $start];
        }
        $cdStart = $offset;
        foreach ($central as $c) {
            $far = $c['start'] >= $limit;
            $extra = $far ? pack('vvP', 0x0001, 8, $c['start']) : '';
            $h = pack('VvvvvvvVVVvvvvvVV', 0x02014b50, (3 << 8) | 45, $far ? 45 : 20, 0x0808, 0, $time, $date,
                $c['crc'], $c['size'], $c['size'], strlen($c['name']), strlen($extra), 0, 0, 0, (0100644 << 16), $far ? self::MAX32 : $c['start']);
            if (!$out($h . $c['name'] . $extra)) return false;
        }
        $cdSize = $offset - $cdStart;
        $n = count($central);
        $big = $n >= 0xffff || $cdStart >= $limit || $cdSize >= $limit;
        if ($big) {
            $z64 = $offset;
            $rec = pack('VPvvVVPPPP', 0x06064b50, 44, (3 << 8) | 45, 45, 0, 0, $n, $n, $cdSize, $cdStart);
            $loc = pack('VVPV', 0x07064b50, 0, $z64, 1);
            if (!$out($rec . $loc)) return false;
        }
        return $out(pack('VvvvvVVv', 0x06054b50, 0, 0, $big ? 0xffff : $n, $big ? 0xffff : $n, $big ? self::MAX32 : $cdSize, $big ? self::MAX32 : $cdStart, 0));
    }
}
