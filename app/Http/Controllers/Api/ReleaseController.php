<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\ApiError;
use App\Http\Controllers\Controller;
use App\Http\Resources\ReleaseResource;
use App\Models\Folder;
use App\Models\Release;
use App\Models\Setting;
use App\Services\ReleaseFiles;
use App\Services\YoutubeKit;
use App\Support\Input;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

use function Illuminate\Support\defer;

class ReleaseController extends Controller
{
    public function __construct(private readonly ReleaseFiles $files) {}

    public static function visible(Request $request)
    {
        return Release::query()->with('folder')->visibleTo($request->user())->newestFirst();
    }

    /** One release this user may see, or 404 (a hidden one looks like it does not exist). */
    public static function find(Request $request, string|int $id): Release
    {
        return self::visible($request)->find(Input::id($id)) ?? throw ApiError::notFound('Release niet gevonden.');
    }

    public function index(Request $request): JsonResponse
    {
        return response()->json(['releases' => ReleaseResource::collection(self::visible($request)->get())]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $release = self::find($request, $id);

        return response()->json(['release' => new ReleaseResource($release), 'limits' => YoutubeKit::LIMITS, 'neighbours' => self::neighbours($request, $release)]);
    }

    /** The release before and after this one in the list as this user sees it (newest first), for paging through. */
    private static function neighbours(Request $request, Release $release): array
    {
        $list = self::visible($request)->setEagerLoads([])->get(['releases.id', 'releases.title'])->values();
        $i = $list->search(fn ($r) => $r->id === $release->id);
        $pick = fn ($r) => $r ? ['id' => $r->id, 'title' => $r->title] : null;

        return ['previous' => $pick($i > 0 ? $list[$i - 1] : null), 'next' => $pick($list[$i + 1] ?? null)];
    }

    public function store(Request $request): JsonResponse
    {
        Release::purgeDeleted();
        $fields = $this->fields($request, null);
        $files = $this->files->fromRequest($request);
        if (empty($files['wav'])) {
            throw ApiError::bad('Een WAV-bestand is verplicht.');
        }
        $release = DB::transaction(function () use ($fields, $files) {
            $release = Release::create($fields);
            foreach ($files as $kind => $f) {
                $release->{Release::FILE_COLUMNS[$kind]} = $this->files->store($release, $kind, $f);
            }
            $release->save();

            return $release;
        });
        $this->afterFiles($release);
        $this->autoText($release);

        return response()->json(['release' => new ReleaseResource($release->fresh('folder'))], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $release = Release::find(Input::id($id)) ?? throw ApiError::notFound('Release niet gevonden.');
        $fields = $this->fields($request, $release);
        $files = $this->files->fromRequest($request);
        DB::transaction(function () use ($request, $release, $fields, $files) {
            $before = clone $release; // its files and flags as they were, with its id
            $release->fill($fields);
            foreach (['mp3', 'video', 'cover'] as $kind) {
                if (Input::bool($request->input("remove_$kind")) && empty($files[$kind])) {
                    $this->files->remove($release, $kind);
                    $release->{Release::FILE_COLUMNS[$kind]} = null;
                }
            }
            foreach ($files as $kind => $f) {
                $release->{Release::FILE_COLUMNS[$kind]} = $this->files->store($release, $kind, $f);
                if ($kind === 'mp3') {
                    $release->mp3_generated = false;
                }
                if ($kind === 'cover') {
                    $release->cover_generated = false;
                }
                if ($kind === 'wav') {
                    $release->duration = null;
                    if ($before->mp3_generated) {
                        $this->files->remove($before, 'mp3');
                        [$release->mp3_file, $release->mp3_generated] = [null, false];
                    }
                }
                if ($kind === 'video' && $before->cover_generated) {
                    $this->files->remove($before, 'cover');
                    [$release->cover_file, $release->cover_generated] = [null, false];
                }
            }
            $release->touch();
            $release->save();
        });
        $this->afterFiles($release);
        $this->autoText($release);

        return response()->json(['release' => new ReleaseResource($release->fresh('folder'))]);
    }

    public function destroy(string $id): JsonResponse
    {
        $release = Release::find(Input::id($id)) ?? throw ApiError::notFound('Release niet gevonden.');
        Release::purgeDeleted();
        $release->delete(); // its files wait, so "Ongedaan maken" can put it back

        return response()->json(['ok' => true, 'undo_until' => $release->deleted_at->copy()->addMinutes(Release::UNDO_MINUTES)->format('Y-m-d H:i:s')]);
    }

    /** "Ongedaan maken": a release deleted within the undo time comes back, with its files and playlists. */
    public function restore(string $id): JsonResponse
    {
        $release = Release::onlyTrashed()->where('deleted_at', '>=', now()->subMinutes(Release::UNDO_MINUTES))->find(Input::id($id))
            ?? throw ApiError::notFound('Deze release is niet meer terug te zetten.');
        $release->restore();

        return response()->json(['release' => new ReleaseResource($release->fresh('folder'))]);
    }

    /** Live on YouTube or Spotify, with the links. */
    public function status(Request $request, string $id): JsonResponse
    {
        $release = Release::find(Input::id($id)) ?? throw ApiError::notFound('Release niet gevonden.');
        foreach (['youtube_url' => 'YouTube-link', 'spotify_url' => 'Spotify-link'] as $key => $name) {
            if ($request->exists($key)) {
                $release->$key = Input::urlOrEmpty($request->input($key), $name);
            }
        }
        foreach (['on_youtube', 'on_spotify'] as $key) {
            if ($request->exists($key)) {
                $release->$key = Input::bool($request->input($key));
            }
        }
        $release->touch();

        return response()->json(['release' => new ReleaseResource($release->fresh('folder'))]);
    }

    /**
     * The YouTube texts filled in with the template: at once for a new release, and again after a
     * change of title, style or lyrics while nobody touched them (still "template"). Texts that Claude
     * wrote or that were edited stay. Claude rewrites in the YouTube-kit, on request (it costs a little).
     */
    private function autoText(Release $release): void
    {
        if (trim((string) $release->yt_description) !== '' && $release->yt_generated_with !== 'template') {
            return;
        }
        $out = app(YoutubeKit::class)->generate($release, Setting::current(), false, '');
        $release->forceFill([
            'yt_title' => $out['title'],
            'yt_description' => $out['description'],
            'yt_tags' => $out['tags'],
            'yt_generated_with' => $out['generated_with'],
        ])->saveQuietly();
    }

    /** The duration now; an MP3 and a cover after the answer is sent, where ffmpeg is there. */
    private function afterFiles(Release $release): void
    {
        $this->files->quickInfo($release);
        if (! ReleaseFiles::hasFfmpeg()) {
            return;
        }
        $id = $release->id;
        // PHP-FPM and LiteSpeed send the answer first and then run the deferred work; mod_php and CGI
        // would make the answer wait for ffmpeg, so there a separate PHP process does it.
        if (function_exists('fastcgi_finish_request') || function_exists('litespeed_finish_request') || ! ReleaseFiles::inBackground($id)) {
            defer(fn () => app(ReleaseFiles::class)->heavyWork($id));
        }
    }

    private function fields(Request $request, ?Release $existing): array
    {
        // A change keeps what it does not send ("Aanvullen" sends only style and lyrics); a new release starts empty.
        $keep = fn (string $key) => $existing !== null && ! $request->exists($key);
        $title = $keep('title') ? $existing->title : Input::text($request->input('title'), 200, 'Titel');
        if ($title === '') {
            throw ApiError::bad('Geef de release een titel.');
        }
        $style = $keep('style') ? (string) $existing->style : Input::text($request->input('style'), 4000, 'Style-omschrijving');
        $folder = $keep('folder_id') ? $existing->folder_id : Input::intOrNull($request->input('folder_id'), 1, PHP_INT_MAX, 'Map');
        if ($folder !== null && ! Folder::whereKey($folder)->exists()) {
            throw ApiError::bad('Die collectie bestaat niet.');
        }
        $out = [
            'title' => $title,
            'style' => $style,
            'lyrics' => $keep('lyrics') ? (string) $existing->lyrics : Input::text($request->input('lyrics'), 20000, 'Lyrics'),
            'bpm' => ($keep('bpm') ? $existing->bpm : Input::intOrNull($request->input('bpm'), 40, 300, 'BPM')) ?? YoutubeKit::bpm($style),
            'release_date' => $keep('release_date') ? $existing->release_date : Input::dateOrNull($request->input('release_date')),
            'video_type' => ($keep('video_type') ? $existing->video_type : Input::text($request->input('video_type'), 60, 'Video-type')) ?: Setting::current()['default_video_type'],
            'folder_id' => $folder,
            'is_hidden' => $keep('hidden') ? (bool) $existing->is_hidden : Input::bool($request->input('hidden')),
            'notes' => $keep('notes') ? (string) $existing->notes : Input::text($request->input('notes'), 4000, 'Notities'),
        ];
        foreach (['youtube_url' => 'YouTube-link', 'spotify_url' => 'Spotify-link'] as $key => $name) {
            $out[$key] = $request->exists($key) ? Input::urlOrEmpty($request->input($key), $name) : ($existing?->$key ?? '');
        }
        foreach (['on_youtube', 'on_spotify'] as $key) {
            $out[$key] = $request->exists($key) ? Input::bool($request->input($key)) : (bool) ($existing?->$key ?? false);
        }
        // A new link to the video on YouTube: it is on YouTube.
        if ($out['youtube_url'] !== '' && $out['youtube_url'] !== $existing?->youtube_url && ! $request->exists('on_youtube')) {
            $out['on_youtube'] = true;
        }

        return $out;
    }
}
