<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\ApiError;
use App\Http\Controllers\Controller;
use App\Http\Resources\PlaylistResource;
use App\Models\Playlist;
use App\Models\Setting;
use App\Services\AlbumNames;
use App\Support\Input;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/** Playlists: everyone makes their own, private or shared; only the owner (or the admin) changes one. */
class PlaylistController extends Controller
{
    /** A private playlist of someone else answers 404, as if it does not exist. */
    private function find(Request $request, string|int $id): Playlist
    {
        $p = Playlist::with('owner')->find(Input::id($id));
        if (! $p || ! $p->canBeSeenBy($request->user())) {
            throw ApiError::notFound('Playlist niet gevonden.');
        }

        return $p;
    }

    private function editable(Request $request, string|int $id): Playlist
    {
        $p = $this->find($request, $id);
        if (! $p->canBeEditedBy($request->user())) {
            throw new ApiError(403, 'Alleen de maker kan deze playlist aanpassen.');
        }

        return $p;
    }

    private function visibleReleases(Request $request, Playlist $p): Collection
    {
        $q = $p->releases()->with('folder');
        if (! $request->user()->isAdmin()) {
            $q->where('releases.is_hidden', false);
        }

        return $q->get();
    }

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $lists = Playlist::with('owner')->withCount('releases')
            ->where(fn ($q) => $q->where('user_id', $user->id)->orWhere('is_public', true))
            ->orderBy('id')->get();

        return response()->json(['playlists' => PlaylistResource::collection($lists)]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $p = $this->find($request, $id);
        $p->setRelation('visible', $this->visibleReleases($request, $p));

        return response()->json(['playlist' => new PlaylistResource($p)]);
    }

    public function store(Request $request): JsonResponse
    {
        $p = Playlist::create(['user_id' => $request->user()->id] + $this->fields($request));

        return response()->json(['playlist' => ['id' => $p->id, 'name' => $p->name]], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $p = $this->editable($request, $id);
        $p->update($this->fields($request));

        return response()->json(['ok' => true]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $this->editable($request, $id)->delete();

        return response()->json(['ok' => true]);
    }

    public function addItem(Request $request, string $id): JsonResponse
    {
        $p = $this->editable($request, $id);
        $releaseId = $request->input('release_id');
        $release = ReleaseController::find($request, is_int($releaseId) ? $releaseId : (string) $releaseId);
        if (! $p->releases()->whereKey($release->id)->exists()) {
            $next = (int) DB::table('playlist_release')->where('playlist_id', $p->id)->max('position') + 1;
            $p->releases()->attach($release->id, ['position' => $next]);
        }

        return response()->json(['ok' => true], 201);
    }

    public function removeItem(Request $request, string $id, string $releaseId): JsonResponse
    {
        $p = $this->editable($request, $id);
        $p->releases()->detach(Input::id($releaseId));

        return response()->json(['ok' => true]);
    }

    public function order(Request $request, string $id): JsonResponse
    {
        $p = $this->editable($request, $id);
        $ids = $request->input('release_ids');
        if (! is_array($ids) || ! array_is_list($ids) || count($ids) > 1000) {
            throw ApiError::bad('Ongeldige volgorde.');
        }
        DB::transaction(function () use ($ids, $p) {
            foreach ($ids as $i => $rid) {
                DB::table('playlist_release')->where('playlist_id', $p->id)->where('release_id', (int) $rid)->update(['position' => $i + 1]);
            }
        });

        return response()->json(['ok' => true]);
    }

    public function suggestNames(Request $request, string $id, AlbumNames $names): JsonResponse
    {
        $p = $this->editable($request, $id);
        $releases = $this->visibleReleases($request, $p);
        if ($releases->isEmpty()) {
            throw ApiError::bad('Deze playlist heeft nog geen nummers.');
        }

        return response()->json($names->suggest(Setting::current(), $p->name, $releases, Input::text($request->input('direction'), 300, 'Richting')));
    }

    private function fields(Request $request): array
    {
        $name = Input::text($request->input('name'), 120, 'Naam');
        if ($name === '') {
            throw ApiError::bad('Geef de playlist een naam.');
        }

        return [
            'name' => $name,
            'description' => Input::text($request->input('description'), 1000, 'Omschrijving'),
            'is_public' => Input::bool($request->input('is_public')),
        ];
    }
}
