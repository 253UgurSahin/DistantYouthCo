<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** A collection ("collectie"): an album or EP in the making. */
class Folder extends Model
{
    protected $fillable = ['name', 'description'];

    public function releases(): HasMany
    {
        return $this->hasMany(Release::class);
    }
}
