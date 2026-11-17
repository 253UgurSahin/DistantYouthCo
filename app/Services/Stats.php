<?php

namespace App\Services;

use App\Models\Release;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Support\Collection;

/** "De stand van de nacht": the numbers of the dashboard, cut by month in Amsterdam time. */
class Stats
{
    public const TIME_ZONE = 'Europe/Amsterdam';
    public const PERIODS = [6, 12, 24];

    public static function releaseMonth(Release $r): ?string
    {
        if ($r->release_date) {
            return substr((string) $r->release_date, 0, 7);
        }
        if (! $r->created_at) {
            return null;
        }

        return $r->created_at->copy()->setTimezone(self::TIME_ZONE)->format('Y-m');
    }

    /** The last $n months up to and including this one, oldest first. */
    public static function lastMonths(int $n, ?DateTimeImmutable $now = null): array
    {
        $now = ($now ?? new DateTimeImmutable('now'))->setTimezone(new DateTimeZone(self::TIME_ZONE));
        $t0 = (int) $now->format('Y') * 12 + (int) $now->format('n') - 1;
        $out = [];
        for ($i = $n - 1; $i >= 0; $i--) {
            $t = $t0 - $i;
            $out[] = sprintf('%04d-%02d', intdiv($t, 12), $t % 12 + 1);
        }

        return $out;
    }

    /** @param Collection<int, Release> $releases the ones this user may see, newest first */
    public static function compute(Collection $releases, int $period, bool $admin, ?DateTimeImmutable $now = null): array
    {
        $counts = ['live' => 0, 'ready' => 0, 'concept' => 0];
        foreach ($releases as $r) {
            $counts[$r->status()]++;
        }
        $both = self::lastMonths($period * 2, $now);
        $previousMonths = array_flip(array_slice($both, 0, $period));
        $months = [];
        $index = [];
        foreach (array_slice($both, $period) as $i => $month) {
            $months[] = ['month' => $month, 'count' => 0, 'by' => ['live' => 0, 'ready' => 0, 'concept' => 0]];
            $index[$month] = $i;
        }
        $previous = 0;
        foreach ($releases as $r) {
            $m = self::releaseMonth($r);
            if ($m !== null && isset($index[$m])) {
                $months[$index[$m]]['count']++;
                $months[$index[$m]]['by'][$r->status()]++;
            } elseif ($m !== null && isset($previousMonths[$m])) {
                $previous++;
            }
        }
        $current = array_sum(array_column($months, 'count'));
        $columns = collect([['wav', 'WAV'], ['mp3', 'MP3'], ['video', 'MP4'], ['cover', 'Cover'], ['yt_text', 'YouTube-tekst'], ['youtube', 'Op YouTube'], ['spotify', 'Op Spotify']])
            ->filter(fn ($c) => $admin || $c[0] !== 'yt_text')
            ->map(fn ($c) => ['key' => $c[0], 'label' => $c[1]])->values()->all();
        $rows = $releases->take(12)->map(function (Release $r) use ($admin) {
            $cells = [
                'wav' => (bool) $r->wav_file, 'mp3' => (bool) $r->mp3_file, 'video' => (bool) $r->video_file, 'cover' => (bool) $r->cover_file,
                'yt_text' => (bool) $r->yt_description, 'youtube' => $r->youtubeState() === 'live', 'spotify' => $r->on_spotify,
            ];
            if (! $admin) {
                unset($cells['yt_text']);
            }

            return ['id' => $r->id, 'title' => $r->title, 'status' => $r->status(), 'cells' => $cells, 'done' => count(array_filter($cells))];
        })->values()->all();

        return [
            'period' => $period,
            'time_zone' => self::TIME_ZONE,
            'generated_at' => gmdate('Y-m-d\TH:i:s.v\Z'),
            'total' => $releases->count(),
            'counts' => $counts,
            'months' => $months,
            'comparison' => ['current' => $current, 'previous' => $previous, 'change' => $current - $previous],
            'matrix' => ['columns' => $columns, 'rows' => $rows],
        ];
    }
}
