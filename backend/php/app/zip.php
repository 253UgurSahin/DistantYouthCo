<?php
declare(strict_types=1);

// Streams a ZIP of stored videos, without packing it in memory or on disk first: the same format as
// backend/node/zip.js (stored, a data descriptor per file, ZIP64 records past 4 GB together).

const ZIP_MAX32 = 0xffffffff;

function zip_safe_name(string $s): string {
    $s = trim((string) preg_replace('/\s+/u', ' ', (string) preg_replace('/[\\\\\/:*?"<>|\x00-\x1f]/u', ' ', $s)));
    $s = mb_substr($s, 0, 120);
    return $s !== '' ? $s : 'video';
}

/** Writes [['name' => ..., 'path' => ...]] as one ZIP to the output. Returns false when the reader left. */
function write_zip(array $entries): bool {
    $now = getdate();
    $time = ($now['hours'] << 11) | ($now['minutes'] << 5) | intdiv($now['seconds'], 2);
    $date = (($now['year'] - 1980) << 9) | ($now['mon'] << 5) | $now['mday'];
    $offset = 0;
    $central = [];
    $out = function (string $b) use (&$offset): bool {
        echo $b;
        $offset += strlen($b);
        flush();
        return !connection_aborted();
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
        $far = $c['start'] >= ZIP_MAX32;
        $extra = $far ? pack('vvP', 0x0001, 8, $c['start']) : '';
        $h = pack('VvvvvvvVVVvvvvvVV', 0x02014b50, (3 << 8) | 45, $far ? 45 : 20, 0x0808, 0, $time, $date,
            $c['crc'], $c['size'], $c['size'], strlen($c['name']), strlen($extra), 0, 0, 0, (0100644 << 16), $far ? ZIP_MAX32 : $c['start']);
        if (!$out($h . $c['name'] . $extra)) return false;
    }
    $cdSize = $offset - $cdStart;
    $n = count($central);
    $big = $n >= 0xffff || $cdStart >= ZIP_MAX32 || $cdSize >= ZIP_MAX32;
    if ($big) {
        $z64 = $offset;
        $rec = pack('VPvvVVPPPP', 0x06064b50, 44, (3 << 8) | 45, 45, 0, 0, $n, $n, $cdSize, $cdStart);
        $loc = pack('VVPV', 0x07064b50, 0, $z64, 1);
        if (!$out($rec . $loc)) return false;
    }
    return $out(pack('VvvvvVVv', 0x06054b50, 0, 0, $big ? 0xffff : $n, $big ? 0xffff : $n, $big ? ZIP_MAX32 : $cdSize, $big ? ZIP_MAX32 : $cdStart, 0));
}
