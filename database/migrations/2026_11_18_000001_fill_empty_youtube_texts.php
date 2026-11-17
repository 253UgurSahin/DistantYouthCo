<?php

use App\Models\Release;
use App\Models\Setting;
use App\Services\YoutubeKit;
use Illuminate\Database\Migrations\Migration;

/** Since 2.2 the YouTube texts are made at once with the template: releases from before get theirs now (only empty ones). */
return new class extends Migration
{
    public function up(): void
    {
        $kit = app(YoutubeKit::class);
        $settings = Setting::current();
        Release::query()->where(fn ($q) => $q->whereNull('yt_description')->orWhere('yt_description', ''))->each(function (Release $r) use ($kit, $settings) {
            $out = $kit->generate($r, $settings, false, '');
            $r->forceFill(['yt_title' => $out['title'], 'yt_description' => $out['description'], 'yt_tags' => $out['tags'], 'yt_generated_with' => 'template'])->saveQuietly();
        });
    }

    public function down(): void {}
};
