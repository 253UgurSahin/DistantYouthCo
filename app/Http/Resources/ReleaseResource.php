<?php

namespace App\Http\Resources;

use App\Models\Release;
use App\Support\Input;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Release */
class ReleaseResource extends JsonResource
{
    public static $wrap = null;

    public function toArray(Request $request): array
    {
        $v = rawurlencode((string) $this->updated_at?->format('Y-m-d H:i:s'));
        $out = [
            'id' => $this->id,
            'title' => $this->title,
            'style' => $this->style,
            'lyrics' => $this->lyrics,
            'bpm' => $this->bpm,
            'release_date' => $this->release_date ? substr((string) $this->release_date, 0, 10) : null,
            'video_type' => $this->video_type,
            'duration' => $this->duration,
            'folder_id' => $this->folder_id,
            'folder_name' => $this->folder?->name,
            'youtube_url' => $this->youtube_url,
            // The video from YouTube, where there is no MP4 of its own (or as well as one).
            'youtube_id' => Input::youtubeId($this->youtube_url),
            'spotify_url' => $this->spotify_url,
            'on_youtube' => $this->on_youtube,
            'on_spotify' => $this->on_spotify,
            'status' => $this->status(),
            'youtube_state' => $this->youtubeState(),
            'has' => ['wav' => (bool) $this->wav_file, 'mp3' => (bool) $this->mp3_file, 'video' => (bool) $this->video_file, 'cover' => (bool) $this->cover_file],
            'mp3_generated' => $this->mp3_generated,
            'cover_generated' => $this->cover_generated,
            'processing' => false,
            'audio_url' => $this->mp3_file || $this->wav_file ? "/media/{$this->id}/audio?v=$v" : null,
            'video_url' => $this->video_file ? "/media/{$this->id}/video?v=$v" : null,
            'cover_url' => $this->cover_file ? "/media/{$this->id}/cover?v=$v" : null,
            'created_at' => $this->created_at?->format('Y-m-d H:i:s'),
            'updated_at' => $this->updated_at?->format('Y-m-d H:i:s'),
        ];
        if ($request->user()?->isAdmin()) {
            $out += [
                'hidden' => $this->is_hidden,
                'notes' => $this->notes,
                'yt_title' => $this->yt_title,
                'yt_description' => $this->yt_description,
                'yt_tags' => $this->yt_tags,
                'yt_generated_with' => $this->yt_generated_with,
            ];
        }

        return $out;
    }
}
