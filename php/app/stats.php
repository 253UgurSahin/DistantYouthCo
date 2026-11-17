<?php
declare(strict_types=1);

const STATS_TZ = 'Europe/Amsterdam';
const STATS_PERIODS = [6, 12, 24];

/** The month (YYYY-MM) of a release: its release date, else when it was added, in Amsterdam time. */
function release_month(array $r): ?string {
    if ($r['release_date']) return substr($r['release_date'], 0, 7);
    if (!$r['created_at']) return null;
    $d = new DateTime($r['created_at'], new DateTimeZone('UTC'));
    return $d->setTimezone(new DateTimeZone(STATS_TZ))->format('Y-m');
}

/** The last $n months up to and including this one, oldest first, cut in Amsterdam time. */
function last_months(int $n): array {
    $now = new DateTime('now', new DateTimeZone(STATS_TZ));
    $y = (int) $now->format('Y');
    $m = (int) $now->format('n');
    $out = [];
    for ($i = $n - 1; $i >= 0; $i--) {
        $t = $y * 12 + ($m - 1) - $i;
        $out[] = sprintf('%04d-%02d', intdiv($t, 12), $t % 12 + 1);
    }
    return $out;
}

function compute_stats(array $releases, int $period, bool $admin): array {
    $counts = ['live' => 0, 'ready' => 0, 'concept' => 0];
    foreach ($releases as $r) $counts[release_status($r)]++;
    $both = last_months($period * 2);
    $previousMonths = array_flip(array_slice($both, 0, $period));
    $months = [];
    $index = [];
    foreach (array_slice($both, $period) as $i => $month) {
        $months[] = ['month' => $month, 'count' => 0, 'by' => ['live' => 0, 'ready' => 0, 'concept' => 0]];
        $index[$month] = $i;
    }
    $previous = 0;
    foreach ($releases as $r) {
        $m = release_month($r);
        if ($m !== null && isset($index[$m])) {
            $months[$index[$m]]['count']++;
            $months[$index[$m]]['by'][release_status($r)]++;
        } elseif ($m !== null && isset($previousMonths[$m])) {
            $previous++;
        }
    }
    $current = array_sum(array_column($months, 'count'));
    $cols = [['wav', 'WAV'], ['mp3', 'MP3'], ['video', 'MP4'], ['cover', 'Cover'], ['yt_text', 'YouTube-tekst'], ['youtube', 'Op YouTube'], ['spotify', 'Op Spotify']];
    $columns = [];
    foreach ($cols as [$key, $label]) if ($admin || $key !== 'yt_text') $columns[] = ['key' => $key, 'label' => $label];
    $rows = [];
    foreach (array_slice($releases, 0, 12) as $r) {
        $cells = [
            'wav' => (bool) $r['wav_file'], 'mp3' => (bool) $r['mp3_file'], 'video' => (bool) $r['video_file'], 'cover' => (bool) $r['cover_file'],
            'yt_text' => (bool) $r['yt_description'], 'youtube' => youtube_state($r) === 'live', 'spotify' => (bool) $r['on_spotify'],
        ];
        if (!$admin) unset($cells['yt_text']);
        $rows[] = ['id' => (int) $r['id'], 'title' => $r['title'], 'status' => release_status($r), 'cells' => $cells, 'done' => count(array_filter($cells))];
    }
    return [
        'period' => $period,
        'time_zone' => STATS_TZ,
        'generated_at' => gmdate('Y-m-d\TH:i:s.v\Z'),
        'total' => count($releases),
        'counts' => $counts,
        'months' => $months,
        'comparison' => ['current' => $current, 'previous' => $previous, 'change' => $current - $previous],
        'matrix' => ['columns' => $columns, 'rows' => $rows],
    ];
}
