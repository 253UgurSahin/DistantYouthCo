<?php
declare(strict_types=1);

function youtube_state(array $r): string {
    if ($r['on_youtube']) return 'live';
    if ($r['video_file'] && $r['yt_description']) return 'ready';
    return 'none';
}

/** The moon: concept (new), ready for YouTube (waxing), live (full). */
function release_status(array $r): string {
    if (youtube_state($r) === 'ready') return 'ready';
    if ($r['on_youtube'] || $r['on_spotify']) return 'live';
    return 'concept';
}

function serialize_release(array $r, ?array $user): array {
    $v = rawurlencode((string) ($r['updated_at'] ?? ''));
    $id = (int) $r['id'];
    $out = [
        'id' => $id,
        'title' => $r['title'],
        'style' => $r['style'],
        'lyrics' => $r['lyrics'],
        'bpm' => $r['bpm'] === null ? null : (int) $r['bpm'],
        'release_date' => $r['release_date'],
        'video_type' => $r['video_type'],
        'duration' => $r['duration'] === null ? null : (float) $r['duration'],
        'folder_id' => $r['folder_id'] === null ? null : (int) $r['folder_id'],
        'folder_name' => $r['folder_name'] ?? null,
        'youtube_url' => $r['youtube_url'],
        'spotify_url' => $r['spotify_url'],
        'on_youtube' => (bool) $r['on_youtube'],
        'on_spotify' => (bool) $r['on_spotify'],
        'status' => release_status($r),
        'youtube_state' => youtube_state($r),
        'has' => ['wav' => (bool) $r['wav_file'], 'mp3' => (bool) $r['mp3_file'], 'video' => (bool) $r['video_file'], 'cover' => (bool) $r['cover_file']],
        'mp3_generated' => (bool) $r['mp3_generated'],
        'cover_generated' => (bool) $r['cover_generated'],
        'processing' => false,
        'audio_url' => ($r['mp3_file'] || $r['wav_file']) ? "/media/$id/audio?v=$v" : null,
        'video_url' => $r['video_file'] ? "/media/$id/video?v=$v" : null,
        'cover_url' => $r['cover_file'] ? "/media/$id/cover?v=$v" : null,
        'created_at' => $r['created_at'],
        'updated_at' => $r['updated_at'],
    ];
    if (($user['role'] ?? '') === 'admin') {
        $out += [
            'hidden' => (bool) $r['hidden'],
            'notes' => $r['notes'],
            'yt_title' => $r['yt_title'],
            'yt_description' => $r['yt_description'],
            'yt_tags' => $r['yt_tags'],
            'yt_generated_with' => $r['yt_generated_with'],
        ];
    }
    return $out;
}

const SELECT_RELEASE = 'SELECT r.*, f.name AS folder_name FROM releases r LEFT JOIN folders f ON f.id = r.folder_id';
const ORDER_RELEASES = 'ORDER BY COALESCE(r.release_date, substr(r.created_at, 1, 10)) DESC, r.id DESC';

function get_release(int $id, ?array $user): ?array {
    $r = one(SELECT_RELEASE . ' WHERE r.id = ?', [$id]);
    if (!$r) return null;
    if ($r['hidden'] && ($user['role'] ?? '') !== 'admin') return null;
    return $r;
}

function list_releases(?array $user, ?int $folderId = null): array {
    $where = [];
    $args = [];
    if (($user['role'] ?? '') !== 'admin') $where[] = 'r.hidden = 0';
    if ($folderId !== null) { $where[] = 'r.folder_id = ?'; $args[] = $folderId; }
    return all(SELECT_RELEASE . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ' . ORDER_RELEASES, $args);
}

function folder_summary(array $f): array {
    $rows = all('SELECT id, cover_file, updated_at, duration FROM releases WHERE folder_id = ? AND hidden = 0 ORDER BY id DESC', [$f['id']]);
    $covers = [];
    foreach ($rows as $r) {
        if ($r['cover_file'] && count($covers) < 3) $covers[] = "/media/{$r['id']}/cover?v=" . rawurlencode((string) $r['updated_at']);
    }
    return [
        'id' => (int) $f['id'],
        'name' => $f['name'],
        'description' => $f['description'],
        'count' => isset($f['count']) ? (int) $f['count'] : count($rows),
        'duration' => array_sum(array_map(fn($r) => (float) ($r['duration'] ?? 0), $rows)),
        'covers' => $covers,
    ];
}

function can_see_playlist(?array $p, array $user): bool {
    return $p !== null && ($p['is_public'] || (int) $p['owner_id'] === $user['id'] || $user['role'] === 'admin');
}
function can_edit_playlist(?array $p, array $user): bool {
    return $p !== null && ((int) $p['owner_id'] === $user['id'] || $user['role'] === 'admin');
}

function playlist_releases(int $playlistId, array $user): array {
    $hidden = $user['role'] === 'admin' ? '' : 'AND r.hidden = 0';
    return all("SELECT r.*, f.name AS folder_name FROM playlist_items i
        JOIN releases r ON r.id = i.release_id LEFT JOIN folders f ON f.id = r.folder_id
        WHERE i.playlist_id = ? $hidden ORDER BY i.position, i.rowid", [$playlistId]);
}

function serialize_playlist(array $p, array $user, ?array $releases = null): array {
    $out = [
        'id' => (int) $p['id'],
        'name' => $p['name'],
        'description' => $p['description'],
        'is_public' => (bool) $p['is_public'],
        'owner' => $p['owner_name'],
        'mine' => (int) $p['owner_id'] === $user['id'],
        'can_edit' => can_edit_playlist($p, $user),
        'count' => $releases !== null ? count($releases) : (int) ($p['count'] ?? 0),
    ];
    if ($releases !== null) {
        $out['duration'] = array_sum(array_map(fn($r) => (float) ($r['duration'] ?? 0), $releases));
        $out['releases'] = array_map(fn($r) => serialize_release($r, $user), $releases);
    }
    return $out;
}
