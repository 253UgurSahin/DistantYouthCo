<?php

namespace Tests\Feature;

use App\Models\Release;
use App\Models\Setting;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class StudioTest extends TestCase
{
    private function release(array $attrs = []): Release
    {
        return Release::create($attrs + ['title' => 'Lanterns in the Rain', 'style' => 'melodic dubstep, 140 bpm, koto, female vocals', 'lyrics' => "[Chorus]\nWe light the lanterns in the rain\n[Outro]\nHome again"]);
    }

    private function claudeAnswers(array $json, string $stop = 'end_turn'): void
    {
        Http::fake(['*/v1/messages*' => Http::response(['model' => 'claude-opus-5-5', 'stop_reason' => $stop, 'content' => [['type' => 'text', 'text' => json_encode($json)]]])]);
    }

    public function test_the_claude_key_is_stored_encrypted_and_never_sent_back(): void
    {
        $this->actingAs($this->admin());
        $this->app_()->putJson('/api/settings', ['anthropic_api_key' => 'example-key', 'artist_name' => 'DYC', 'spotify_artist_url' => 'javascript:x'])->assertStatus(400);
        $this->app_()->putJson('/api/settings', ['anthropic_api_key' => 'example-key', 'artist_name' => 'DYC'])->assertOk();
        $stored = DB::table('settings')->where('key', 'anthropic_api_key')->value('value');
        $this->assertTrue($stored !== 'example-key' && ! str_contains($stored, 'example-key'), 'stored encrypted');
        $this->assertTrue(Setting::current()['anthropic_api_key'] === 'example-key', 'decrypts with APP_KEY');
        $r = $this->getJson('/api/settings')->assertOk();
        $this->assertStringNotContainsString('example-key', $r->getContent());
        $r->assertJson(['settings' => ['artist_name' => 'DYC'], 'claude' => ['configured' => true, 'key_saved' => true]]);
        $this->app_()->putJson('/api/settings', ['clear_api_key' => true])->assertOk();
        $this->getJson('/api/settings')->assertJsonPath('claude.key_saved', false);
    }

    public function test_the_template_kit_follows_the_artists_layout_without_claude(): void
    {
        $this->actingAs($this->admin());
        $id = $this->release()->id;
        $r = $this->app_()->postJson("/api/releases/$id/youtube", ['mode' => 'template'])->assertOk();
        $r->assertJsonPath('generated_with', 'template')->assertJsonPath('release.yt_title', 'Lanterns in the Rain — Distant Youth Co. (Official Visualizer)');
        $d = $r->json('release.yt_description');
        $this->assertStringStartsWith("# 🎵 Lanterns in the Rain — Distant Youth Co. (Official Visualizer)\n\n*\"We light the lanterns in the rain\"*", $d);
        $this->assertStringContainsString('140 BPM · Melodic Dubstep', $d);
        $this->assertStringContainsString('https://open.spotify.com/artist/', $d);
        $this->assertStringContainsString('#distantyouthco', $d);
        $this->assertSame(140, $r->json('release.bpm'));
        $this->app_()->putJson("/api/releases/$id/youtube", ['yt_title' => 'Eigen titel', 'yt_description' => 'x', 'yt_tags' => 'a, b'])->assertOk()->assertJsonPath('release.yt_title', 'Eigen titel');
    }

    public function test_claude_gets_the_right_request_and_its_answer_fills_the_layout(): void
    {
        $this->actingAs($this->admin());
        Setting::put(['anthropic_api_key' => 'example-key']);
        $this->claudeAnswers(['hook_line' => 'We light the lanterns', 'story_paragraphs' => ['Lanterns is a dubstep track about home.'], 'style_tags' => ['Melodic Dubstep', 'Koto'], 'bpm' => 0,
            'dedication' => 'For everyone far away.', 'closing_line' => 'Home again.', 'hashtags' => ['lanterns'], 'youtube_tags' => ['lanterns in the rain']]);
        $id = $this->release()->id;
        $r = $this->app_()->postJson("/api/releases/$id/youtube", ['extra' => 'mention the koto'])->assertOk();
        $r->assertJsonPath('generated_with', 'claude-opus-5-5');
        $this->assertStringContainsString("Lanterns is a dubstep track about home.\n\n140 BPM · Melodic Dubstep · Koto", $r->json('release.yt_description'));
        Http::assertSent(function (HttpRequest $req) {
            $b = $req->data();

            return $req->hasHeader('x-api-key', 'example-key') && str_ends_with($req->url(), '/v1/messages?beta=true')
                && $req->hasHeader('anthropic-beta', 'server-side-fallback-2026-07-01')
                && $b['model'] === config('studio.claude_model') && $b['fallbacks'] === 'default'
                && $b['output_config']['format']['type'] === 'json_schema'
                && str_contains($b['messages'][0]['content'], '<extra_notes_from_artist>');
        });
    }

    public function test_claude_errors_become_clear_dutch_messages(): void
    {
        $this->actingAs($this->admin());
        $id = $this->release()->id;
        $this->app_()->postJson("/api/releases/$id/youtube")->assertOk()->assertJsonPath('generated_with', 'template');
        Setting::put(['anthropic_api_key' => 'example-key']);
        Http::fake(['*' => Http::sequence()->push(['error' => []], 401)->push(['stop_reason' => 'refusal', 'content' => []])]);
        $this->app_()->postJson("/api/releases/$id/youtube")->assertStatus(502)->assertJson(['error' => 'De Claude API key is ongeldig. Controleer Instellingen.']);
        $this->app_()->postJson("/api/releases/$id/youtube")->assertStatus(502)->assertJsonPath('error', fn ($e) => str_contains($e, 'wilde dit niet schrijven'));
    }

    public function test_album_names_for_a_collection(): void
    {
        $this->actingAs($this->admin());
        Setting::put(['anthropic_api_key' => 'example-key']);
        $folder = $this->app_()->postJson('/api/folders', ['name' => 'Map'])->assertCreated()->json('folder.id');
        $this->app_()->postJson("/api/folders/$folder/suggest-names")->assertStatus(400);
        $this->release(['folder_id' => $folder]);
        $this->claudeAnswers(['suggestions' => [['name' => 'Lantaarns', 'why' => 'Licht in de regen.'], ['name' => '  ', 'why' => 'leeg']]]);
        $this->app_()->postJson("/api/folders/$folder/suggest-names")->assertOk()->assertJson(['suggestions' => [['name' => 'Lantaarns', 'why' => 'Licht in de regen.']]])->assertJsonCount(1, 'suggestions');
    }

    public function test_playlists_private_ones_are_404_order_is_kept_and_hidden_releases_stay_out(): void
    {
        $a = $this->release(['title' => 'A']);
        $b = $this->release(['title' => 'B']);
        $hidden = $this->release(['title' => 'Geheim', 'is_hidden' => true]);
        $this->actingAs($owner = $this->listener('eigenaar'));
        $id = $this->app_()->postJson('/api/playlists', ['name' => 'Nacht'])->assertCreated()->json('playlist.id');
        $this->app_()->postJson("/api/playlists/$id/items", ['release_id' => $a->id])->assertCreated();
        $this->app_()->postJson("/api/playlists/$id/items", ['release_id' => $b->id])->assertCreated();
        $this->app_()->postJson("/api/playlists/$id/items", ['release_id' => $hidden->id])->assertNotFound();
        $this->app_()->putJson("/api/playlists/$id/order", ['release_ids' => [$b->id, $a->id]])->assertOk();
        $this->assertSame(['B', 'A'], collect($this->getJson("/api/playlists/$id")->json('playlist.releases'))->pluck('title')->all());

        $this->actingAs($this->listener('ander'));
        $this->getJson("/api/playlists/$id")->assertNotFound();
        $this->assertSame([], $this->getJson('/api/playlists')->json('playlists'));

        $this->actingAs($owner);
        $this->app_()->putJson("/api/playlists/$id", ['name' => 'Nacht', 'is_public' => true])->assertOk();
        $this->actingAs($this->listener('derde'));
        $this->getJson("/api/playlists/$id")->assertOk();
        $this->app_()->deleteJson("/api/playlists/$id")->assertForbidden();
    }

    public function test_stats_count_by_status_and_month_in_amsterdam_time(): void
    {
        $this->actingAs($this->admin());
        $this->release(['release_date' => now('Europe/Amsterdam')->format('Y-m-d'), 'on_spotify' => true]);
        $this->release(['title' => 'Concept']);
        $s = $this->getJson('/api/stats?months=6')->assertOk()->json();
        $this->assertSame(2, $s['total']);
        $this->assertSame(1, $s['counts']['live']);
        $this->assertCount(6, $s['months']);
        $this->assertSame('Europe/Amsterdam', $s['time_zone']);
        $this->getJson('/api/stats?months=7')->assertStatus(400);
    }
}
