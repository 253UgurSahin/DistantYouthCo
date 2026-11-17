<?php
// Distant Youth Studio, the server in PHP: for shared hosting, where Node.js cannot run.
// It speaks the same API as src/ (the Node.js server), so the screens in public/ work with either.
declare(strict_types=1);

const DYC_SESSION_DAYS = 30;
const DYC_COOKIE = 'dyc_session';
const DYC_MAX_UPLOAD = 4294967295; // a file of up to 4 GB (one byte under: the ZIP of videos keeps it simple)

// ---------- configuration: config.php next to app/, then the environment ----------

/** One setting: config.php beside app/ first, then an environment variable, then the default. */
function cfg(string $key, $default = null) {
    static $file = null;
    if ($file === null) {
        $p = DYC_APP . '/config.php';
        $file = is_file($p) ? (array) (require $p) : [];
    }
    if (array_key_exists($key, $file) && $file[$key] !== '' && $file[$key] !== null) return $file[$key];
    $env = getenv(strtoupper($key));
    if ($env !== false && $env !== '') return $env;
    return $default;
}

function dyc_version(): string {
    foreach ([DYC_APP . '/VERSION', dirname(DYC_APP) . '/package.json'] as $p) {
        if (!is_file($p)) continue;
        $raw = trim((string) file_get_contents($p));
        if (str_ends_with($p, 'VERSION')) return $raw;
        $j = json_decode($raw, true);
        if (is_array($j) && isset($j['version'])) return (string) $j['version'];
    }
    return '0.0.0';
}

function data_dir(): string {
    static $dir = null;
    if ($dir === null) {
        $dir = rtrim((string) cfg('data_dir', DYC_APP . '/data'), '/');
        if (!is_dir($dir)) mkdir($dir, 0700, true);
        // The data folder never serves anything, even if a host puts it inside the web root by mistake.
        if (!is_file("$dir/.htaccess")) @file_put_contents("$dir/.htaccess", "<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
    }
    return $dir;
}
function upload_dir(): string { return data_dir() . '/uploads'; }

// ---------- errors and responses ----------

final class HttpError extends Exception {
    public int $status;
    public function __construct(int $status, string $message) { parent::__construct($message); $this->status = $status; }
}
function bad(string $m): HttpError { return new HttpError(400, $m); }
function not_found(string $m = 'Niet gevonden'): HttpError { return new HttpError(404, $m); }

function send_json($data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
}

function security_headers(): void {
    header("Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: same-origin');
    header('X-Frame-Options: DENY');
    header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
    header('Cross-Origin-Opener-Policy: same-origin');
    if (is_https()) header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
    header_remove('X-Powered-By');
}

function trust_proxy(): bool { return (string) cfg('trust_proxy', '0') === '1'; }

function is_https(): bool {
    if (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off') return true;
    if (($_SERVER['SERVER_PORT'] ?? '') === '443') return true;
    if (trust_proxy() && strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https') return true;
    return false;
}

function client_ip(): string {
    if (trust_proxy() && !empty($_SERVER['HTTP_X_FORWARDED_FOR'])) return trim(explode(',', (string) $_SERVER['HTTP_X_FORWARDED_FOR'])[0]);
    return (string) ($_SERVER['REMOTE_ADDR'] ?? '');
}

// ---------- the database: SQLite, the same tables as the Node.js server ----------

function db(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;
    $pdo = new PDO('sqlite:' . data_dir() . '/distantyouth.db');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->setAttribute(PDO::ATTR_STRINGIFY_FETCHES, false);
    $pdo->exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    $pdo->exec(<<<SQL
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'listener')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  style TEXT NOT NULL DEFAULT '',
  lyrics TEXT NOT NULL DEFAULT '',
  bpm INTEGER,
  release_date TEXT,
  video_type TEXT NOT NULL DEFAULT 'Official Visualizer',
  hidden INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  wav_file TEXT,
  mp3_file TEXT,
  mp3_generated INTEGER NOT NULL DEFAULT 0,
  video_file TEXT,
  cover_file TEXT,
  cover_generated INTEGER NOT NULL DEFAULT 0,
  duration REAL,
  yt_title TEXT NOT NULL DEFAULT '',
  yt_description TEXT NOT NULL DEFAULT '',
  yt_tags TEXT NOT NULL DEFAULT '',
  yt_generated_with TEXT NOT NULL DEFAULT '',
  youtube_url TEXT NOT NULL DEFAULT '',
  spotify_url TEXT NOT NULL DEFAULT '',
  on_youtube INTEGER NOT NULL DEFAULT 0,
  on_spotify INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_public INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS playlist_items (
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, release_id)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS uploads (
  token TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  received INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
SQL);
    return $pdo;
}

function q(string $sql, array $args = []): PDOStatement {
    $st = db()->prepare($sql);
    $st->execute($args);
    return $st;
}
function one(string $sql, array $args = []): ?array { $r = q($sql, $args)->fetch(); return $r === false ? null : $r; }
function all(string $sql, array $args = []): array { return q($sql, $args)->fetchAll(); }

function tx(callable $fn) {
    db()->beginTransaction();
    try { $r = $fn(); db()->commit(); return $r; }
    catch (Throwable $e) { db()->rollBack(); throw $e; }
}

// ---------- secrets in the database (the Claude key): AES-256-GCM, the same format as the Node.js server ----------

const SEAL_PREFIX = 'enc:v1:';

function seal_key(): string {
    static $key = null;
    if ($key !== null) return $key;
    $secret = (string) cfg('secret_key', '');
    if ($secret !== '') return $key = hash('sha256', $secret, true);
    $file = data_dir() . '/secret.key';
    if (!is_file($file)) {
        $f = @fopen($file, 'x');
        if ($f) { fwrite($f, bin2hex(random_bytes(32))); fclose($f); @chmod($file, 0600); }
    }
    return $key = (string) hex2bin(trim((string) file_get_contents($file)));
}

function seal(string $text): string {
    if ($text === '') return '';
    $iv = random_bytes(12);
    $tag = '';
    $body = openssl_encrypt($text, 'aes-256-gcm', seal_key(), OPENSSL_RAW_DATA, $iv, $tag, '', 16);
    return SEAL_PREFIX . base64_encode($iv . $tag . $body);
}

function open_sealed(?string $value): string {
    if ($value === null || $value === '') return '';
    if (!str_starts_with($value, SEAL_PREFIX)) return $value;
    $raw = base64_decode(substr($value, strlen(SEAL_PREFIX)), true);
    if ($raw === false || strlen($raw) < 28) return '';
    $out = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', seal_key(), OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
    if ($out === false) { error_log('Een opgeslagen geheim kon niet worden geopend (andere SECRET_KEY?). Sla de API key opnieuw op.'); return ''; }
    return $out;
}

// ---------- settings ----------

const DEFAULT_SETTINGS = [
    'artist_name' => 'Distant Youth Co.',
    'spotify_artist_url' => 'https://open.spotify.com/artist/7hbil2HXkg0OniGTxMUHeo',
    'youtube_channel_url' => 'https://www.youtube.com/@DistantYouthCo',
    'ai_disclosure' => '🧪 Made with AI — Suno AI (AI-assisted, human-directed).',
    'default_hashtags' => '#aimusic #sunoai #bassmusic #electronicmusic #distantyouthco',
    'default_video_type' => 'Official Visualizer',
    'anthropic_api_key' => '',
];
const SECRET_SETTINGS = ['anthropic_api_key'];

function get_settings(): array {
    $out = DEFAULT_SETTINGS;
    foreach (all('SELECT key, value FROM settings') as $r) {
        $out[$r['key']] = in_array($r['key'], SECRET_SETTINGS, true) ? open_sealed($r['value']) : $r['value'];
    }
    return $out;
}

function save_settings(array $values): void {
    foreach ($values as $k => $v) {
        if (!array_key_exists($k, DEFAULT_SETTINGS) || !is_string($v)) continue;
        q('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
            [$k, in_array($k, SECRET_SETTINGS, true) ? seal($v) : $v]);
    }
}

// ---------- accounts and sessions ----------

function validate_credentials($username, $password): ?string {
    if (!is_string($username) || !preg_match('/^[a-zA-Z0-9_.-]{3,32}$/', $username)) return 'Gebruikersnaam: 3–32 tekens (letters, cijfers, _ . -).';
    if (!is_string($password) || mb_strlen($password) < 8) return 'Wachtwoord moet minstens 8 tekens zijn.';
    return null;
}

function hash_password(string $p): string { return password_hash($p, PASSWORD_DEFAULT); }
function verify_password(string $p, string $stored): bool { return password_verify($p, $stored); }

function session_cookie(string $value, int $expires): void {
    setcookie(DYC_COOKIE, $value, [
        'expires' => $expires, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax',
        'secure' => is_https() || (string) cfg('cookie_secure', '0') === '1',
    ]);
}

function create_session(int $userId): void {
    $token = bin2hex(random_bytes(32));
    $expires = time() + DYC_SESSION_DAYS * 86400;
    q('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', [$token, $userId, $expires * 1000]);
    session_cookie($token, $expires);
}

function destroy_session(): void {
    $t = $_COOKIE[DYC_COOKIE] ?? '';
    if ($t !== '') q('DELETE FROM sessions WHERE token = ?', [$t]);
    session_cookie('', time() - 3600);
}

function current_user(): ?array {
    static $done = false, $user = null;
    if ($done) return $user;
    $done = true;
    $t = $_COOKIE[DYC_COOKIE] ?? '';
    if (!is_string($t) || $t === '') return null;
    $row = one('SELECT u.id, u.username, u.role, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?', [$t]);
    if ($row && $row['expires_at'] > time() * 1000) {
        $user = ['id' => (int) $row['id'], 'username' => $row['username'], 'role' => $row['role']];
    } elseif ($row) {
        q('DELETE FROM sessions WHERE token = ?', [$t]);
    }
    return $user;
}

function require_user(): array {
    $u = current_user();
    if (!$u) throw new HttpError(401, 'Niet ingelogd');
    return $u;
}
function require_admin(): array {
    $u = require_user();
    if ($u['role'] !== 'admin') throw new HttpError(403, 'Alleen voor admin');
    return $u;
}

/** Only failed attempts count: 20 in 15 minutes per address. */
function login_guard(): void {
    $ip = client_ip();
    $now = time();
    $row = one('SELECT * FROM login_attempts WHERE ip = ?', [$ip]);
    if ($row && $row['reset_at'] > $now && $row['count'] >= 20) throw new HttpError(429, 'Te veel pogingen, probeer het later opnieuw.');
}
function login_failed(): void {
    $ip = client_ip();
    $now = time();
    $row = one('SELECT * FROM login_attempts WHERE ip = ?', [$ip]);
    if (!$row || $row['reset_at'] <= $now) q('INSERT INTO login_attempts (ip, count, reset_at) VALUES (?, 1, ?) ON CONFLICT(ip) DO UPDATE SET count = 1, reset_at = excluded.reset_at', [$ip, $now + 900]);
    else q('UPDATE login_attempts SET count = count + 1 WHERE ip = ?', [$ip]);
}

// ---------- input ----------

function body(): array {
    static $b = null;
    if ($b !== null) return $b;
    $type = strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? ''));
    if (str_starts_with($type, 'application/json')) {
        $raw = file_get_contents('php://input', false, null, 0, 1048577);
        if (strlen((string) $raw) > 1048576) throw new HttpError(413, 'Te veel gegevens in één keer.');
        $d = $raw === '' ? [] : json_decode((string) $raw, true);
        if (!is_array($d)) throw bad('Ongeldige gegevens.');
        return $b = $d;
    }
    return $b = $_POST;
}

function text($v, int $max, string $name): string {
    if ($v === null) return '';
    if (!is_string($v)) throw bad("$name is ongeldig.");
    $s = trim(str_replace("\r\n", "\n", $v));
    if (mb_strlen($s) > $max) throw bad("$name is te lang (max $max tekens).");
    return $s;
}
function int_or_null($v, int $min, int $max, string $name): ?int {
    if ($v === null || $v === '') return null;
    if (is_int($v)) $n = $v;
    elseif (is_string($v) && preg_match('/^-?\d+$/', trim($v))) $n = (int) trim($v);
    else throw bad("$name moet een heel getal tussen $min en $max zijn.");
    if ($n < $min || $n > $max) throw bad("$name moet een heel getal tussen $min en $max zijn.");
    return $n;
}
function date_or_null($v): ?string {
    if (!$v) return null;
    if (!is_string($v) || !preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $v, $m) || !checkdate((int) $m[2], (int) $m[3], (int) $m[1])) throw bad('Datum is ongeldig.');
    return $v;
}
function url_or_empty($v, string $name): string {
    $s = text($v, 500, $name);
    if ($s === '') return '';
    $p = parse_url($s);
    if ($p === false || empty($p['scheme']) || empty($p['host'])) throw bad("$name is geen geldige link.");
    if (!in_array(strtolower($p['scheme']), ['http', 'https'], true)) throw bad("$name moet met https:// beginnen.");
    return $s;
}
function boolish($v): bool { return $v === true || $v === 1 || $v === '1' || $v === 'true' || $v === 'on'; }
function id_param($v): int {
    if (is_int($v) && $v > 0) return $v;
    if (is_string($v) && preg_match('/^[1-9]\d{0,15}$/', $v)) return (int) $v;
    throw not_found();
}
function slug(string $s): string {
    $a = function_exists('iconv') ? (string) @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $s) : $s;
    $a = trim((string) preg_replace('/[^a-z0-9]+/', '-', strtolower($a)), '-');
    return $a !== '' ? $a : 'release';
}

/** php.ini sizes such as "8M" in bytes. */
function ini_bytes(string $key): int {
    $v = trim((string) ini_get($key));
    if ($v === '' || $v === '0' || $v === '-1') return PHP_INT_MAX;
    $n = (int) $v;
    switch (strtolower(substr($v, -1))) { case 'g': $n *= 1024; // fall through
        case 'm': $n *= 1024; // fall through
        case 'k': $n *= 1024; }
    return $n;
}

/** The size of one upload piece: well under this host's limits, at most 8 MB. */
function upload_chunk(): int {
    $limit = min(ini_bytes('upload_max_filesize'), ini_bytes('post_max_size'));
    return (int) max(256 * 1024, min(8 * 1024 * 1024, floor($limit * 0.8)));
}

require __DIR__ . '/files.php';
require __DIR__ . '/model.php';
require __DIR__ . '/youtube.php';
require __DIR__ . '/stats.php';
require __DIR__ . '/zip.php';
require __DIR__ . '/routes.php';
