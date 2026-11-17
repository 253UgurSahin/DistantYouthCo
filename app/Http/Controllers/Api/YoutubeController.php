<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\ApiError;
use App\Http\Controllers\Controller;
use App\Http\Resources\ReleaseResource;
use App\Models\Release;
use App\Models\Setting;
use App\Services\YoutubeKit;
use App\Support\Input;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** The YouTube kit of a release: make the texts (Claude or the template), or save them as edited. */
class YoutubeController extends Controller
{
    public function generate(Request $request, string $id, YoutubeKit $kit): JsonResponse
    {
        $release = Release::find(Input::id($id)) ?? throw ApiError::notFound('Release niet gevonden.');
        $out = $kit->generate($release, Setting::current(), $request->input('mode') !== 'template', Input::text($request->input('extra'), 1000, 'Extra wensen'));
        $release->forceFill([
            'yt_title' => $out['title'],
            'yt_description' => $out['description'],
            'yt_tags' => $out['tags'],
            'yt_generated_with' => $out['generated_with'],
            'bpm' => $release->bpm ?? $out['bpm'],
        ])->save();

        return response()->json(['release' => new ReleaseResource($release->fresh('folder')), 'generated_with' => $out['generated_with']]);
    }

    public function save(Request $request, string $id): JsonResponse
    {
        $release = Release::find(Input::id($id)) ?? throw ApiError::notFound('Release niet gevonden.');
        $release->forceFill([
            'yt_title' => Input::text($request->input('yt_title'), 300, 'Titel'),
            'yt_description' => Input::text($request->input('yt_description'), 10000, 'Beschrijving'),
            'yt_tags' => Input::text($request->input('yt_tags'), 2000, 'Tags'),
        ])->save();
        $release->touch();

        return response()->json(['release' => new ReleaseResource($release->fresh('folder'))]);
    }
}
