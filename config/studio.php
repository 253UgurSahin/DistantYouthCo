<?php

// Settings of Distant Youth Studio itself (the framework's own live in the other files here).
return [
    // major.minor.patch, from the VERSION file in the project root (see CLAUDE.md).
    'version' => trim((string) @file_get_contents(base_path('VERSION'))) ?: '0.0.0',

    'claude_model' => env('CLAUDE_MODEL', 'claude-opus-5-5'),
    'anthropic_api_key' => env('ANTHROPIC_API_KEY', ''),
    'anthropic_base_url' => env('ANTHROPIC_BASE_URL', 'https://api.anthropic.com'),

    'trust_proxy' => (bool) env('TRUST_PROXY', false),

    // Direct upload to YouTube: the OAuth client of the artist's own Google Cloud project (or set in
    // the app under Instellingen). The Google addresses can be changed for tests only.
    'youtube_client_id' => env('YOUTUBE_CLIENT_ID', ''),
    'youtube_client_secret' => env('YOUTUBE_CLIENT_SECRET', ''),
    'google_auth_url' => env('GOOGLE_AUTH_URL', 'https://accounts.google.com/o/oauth2/v2/auth'),
    'google_token_url' => env('GOOGLE_TOKEN_URL', 'https://oauth2.googleapis.com/token'),
    'google_revoke_url' => env('GOOGLE_REVOKE_URL', 'https://oauth2.googleapis.com/revoke'),
    'youtube_api_url' => env('YOUTUBE_API_URL', 'https://www.googleapis.com/youtube/v3'),
    'youtube_upload_url' => env('YOUTUBE_UPLOAD_URL', 'https://www.googleapis.com/upload/youtube/v3'),
    // One step of the upload sends this much (a multiple of 256 KB, as YouTube asks), well within the
    // time a shared host gives one request.
    'youtube_chunk' => (int) env('YOUTUBE_CHUNK_BYTES', 8 * 1024 * 1024),

    // A single file may be up to 4 GB (one byte under, so the ZIP of videos stays simple).
    'max_upload' => 4294967295,

    // Where the release files live, below storage/app/private.
    'releases_path' => 'releases',
    'uploads_path' => 'uploads',
];
