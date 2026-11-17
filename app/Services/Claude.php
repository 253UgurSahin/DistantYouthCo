<?php

namespace App\Services;

use App\Exceptions\ApiError;
use App\Support\Input;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

/** One request to the Claude API that must come back as JSON matching a schema. */
class Claude
{
    public function key(array $settings): string
    {
        return (string) ($settings['anthropic_api_key'] ?: config('studio.anthropic_api_key'));
    }

    public function configured(array $settings): bool
    {
        return $this->key($settings) !== '';
    }

    /** @return array{0: array, 1: string} the parsed answer and the model that wrote it */
    public function json(array $settings, string $system, string $user, array $schema, string $effort = 'medium'): array
    {
        if (! $this->configured($settings)) {
            throw new ApiError(409, 'Claude is niet ingesteld. Voeg een API key toe bij Instellingen.');
        }
        Input::moreTime(330);
        try {
            $res = Http::withHeaders([
                'x-api-key' => $this->key($settings),
                'anthropic-version' => '2023-06-01',
                'anthropic-beta' => 'server-side-fallback-2026-07-01',
            ])->connectTimeout(15)->timeout(300)->acceptJson()
                ->post(rtrim((string) config('studio.anthropic_base_url'), '/').'/v1/messages?beta=true', [
                    'model' => config('studio.claude_model'),
                    'max_tokens' => 16000,
                    'fallbacks' => 'default',
                    'output_config' => ['effort' => $effort, 'format' => ['type' => 'json_schema', 'schema' => $schema]],
                    'system' => $system,
                    'messages' => [['role' => 'user', 'content' => $user]],
                ]);
        } catch (ConnectionException) {
            throw new ApiError(502, 'Kan de Claude API niet bereiken (netwerk).');
        }
        match (true) {
            $res->status() === 401 => throw new ApiError(502, 'De Claude API key is ongeldig. Controleer Instellingen.'),
            $res->status() === 403 => throw new ApiError(502, 'Deze Claude API key heeft geen toegang tot dit model.'),
            $res->status() === 429 => throw new ApiError(502, 'Claude heeft even te veel verzoeken gehad. Probeer het zo opnieuw.'),
            ! $res->successful() => throw new ApiError(502, "Claude API gaf een fout ({$res->status()})."),
            default => null,
        };
        $body = $res->json();
        if (! is_array($body)) {
            throw new ApiError(502, 'Kon het antwoord van Claude niet lezen. Probeer opnieuw.');
        }
        if (($body['stop_reason'] ?? '') === 'refusal') {
            throw new ApiError(502, 'Claude wilde dit niet schrijven. Pas de tekst aan of gebruik het template.');
        }
        if (($body['stop_reason'] ?? '') === 'max_tokens') {
            throw new ApiError(502, 'Het antwoord werd te lang en is afgebroken. Probeer opnieuw.');
        }
        $text = collect($body['content'] ?? [])->where('type', 'text')->pluck('text')->implode('');
        $data = json_decode($text, true);
        if (! is_array($data)) {
            throw new ApiError(502, 'Kon het antwoord van Claude niet lezen. Probeer opnieuw.');
        }

        return [$data, (string) ($body['model'] ?? config('studio.claude_model'))];
    }
}
