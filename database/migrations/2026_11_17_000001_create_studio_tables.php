<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('folders', function (Blueprint $table) {
            $table->id();
            $table->string('name', 120);
            $table->text('description')->nullable();
            $table->timestamps();
        });

        Schema::create('releases', function (Blueprint $table) {
            $table->id();
            $table->foreignId('folder_id')->nullable()->constrained()->nullOnDelete();
            $table->string('title', 200);
            $table->text('style')->nullable();
            $table->text('lyrics')->nullable();
            $table->unsignedSmallInteger('bpm')->nullable();
            $table->date('release_date')->nullable();
            $table->string('video_type', 60)->default('Official Visualizer');
            $table->boolean('is_hidden')->default(false); // a concept: listeners do not see it
            $table->text('notes')->nullable();
            // Stored file names inside storage/app/private/releases/{id}/
            $table->string('wav_file')->nullable();
            $table->string('mp3_file')->nullable();
            $table->boolean('mp3_generated')->default(false);
            $table->string('video_file')->nullable();
            $table->string('cover_file')->nullable();
            $table->boolean('cover_generated')->default(false);
            $table->float('duration')->nullable();
            // The YouTube kit
            $table->string('yt_title', 300)->default('');
            $table->text('yt_description')->nullable();
            $table->text('yt_tags')->nullable();
            $table->string('yt_generated_with', 80)->default('');
            // Where it is live
            $table->string('youtube_url', 500)->default('');
            $table->string('spotify_url', 500)->default('');
            $table->boolean('on_youtube')->default(false);
            $table->boolean('on_spotify')->default(false);
            $table->timestamps();
        });

        Schema::create('playlists', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete(); // the owner
            $table->string('name', 120);
            $table->text('description')->nullable();
            $table->boolean('is_public')->default(false);
            $table->timestamps();
        });

        Schema::create('playlist_release', function (Blueprint $table) {
            $table->foreignId('playlist_id')->constrained()->cascadeOnDelete();
            $table->foreignId('release_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('position');
            $table->primary(['playlist_id', 'release_id']);
        });

        Schema::create('settings', function (Blueprint $table) {
            $table->string('key', 64)->primary();
            $table->text('value');
        });

        // Large files arrive in pieces (a shared host's upload limit is far below a WAV or a video).
        Schema::create('uploads', function (Blueprint $table) {
            $table->string('token', 32)->primary();
            $table->string('name');
            $table->unsignedBigInteger('size');
            $table->unsignedBigInteger('received')->default(0);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        foreach (['uploads', 'settings', 'playlist_release', 'playlists', 'releases', 'folders'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
