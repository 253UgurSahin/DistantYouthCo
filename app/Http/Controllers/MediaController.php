<?php

namespace App\Http\Controllers;

use App\Exceptions\ApiError;
use App\Http\Controllers\Api\ReleaseController;
use App\Support\Input;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/** The files of a release for the player and for downloading: with ranges, so seeking works. */
class MediaController extends Controller
{
    public function show(Request $request, string $id, string $kind): BinaryFileResponse
    {
        $release = ReleaseController::find($request, $id);
        $file = match ($kind) {
            'audio' => $release->filePath('mp3') ?? $release->filePath('wav'),
            'wav', 'mp3', 'video', 'cover' => $release->filePath($kind),
            default => null,
        } ?? throw ApiError::notFound();
        $headers = ['Cache-Control' => 'private, max-age=3600'];
        if ($request->query('download') === '1') {
            return response()->download($file, Str::slug($release->title).'-'.$kind.'.'.pathinfo($file, PATHINFO_EXTENSION), $headers);
        }

        return response()->file($file, $headers);
    }
}
