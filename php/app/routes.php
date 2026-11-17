<?php
declare(strict_types=1);

// Every route of src/app.js, with the same paths, answers and messages.

function release_fields(array $b, ?array $existing): array {
    $title = text($b['title'] ?? null, 200, 'Titel');
    if ($title === '') throw bad('Geef de release een titel.');
    $style = text($b['style'] ?? null, 4000, 'Style-omschrijving');
    $bpm = int_or_null($b['bpm'] ?? null, 40, 300, 'BPM') ?? extract_bpm($style);
    $folder = int_or_null($b['folder_id'] ?? null, 1, PHP_INT_MAX, 'Map');
    if ($folder !== null && !one('SELECT 1 FROM folders WHERE id = ?', [$folder])) throw bad('Die collectie bestaat niet.');
    return [
        'title' => $title,
        'style' => $style,
        'lyrics' => text($b['lyrics'] ?? null, 20000, 'Lyrics'),
        'bpm' => $bpm,
        'release_date' => date_or_null($b['release_date'] ?? null),
        'video_type' => text($b['video_type'] ?? null, 60, 'Video-type') ?: get_settings()['default_video_type'],
        'folder_id' => $folder,
        'hidden' => boolish($b['hidden'] ?? null) ? 1 : 0,
        'notes' => text($b['notes'] ?? null, 4000, 'Notities'),
        'youtube_url' => array_key_exists('youtube_url', $b) ? url_or_empty($b['youtube_url'], 'YouTube-link') : ($existing['youtube_url'] ?? ''),
        'spotify_url' => array_key_exists('spotify_url', $b) ? url_or_empty($b['spotify_url'], 'Spotify-link') : ($existing['spotify_url'] ?? ''),
        'on_youtube' => array_key_exists('on_youtube', $b) ? (boolish($b['on_youtube']) ? 1 : 0) : (int) ($existing['on_youtube'] ?? 0),
        'on_spotify' => array_key_exists('on_spotify', $b) ? (boolish($b['on_spotify']) ? 1 : 0) : (int) ($existing['on_spotify'] ?? 0),
    ];
}

/** Ends the response, then does slow work (an MP3 with ffmpeg) where the host allows it. */
function respond_then(callable $after): void {
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
        $after(true);
    } else {
        $after(false);
    }
}

function load_playlist(int $id, array $user): array {
    $p = one('SELECT p.*, u.username AS owner_name FROM playlists p JOIN users u ON u.id = p.owner_id WHERE p.id = ?', [$id]);
    if (!can_see_playlist($p, $user)) throw not_found('Playlist niet gevonden.');
    return $p;
}
function editable_playlist(int $id, array $user): array {
    $p = load_playlist($id, $user);
    if (!can_edit_playlist($p, $user)) throw new HttpError(403, 'Alleen de maker kan deze playlist aanpassen.');
    return $p;
}

function releases_with_video(array $user): array {
    $out = [];
    foreach (list_releases($user) as $r) {
        $f = stored_path((int) $r['id'], $r['video_file']);
        if ($f) $out[] = ['r' => $r, 'file' => $f];
    }
    return $out;
}

/** The routes: [method, pattern, handler(array $params)]. */
function routes(): array {
    $userCount = fn() => (int) one('SELECT COUNT(*) AS n FROM users')['n'];
    return [
        ['GET', '#^/api/session$#', function () use ($userCount) {
            send_json(['user' => current_user(), 'needsSetup' => $userCount() === 0, 'version' => dyc_version(), 'upload_chunk' => upload_chunk()]);
        }],
        ['POST', '#^/api/setup$#', function () use ($userCount) {
            login_guard();
            try {
                if ($userCount() > 0) throw new HttpError(403, 'De admin bestaat al.');
                $b = body();
                if ($err = validate_credentials($b['username'] ?? null, $b['password'] ?? null)) throw bad($err);
                q("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')", [$b['username'], hash_password($b['password'])]);
                $id = (int) db()->lastInsertId();
            } catch (HttpError $e) { login_failed(); throw $e; }
            create_session($id);
            send_json(['user' => ['id' => $id, 'username' => $b['username'], 'role' => 'admin']], 201);
        }],
        ['POST', '#^/api/login$#', function () {
            login_guard();
            try {
                $b = body();
                if (!is_string($b['username'] ?? null) || !is_string($b['password'] ?? null)) throw bad('Vul je gebruikersnaam en wachtwoord in.');
                $u = one('SELECT * FROM users WHERE username = ?', [$b['username']]);
                if (!$u || !verify_password($b['password'], $u['password_hash'])) throw new HttpError(401, 'Gebruikersnaam of wachtwoord klopt niet.');
            } catch (HttpError $e) { login_failed(); throw $e; }
            q('DELETE FROM sessions WHERE expires_at < ?', [time() * 1000]);
            create_session((int) $u['id']);
            send_json(['user' => ['id' => (int) $u['id'], 'username' => $u['username'], 'role' => $u['role']]]);
        }],
        ['POST', '#^/api/logout$#', function () { destroy_session(); send_json(['ok' => true]); }],
        ['POST', '#^/api/me/password$#', function () {
            $me = require_user();
            $b = body();
            $u = one('SELECT * FROM users WHERE id = ?', [$me['id']]);
            if (!is_string($b['current'] ?? null) || !verify_password($b['current'], $u['password_hash'])) throw bad('Je huidige wachtwoord klopt niet.');
            if ($err = validate_credentials($u['username'], $b['password'] ?? null)) throw bad($err);
            q('UPDATE users SET password_hash = ? WHERE id = ?', [hash_password($b['password']), $u['id']]);
            send_json(['ok' => true]);
        }],

        // accounts
        ['GET', '#^/api/users$#', function () {
            require_admin();
            send_json(['users' => array_map(fn($u) => ['id' => (int) $u['id']] + $u, all('SELECT id, username, role, created_at FROM users ORDER BY id'))]);
        }],
        ['POST', '#^/api/users$#', function () {
            require_admin();
            $b = body();
            if ($err = validate_credentials($b['username'] ?? null, $b['password'] ?? null)) throw bad($err);
            if (!in_array($b['role'] ?? '', ['admin', 'listener'], true)) throw bad('Kies een rol.');
            if (one('SELECT 1 FROM users WHERE username = ?', [$b['username']])) throw bad('Die gebruikersnaam bestaat al.');
            q('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [$b['username'], hash_password($b['password']), $b['role']]);
            send_json(['user' => ['id' => (int) db()->lastInsertId(), 'username' => $b['username'], 'role' => $b['role']]], 201);
        }],
        ['POST', '#^/api/users/(\d+)/password$#', function ($p) {
            require_admin();
            $id = id_param($p[1]);
            $u = one('SELECT * FROM users WHERE id = ?', [$id]);
            if (!$u) throw not_found('Account niet gevonden.');
            $b = body();
            if ($err = validate_credentials($u['username'], $b['password'] ?? null)) throw bad($err);
            q('UPDATE users SET password_hash = ? WHERE id = ?', [hash_password($b['password']), $id]);
            q('DELETE FROM sessions WHERE user_id = ?', [$id]);
            send_json(['ok' => true]);
        }],
        ['DELETE', '#^/api/users/(\d+)$#', function ($p) {
            $me = require_admin();
            $id = id_param($p[1]);
            if ($id === $me['id']) throw bad('Je kunt je eigen account niet verwijderen.');
            if (!q('DELETE FROM users WHERE id = ?', [$id])->rowCount()) throw not_found('Account niet gevonden.');
            send_json(['ok' => true]);
        }],

        // settings
        ['GET', '#^/api/settings$#', function () {
            require_admin();
            $s = get_settings();
            $saved = $s['anthropic_api_key'] !== '';
            $rest = $s;
            unset($rest['anthropic_api_key']);
            send_json(['settings' => $rest, 'claude' => ['configured' => claude_configured($s), 'key_saved' => $saved, 'from_env' => !$saved && claude_configured($s)]]);
        }],
        ['PUT', '#^/api/settings$#', function () {
            require_admin();
            $b = body();
            $values = [];
            foreach (array_keys(DEFAULT_SETTINGS) as $key) {
                if ($key === 'anthropic_api_key' || !array_key_exists($key, $b)) continue;
                $values[$key] = str_ends_with($key, '_url') ? url_or_empty($b[$key], $key) : text($b[$key], 2000, $key);
            }
            if (is_string($b['anthropic_api_key'] ?? null) && trim($b['anthropic_api_key']) !== '') $values['anthropic_api_key'] = text($b['anthropic_api_key'], 300, 'API key');
            if (($b['clear_api_key'] ?? null) === true) $values['anthropic_api_key'] = '';
            save_settings($values);
            send_json(['ok' => true]);
        }],

        // uploads in pieces
        ['POST', '#^/api/uploads$#', function () {
            require_admin();
            purge_stale_uploads();
            $b = body();
            $size = $b['size'] ?? null;
            if (!is_int($size) || $size < 1 || $size > DYC_MAX_UPLOAD) throw bad('Een bestand mag tot 4 GB zijn.');
            $name = text(is_string($b['name'] ?? null) ? $b['name'] : 'bestand', 255, 'Naam') ?: 'bestand';
            $token = bin2hex(random_bytes(16));
            touch(part_path($token));
            q('INSERT INTO uploads (token, name, size, received, created_at) VALUES (?, ?, ?, 0, ?)', [$token, $name, $size, time()]);
            send_json(['token' => $token, 'chunk' => upload_chunk()], 201);
        }],
        ['GET', '#^/api/uploads/([a-f0-9]{32})$#', function ($p) {
            require_admin();
            $r = upload_row($p[1]);
            send_json(['received' => (int) $r['received'], 'size' => (int) $r['size']]);
        }],
        ['POST', '#^/api/uploads/([a-f0-9]{32})$#', function ($p) {
            require_admin();
            $r = upload_row($p[1]);
            $offset = $_GET['offset'] ?? '';
            if (!is_string($offset) || !preg_match('/^\d+$/', $offset)) throw bad('Ongeldige positie.');
            $offset = (int) $offset;
            $received = (int) $r['received'];
            // A piece sent twice (a retry after a lost answer) is not written again.
            if ($offset < $received) { send_json(['received' => $received]); return; }
            if ($offset > $received) throw new HttpError(409, 'Dit stuk sluit niet aan; de upload gaat verder waar hij was.');
            $in = fopen('php://input', 'rb');
            $outF = fopen(part_path($p[1]), 'ab');
            $n = 0;
            $max = (int) $r['size'] - $received;
            while (!feof($in)) {
                $buf = fread($in, 1048576);
                if ($buf === false || $buf === '') break;
                $n += strlen($buf);
                if ($n > $max) { fclose($in); fclose($outF); ftruncate(fopen(part_path($p[1]), 'r+b'), $received); throw bad('Er kwam meer binnen dan het bestand groot is.'); }
                fwrite($outF, $buf);
            }
            fclose($in);
            fclose($outF);
            q('UPDATE uploads SET received = ? WHERE token = ?', [$received + $n, $p[1]]);
            send_json(['received' => $received + $n]);
        }],

        // releases
        ['GET', '#^/api/releases$#', function () {
            $u = require_user();
            send_json(['releases' => array_map(fn($r) => serialize_release($r, $u), list_releases($u))]);
        }],
        ['GET', '#^/api/releases/(\d+)$#', function ($p) {
            $u = require_user();
            $r = get_release(id_param($p[1]), $u);
            if (!$r) throw not_found('Release niet gevonden.');
            send_json(['release' => serialize_release($r, $u), 'limits' => YT_LIMITS]);
        }],
        ['POST', '#^/api/releases$#', function () {
            $u = require_admin();
            $fields = release_fields(body(), null);
            $files = form_files();
            if (empty($files['wav'])) throw bad('Een WAV-bestand is verplicht.');
            $id = tx(function () use ($fields, $files) {
                $cols = array_keys($fields);
                q('INSERT INTO releases (' . implode(', ', $cols) . ') VALUES (' . implode(', ', array_fill(0, count($cols), '?')) . ')', array_values($fields));
                $id = (int) db()->lastInsertId();
                foreach ($files as $kind => $f) q('UPDATE releases SET ' . KIND_COLUMN[$kind] . ' = ? WHERE id = ?', [store_file($id, $kind, $f['path'], $f['ext']), $id]);
                return $id;
            });
            forget_uploads($files);
            process_release($id, false);
            send_json(['release' => serialize_release(get_release($id, $u), $u)], 201);
            respond_then(fn($done) => process_release($id, true));
        }],
        ['PUT', '#^/api/releases/(\d+)$#', function ($p) {
            $u = require_admin();
            $id = id_param($p[1]);
            $existing = one('SELECT * FROM releases WHERE id = ?', [$id]);
            if (!$existing) throw not_found('Release niet gevonden.');
            $b = body();
            $fields = release_fields($b, $existing);
            $files = form_files();
            tx(function () use ($id, $b, $fields, $files, $existing) {
                $cols = array_keys($fields);
                q('UPDATE releases SET ' . implode(', ', array_map(fn($c) => "$c = ?", $cols)) . ", updated_at = datetime('now') WHERE id = ?", [...array_values($fields), $id]);
                foreach (['mp3', 'video', 'cover'] as $kind) {
                    if (boolish($b["remove_$kind"] ?? null) && empty($files[$kind])) {
                        remove_stored($id, $existing[KIND_COLUMN[$kind]]);
                        q('UPDATE releases SET ' . KIND_COLUMN[$kind] . ' = NULL WHERE id = ?', [$id]);
                    }
                }
                foreach ($files as $kind => $f) {
                    q('UPDATE releases SET ' . KIND_COLUMN[$kind] . ' = ? WHERE id = ?', [store_file($id, $kind, $f['path'], $f['ext']), $id]);
                    if ($kind === 'mp3') q('UPDATE releases SET mp3_generated = 0 WHERE id = ?', [$id]);
                    if ($kind === 'cover') q('UPDATE releases SET cover_generated = 0 WHERE id = ?', [$id]);
                    if ($kind === 'wav') {
                        q('UPDATE releases SET duration = NULL WHERE id = ?', [$id]);
                        if ($existing['mp3_generated']) { remove_stored($id, $existing['mp3_file']); q('UPDATE releases SET mp3_file = NULL, mp3_generated = 0 WHERE id = ?', [$id]); }
                    }
                    if ($kind === 'video' && $existing['cover_generated']) { remove_stored($id, $existing['cover_file']); q('UPDATE releases SET cover_file = NULL, cover_generated = 0 WHERE id = ?', [$id]); }
                }
            });
            forget_uploads($files);
            process_release($id, false);
            send_json(['release' => serialize_release(get_release($id, $u), $u)]);
            respond_then(fn($done) => process_release($id, true));
        }],
        ['DELETE', '#^/api/releases/(\d+)$#', function ($p) {
            require_admin();
            $id = id_param($p[1]);
            if (!q('DELETE FROM releases WHERE id = ?', [$id])->rowCount()) throw not_found('Release niet gevonden.');
            rm_tree(release_dir($id));
            send_json(['ok' => true]);
        }],
        ['POST', '#^/api/releases/(\d+)/youtube$#', function ($p) {
            $u = require_admin();
            $id = id_param($p[1]);
            $r = one('SELECT * FROM releases WHERE id = ?', [$id]);
            if (!$r) throw not_found('Release niet gevonden.');
            $b = body();
            $kit = generate_youtube_kit($r, get_settings(), ($b['mode'] ?? '') !== 'template', text($b['extra'] ?? null, 1000, 'Extra wensen'));
            q("UPDATE releases SET yt_title = ?, yt_description = ?, yt_tags = ?, yt_generated_with = ?, bpm = COALESCE(bpm, ?), updated_at = datetime('now') WHERE id = ?",
                [$kit['title'], $kit['description'], $kit['tags'], $kit['generated_with'], $kit['bpm'], $id]);
            send_json(['release' => serialize_release(get_release($id, $u), $u), 'generated_with' => $kit['generated_with']]);
        }],
        ['PUT', '#^/api/releases/(\d+)/youtube$#', function ($p) {
            $u = require_admin();
            $id = id_param($p[1]);
            if (!one('SELECT 1 FROM releases WHERE id = ?', [$id])) throw not_found('Release niet gevonden.');
            $b = body();
            q("UPDATE releases SET yt_title = ?, yt_description = ?, yt_tags = ?, updated_at = datetime('now') WHERE id = ?",
                [text($b['yt_title'] ?? null, 300, 'Titel'), text($b['yt_description'] ?? null, 10000, 'Beschrijving'), text($b['yt_tags'] ?? null, 2000, 'Tags'), $id]);
            send_json(['release' => serialize_release(get_release($id, $u), $u)]);
        }],
        ['POST', '#^/api/releases/(\d+)/status$#', function ($p) {
            $u = require_admin();
            $id = id_param($p[1]);
            $r = one('SELECT * FROM releases WHERE id = ?', [$id]);
            if (!$r) throw not_found('Release niet gevonden.');
            $b = body();
            q("UPDATE releases SET youtube_url = ?, spotify_url = ?, on_youtube = ?, on_spotify = ?, updated_at = datetime('now') WHERE id = ?", [
                array_key_exists('youtube_url', $b) ? url_or_empty($b['youtube_url'], 'YouTube-link') : $r['youtube_url'],
                array_key_exists('spotify_url', $b) ? url_or_empty($b['spotify_url'], 'Spotify-link') : $r['spotify_url'],
                array_key_exists('on_youtube', $b) ? (boolish($b['on_youtube']) ? 1 : 0) : $r['on_youtube'],
                array_key_exists('on_spotify', $b) ? (boolish($b['on_spotify']) ? 1 : 0) : $r['on_spotify'],
                $id,
            ]);
            send_json(['release' => serialize_release(get_release($id, $u), $u)]);
        }],

        // media
        ['GET', '#^/media/(\d+)/([a-z]+)$#', function ($p) {
            $u = require_user();
            $r = get_release(id_param($p[1]), $u);
            if (!$r) throw not_found();
            $col = ['audio' => $r['mp3_file'] ? 'mp3_file' : 'wav_file', 'wav' => 'wav_file', 'mp3' => 'mp3_file', 'video' => 'video_file', 'cover' => 'cover_file'][$p[2]] ?? null;
            if (!$col) throw not_found();
            $file = stored_path((int) $r['id'], $r[$col]);
            if (!$file) throw not_found();
            $name = ($_GET['download'] ?? '') === '1' ? slug($r['title']) . "-{$p[2]}." . pathinfo($file, PATHINFO_EXTENSION) : '';
            send_file($file, $name);
        }],

        // downloads
        ['GET', '#^/api/downloads$#', function () {
            $u = require_admin();
            $out = [];
            foreach (releases_with_video($u) as $x) {
                $out[] = serialize_release($x['r'], $u) + ['video_size' => filesize($x['file']), 'download_url' => "/media/{$x['r']['id']}/video?download=1"];
            }
            send_json(['videos' => $out]);
        }],
        ['GET', '#^/downloads/videos\.zip$#', function () {
            $u = require_admin();
            $all = releases_with_video($u);
            $raw = $_GET['ids'] ?? '';
            $raw = is_array($raw) ? implode(',', array_filter($raw, 'is_string')) : (string) $raw;
            $wanted = [];
            foreach (explode(',', $raw) as $x) if (preg_match('/^[1-9]\d*$/', trim($x))) $wanted[(int) trim($x)] = true;
            $chosen = $wanted ? array_values(array_filter($all, fn($x) => isset($wanted[(int) $x['r']['id']]))) : $all;
            if (!$chosen) throw not_found("Geen video's om te downloaden.");
            foreach ($chosen as $x) if (filesize($x['file']) >= ZIP_MAX32) throw new HttpError(413, "De video van {$x['r']['title']} is 4 GB of groter: download die los met zijn eigen MP4-knop.");
            $used = [];
            $entries = [];
            foreach ($chosen as $x) {
                $base = zip_safe_name("{$x['r']['title']} (" . ($x['r']['video_type'] ?: 'Video') . ')');
                $ext = '.' . (pathinfo($x['file'], PATHINFO_EXTENSION) ?: 'mp4');
                $name = $base . $ext;
                for ($n = 2; isset($used[mb_strtolower($name)]); $n++) $name = "$base $n$ext";
                $used[mb_strtolower($name)] = true;
                $entries[] = ['name' => $name, 'path' => $x['file']];
            }
            header('Content-Type: application/zip');
            header('Content-Disposition: attachment; filename="distant-youth-videos-' . gmdate('Y-m-d') . '.zip"');
            header('Cache-Control: no-store');
            if ($_SERVER['REQUEST_METHOD'] === 'HEAD') return;
            @set_time_limit(0);
            @ini_set('zlib.output_compression', '0');
            while (ob_get_level()) ob_end_clean();
            write_zip($entries);
        }],

        // collections
        ['GET', '#^/api/folders$#', function () {
            $u = require_user();
            $hidden = $u['role'] === 'admin' ? '' : 'AND r.hidden = 0';
            $rows = all("SELECT f.*, (SELECT COUNT(*) FROM releases r WHERE r.folder_id = f.id $hidden) AS count FROM folders f ORDER BY f.id");
            send_json(['folders' => array_map('folder_summary', $rows)]);
        }],
        ['GET', '#^/api/folders/(\d+)$#', function ($p) {
            $u = require_user();
            $f = one('SELECT * FROM folders WHERE id = ?', [id_param($p[1])]);
            if (!$f) throw not_found('Collectie niet gevonden.');
            $rel = list_releases($u, (int) $f['id']);
            send_json(['folder' => folder_summary($f + ['count' => count($rel)]) + ['releases' => array_map(fn($r) => serialize_release($r, $u), $rel)]]);
        }],
        ['POST', '#^/api/folders$#', function () {
            require_admin();
            $b = body();
            $name = text($b['name'] ?? null, 120, 'Naam');
            if ($name === '') throw bad('Geef de collectie een naam.');
            q('INSERT INTO folders (name, description) VALUES (?, ?)', [$name, text($b['description'] ?? null, 1000, 'Omschrijving')]);
            send_json(['folder' => folder_summary(one('SELECT * FROM folders WHERE id = ?', [(int) db()->lastInsertId()]))], 201);
        }],
        ['PUT', '#^/api/folders/(\d+)$#', function ($p) {
            require_admin();
            $b = body();
            $name = text($b['name'] ?? null, 120, 'Naam');
            if ($name === '') throw bad('Geef de collectie een naam.');
            $id = id_param($p[1]);
            if (!one('SELECT 1 FROM folders WHERE id = ?', [$id])) throw not_found('Collectie niet gevonden.');
            q('UPDATE folders SET name = ?, description = ? WHERE id = ?', [$name, text($b['description'] ?? null, 1000, 'Omschrijving'), $id]);
            send_json(['ok' => true]);
        }],
        ['DELETE', '#^/api/folders/(\d+)$#', function ($p) {
            require_admin();
            if (!q('DELETE FROM folders WHERE id = ?', [id_param($p[1])])->rowCount()) throw not_found('Collectie niet gevonden.');
            send_json(['ok' => true]);
        }],
        ['POST', '#^/api/folders/(\d+)/suggest-names$#', function ($p) {
            $u = require_admin();
            $f = one('SELECT * FROM folders WHERE id = ?', [id_param($p[1])]);
            if (!$f) throw not_found('Collectie niet gevonden.');
            $rel = list_releases($u, (int) $f['id']);
            if (!$rel) throw bad('Deze collectie heeft nog geen nummers.');
            send_json(suggest_names(get_settings(), $f['name'], $rel, text(body()['direction'] ?? null, 300, 'Richting')));
        }],

        // playlists
        ['GET', '#^/api/playlists$#', function () {
            $u = require_user();
            $rows = all('SELECT p.*, u.username AS owner_name, (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id) AS count
                FROM playlists p JOIN users u ON u.id = p.owner_id WHERE p.owner_id = ? OR p.is_public = 1 ORDER BY p.id', [$u['id']]);
            send_json(['playlists' => array_map(fn($p) => serialize_playlist($p, $u), $rows)]);
        }],
        ['GET', '#^/api/playlists/(\d+)$#', function ($p) {
            $u = require_user();
            $pl = load_playlist(id_param($p[1]), $u);
            send_json(['playlist' => serialize_playlist($pl, $u, playlist_releases((int) $pl['id'], $u))]);
        }],
        ['POST', '#^/api/playlists$#', function () {
            $u = require_user();
            $b = body();
            $name = text($b['name'] ?? null, 120, 'Naam');
            if ($name === '') throw bad('Geef de playlist een naam.');
            q('INSERT INTO playlists (owner_id, name, description, is_public) VALUES (?, ?, ?, ?)', [$u['id'], $name, text($b['description'] ?? null, 1000, 'Omschrijving'), boolish($b['is_public'] ?? null) ? 1 : 0]);
            send_json(['playlist' => ['id' => (int) db()->lastInsertId(), 'name' => $name]], 201);
        }],
        ['PUT', '#^/api/playlists/(\d+)$#', function ($p) {
            $u = require_user();
            $pl = editable_playlist(id_param($p[1]), $u);
            $b = body();
            $name = text($b['name'] ?? null, 120, 'Naam');
            if ($name === '') throw bad('Geef de playlist een naam.');
            q('UPDATE playlists SET name = ?, description = ?, is_public = ? WHERE id = ?', [$name, text($b['description'] ?? null, 1000, 'Omschrijving'), boolish($b['is_public'] ?? null) ? 1 : 0, $pl['id']]);
            send_json(['ok' => true]);
        }],
        ['DELETE', '#^/api/playlists/(\d+)$#', function ($p) {
            $u = require_user();
            $pl = editable_playlist(id_param($p[1]), $u);
            q('DELETE FROM playlists WHERE id = ?', [$pl['id']]);
            send_json(['ok' => true]);
        }],
        ['POST', '#^/api/playlists/(\d+)/items$#', function ($p) {
            $u = require_user();
            $pl = editable_playlist(id_param($p[1]), $u);
            $rid = body()['release_id'] ?? null;
            $r = get_release(id_param(is_int($rid) ? $rid : (string) $rid), $u);
            if (!$r) throw not_found('Release niet gevonden.');
            $pos = (int) one('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM playlist_items WHERE playlist_id = ?', [$pl['id']])['n'];
            q('INSERT OR IGNORE INTO playlist_items (playlist_id, release_id, position) VALUES (?, ?, ?)', [$pl['id'], $r['id'], $pos]);
            send_json(['ok' => true], 201);
        }],
        ['DELETE', '#^/api/playlists/(\d+)/items/(\d+)$#', function ($p) {
            $u = require_user();
            $pl = editable_playlist(id_param($p[1]), $u);
            q('DELETE FROM playlist_items WHERE playlist_id = ? AND release_id = ?', [$pl['id'], id_param($p[2])]);
            send_json(['ok' => true]);
        }],
        ['PUT', '#^/api/playlists/(\d+)/order$#', function ($p) {
            $u = require_user();
            $pl = editable_playlist(id_param($p[1]), $u);
            $ids = body()['release_ids'] ?? null;
            if (!is_array($ids) || !array_is_list($ids) || count($ids) > 1000) throw bad('Ongeldige volgorde.');
            tx(function () use ($ids, $pl) {
                foreach ($ids as $i => $rid) q('UPDATE playlist_items SET position = ? WHERE playlist_id = ? AND release_id = ?', [$i + 1, $pl['id'], (int) $rid]);
            });
            send_json(['ok' => true]);
        }],
        ['POST', '#^/api/playlists/(\d+)/suggest-names$#', function ($p) {
            $u = require_user();
            $pl = editable_playlist(id_param($p[1]), $u);
            $rel = playlist_releases((int) $pl['id'], $u);
            if (!$rel) throw bad('Deze playlist heeft nog geen nummers.');
            send_json(suggest_names(get_settings(), $pl['name'], $rel, text(body()['direction'] ?? null, 300, 'Richting')));
        }],

        // stats
        ['GET', '#^/api/stats$#', function () {
            $u = require_user();
            $m = $_GET['months'] ?? '12';
            $months = is_string($m) && preg_match('/^\d+$/', $m) ? (int) $m : -1;
            if (!in_array($months, STATS_PERIODS, true)) throw bad('Kies een periode van ' . implode(', ', STATS_PERIODS) . ' maanden.');
            send_json(compute_stats(list_releases($u), $months, $u['role'] === 'admin'));
        }],
    ];
}

/** Handles one request: the front controller (index.php) calls this. */
function handle_request(): void {
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    $override = strtoupper((string) ($_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'] ?? ''));
    if ($method === 'POST' && in_array($override, ['PUT', 'PATCH', 'DELETE'], true)) $method = $override;
    $path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
    $isApi = str_starts_with($path, '/api/') || $path === '/api';
    security_headers();
    if ($isApi) header('Cache-Control: no-store');
    try {
        if ($isApi && !in_array($method, ['GET', 'HEAD', 'OPTIONS'], true) && ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'dyc') {
            throw new HttpError(403, 'Ongeldig verzoek');
        }
        // A form bigger than this host's limit arrives empty: say so instead of "title missing".
        $len = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
        if ($len > 0 && $len > ini_bytes('post_max_size') && str_contains(strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? '')), 'multipart')) {
            throw new HttpError(413, 'Te veel gegevens in één keer voor deze server (max ' . ini_get('post_max_size') . ').');
        }
        $match = $method === 'HEAD' ? 'GET' : $method;
        $pathKnown = false;
        foreach (routes() as [$m, $re, $fn]) {
            if (!preg_match($re, $path, $params)) continue;
            $pathKnown = true;
            if ($m !== $match) continue;
            $fn($params);
            return;
        }
        throw $isApi ? not_found($pathKnown ? 'Onbekende API-route.' : 'Onbekende API-route.') : not_found();
    } catch (HttpError $e) {
        if (!headers_sent()) send_json(['error' => $e->getMessage()], $e->status);
    } catch (Throwable $e) {
        error_log('Distant Youth Studio: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
        if (!headers_sent()) send_json(['error' => 'Er ging iets mis op de server.'], 500);
    }
}
