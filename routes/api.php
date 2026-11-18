<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\FolderController;
use App\Http\Controllers\Api\PlaylistController;
use App\Http\Controllers\Api\ReleaseController;
use App\Http\Controllers\Api\SettingController;
use App\Http\Controllers\Api\StatsController;
use App\Http\Controllers\Api\UploadController;
use App\Http\Controllers\Api\UserController;
use App\Http\Controllers\Api\YoutubeController;
use App\Http\Controllers\Api\YoutubeUploadController;
use App\Http\Controllers\DownloadController;
use Illuminate\Support\Facades\Route;

// Everything here answers JSON under /api. A change needs the app's header (RequireAppHeader).

Route::get('/session', [AuthController::class, 'session']);
Route::post('/setup', [AuthController::class, 'setup']);
Route::post('/login', [AuthController::class, 'login']);
Route::post('/logout', [AuthController::class, 'logout']);

// Everyone who is signed in: listening, collections, playlists, the dashboard.
Route::middleware('signed.in')->group(function () {
    Route::post('/me/password', [AuthController::class, 'password']);

    Route::get('/releases', [ReleaseController::class, 'index']);
    Route::get('/releases/{id}', [ReleaseController::class, 'show']);

    Route::get('/folders', [FolderController::class, 'index']);
    Route::get('/folders/{id}', [FolderController::class, 'show']);

    Route::get('/playlists', [PlaylistController::class, 'index']);
    Route::post('/playlists', [PlaylistController::class, 'store']);
    Route::get('/playlists/{id}', [PlaylistController::class, 'show']);
    Route::put('/playlists/{id}', [PlaylistController::class, 'update']);
    Route::delete('/playlists/{id}', [PlaylistController::class, 'destroy']);
    Route::post('/playlists/{id}/items', [PlaylistController::class, 'addItem']);
    Route::delete('/playlists/{id}/items/{releaseId}', [PlaylistController::class, 'removeItem']);
    Route::put('/playlists/{id}/order', [PlaylistController::class, 'order']);
    Route::post('/playlists/{id}/suggest-names', [PlaylistController::class, 'suggestNames']);

    Route::get('/stats', [StatsController::class, 'index']);
});

// The admin: accounts, settings, uploading and managing releases and collections.
Route::middleware('admin')->group(function () {
    Route::get('/users', [UserController::class, 'index']);
    Route::post('/users', [UserController::class, 'store']);
    Route::post('/users/{id}/password', [UserController::class, 'password']);
    Route::delete('/users/{id}', [UserController::class, 'destroy']);

    Route::get('/settings', [SettingController::class, 'show']);
    Route::put('/settings', [SettingController::class, 'update']);

    Route::post('/uploads', [UploadController::class, 'start']);
    Route::get('/uploads/{token}', [UploadController::class, 'show']);
    Route::post('/uploads/{token}', [UploadController::class, 'append']);

    Route::post('/releases', [ReleaseController::class, 'store']);
    Route::put('/releases/{id}', [ReleaseController::class, 'update']);
    Route::delete('/releases/{id}', [ReleaseController::class, 'destroy']);
    Route::post('/releases/{id}/status', [ReleaseController::class, 'status']);
    Route::post('/releases/{id}/restore', [ReleaseController::class, 'restore']);
    Route::post('/releases/{id}/youtube', [YoutubeController::class, 'generate']);
    Route::put('/releases/{id}/youtube', [YoutubeController::class, 'save']);

    // Direct upload to YouTube
    Route::get('/youtube', [YoutubeUploadController::class, 'status']);
    Route::post('/youtube/connect', [YoutubeUploadController::class, 'connect']);
    Route::delete('/youtube/connection', [YoutubeUploadController::class, 'disconnect']);
    Route::get('/releases/{id}/youtube-upload', [YoutubeUploadController::class, 'show']);
    Route::post('/releases/{id}/youtube-upload', [YoutubeUploadController::class, 'start']);
    Route::post('/releases/{id}/youtube-upload/step', [YoutubeUploadController::class, 'step']);
    Route::post('/releases/{id}/youtube-sync', [YoutubeUploadController::class, 'sync']);

    Route::get('/downloads', [DownloadController::class, 'index']);

    Route::post('/folders', [FolderController::class, 'store']);
    Route::put('/folders/{id}', [FolderController::class, 'update']);
    Route::delete('/folders/{id}', [FolderController::class, 'destroy']);
    Route::post('/folders/{id}/suggest-names', [FolderController::class, 'suggestNames']);
});
