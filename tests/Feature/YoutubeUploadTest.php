<?php

namespace Tests\Feature;

use App\Models\Release;
use App\Models\Setting;
use App\Services\YoutubeApi;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/** Direct upload to YouTube, against a stand-in Google (Http::fake). */
class YoutubeUploadTest extends TestCase
{
    private const SESSION = 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=abc';

    protected function setUp(): void
    {
        parent::setUp();
        config(['studio.youtube_chunk' => 1000]);
    }

    private function connected(): void
    {
        Setting::put(['youtube_client_id' => 'client-1', 'youtube_client_secret' => 'example-secret', 'youtube_refresh_token' => 'example-refresh', 'youtube_channel_title' => 'Distant Youth Co.']);
    }

    private function releaseWithVideo(array $attrs = []): Release
    {
        $this->actingAs($admin = $this->admin());
        $r = $this->app_()->post('/api/releases', ['title' => 'Lanterns', 'wav' => self::file('a.wav', self::wav()), 'video' => self::file('v.mp4', self::mp4(2500)), 'cover' => self::file('c.jpg', "\xFF\xD8\xFF".str_repeat('x', 200))] + $attrs, ['Accept' => 'application/json'])->assertCreated()->json('release');

        return Release::find($r['id']);
    }

    public function test_the_client_secret_is_kept_encrypted_and_the_connection_cannot_be_set_through_the_form(): void
    {
        $this->actingAs($this->admin());
        $this->app_()->putJson('/api/settings', ['youtube_client_id' => 'client-1', 'youtube_client_secret' => 'example-secret', 'youtube_refresh_token' => 'stolen', 'youtube_channel_title' => 'fake', 'youtube_default_privacy' => 'unlisted', 'youtube_ai_label' => false])->assertOk();
        $this->assertStringNotContainsString('example-secret', (string) DB::table('settings')->where('key', 'youtube_client_secret')->value('value'));
        $s = Setting::current();
        $this->assertTrue($s['youtube_client_secret'] === 'example-secret' && $s['youtube_refresh_token'] === '' && $s['youtube_channel_title'] === '');
        $r = $this->getJson('/api/settings')->assertOk();
        $this->assertStringNotContainsString('example-secret', $r->getContent());
        $r->assertJson(['settings' => ['youtube_client_id' => 'client-1', 'youtube_default_privacy' => 'unlisted', 'youtube_ai_label' => '0'], 'youtube_secret_saved' => true]);
        $this->app_()->putJson('/api/settings', ['youtube_default_privacy' => 'iedereen'])->assertStatus(400);
        // A connection belongs to its client: another Client ID forgets it.
        Setting::put(['youtube_refresh_token' => 'example-refresh']);
        $this->app_()->putJson('/api/settings', ['youtube_client_id' => 'client-2'])->assertOk();
        $this->assertSame('', Setting::current()['youtube_refresh_token']);
    }

    public function test_connecting_the_channel_with_a_one_time_state(): void
    {
        $this->actingAs($this->admin());
        $this->app_()->postJson('/api/youtube/connect')->assertStatus(409);
        Setting::put(['youtube_client_id' => 'client-1', 'youtube_client_secret' => 'example-secret']);
        $url = $this->app_()->postJson('/api/youtube/connect')->assertOk()->json('url');
        parse_str((string) parse_url($url, PHP_URL_QUERY), $q);
        $this->assertSame(['client-1', 'code', 'offline', 'consent', url('/oauth/youtube/callback')], [$q['client_id'], $q['response_type'], $q['access_type'], $q['prompt'], $q['redirect_uri']]);
        $this->assertStringContainsString('youtube.upload', $q['scope']);
        $this->assertStringNotContainsString('force-ssl', $q['scope'], 'no right to change or delete videos');

        // Someone else's state: refused, nothing stored.
        $this->get('/oauth/youtube/callback?state=wrong&code=x')->assertRedirectContains('youtube_error=');
        Http::fake([
            'oauth2.googleapis.com/token' => Http::response(['access_token' => 'at-1', 'refresh_token' => 'rt-1', 'expires_in' => 3600]),
            'www.googleapis.com/youtube/v3/channels*' => Http::response(['items' => [['id' => 'UC1', 'snippet' => ['title' => 'Distant Youth Co.']]]]),
        ]);
        $url = $this->app_()->postJson('/api/youtube/connect')->json('url');
        parse_str((string) parse_url($url, PHP_URL_QUERY), $q);
        $this->get("/oauth/youtube/callback?state={$q['state']}&code=the-code")->assertRedirect('/#/instellingen?youtube=Distant+Youth+Co.');
        Http::assertSent(fn (HttpRequest $r) => str_contains($r->url(), '/token') && $r['code'] === 'the-code' && $r['client_secret'] === 'example-secret');
        $this->assertSame('rt-1', Setting::current()['youtube_refresh_token']);
        $this->getJson('/api/youtube')->assertJson(['youtube' => ['connected' => true, 'channel_title' => 'Distant Youth Co.']]);
        $this->assertStringNotContainsString('rt-1', $this->getJson('/api/settings')->getContent());
        // The same state twice: no.
        $this->get("/oauth/youtube/callback?state={$q['state']}&code=again")->assertRedirectContains('youtube_error=');
    }

    public function test_youtubes_rules_are_checked_before_anything_is_sent(): void
    {
        $r = new Release(['title' => 'x']);
        foreach ([
            ['yt_title' => '', 'yt_description' => 'd'],
            ['yt_title' => str_repeat('T', 101), 'yt_description' => 'd'],
            ['yt_title' => 'T', 'yt_description' => str_repeat('😀', 1251)], // 5004 bytes
            ['yt_title' => 'Moon <3', 'yt_description' => 'd'],
        ] as $texts) {
            $r->forceFill($texts);
            try {
                YoutubeApi::resource($r, 'public', null, true);
                $this->fail('accepted: '.json_encode($texts));
            } catch (\App\Exceptions\ApiError $e) {
                $this->assertSame(400, $e->status);
            }
        }
        $r->forceFill(['yt_title' => 'Lanterns', 'yt_description' => 'Mooi', 'yt_tags' => implode(', ', array_map(fn ($i) => "tag met spatie $i", range(1, 40))).', dubbel, dubbel']);
        [$res, $warnings] = YoutubeApi::resource($r, 'public', null, true);
        $this->assertLessThanOrEqual(500, YoutubeApi::tagsLength($res['snippet']['tags']));
        $this->assertStringContainsString('weggelaten', $warnings[0]);
        $this->assertSame(['10', false, true], [$res['snippet']['categoryId'], $res['status']['selfDeclaredMadeForKids'], $res['status']['containsSyntheticMedia']]);
        $this->expectException(\App\Exceptions\ApiError::class);
        YoutubeApi::resource($r, 'public', '2030-01-01T10:00:00Z', true); // scheduled must be private until then
    }

    public function test_an_upload_goes_piece_by_piece_survives_a_dropped_connection_and_sets_the_cover(): void
    {
        $release = $this->releaseWithVideo();
        $this->connected();
        $size = strlen(self::mp4(2500));
        $pieces = 0;
        $dropped = false;
        Http::fake(function (HttpRequest $req) use ($size, &$pieces, &$dropped) {
            $url = $req->url();
            if (str_contains($url, '/token')) {
                return Http::response(['access_token' => 'at', 'expires_in' => 3600]);
            }
            if (str_contains($url, 'uploadType=resumable')) {
                return Http::response('', 200, ['Location' => self::SESSION]);
            }
            if (str_starts_with($url, self::SESSION)) {
                $range = $req->header('Content-Range')[0];
                if ($range === "bytes */$size") {
                    return Http::response('', 308, ['Range' => 'bytes=0-1999']); // it had the second piece after all
                }
                $pieces++;
                if ($pieces === 2 && ! $dropped) {
                    $dropped = true;
                    throw new ConnectionException('reset');
                }
                preg_match('/bytes (\d+)-(\d+)\/(\d+)/', $range, $m);

                return (int) $m[2] + 1 === $size ? Http::response(['id' => 'VIDEO123'], 201) : Http::response('', 308, ['Range' => "bytes=0-{$m[2]}"]);
            }
            if (str_contains($url, 'thumbnails/set')) {
                return Http::response(['items' => []]);
            }

            return Http::response('unexpected', 500);
        });
        $this->actingAs(\App\Models\User::where('username', 'admin')->first());
        $this->app_()->postJson("/api/releases/{$release->id}/youtube-upload", ['privacy' => 'public'])->assertCreated()->assertJsonPath('upload.state', 'uploading');
        $this->assertStringNotContainsString('upload_id', $this->getJson("/api/releases/{$release->id}/youtube-upload")->getContent(), 'the session address stays on the server');
        $states = [];
        for ($i = 0; $i < 10; $i++) {
            $u = $this->app_()->postJson("/api/releases/{$release->id}/youtube-upload/step")->assertOk()->json('upload');
            $states[] = "{$u['state']}:{$u['sent']}";
            if ($u['state'] === 'done') {
                break;
            }
        }
        $this->assertSame('done', $u['state'], implode(' ', $states));
        $this->assertContains('uploading:1000', $states);
        $this->assertSame('https://youtu.be/VIDEO123', $u['url']);
        $r = $this->getJson("/api/releases/{$release->id}")->json('release');
        $this->assertSame(['https://youtu.be/VIDEO123', 'VIDEO123', true, 'public', 'live'], [$r['youtube_url'], $r['youtube_video_id'], $r['on_youtube'], $r['youtube_privacy'], $r['status']]);
        Http::assertSent(fn (HttpRequest $q) => str_contains($q->url(), 'uploadType=resumable') && $q['snippet']['title'] === $release->fresh()->yt_title && $q['status']['privacyStatus'] === 'public' && $q->header('X-Upload-Content-Length')[0] === (string) $size);
        Http::assertSent(fn (HttpRequest $q) => str_contains($q->url(), 'thumbnails/set?videoId=VIDEO123') && $q->header('Content-Type')[0] === 'image/jpeg');
    }

    public function test_an_expired_session_or_a_refusal_ends_the_upload_with_the_reason(): void
    {
        $release = $this->releaseWithVideo();
        $this->connected();
        Http::fake([
            'oauth2.googleapis.com/token' => Http::response(['access_token' => 'at', 'expires_in' => 3600]),
            '*uploadType=resumable*' => Http::sequence()->push('', 200, ['Location' => self::SESSION])->push(['error' => ['errors' => [['reason' => 'quotaExceeded']]]], 403),
            self::SESSION => Http::response('', 404),
        ]);
        $this->app_()->postJson("/api/releases/{$release->id}/youtube-upload", ['privacy' => 'private'])->assertCreated();
        $this->app_()->postJson("/api/releases/{$release->id}/youtube-upload/step")->assertJsonPath('upload.state', 'failed')->assertJsonPath('upload.error', fn ($e) => str_contains($e, 'verlopen'));
        $this->app_()->postJson("/api/releases/{$release->id}/youtube-upload", ['privacy' => 'private'])->assertStatus(429)->assertJsonPath('error', fn ($e) => str_contains($e, 'quotum'));
    }

    public function test_no_upload_without_a_channel_a_video_or_a_good_moment(): void
    {
        $release = $this->releaseWithVideo();
        $this->app_()->postJson("/api/releases/{$release->id}/youtube-upload", ['privacy' => 'public'])->assertStatus(409)->assertJsonPath('error', fn ($e) => str_contains($e, 'niet gekoppeld'));
        $this->connected();
        Http::fake(['oauth2.googleapis.com/token' => Http::response(['access_token' => 'at', 'expires_in' => 3600])]);
        $this->app_()->postJson("/api/releases/{$release->id}/youtube-upload", ['privacy' => 'public', 'publish_at' => '2020-01-01T10:00'])->assertStatus(400);
        $bare = $this->app_()->post('/api/releases', ['title' => 'Zonder video', 'wav' => self::file('a.wav', self::wav())], ['Accept' => 'application/json'])->json('release.id');
        $this->app_()->postJson("/api/releases/$bare/youtube-upload", ['privacy' => 'public'])->assertStatus(400)->assertJsonPath('error', fn ($e) => str_contains($e, 'nog geen MP4'));
    }

    public function test_the_status_turns_the_moon_full_when_public_and_takes_the_link_away_when_gone(): void
    {
        $release = $this->releaseWithVideo();
        $this->connected();
        $release->forceFill(['youtube_video_id' => 'V1', 'youtube_url' => 'https://youtu.be/V1', 'youtube_privacy' => 'private', 'on_youtube' => false])->save();
        Http::fake([
            'oauth2.googleapis.com/token' => Http::response(['access_token' => 'at', 'expires_in' => 3600]),
            'www.googleapis.com/youtube/v3/videos*' => Http::sequence()->push(['items' => [['status' => ['privacyStatus' => 'public', 'uploadStatus' => 'processed']]]])->push(['items' => []]),
        ]);
        $this->app_()->postJson("/api/releases/{$release->id}/youtube-sync")->assertOk()->assertJson(['gone' => false, 'privacy' => 'public', 'release' => ['on_youtube' => true, 'status' => 'live']]);
        $this->app_()->postJson("/api/releases/{$release->id}/youtube-sync")->assertOk()->assertJson(['gone' => true, 'release' => ['youtube_url' => '', 'on_youtube' => false]]);
    }

    public function test_a_listener_gets_none_of_it(): void
    {
        $release = $this->releaseWithVideo();
        $this->actingAs($this->listener());
        foreach (['GET /api/youtube', 'POST /api/youtube/connect', 'DELETE /api/youtube/connection', "POST /api/releases/{$release->id}/youtube-upload", "POST /api/releases/{$release->id}/youtube-upload/step", "POST /api/releases/{$release->id}/youtube-sync"] as $route) {
            [$method, $path] = explode(' ', $route);
            $this->app_()->json($method, $path)->assertForbidden();
        }
        $this->get('/oauth/youtube/callback?state=x&code=y')->assertForbidden();
        $this->assertArrayNotHasKey('youtube_video_id', $this->getJson("/api/releases/{$release->id}")->json('release'));
    }
}
