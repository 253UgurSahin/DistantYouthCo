<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\ApiError;
use App\Http\Controllers\Controller;
use App\Http\Resources\FolderResource;
use App\Http\Resources\ReleaseResource;
use App\Models\Folder;
use App\Models\Setting;
use App\Services\AlbumNames;
use App\Support\Input;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Collections: everyone sees them, the admin makes and names them. */
class FolderController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $folders = Folder::query()->withCount(['releases as count' => fn ($q) => $q->visibleTo($user)])->orderBy('id')->get();

        return response()->json(['folders' => FolderResource::collection($folders)]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $folder = Folder::find(Input::id($id)) ?? throw ApiError::notFound('Collectie niet gevonden.');
        $releases = ReleaseController::visible($request)->where('folder_id', $folder->id)->get();
        $folder->count = $releases->count();

        return response()->json(['folder' => (new FolderResource($folder))->resolve($request) + ['releases' => ReleaseResource::collection($releases)->resolve($request)]]);
    }

    public function store(Request $request): JsonResponse
    {
        $folder = Folder::create($this->fields($request));

        return response()->json(['folder' => new FolderResource($folder)], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $fields = $this->fields($request);
        $folder = Folder::find(Input::id($id)) ?? throw ApiError::notFound('Collectie niet gevonden.');
        $folder->update($fields);

        return response()->json(['ok' => true]);
    }

    public function destroy(string $id): JsonResponse
    {
        $folder = Folder::find(Input::id($id)) ?? throw ApiError::notFound('Collectie niet gevonden.');
        $folder->delete();

        return response()->json(['ok' => true]);
    }

    public function suggestNames(Request $request, string $id, AlbumNames $names): JsonResponse
    {
        $folder = Folder::find(Input::id($id)) ?? throw ApiError::notFound('Collectie niet gevonden.');
        $releases = ReleaseController::visible($request)->where('folder_id', $folder->id)->get();
        if ($releases->isEmpty()) {
            throw ApiError::bad('Deze collectie heeft nog geen nummers.');
        }

        return response()->json($names->suggest(Setting::current(), $folder->name, $releases, Input::text($request->input('direction'), 300, 'Richting')));
    }

    private function fields(Request $request): array
    {
        $name = Input::text($request->input('name'), 120, 'Naam');
        if ($name === '') {
            throw ApiError::bad('Geef de collectie een naam.');
        }

        return ['name' => $name, 'description' => Input::text($request->input('description'), 1000, 'Omschrijving')];
    }
}
