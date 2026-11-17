<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Support\Facades\Storage;

/** One release: its files, its texts and where it is live. */
class Release extends Model
{
    public const FILE_COLUMNS = ['wav' => 'wav_file', 'mp3' => 'mp3_file', 'video' => 'video_file', 'cover' => 'cover_file'];

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'is_hidden' => 'boolean',
            'mp3_generated' => 'boolean',
            'cover_generated' => 'boolean',
            'on_youtube' => 'boolean',
            'on_spotify' => 'boolean',
            'bpm' => 'integer',
            'duration' => 'float',
            'folder_id' => 'integer',
        ];
    }

    public function folder(): BelongsTo
    {
        return $this->belongsTo(Folder::class);
    }

    public function playlists(): BelongsToMany
    {
        return $this->belongsToMany(Playlist::class)->withPivot('position');
    }

    /** Listeners never see a release marked as concept. */
    public function scopeVisibleTo(Builder $q, ?User $user): Builder
    {
        return $user?->isAdmin() ? $q : $q->where('is_hidden', false);
    }

    /** Newest first: by release date, else by the day it was added. */
    public function scopeNewestFirst(Builder $q): Builder
    {
        return $q->orderByRaw('COALESCE(release_date, substr(created_at, 1, 10)) DESC')->orderByDesc('id');
    }

    /** none, ready (video and text, waiting for YouTube) or live. */
    public function youtubeState(): string
    {
        if ($this->on_youtube) {
            return 'live';
        }

        return $this->video_file && $this->yt_description ? 'ready' : 'none';
    }

    /** The moon: concept (new), ready for YouTube (waxing), live (full). */
    public function status(): string
    {
        if ($this->youtubeState() === 'ready') {
            return 'ready';
        }

        return $this->on_youtube || $this->on_spotify ? 'live' : 'concept';
    }

    public function directory(): string
    {
        return config('studio.releases_path').'/'.$this->id;
    }

    /** The absolute path of one of its files, or null when it is not there. */
    public function filePath(string $kind): ?string
    {
        $name = $this->{self::FILE_COLUMNS[$kind] ?? ''} ?? null;
        if (! is_string($name) || ! preg_match('/^[a-z0-9]+\.[a-z0-9]+$/', $name)) {
            return null;
        }
        $path = Storage::disk('local')->path($this->directory().'/'.$name);

        return is_file($path) ? $path : null;
    }

    public function deleteFiles(): void
    {
        Storage::disk('local')->deleteDirectory($this->directory());
    }
}
