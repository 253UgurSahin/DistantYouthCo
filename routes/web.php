<?php

use App\Http\Controllers\DownloadController;
use App\Http\Controllers\MediaController;
use Illuminate\Support\Facades\Route;

// The app itself: one page; every screen after it is drawn in the browser (public/js).
Route::get('/', fn () => response()->view('app')->header('Cache-Control', 'no-cache'));

// The files of a release (player, download) and all videos as one ZIP.
Route::get('/media/{id}/{kind}', [MediaController::class, 'show'])->middleware('signed.in');
Route::get('/downloads/videos.zip', [DownloadController::class, 'zip'])->middleware('admin');
