<?php

namespace App\Http\Resources;

use App\Models\Playlist;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** A playlist; with its releases when they are loaded (the page of one playlist). @mixin Playlist */
class PlaylistResource extends JsonResource
{
    public static $wrap = null;

    public function toArray(Request $request): array
    {
        $user = $request->user();
        // The releases this viewer may see, when the controller loaded them (the page of one playlist).
        $list = $this->relationLoaded('visible') ? $this->getRelation('visible') : null;
        $out = [
            'id' => $this->id,
            'name' => $this->name,
            'description' => $this->description,
            'is_public' => $this->is_public,
            'owner' => $this->owner?->username,
            'mine' => $this->user_id === $user->id,
            'can_edit' => $this->canBeEditedBy($user),
            'count' => $list !== null ? $list->count() : (int) ($this->releases_count ?? 0),
        ];
        if ($list !== null) {
            $out['duration'] = (float) $list->sum('duration');
            $out['releases'] = ReleaseResource::collection($list)->resolve($request);
        }

        return $out;
    }
}
