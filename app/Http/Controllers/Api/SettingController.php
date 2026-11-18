<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Setting;
use App\Exceptions\ApiError;
use App\Services\Claude;
use App\Services\YoutubeApi;
use App\Support\Input;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** The fixed parts of every YouTube description and the Claude key. The key is never sent back. */
class SettingController extends Controller
{
    /** Set by the app itself (the YouTube connection), never through this form. */
    private const INTERNAL = ['youtube_refresh_token', 'youtube_channel_id', 'youtube_channel_title'];

    public function show(Claude $claude): JsonResponse
    {
        $s = Setting::current();
        $saved = $s['anthropic_api_key'] !== '';
        $configured = $claude->configured($s);
        $secretSaved = $s['youtube_client_secret'] !== '';
        foreach ([...Setting::SECRETS, ...self::INTERNAL] as $hidden) {
            unset($s[$hidden]);
        }

        return response()->json(['settings' => $s, 'claude' => ['configured' => $configured, 'key_saved' => $saved, 'from_env' => ! $saved && $configured],
            'youtube_secret_saved' => $secretSaved]);
    }

    public function update(Request $request, YoutubeApi $yt): JsonResponse
    {
        $before = Setting::current();
        $values = [];
        foreach (array_keys(Setting::DEFAULTS) as $key) {
            if (in_array($key, [...Setting::SECRETS, ...self::INTERNAL], true) || ! $request->exists($key)) {
                continue;
            }
            $values[$key] = match (true) {
                str_ends_with($key, '_url') => Input::urlOrEmpty($request->input($key), $key),
                $key === 'youtube_default_privacy' => in_array($request->input($key), YoutubeApi::PRIVACY, true) ? $request->input($key) : throw ApiError::bad('Kies privé, verborgen of openbaar.'),
                $key === 'youtube_ai_label' => Input::bool($request->input($key)) ? '1' : '0',
                default => Input::text($request->input($key), 2000, $key),
            };
        }
        foreach (['anthropic_api_key' => 'API key', 'youtube_client_secret' => 'Client secret'] as $key => $name) {
            $v = $request->input($key);
            if (is_string($v) && trim($v) !== '') {
                $values[$key] = Input::text($v, 300, $name);
            }
        }
        if ($request->input('clear_api_key') === true) {
            $values['anthropic_api_key'] = '';
        }
        Setting::put($values);
        // Another OAuth client: the old connection belongs to the old one.
        if (isset($values['youtube_client_id']) && $values['youtube_client_id'] !== $before['youtube_client_id'] && $before['youtube_refresh_token'] !== '') {
            $yt->forget();
        }

        return response()->json(['ok' => true]);
    }
}
