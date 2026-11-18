<?php

namespace Tests\Feature;

use App\Models\Release;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;
use ZipArchive;

class ReleaseTest extends TestCase
{
    private function upload(array $fields, array $files = ['wav' => null])
    {
        $data = $fields;
        foreach ($files as $kind => $content) {
            $data[$kind] = $content instanceof UploadedFile ? $content : self::file("$kind.bin", $content ?? self::wav());
        }

        return $this->app_()->post('/api/releases', $data, ['Accept' => 'application/json']);
    }

    /** A file in pieces, as the browser sends it to a host with a small upload limit. */
    private function inPieces(string $content, int $chunk): string
    {
        $token = $this->app_()->postJson('/api/uploads', ['name' => 'x', 'size' => strlen($content)])->assertCreated()->json('token');
        for ($o = 0; $o < strlen($content); $o += $chunk) {
            $this->app_()->call('POST', "/api/uploads/$token?offset=$o", [], [], [], ['CONTENT_TYPE' => 'application/octet-stream', 'HTTP_X_REQUESTED_WITH' => 'dyc'], substr($content, $o, $chunk))->assertOk();
        }

        return $token;
    }

    private function piece(string $token, int $offset, string $bytes)
    {
        return $this->call('POST', "/api/uploads/$token?offset=$offset", [], [], [], ['CONTENT_TYPE' => 'application/octet-stream', 'HTTP_X_REQUESTED_WITH' => 'dyc', 'HTTP_ACCEPT' => 'application/json'], $bytes);
    }

    public function test_a_release_needs_a_title_and_a_real_wav_and_reads_bpm_and_duration(): void
    {
        $this->actingAs($this->admin());
        $this->upload(['title' => ''])->assertStatus(400)->assertJson(['error' => 'Geef de release een titel.']);
        $this->upload(['title' => 'Nep'], ['wav' => 'this is not a wav'])->assertStatus(400)->assertJson(['error' => 'wav.bin is geen geldig WAV-bestand.']);
        $this->upload(['title' => 'Zonder'], [])->assertStatus(400)->assertJson(['error' => 'Een WAV-bestand is verplicht.']);
        $r = $this->upload(['title' => 'Lanterns in the Rain', 'style' => 'heavy melodic dubstep, 140 bpm, koto'], ['wav' => self::wav(3), 'video' => self::mp4()])
            ->assertCreated()->json('release');
        $this->assertSame(140, $r['bpm']);
        $this->assertEquals(3.0, $r['duration']);
        $this->assertTrue($r['has']['video']);
        $this->assertSame('ready', $r['status'], 'video and the YouTube text (made by itself): ready for YouTube');
        $this->assertSame(self::wav(3), Storage::disk('local')->get("releases/{$r['id']}/master.wav"));
    }

    public function test_a_file_over_this_servers_limit_gets_a_clear_413(): void
    {
        $this->actingAs($this->admin());
        $big = new UploadedFile(tempnam(sys_get_temp_dir(), 'w'), 'groot.wav', 'audio/wav', UPLOAD_ERR_INI_SIZE, true);
        $this->upload(['title' => 'Te groot'], ['wav' => $big])->assertStatus(413)->assertJsonPath('error', fn ($e) => str_contains($e, 'te groot voor deze server'));
    }

    public function test_pieces_wrong_order_a_retry_a_half_failed_write_and_an_empty_piece(): void
    {
        $this->actingAs($this->admin());
        $content = random_bytes(5000);
        $token = $this->app_()->postJson('/api/uploads', ['name' => 'x.mp4', 'size' => 5000])->json('token');
        $this->piece($token, 2000, substr($content, 2000))->assertStatus(409);
        $this->piece($token, 0, '')->assertStatus(400);
        $this->piece($token, 0, substr($content, 0, 2000))->assertOk()->assertJson(['received' => 2000]);
        $this->piece($token, 0, substr($content, 0, 2000))->assertOk()->assertJson(['received' => 2000]);
        // Bytes on disk that were never counted (a write cut off before the database heard of it).
        file_put_contents(Storage::disk('local')->path("uploads/$token.part"), 'garbage', FILE_APPEND);
        $this->piece($token, 2000, substr($content, 2000))->assertOk()->assertJson(['received' => 5000]);
        $this->assertSame($content, Storage::disk('local')->get("uploads/$token.part"));
        $this->getJson("/api/uploads/$token")->assertOk()->assertJson(['received' => 5000, 'size' => 5000]);
    }

    public function test_a_release_from_pieces_and_an_unfinished_upload_refused(): void
    {
        $this->actingAs($this->admin());
        $half = $this->app_()->postJson('/api/uploads', ['name' => 'half.wav', 'size' => 1000])->json('token');
        $this->upload(['title' => 'Te vroeg', 'wav_upload' => $half], [])->assertStatus(400)->assertJson(['error' => 'half.wav is nog niet helemaal geüpload.']);
        $wav = self::wav(200);
        $r = $this->upload(['title' => 'Uit stukjes', 'wav_upload' => $this->inPieces($wav, 1_600_000), 'video_upload' => $this->inPieces(self::mp4(), 1000)], [])
            ->assertCreated()->json('release');
        $this->assertEquals(200.0, $r['duration']);
        $this->assertSame($wav, Storage::disk('local')->get("releases/{$r['id']}/master.wav"));
        $this->assertSame(["uploads/$half.part"], Storage::disk('local')->files('uploads'), 'only the unfinished upload is left');
    }

    public function test_hidden_releases_stay_hidden_from_listeners_also_their_files(): void
    {
        $this->actingAs($admin = $this->admin());
        $open = $this->upload(['title' => 'Open'])->json('release.id');
        $hidden = $this->upload(['title' => 'Geheim', 'hidden' => '1'])->json('release.id');
        $this->actingAs($this->listener());
        $this->getJson("/api/releases/$hidden")->assertNotFound();
        $this->get("/media/$hidden/audio")->assertNotFound();
        $this->assertSame([$open], collect($this->getJson('/api/releases')->json('releases'))->pluck('id')->all());
        $this->assertArrayNotHasKey('yt_description', $this->getJson("/api/releases/$open")->json('release'), 'admin fields stay with the admin');
        $this->assertSame(1, $this->getJson('/api/stats?months=12')->assertOk()->json('total'));
    }

    public function test_updating_keeps_what_is_not_sent_and_removes_what_is_asked(): void
    {
        $this->actingAs($this->admin());
        $id = $this->upload(['title' => 'Een', 'style' => 'riddim'], ['wav' => self::wav(), 'video' => self::mp4(), 'cover' => "\xFF\xD8\xFF".str_repeat('x', 100)])->json('release.id');
        $this->app_()->post("/api/releases/$id", ['title' => 'Een (edit)', 'style' => 'riddim', 'remove_video' => '1'], ['X-HTTP-Method-Override' => 'PUT', 'Accept' => 'application/json'])
            ->assertOk()->assertJsonPath('release.title', 'Een (edit)')->assertJsonPath('release.has.video', false)->assertJsonPath('release.has.cover', true);
        $this->app_()->postJson("/api/releases/$id/status", ['on_spotify' => true, 'spotify_url' => 'javascript:alert(1)'])->assertStatus(400);
        $this->app_()->postJson("/api/releases/$id/status", ['on_spotify' => true])->assertOk()->assertJsonPath('release.status', 'live');
        $this->app_()->deleteJson("/api/releases/$id")->assertOk();
        $this->getJson("/api/releases/$id")->assertNotFound();
    }

    public function test_a_deleted_release_can_be_put_back_for_an_hour_then_its_files_go(): void
    {
        $this->actingAs($admin = $this->admin());
        $id = $this->upload(['title' => 'Per ongeluk'], ['wav' => self::wav(), 'video' => self::mp4()])->json('release.id');
        $pl = $this->app_()->postJson('/api/playlists', ['name' => 'Lijst'])->json('playlist.id');
        $this->app_()->postJson("/api/playlists/$pl/items", ['release_id' => $id])->assertCreated();

        $this->app_()->deleteJson("/api/releases/$id")->assertOk()->assertJson(['ok' => true, 'undo_until' => now()->addHour()->format('Y-m-d H:i:s')]);
        $this->getJson("/api/releases/$id")->assertNotFound();
        $this->assertNotContains($id, collect($this->getJson('/api/releases')->json('releases'))->pluck('id'));
        $this->assertSame(0, $this->getJson("/api/playlists/$pl")->json('playlist.count'));
        $this->get("/media/$id/audio")->assertNotFound();
        $this->actingAs($this->listener());
        $this->app_()->postJson("/api/releases/$id/restore")->assertForbidden();

        $this->actingAs($admin);
        $this->app_()->postJson("/api/releases/$id/restore")->assertOk()->assertJsonPath('release.title', 'Per ongeluk');
        $this->get("/media/$id/audio")->assertOk();
        $this->assertSame(1, $this->getJson("/api/playlists/$pl")->json('playlist.count'), 'back in its playlist too');
        $this->app_()->postJson("/api/releases/$id/restore")->assertNotFound(); // not deleted (any more)

        // Deleted again, and more than an hour later: gone with its files, no way back.
        $this->app_()->deleteJson("/api/releases/$id")->assertOk();
        $this->travel(61)->minutes();
        $other = $this->upload(['title' => 'Nieuw'])->json('release.id');
        $this->app_()->deleteJson("/api/releases/$other")->assertOk();
        $this->assertFalse(Storage::disk('local')->exists("releases/$id"));
        $this->assertTrue(Storage::disk('local')->exists("releases/$other"), 'the one just deleted still waits');
        $this->app_()->postJson("/api/releases/$id/restore")->assertNotFound();
        $this->assertSame(0, \Illuminate\Support\Facades\DB::table('playlist_release')->where('release_id', $id)->count());
    }

    public function test_media_ranges_for_seeking_a_download_name_and_a_session_needed(): void
    {
        $this->actingAs($this->admin());
        $id = $this->upload(['title' => 'Lanterns in the Rain'], ['wav' => self::wav(2), 'video' => self::mp4()])->json('release.id');
        $r = $this->get("/media/$id/audio", ['Range' => 'bytes=0-99']);
        $r->assertStatus(206);
        $this->assertSame('bytes 0-99/'.strlen(self::wav(2)), $r->headers->get('Content-Range'));
        $d = $this->get("/media/$id/video?download=1");
        $d->assertOk();
        $this->assertStringContainsString('lanterns-in-the-rain-video.mp4', $d->headers->get('Content-Disposition'));
        $this->get("/media/$id/onzin")->assertNotFound();
        // A listener listens and watches, but the master WAV and the downloads stay with the admin.
        $this->actingAs($this->listener());
        $this->get("/media/$id/audio")->assertOk();
        $this->get("/media/$id/video")->assertOk();
        $this->get("/media/$id/wav")->assertNotFound();
        $this->get("/media/$id/video?download=1")->assertNotFound();
        auth()->logout();
        $this->get("/media/$id/audio")->assertStatus(401);
    }

    public function test_downloads_every_video_and_one_zip_that_unzip_tools_read(): void
    {
        $this->actingAs($this->admin());
        $a = $this->upload(['title' => 'Night/Video: one'], ['wav' => self::wav(), 'video' => self::mp4(500)])->json('release.id');
        $this->upload(['title' => 'Night/Video: one'], ['wav' => self::wav(), 'video' => self::mp4(700)]);
        $this->upload(['title' => 'Geen video']);
        $list = $this->getJson('/api/downloads')->assertOk()->json('videos');
        $this->assertCount(2, $list);
        $this->assertSame(strlen(self::mp4(500)), collect($list)->firstWhere('id', $a)['video_size']);

        $zip = $this->get('/downloads/videos.zip');
        $zip->assertOk()->assertHeader('Content-Type', 'application/zip');
        $path = tempnam(sys_get_temp_dir(), 'zip');
        file_put_contents($path, $zip->streamedContent());
        $z = new ZipArchive();
        $this->assertTrue($z->open($path, ZipArchive::CHECKCONS));
        $names = [$z->getNameIndex(0), $z->getNameIndex(1)];
        sort($names);
        $this->assertSame(['Night Video one (Official Visualizer) 2.mp4', 'Night Video one (Official Visualizer).mp4'], $names);
        $this->assertEqualsCanonicalizing([self::mp4(500), self::mp4(700)], [$z->getFromIndex(0), $z->getFromIndex(1)]);
        $z->close();

        $this->get("/downloads/videos.zip?ids=$a")->assertOk();
        // Every id counts, not only the first (a review found ids=1,12 gave just 1).
        $c = $this->upload(['title' => 'Derde'], ['wav' => self::wav(), 'video' => self::mp4(900)])->json('release.id');
        $b = collect($list)->pluck('id')->first(fn ($id) => $id !== $a);
        file_put_contents($path, $this->get("/downloads/videos.zip?ids=$b,%20$c")->streamedContent());
        $z = new ZipArchive();
        $z->open($path);
        $this->assertEqualsCanonicalizing([self::mp4(700), self::mp4(900)], [$z->getFromIndex(0), $z->getFromIndex(1)]);
        $this->assertSame(2, $z->numFiles);
        $z->close();
        $this->get('/downloads/videos.zip?ids=999999')->assertNotFound();
        $this->call('HEAD', '/downloads/videos.zip')->assertOk()->assertHeader('Content-Type', 'application/zip');
    }

    public function test_a_release_knows_the_one_before_and_after_it_and_skips_what_a_listener_may_not_see(): void
    {
        $this->actingAs($this->admin());
        $old = $this->upload(['title' => 'Oud', 'release_date' => '2026-01-01'])->json('release.id');
        $hidden = $this->upload(['title' => 'Geheim', 'release_date' => '2026-02-01', 'hidden' => '1'])->json('release.id');
        $new = $this->upload(['title' => 'Nieuw', 'release_date' => '2026-03-01'])->json('release.id');
        $this->getJson("/api/releases/$hidden")->assertJsonPath('neighbours.previous.id', $new)->assertJsonPath('neighbours.next.id', $old);
        $this->actingAs($this->listener());
        $this->getJson("/api/releases/$new")->assertJson(['neighbours' => ['previous' => null, 'next' => ['id' => $old, 'title' => 'Oud']]]);
        $this->getJson("/api/releases/$old")->assertJsonPath('neighbours.previous.id', $new)->assertJsonPath('neighbours.next', null);
    }
}
