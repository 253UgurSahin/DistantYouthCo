<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** An upload of a release's MP4 to YouTube, sent piece by piece (one browser request per piece). */
class YoutubeUpload extends Model
{
    protected $primaryKey = 'release_id';
    public $incrementing = false;
    protected $guarded = [];
    protected $casts = ['warnings' => 'array', 'size' => 'integer', 'sent' => 'integer'];

    public const ACTIVE = ['uploading', 'thumbnail'];

    public function isActive(): bool
    {
        return in_array($this->state, self::ACTIVE, true);
    }

    /** What the browser sees: never the session address (it is a credential of its own). */
    public function toPublic(): array
    {
        return [
            'state' => $this->state,
            'size' => $this->size,
            'sent' => $this->sent,
            'progress' => $this->size ? round($this->sent / $this->size, 4) : 0,
            'privacy' => $this->privacy,
            'publish_at' => $this->publish_at,
            'video_id' => $this->video_id,
            'url' => $this->video_id ? "https://youtu.be/{$this->video_id}" : null,
            'studio_url' => $this->video_id ? "https://studio.youtube.com/video/{$this->video_id}/edit" : null,
            'warnings' => $this->warnings ?? [],
            'error' => $this->error,
        ];
    }
}
