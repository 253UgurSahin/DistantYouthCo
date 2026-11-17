<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Storage;

/** A file on its way up, in pieces. */
class Upload extends Model
{
    protected $primaryKey = 'token';
    public $incrementing = false;
    protected $keyType = 'string';
    protected $fillable = ['token', 'name', 'size', 'received'];

    protected function casts(): array
    {
        return ['size' => 'integer', 'received' => 'integer'];
    }

    public function partPath(): string
    {
        $dir = config('studio.uploads_path');
        Storage::disk('local')->makeDirectory($dir);

        return Storage::disk('local')->path($dir.'/'.$this->token.'.part');
    }

    public function isComplete(): bool
    {
        clearstatcache(true, $this->partPath());

        return $this->received === $this->size && is_file($this->partPath()) && filesize($this->partPath()) === $this->size;
    }
}
