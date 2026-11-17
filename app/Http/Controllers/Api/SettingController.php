<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Setting;
use App\Services\Claude;
use App\Support\Input;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** The fixed parts of every YouTube description and the Claude key. The key is never sent back. */
class SettingController extends Controller
{
    public function show(Claude $claude): JsonResponse
    {
        $s = Setting::current();
        $saved = $s['anthropic_api_key'] !== '';
        $configured = $claude->configured($s);
        unset($s['anthropic_api_key']);

        return response()->json(['settings' => $s, 'claude' => ['configured' => $configured, 'key_saved' => $saved, 'from_env' => ! $saved && $configured]]);
    }

    public function update(Request $request): JsonResponse
    {
        $values = [];
        foreach (array_keys(Setting::DEFAULTS) as $key) {
            if ($key === 'anthropic_api_key' || ! $request->exists($key)) {
                continue;
            }
            $values[$key] = str_ends_with($key, '_url') ? Input::urlOrEmpty($request->input($key), $key) : Input::text($request->input($key), 2000, $key);
        }
        $apiKey = $request->input('anthropic_api_key');
        if (is_string($apiKey) && trim($apiKey) !== '') {
            $values['anthropic_api_key'] = Input::text($apiKey, 300, 'API key');
        }
        if ($request->input('clear_api_key') === true) {
            $values['anthropic_api_key'] = '';
        }
        Setting::put($values);

        return response()->json(['ok' => true]);
    }
}
