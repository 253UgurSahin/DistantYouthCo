<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\ApiError;
use App\Http\Controllers\Controller;
use App\Services\Uploads;
use App\Support\Input;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Large files in pieces: start, ask how far it is, send the next piece. */
class UploadController extends Controller
{
    public function __construct(private readonly Uploads $uploads) {}

    public function start(Request $request): JsonResponse
    {
        $size = $request->input('size');
        if (! is_int($size) || $size < 1 || $size > config('studio.max_upload')) {
            throw ApiError::bad('Een bestand mag tot 4 GB zijn.');
        }
        $name = is_string($request->input('name')) ? Input::text($request->input('name'), 255, 'Naam') : '';
        $upload = $this->uploads->start($name ?: 'bestand', $size);

        return response()->json(['token' => $upload->token, 'chunk' => Input::uploadChunk()], 201);
    }

    public function show(string $token): JsonResponse
    {
        $u = Uploads::find($token);

        return response()->json(['received' => $u->received, 'size' => $u->size]);
    }

    public function append(Request $request, string $token): JsonResponse
    {
        $upload = Uploads::find($token);
        $offset = $request->query('offset');
        if (! is_string($offset) || ! preg_match('/^\d+$/', $offset)) {
            throw ApiError::bad('Ongeldige positie.');
        }

        return response()->json(['received' => $this->uploads->append($upload, (int) $offset, $request->getContent(true))]);
    }
}
