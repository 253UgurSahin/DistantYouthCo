<?php

namespace Tests\Unit;

use App\Models\Release;
use App\Services\Stats;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/** Level 5: months in Amsterdam time around midnight, the summer-time Sundays and the year's edge. */
class StatsTest extends TestCase
{
    private function made(string $utc): Release
    {
        $r = new Release();
        $r->created_at = Carbon::parse($utc, 'UTC');

        return $r;
    }

    public function test_a_release_made_late_in_the_evening_counts_in_its_amsterdam_month(): void
    {
        $this->assertSame('2026-11', Stats::releaseMonth($this->made('2026-10-31 23:30:00')), 'winter time: 00:30 on 1 Nov in Amsterdam');
        $this->assertSame('2026-08', Stats::releaseMonth($this->made('2026-07-31 22:30:00')), 'summer time: 00:30 on 1 Aug');
        $this->assertSame('2026-07', Stats::releaseMonth($this->made('2026-07-31 21:30:00')));
        $this->assertSame('2027-01', Stats::releaseMonth($this->made('2026-12-31 23:00:00')), 'the year edge');
        $this->assertSame('2026-03', Stats::releaseMonth($this->made('2026-03-29 01:30:00')), 'the night the clocks go forward');
        $this->assertSame('2026-10', Stats::releaseMonth($this->made('2026-10-25 00:30:00')), 'the night the clocks go back');
    }

    public function test_a_release_date_is_its_own_month_whatever_the_clock(): void
    {
        $r = new Release();
        $r->release_date = '2026-03-31';
        $this->assertSame('2026-03', Stats::releaseMonth($r));
    }

    public function test_the_last_months_follow_amsterdam_at_midnight(): void
    {
        $now = new DateTimeImmutable('2026-11-30 23:30:00', new DateTimeZone('UTC')); // 00:30 on 1 Dec in Amsterdam
        $this->assertSame(['2026-10', '2026-11', '2026-12'], Stats::lastMonths(3, $now));
        $this->assertSame(['2026-12', '2027-01'], Stats::lastMonths(2, new DateTimeImmutable('2026-12-31 23:10:00', new DateTimeZone('UTC'))));
    }
}
