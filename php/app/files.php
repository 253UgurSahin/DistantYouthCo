<?php
declare(strict_types=1);

const KIND_LABEL = ['wav' => 'WAV', 'mp3' => 'MP3', 'video' => 'MP4', 'cover' => 'cover'];
const KIND_COLUMN = ['wav' => 'wav_file', 'mp3' => 'mp3_file', 'video' => 'video_file', 'cover' => 'cover_file'];
const KIND_BASENAME = ['wav' => 'master', 'mp3' => 'audio', 'video' => 'video', 'cover' => 'cover'];

/** Checks the real content of a file (not its name). Returns the extension to store it under, or null. */
function sniff(string $kind, string $file): ?string {
    $f = @fopen($file, 'rb');
    if (!$f) return null;
    $b = (string) fread($f, 16);
    fclose($f);
    if (strlen($b) < 12) return null;
    switch ($kind) {
        case 'wav': return in_array(substr($b, 0, 4), ['RIFF', 'RF64', 'BW64'], true) && substr($b, 8, 4) === 'WAVE' ? 'wav' : null;
        case 'mp3': return substr($b, 0, 3) === 'ID3' || (ord($b[0]) === 0xff && (ord($b[1]) & 0xe0) === 0xe0) ? 'mp3' : null;
        case 'video': return substr($b, 4, 4) === 'ftyp' ? 'mp4' : null;
        case 'cover':
            if (substr($b, 0, 3) === "\xFF\xD8\xFF") return 'jpg';
            if (substr($b, 0, 4) === "\x89PNG") return 'png';
            if (substr($b, 0, 4) === 'RIFF' && substr($b, 8, 4) === 'WEBP') return 'webp';
            return null;
    }
    return null;
}

function release_dir(int $id): string { return upload_dir() . '/releases/' . $id; }

/** Absolute path of a stored file, or null when the name is missing or would leave the folder. */
function stored_path(int $id, ?string $name): ?string {
    if (!$name || !preg_match('/^[a-z0-9]+\.[a-z0-9]+$/', $name)) return null;
    $p = release_dir($id) . '/' . $name;
    return is_file($p) ? $p : null;
}

/** Moves a checked file into the release's folder; returns the stored name. */
function store_file(int $id, string $kind, string $from, string $ext): string {
    $dir = release_dir($id);
    if (!is_dir($dir)) mkdir($dir, 0700, true);
    foreach (glob($dir . '/' . KIND_BASENAME[$kind] . '.*') ?: [] as $old) @unlink($old);
    $name = KIND_BASENAME[$kind] . '.' . $ext;
    if (!rename($from, "$dir/$name")) throw new HttpError(500, 'Het bestand kon niet worden opgeslagen.');
    return $name;
}

function remove_stored(int $id, ?string $name): void {
    $p = stored_path($id, $name);
    if ($p) @unlink($p);
}

function rm_tree(string $dir): void {
    if (!is_dir($dir)) return;
    foreach (scandir($dir) ?: [] as $f) {
        if ($f === '.' || $f === '..') continue;
        $p = "$dir/$f";
        is_dir($p) ? rm_tree($p) : @unlink($p);
    }
    @rmdir($dir);
}

// ---------- uploads in pieces (a shared host's upload limit is far below a WAV or a video) ----------

function tmp_dir(): string {
    $d = upload_dir() . '/tmp';
    if (!is_dir($d)) mkdir($d, 0700, true);
    return $d;
}
function part_path(string $token): string { return tmp_dir() . "/$token.part"; }

function upload_row(string $token): array {
    if (!preg_match('/^[a-f0-9]{32}$/', $token)) throw not_found('Upload niet gevonden.');
    $r = one('SELECT * FROM uploads WHERE token = ?', [$token]);
    if (!$r) throw not_found('Upload niet gevonden.');
    return $r;
}

/** Pieces left behind for a day are thrown away. */
function purge_stale_uploads(): void {
    foreach (all('SELECT token FROM uploads WHERE created_at < ?', [time() - 86400]) as $r) {
        @unlink(part_path($r['token']));
        q('DELETE FROM uploads WHERE token = ?', [$r['token']]);
    }
}

/**
 * The files sent with a release form: each either as a normal file field, or as "<kind>_upload",
 * the token of a file sent in pieces. Checks every one before anything is stored.
 * Returns [kind => ['path' => ..., 'ext' => ..., 'token' => ?]].
 */
function form_files(): array {
    $found = [];
    foreach (array_keys(KIND_COLUMN) as $kind) {
        $token = $_POST[$kind . '_upload'] ?? '';
        if (is_string($token) && $token !== '') {
            $row = upload_row($token);
            $path = part_path($token);
            clearstatcache(true, $path);
            if ((int) $row['received'] !== (int) $row['size'] || !is_file($path) || filesize($path) !== (int) $row['size']) {
                throw bad("{$row['name']} is nog niet helemaal geüpload.");
            }
            $ext = sniff($kind, $path);
            if (!$ext) throw bad("{$row['name']} is geen geldig " . KIND_LABEL[$kind] . '-bestand.');
            $found[$kind] = ['path' => $path, 'ext' => $ext, 'token' => $token];
            continue;
        }
        $f = $_FILES[$kind] ?? null;
        if (!$f || ($f['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) continue;
        if (in_array($f['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) {
            throw new HttpError(413, "{$f['name']} is te groot voor deze server (max " . ini_get('upload_max_filesize') . ').');
        }
        if ($f['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) throw bad('Upload mislukt.');
        $ext = sniff($kind, $f['tmp_name']);
        if (!$ext) throw bad("{$f['name']} is geen geldig " . KIND_LABEL[$kind] . '-bestand.');
        $found[$kind] = ['path' => $f['tmp_name'], 'ext' => $ext, 'token' => null];
    }
    return $found;
}

function forget_uploads(array $files): void {
    foreach ($files as $f) if (!empty($f['token'])) q('DELETE FROM uploads WHERE token = ?', [$f['token']]);
}

// ---------- after an upload: duration, and with ffmpeg an MP3 and a cover ----------

/** The length of a WAV from its header, without any tool. */
function wav_duration(string $file): ?float {
    $f = @fopen($file, 'rb');
    if (!$f) return null;
    $head = (string) fread($f, 12);
    if (strlen($head) < 12 || substr($head, 0, 4) !== 'RIFF' || substr($head, 8, 4) !== 'WAVE') { fclose($f); return null; }
    $byteRate = null;
    $dataSize = null;
    while (!feof($f)) {
        $h = fread($f, 8);
        if ($h === false || strlen($h) < 8) break;
        $id = substr($h, 0, 4);
        $size = unpack('V', substr($h, 4, 4))[1];
        if ($id === 'fmt ') {
            $fmt = (string) fread($f, $size);
            if (strlen($fmt) >= 12) $byteRate = unpack('V', substr($fmt, 8, 4))[1];
            if ($size % 2) fseek($f, 1, SEEK_CUR);
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

function has_ffmpeg(): bool {
    static $has = null;
    if ($has !== null) return $has;
    if (getenv('DYC_NO_FFMPEG') === '1' || !function_exists('exec')) return $has = false;
    $disabled = array_map('trim', explode(',', (string) ini_get('disable_functions')));
    if (in_array('exec', $disabled, true)) return $has = false;
    $out = [];
    $code = 1;
    @exec('ffmpeg -version 2>&1', $out, $code);
    return $has = ($code === 0);
}

function run_ffmpeg(array $args): bool {
    $cmd = 'ffmpeg ' . implode(' ', array_map('escapeshellarg', $args)) . ' 2>&1';
    $out = [];
    $code = 1;
    @exec($cmd, $out, $code);
    return $code === 0;
}

/** Duration now (quick); an MP3 from the WAV and a cover from the video when ffmpeg is there. */
function process_release(int $id, bool $heavy): void {
    $r = one('SELECT * FROM releases WHERE id = ?', [$id]);
    if (!$r) return;
    $wav = stored_path($id, $r['wav_file']);
    if ($wav && !$r['duration']) {
        $d = wav_duration($wav);
        if ($d) q('UPDATE releases SET duration = ? WHERE id = ?', [$d, $id]);
    }
    if (!$heavy || !has_ffmpeg()) return;
    // One conversion per release at a time (two saves in a row must not both run ffmpeg).
    $lock = fopen(release_dir($id) . '/.processing', 'c');
    if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) return;
    @set_time_limit(900);
    $dir = release_dir($id);
    if ($wav && !$r['mp3_file'] && run_ffmpeg(['-y', '-v', 'error', '-i', $wav, '-codec:a', 'libmp3lame', '-b:a', '320k', "$dir/audio.mp3"])) {
        q('UPDATE releases SET mp3_file = ?, mp3_generated = 1 WHERE id = ?', ['audio.mp3', $id]);
    }
    $r = one('SELECT * FROM releases WHERE id = ?', [$id]);
    $video = stored_path($id, $r['video_file']);
    if ($video && !$r['cover_file']) {
        $vf = "crop='min(iw,ih)':'min(iw,ih)',scale=600:600";
        $ok = run_ffmpeg(['-y', '-v', 'error', '-ss', '1', '-i', $video, '-frames:v', '1', '-vf', $vf, '-q:v', '3', "$dir/cover.jpg"])
            || run_ffmpeg(['-y', '-v', 'error', '-i', $video, '-frames:v', '1', '-vf', $vf, '-q:v', '3', "$dir/cover.jpg"]);
        if ($ok) q('UPDATE releases SET cover_file = ?, cover_generated = 1 WHERE id = ?', ['cover.jpg', $id]);
    }
    q("UPDATE releases SET updated_at = datetime('now') WHERE id = ?", [$id]);
    flock($lock, LOCK_UN);
    fclose($lock);
}

/** Sends a stored file, with ranges (seeking in the player) and as a download when asked. */
function send_file(string $path, string $downloadName = ''): void {
    $types = ['wav' => 'audio/wav', 'mp3' => 'audio/mpeg', 'mp4' => 'video/mp4', 'jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'];
    $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
    $size = filesize($path);
    $mtime = filemtime($path);
    $etag = '"' . dechex($size) . '-' . dechex($mtime) . '"';
    header('Content-Type: ' . ($types[$ext] ?? 'application/octet-stream'));
    header('Accept-Ranges: bytes');
    header('ETag: ' . $etag);
    header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $mtime) . ' GMT');
    header('Cache-Control: private, max-age=3600');
    if ($downloadName !== '') header('Content-Disposition: attachment; filename="' . $downloadName . '"');
    if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) { http_response_code(304); return; }
    $start = 0;
    $end = $size - 1;
    $range = $_SERVER['HTTP_RANGE'] ?? '';
    if ($range !== '' && preg_match('/^bytes=(\d*)-(\d*)$/', trim($range), $m) && ($m[1] !== '' || $m[2] !== '')) {
        $ignore = $m[1] !== '' && $m[2] !== '' && (int) $m[2] < (int) $m[1];
        if ($m[1] === '') { $start = max(0, $size - (int) $m[2]); }
        else { $start = (int) $m[1]; if ($m[2] !== '' && !$ignore) $end = min($end, (int) $m[2]); }
        if ($ignore) { $start = 0; $end = $size - 1; }
        elseif ($start > $end || $start >= $size) {
            http_response_code(416);
            header("Content-Range: bytes */$size");
            return;
        }
        if (!$ignore) {
            http_response_code(206);
            header("Content-Range: bytes $start-$end/$size");
        }
    }
    header('Content-Length: ' . ($end - $start + 1));
    if ($_SERVER['REQUEST_METHOD'] === 'HEAD') return;
    @set_time_limit(0);
    while (ob_get_level()) ob_end_clean();
    $f = fopen($path, 'rb');
    fseek($f, $start);
    $left = $end - $start + 1;
    while ($left > 0 && !feof($f) && !connection_aborted()) {
        $chunk = fread($f, (int) min(1048576, $left));
        if ($chunk === false || $chunk === '') break;
        echo $chunk;
        flush();
        $left -= strlen($chunk);
    }
    fclose($f);
}
