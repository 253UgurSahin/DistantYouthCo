<?php

namespace App\Http\Controllers;

use App\Exceptions\ApiError;
use App\Http\Resources\ReleaseResource;
use App\Models\Release;
use App\Services\ZipStream;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Symfony\Component\HttpFoundation\Response;

/** Every release's video: listed with its size, and the chosen ones together as one ZIP (admin). */
class DownloadController extends Controller
{
    /** @return Collection<int, array{release: Release, file: string}> */
    private function withVideo(Request $request): Collection
    {
        return Release::query()->with('folder')->newestFirst()->get()
            ->map(fn (Release $r) => ['release' => $r, 'file' => $r->filePath('video')])
            ->filter(fn ($x) => $x['file'])->values();
    }

    public function index(Request $request): JsonResponse
    {
        return response()->json(['videos' => $this->withVideo($request)->map(fn ($x) => (new ReleaseResource($x['release']))->resolve($request) + [
            'video_size' => filesize($x['file']),
            'download_url' => "/media/{$x['release']->id}/video?download=1",
        ])]);
    }

    public function zip(Request $request): Response
    {
        // ids=1,2 or ids[]=1&ids[]=2; none: every video.
        $raw = $request->query('ids', '');
        $raw = is_array($raw) ? implode(',', array_filter($raw, 'is_string')) : (string) $raw;
        $wanted = collect(explode(',', $raw))->map('trim')->filter(fn ($x) => preg_match('/^[1-9]\d*$/', $x))->map('intval')->flip();
        $chosen = $this->withVideo($request)->filter(fn ($x) => $wanted->isEmpty() || $wanted->has($x['release']->id))->values();
        if ($chosen->isEmpty()) {
            throw ApiError::notFound("Geen video's om te downloaden.");
        }
        // Checked before anything is sent, so a too large file gets a clear answer, not a broken archive.
        foreach ($chosen as $x) {
            if (filesize($x['file']) >= ZipStream::MAX32) {
                throw new ApiError(413, "De video van {$x['release']->title} is 4 GB of groter: download die los met zijn eigen MP4-knop.");
            }
        }
        $used = [];
        $entries = $chosen->map(function ($x) use (&$used) {
            $base = ZipStream::safeName("{$x['release']->title} (".($x['release']->video_type ?: 'Video').')');
            $ext = '.'.(pathinfo($x['file'], PATHINFO_EXTENSION) ?: 'mp4');
            $name = $base.$ext;
            for ($n = 2; isset($used[mb_strtolower($name)]); $n++) {
                $name = "$base $n$ext";
            }
            $used[mb_strtolower($name)] = true;

            return ['name' => $name, 'path' => $x['file']];
        })->all();
        $headers = [
            'Content-Type' => 'application/zip',
            'Content-Disposition' => 'attachment; filename="distant-youth-videos-'.gmdate('Y-m-d').'.zip"',
            'Cache-Control' => 'no-store',
        ];
        if ($request->isMethod('HEAD')) {
            return response('', 200, $headers); // a link checker asking: no files read
        }

        return response()->stream(function () use ($entries) {
            @set_time_limit(0);
            // Straight to the browser, not into a buffer the size of every video (tests read the buffer).
            while (! app()->runningUnitTests() && ob_get_level()) {
                ob_end_clean();
            }
            ZipStream::write($entries, app()->runningUnitTests() ? function (string $b): bool { echo $b; return true; } : null);
        }, 200, $headers);
    }
}
