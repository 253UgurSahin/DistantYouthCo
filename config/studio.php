<?php

// Settings of Distant Youth Studio itself (the framework's own live in the other files here).
return [
    // major.minor.patch, from the VERSION file in the project root (see CLAUDE.md).
    'version' => trim((string) @file_get_contents(base_path('VERSION'))) ?: '0.0.0',

    'claude_model' => env('CLAUDE_MODEL', 'claude-opus-5-5'),
    'anthropic_api_key' => env('ANTHROPIC_API_KEY', ''),
    'anthropic_base_url' => env('ANTHROPIC_BASE_URL', 'https://api.anthropic.com'),

    'trust_proxy' => (bool) env('TRUST_PROXY', false),

    // A single file may be up to 4 GB (one byte under, so the ZIP of videos stays simple).
    'max_upload' => 4294967295,

    // Where the release files live, below storage/app/private.
    'releases_path' => 'releases',
    'uploads_path' => 'uploads',
];
