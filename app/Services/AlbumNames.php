<?php

namespace App\Services;

use Illuminate\Support\Collection;

/** Claude proposes album, EP or playlist names from the tracks themselves. */
class AlbumNames
{
    private const SCHEMA = [
        'type' => 'object',
        'additionalProperties' => false,
        'required' => ['suggestions'],
        'properties' => [
            'suggestions' => [
                'type' => 'array',
                'description' => 'Five album, EP or playlist names, best first.',
                'items' => [
                    'type' => 'object',
                    'additionalProperties' => false,
                    'required' => ['name', 'why'],
                    'properties' => [
                        'name' => ['type' => 'string', 'description' => 'The name itself, without quotes. At most 40 characters.'],
                        'why' => ['type' => 'string', 'description' => 'One short sentence in Dutch: which shared thread in the tracks it comes from.'],
                    ],
                ],
            ],
        ],
    ];

    private const SYSTEM = 'You name albums, EPs and playlists for the electronic music artist Distant Youth Co.
The brand is a night scene: a figure on a wooden pier over a still lake, mountains, a crescent moon,
stars; black and white; quiet, distant, nostalgic. The music is mostly melodic bass and dubstep.

You receive the tracks of one collection: titles, style descriptions and lyrics. Find what really
connects them (images that come back in the lyrics, a mood, an instrument, a place, a time of night)
and propose names that come from that thread.

- Names are in English unless the artist asks otherwise. Short: one to four words.
- Each name must come from the tracks themselves; do not reuse a track title unless it clearly
  fits the whole collection, and then say so.
- Avoid clichés ("Journey", "Odyssey", "Vibes", "Chronicles") and anything that sounds like an
  existing famous album.
- The "why" is one short sentence in Dutch naming the shared thread.';

    public function __construct(private readonly Claude $claude) {}

    /** @param Collection<int, \App\Models\Release> $releases */
    public function suggest(array $settings, string $collection, Collection $releases, string $direction): array
    {
        $tracks = $releases->values()->map(fn ($r, $i) => implode("\n", [
            '<track n="'.($i + 1).'">',
            "<title>{$r->title}</title>",
            '<style>'.($r->style ?: '-').'</style>',
            "<lyrics>\n".mb_substr($r->lyrics ?: '(instrumental)', 0, 6000)."\n</lyrics>",
            '</track>',
        ]))->implode("\n\n");
        $user = implode("\n\n", array_filter([
            "<current_name>$collection</current_name>",
            $tracks,
            $direction !== '' ? "<direction_from_artist>$direction</direction_from_artist>" : '',
        ]));
        [$data, $model] = $this->claude->json($settings, self::SYSTEM, $user, self::SCHEMA);
        $out = collect($data['suggestions'] ?? [])
            ->filter(fn ($s) => is_array($s) && is_string($s['name'] ?? null) && trim($s['name']) !== '')
            ->take(5)
            ->map(fn ($s) => ['name' => mb_substr(trim($s['name']), 0, 60), 'why' => trim((string) ($s['why'] ?? ''))])
            ->values()->all();

        return ['suggestions' => $out, 'model' => $model];
    }
}
