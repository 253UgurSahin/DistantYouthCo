<?php
declare(strict_types=1);

// The YouTube kit and album names: the same rules and prompts as backend/node/youtube.js, claude.js and
// albumnames.js, so both servers write the same text.

const YT_LIMITS = ['title' => 100, 'description' => 5000, 'tags' => 500];

const EXAMPLE_DESCRIPTION = <<<'TXT'
# 🎵 Lanterns in the Rain — Distant Youth Co. (Official Visualizer)

*"Light it up, light it up, like lanterns in the rain."*

Lanterns in the Rain is a heavy melodic dubstep track about letting go of fear, embracing the moment, and finding light even when everything around you feels dark.

It begins with a whispered invitation to close your eyes and make a wish. Koto plucks introduce a delicate Japanese-inspired atmosphere, while the sound of midnight rain sets the scene for something magical.

Bright female vocals tell a story of paper hearts, whispered secrets and a fire that takes away the fear. Gentle verses gradually open into soaring, harmonized vocals, building towards an uplifting chorus that feels like watching hundreds of glowing lanterns rise into the night sky.

Then the energy takes over.

A powerful build-up transforms the simple words "Light it up" into a rhythmic vocal chant before the first drop explodes.

Gritty growl bass, distorted midrange layers, metallic screeches and massive half-time drums collide with traditional Japanese-inspired koto melodies. The result is a combination of beautiful melodic atmosphere and aggressive festival-scale dubstep.

But there's another surprise.

After the second chorus, the track switches direction completely. Heavy taiko percussion takes control in a powerful riddim-inspired section, bringing a darker and more rhythmic energy to the final moments.

Then everything fades away.

One last whisper:

Make a wish.

140 BPM · Heavy Melodic Dubstep · Japanese-Inspired Dubstep · Koto · Shakuhachi · Taiko Drums · Female Vocals · Growl Bass · Taiko Riddim

🎧 More from Distant Youth Co. on Spotify:
https://open.spotify.com/artist/7hbil2HXkg0OniGTxMUHeo

🧪 Made with AI — Suno AI (AI-assisted, human-directed).

For everyone who still finds a reason to shine, even in the darkest rain.

Light it up.

#dubstep #melodicdubstep #japanesedubstep #heavydubstep #taiko #koto #festivaldubstep #aimusic #sunoai #bassmusic #electronicmusic #distantyouthco
TXT;

// ---------- helpers ----------

function parse_lyrics(?string $lyrics): array {
    $sections = [];
    $cur = ['name' => '', 'lines' => []];
    foreach (preg_split('/\r?\n/', (string) $lyrics) as $raw) {
        if (preg_match('/^\s*[\[(]([^\])]+)[\])]\s*$/u', $raw, $m)) {
            if ($cur['lines'] || $cur['name'] !== '') $sections[] = $cur;
            $cur = ['name' => trim($m[1]), 'lines' => []];
        } elseif (trim($raw) !== '') {
            $cur['lines'][] = (string) preg_replace('/^[-–—]\s*/u', '', trim($raw));
        }
    }
    if ($cur['lines'] || $cur['name'] !== '') $sections[] = $cur;
    return $sections;
}

function find_hook_line(?string $lyrics): string {
    $sections = parse_lyrics($lyrics);
    foreach ($sections as $s) {
        if (preg_match('/chorus|hook|refrein/i', $s['name']) && $s['lines']) return $s['lines'][0];
    }
    $counts = [];
    foreach ($sections as $s) foreach ($s['lines'] as $l) $counts[$l] = ($counts[$l] ?? 0) + 1;
    $best = '';
    $bestCount = 0;
    foreach ($counts as $line => $c) if ($c > $bestCount) { $best = (string) $line; $bestCount = $c; }
    if ($bestCount > 1) return $best;
    foreach ($sections as $s) if ($s['lines']) return $s['lines'][0];
    return '';
}

function extract_bpm(?string $style): ?int {
    return preg_match('/(\d{2,3})\s*bpm/i', (string) $style, $m) ? (int) $m[1] : null;
}

function title_case(string $s): string {
    $s = (string) preg_replace_callback('/(^|[\s\-\/])([a-z])/u', fn($m) => $m[1] . strtoupper($m[2]), mb_strtolower($s));
    return (string) preg_replace(['/\bEdm\b/', '/\bDnb\b/'], ['EDM', 'DnB'], $s);
}

function style_tags(?string $style): array {
    $out = [];
    foreach (preg_split('/[,;·|\n]+/u', (string) $style) as $t) {
        $t = (string) preg_replace('/\.$/', '', trim($t));
        if ($t === '' || mb_strlen($t) > 40 || preg_match('/^\d{2,3}\s*bpm$/i', $t)) continue;
        $tc = title_case($t);
        if (!in_array($tc, $out, true)) $out[] = $tc;
    }
    return array_slice($out, 0, 12);
}

function to_hashtag(string $s): string {
    $s = mb_strtolower($s);
    if (class_exists('Normalizer')) $s = (string) preg_replace('/\p{Mn}/u', '', (string) Normalizer::normalize($s, Normalizer::FORM_KD));
    elseif (function_exists('iconv')) $s = (string) @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $s);
    $s = (string) preg_replace('/[^a-z0-9]/', '', (string) preg_replace('/^#/', '', $s));
    return $s !== '' ? "#$s" : '';
}

function merge_hashtags(array ...$lists): array {
    $out = [];
    foreach ($lists as $list) foreach ($list as $h) {
        $tag = to_hashtag((string) $h);
        if ($tag !== '' && !in_array($tag, $out, true)) $out[] = $tag;
    }
    return array_slice($out, 0, 15);
}

function build_tag_field(array $tags): string {
    $out = [];
    $len = 0;
    foreach ($tags as $t) {
        $t = trim((string) $t);
        if ($t === '' || in_array($t, $out, true)) continue;
        $add = ($out ? 2 : 0) + mb_strlen($t);
        if ($len + $add > YT_LIMITS['tags']) break;
        $out[] = $t;
        $len += $add;
    }
    return implode(', ', $out);
}

function build_title(array $r, array $s): string {
    $type = $r['video_type'] ?: $s['default_video_type'];
    return "{$r['title']} — {$s['artist_name']}" . ($type ? " ($type)" : '');
}

function assemble_description(array $p, array $r, array $s): string {
    $b = ['# 🎵 ' . build_title($r, $s)];
    if (!empty($p['hook_line'])) $b[] = '*"' . preg_replace('/^["“]|["”]$/u', '', (string) $p['hook_line']) . '"*';
    foreach ($p['story_paragraphs'] ?? [] as $para) if (trim((string) $para) !== '') $b[] = trim((string) $para);
    $bpm = $p['bpm'] ?: $r['bpm'];
    $meta = array_values(array_filter(array_merge([$bpm ? "$bpm BPM" : ''], $p['style_tags'] ?? []), fn($x) => $x !== '' && $x !== null));
    if ($meta) $b[] = implode(' · ', $meta);
    if ($s['spotify_artist_url']) $b[] = "🎧 More from {$s['artist_name']} on Spotify:  \n{$s['spotify_artist_url']}";
    if ($s['ai_disclosure']) $b[] = $s['ai_disclosure'];
    if (!empty($p['dedication'])) $b[] = trim((string) $p['dedication']);
    if (!empty($p['closing_line'])) $b[] = trim((string) $p['closing_line']);
    $tags = merge_hashtags($p['hashtags'] ?? [], preg_split('/\s+/', (string) $s['default_hashtags']));
    if ($tags) $b[] = implode(' ', $tags);
    return implode("\n\n", $b);
}

function template_parts(array $r, array $s): array {
    $tags = style_tags($r['style']);
    $genre = $tags ? mb_strtolower($tags[0]) : 'electronic';
    $sections = parse_lyrics($r['lyrics']);
    $hook = find_hook_line($r['lyrics']);
    $artist = (string) preg_replace('/\.$/', '', $s['artist_name'] ?: 'Distant Youth Co.');
    $paras = ["{$r['title']} is a $genre track by $artist."];
    if (count($tags) > 1) $paras[] = 'Expect ' . implode(', ', array_map('mb_strtolower', array_slice($tags, 1, 5))) . ' — built for headphones and big speakers alike.';
    $last = $sections ? end($sections) : null;
    $lastLine = $last && $last['lines'] ? end($last['lines']) : '';
    return [
        'hook_line' => $hook,
        'story_paragraphs' => $paras,
        'style_tags' => $tags,
        'bpm' => $r['bpm'] ?: (extract_bpm($r['style']) ?? 0),
        'dedication' => '',
        'closing_line' => $lastLine !== '' && $lastLine !== $hook ? $lastLine : '',
        'hashtags' => array_slice($tags, 0, 8),
        'youtube_tags' => array_merge([$r['title'], $s['artist_name'] ?: 'Distant Youth Co.'], $tags),
    ];
}

// ---------- Claude ----------

function claude_key(array $settings): string {
    return (string) ($settings['anthropic_api_key'] ?: cfg('anthropic_api_key', ''));
}
function claude_configured(array $settings): bool {
    return claude_key($settings) !== '' || (string) cfg('anthropic_auth_token', '') !== '';
}

/** One request that must come back as JSON matching $schema; returns [data, model]. */
function claude_json(array $settings, string $system, string $user, array $schema, string $effort = 'medium'): array {
    if (!claude_configured($settings)) throw new HttpError(409, 'Claude is niet ingesteld. Voeg een API key toe bij Instellingen.');
    if (!function_exists('curl_init')) throw new HttpError(502, 'Deze server kan de Claude API niet aanroepen (PHP curl ontbreekt).');
    $base = rtrim((string) cfg('anthropic_base_url', 'https://api.anthropic.com'), '/');
    $headers = ['content-type: application/json', 'anthropic-version: 2023-06-01', 'anthropic-beta: server-side-fallback-2026-07-01'];
    $key = claude_key($settings);
    $headers[] = $key !== '' ? "x-api-key: $key" : 'authorization: Bearer ' . cfg('anthropic_auth_token');
    $payload = [
        'model' => (string) cfg('claude_model', 'claude-opus-5-5'),
        'max_tokens' => 16000,
        'fallbacks' => 'default',
        'output_config' => ['effort' => $effort, 'format' => ['type' => 'json_schema', 'schema' => $schema]],
        'system' => $system,
        'messages' => [['role' => 'user', 'content' => $user]],
    ];
    @set_time_limit(330);
    $ch = curl_init("$base/v1/messages?beta=true");
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_TIMEOUT => 300,
    ]);
    $raw = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($raw === false) throw new HttpError(502, 'Kan de Claude API niet bereiken (netwerk).' . ($err ? '' : ''));
    if ($status === 401) throw new HttpError(502, 'De Claude API key is ongeldig. Controleer Instellingen.');
    if ($status === 403) throw new HttpError(502, 'Deze Claude API key heeft geen toegang tot dit model.');
    if ($status === 429) throw new HttpError(502, 'Claude heeft even te veel verzoeken gehad. Probeer het zo opnieuw.');
    if ($status < 200 || $status >= 300) throw new HttpError(502, "Claude API gaf een fout ($status).");
    $res = json_decode((string) $raw, true);
    if (!is_array($res)) throw new HttpError(502, 'Kon het antwoord van Claude niet lezen. Probeer opnieuw.');
    if (($res['stop_reason'] ?? '') === 'refusal') throw new HttpError(502, 'Claude wilde dit niet schrijven. Pas de tekst aan of gebruik het template.');
    if (($res['stop_reason'] ?? '') === 'max_tokens') throw new HttpError(502, 'Het antwoord werd te lang en is afgebroken. Probeer opnieuw.');
    $text = '';
    foreach ($res['content'] ?? [] as $blk) if (($blk['type'] ?? '') === 'text') $text .= $blk['text'];
    $data = json_decode($text, true);
    if (!is_array($data)) throw new HttpError(502, 'Kon het antwoord van Claude niet lezen. Probeer opnieuw.');
    return [$data, (string) ($res['model'] ?? cfg('claude_model', 'claude-opus-5-5'))];
}

const YT_SCHEMA = [
    'type' => 'object',
    'additionalProperties' => false,
    'required' => ['hook_line', 'story_paragraphs', 'style_tags', 'bpm', 'dedication', 'closing_line', 'hashtags', 'youtube_tags'],
    'properties' => [
        'hook_line' => ['type' => 'string', 'description' => 'One memorable line quoted verbatim from the lyrics, usually from the chorus. No quote marks.'],
        'story_paragraphs' => ['type' => 'array', 'items' => ['type' => 'string'], 'description' => 'The narrative body, one array entry per paragraph (short one-line paragraphs count as entries).'],
        'style_tags' => ['type' => 'array', 'items' => ['type' => 'string'], 'description' => 'Title Case genre / instrument / vocal tags for the "·" line, without the BPM.'],
        'bpm' => ['type' => 'integer', 'description' => 'Tempo if known from the input, otherwise 0.'],
        'dedication' => ['type' => 'string', 'description' => 'A one-sentence dedication in the spirit of the song.'],
        'closing_line' => ['type' => 'string', 'description' => 'A very short sign-off, ideally a lyric fragment.'],
        'hashtags' => ['type' => 'array', 'items' => ['type' => 'string'], 'description' => 'Lowercase hashtags without "#" and without spaces, most specific first.'],
        'youtube_tags' => ['type' => 'array', 'items' => ['type' => 'string'], 'description' => 'Search tags for the YouTube tags field (plain words/phrases).'],
    ],
];

function yt_system_prompt(): string {
    return "You write YouTube video descriptions for the electronic music artist Distant Youth Co.
You receive a song's title, its style description (often a Suno style prompt) and its lyrics (often with Suno section tags such as [Intro], [Verse], [Chorus], [Drop], [Bridge], [Outro]).
You return the parts of the description as JSON; the application assembles them into the artist's fixed layout (header, quote, story, tag line, Spotify link, AI disclosure, dedication, sign-off, hashtags).

This is a description the artist wrote and wants every release to match in tone and structure:

<example>
" . EXAMPLE_DESCRIPTION . "
</example>

How to write the story_paragraphs:
- Write in English, whatever language the input is in.
- Start with one sentence of the form \"<Title> is a <genre> track about <theme>.\" The theme comes from the lyrics.
- Then walk through the song in order, using the section tags and the style description: how it opens, what the vocals tell, how the chorus feels, the build-up and drop, any switch in direction, and how it ends.
- Mix fuller paragraphs with short one-line beats (\"Then the energy takes over.\", \"But there's another surprise.\") as the example does, but only where the song really has such a moment.
- Name instruments, vocal types and sound design only if the style description or lyrics support them. Do not invent a section, instrument or tempo that is not in the input. Quote lyric fragments exactly.
- Paint the song's imagery vividly but keep sentences plain and readable; no clichés about \"sonic journeys\" or \"soundscapes\".
- Do not mention AI, Suno, Spotify or hashtags in the story; the layout adds those.
- Keep the whole story under 2,800 characters.

Other fields:
- style_tags: 6–10 tags like the example's tag line (genre first, then instruments, vocals, special sections).
- hashtags: 6–9 song-specific hashtags; the application appends the artist's standard ones.
- youtube_tags: 10–20 search phrases, including the song title and \"Distant Youth Co.\".";
}

/** Title, description and tags for a release. */
function generate_youtube_kit(array $r, array $s, bool $useClaude, string $extra): array {
    $with = 'template';
    if ($useClaude && claude_configured($s)) {
        $user = implode("\n\n", array_filter([
            "<title>{$r['title']}</title>",
            "<style_description>\n" . ($r['style'] ?: '(none given)') . "\n</style_description>",
            $r['bpm'] ? "<bpm>{$r['bpm']}</bpm>" : '',
            "<lyrics>\n" . ($r['lyrics'] ?: '(instrumental)') . "\n</lyrics>",
            $extra !== '' ? "<extra_notes_from_artist>\n$extra\n</extra_notes_from_artist>" : '',
        ]));
        [$parts, $with] = claude_json($s, yt_system_prompt(), $user, YT_SCHEMA);
    } else {
        $parts = template_parts($r, $s);
    }
    if (empty($parts['bpm'])) $parts['bpm'] = $r['bpm'] ?: (extract_bpm($r['style']) ?? 0);
    return [
        'title' => mb_substr(build_title($r, $s), 0, YT_LIMITS['title']),
        'description' => assemble_description($parts, $r, $s),
        'tags' => build_tag_field(array_merge($parts['youtube_tags'] ?? [], [$r['title'], $s['artist_name']])),
        'bpm' => $parts['bpm'] ?: null,
        'generated_with' => $with,
    ];
}

// ---------- album and playlist names ----------

const NAMES_SCHEMA = [
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

const NAMES_SYSTEM = 'You name albums, EPs and playlists for the electronic music artist Distant Youth Co.
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

function suggest_names(array $s, string $collection, array $releases, string $direction): array {
    $tracks = [];
    foreach (array_values($releases) as $i => $r) {
        $tracks[] = implode("\n", ['<track n="' . ($i + 1) . '">', "<title>{$r['title']}</title>", '<style>' . ($r['style'] ?: '-') . '</style>',
            "<lyrics>\n" . mb_substr($r['lyrics'] ?: '(instrumental)', 0, 6000) . "\n</lyrics>", '</track>']);
    }
    $user = implode("\n\n", array_filter(["<current_name>$collection</current_name>", implode("\n\n", $tracks),
        $direction !== '' ? "<direction_from_artist>$direction</direction_from_artist>" : '']));
    [$data, $model] = claude_json($s, NAMES_SYSTEM, $user, NAMES_SCHEMA);
    $out = [];
    foreach ($data['suggestions'] ?? [] as $sg) {
        if (!is_array($sg) || !is_string($sg['name'] ?? null) || trim($sg['name']) === '') continue;
        $out[] = ['name' => mb_substr(trim($sg['name']), 0, 60), 'why' => trim((string) ($sg['why'] ?? ''))];
        if (count($out) === 5) break;
    }
    return ['suggestions' => $out, 'model' => $model];
}
