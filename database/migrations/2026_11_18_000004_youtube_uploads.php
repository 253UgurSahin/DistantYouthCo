<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Direct upload to YouTube: what a release knows of its video there, and the upload in progress. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('releases', function (Blueprint $table) {
            $table->string('youtube_video_id', 20)->nullable();
            $table->string('youtube_privacy', 10)->nullable();
            $table->string('youtube_publish_at', 30)->nullable();
        });
        Schema::create('youtube_uploads', function (Blueprint $table) {
            $table->foreignId('release_id')->primary()->constrained()->cascadeOnDelete();
            $table->text('session_url')->nullable();
            $table->unsignedBigInteger('size');
            $table->unsignedBigInteger('sent')->default(0);
            $table->string('state', 16); // uploading, thumbnail, done, failed
            $table->string('privacy', 10);
            $table->string('publish_at', 30)->nullable();
            $table->string('video_id', 20)->nullable();
            $table->text('warnings')->nullable();
            $table->text('error')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('youtube_uploads');
        Schema::table('releases', function (Blueprint $table) {
            $table->dropColumn(['youtube_video_id', 'youtube_privacy', 'youtube_publish_at']);
        });
    }
};
