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
        return response()->json(['release' => new ReleaseResource(self::find($request, $id)), 'limits' => YoutubeKit::LIMITS]);
    }

    public function store(Request $request): JsonResponse
    {
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

        return response()->json(['release' => new ReleaseResource($release->fresh('folder'))]);
    }

    public function destroy(string $id): JsonResponse
    {
        $release = Release::find(Input::id($id)) ?? throw ApiError::notFound('Release niet gevonden.');
        $release->delete();
        $release->deleteFiles();

        return response()->json(['ok' => true]);
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
        $title = Input::text($request->input('title'), 200, 'Titel');
        if ($title === '') {
            throw ApiError::bad('Geef de release een titel.');
        }
        $style = Input::text($request->input('style'), 4000, 'Style-omschrijving');
        $folder = Input::intOrNull($request->input('folder_id'), 1, PHP_INT_MAX, 'Map');
        if ($folder !== null && ! Folder::whereKey($folder)->exists()) {
            throw ApiError::bad('Die collectie bestaat niet.');
        }
        $out = [
            'title' => $title,
            'style' => $style,
            'lyrics' => Input::text($request->input('lyrics'), 20000, 'Lyrics'),
            'bpm' => Input::intOrNull($request->input('bpm'), 40, 300, 'BPM') ?? YoutubeKit::bpm($style),
            'release_date' => Input::dateOrNull($request->input('release_date')),
            'video_type' => Input::text($request->input('video_type'), 60, 'Video-type') ?: Setting::current()['default_video_type'],
            'folder_id' => $folder,
            'is_hidden' => Input::bool($request->input('hidden')),
            'notes' => Input::text($request->input('notes'), 4000, 'Notities'),
        ];
        foreach (['youtube_url' => 'YouTube-link', 'spotify_url' => 'Spotify-link'] as $key => $name) {
            $out[$key] = $request->exists($key) ? Input::urlOrEmpty($request->input($key), $name) : ($existing?->$key ?? '');
        }
        foreach (['on_youtube', 'on_spotify'] as $key) {
            $out[$key] = $request->exists($key) ? Input::bool($request->input($key)) : (bool) ($existing?->$key ?? false);
        }

        return $out;
    }
}
