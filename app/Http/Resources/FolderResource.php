<?php

namespace App\Http\Resources;

use App\Models\Folder;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** A collection with its count, total length and up to three covers (of releases everyone may see). @mixin Folder */
class FolderResource extends JsonResource
{
    public static $wrap = null;

    public function toArray(Request $request): array
    {
        $visible = $this->releases()->where('is_hidden', false)->orderByDesc('id')->get(['id', 'cover_file', 'updated_at', 'duration']);

        return [
            'id' => $this->id,
            'name' => $this->name,
            'description' => $this->description,
            'count' => $this->count ?? $visible->count(),
            'duration' => (float) $visible->sum('duration'),
            'covers' => $visible->filter(fn ($r) => $r->cover_file)->take(3)
                ->map(fn ($r) => "/media/{$r->id}/cover?v=".rawurlencode((string) $r->updated_at?->format('Y-m-d H:i:s')))->values()->all(),
        ];
    }
}
