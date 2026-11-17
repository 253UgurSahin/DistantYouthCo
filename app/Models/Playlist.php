<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

/** A playlist of one account: private, or shared with every account. */
class Playlist extends Model
{
    protected $fillable = ['user_id', 'name', 'description', 'is_public'];

    protected function casts(): array
    {
        return ['is_public' => 'boolean', 'user_id' => 'integer'];
    }

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    public function releases(): BelongsToMany
    {
        return $this->belongsToMany(Release::class)->withPivot('position')->orderBy('playlist_release.position');
    }

    public function canBeSeenBy(User $user): bool
    {
        return $this->is_public || $this->user_id === $user->id || $user->isAdmin();
    }

    public function canBeEditedBy(User $user): bool
    {
        return $this->user_id === $user->id || $user->isAdmin();
    }
}
