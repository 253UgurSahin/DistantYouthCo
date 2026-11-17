<?php

namespace App\Services;

use App\Models\Release;

/**
 * The YouTube kit: title, description and tags in the artist's fixed layout, from the release's
 * title, style description and lyrics. The story comes from Claude when a key is set, else from a
 * template.
 */
final class YoutubeKit
{
    public const LIMITS = ['title' => 100, 'description' => 5000, 'tags' => 500];

    public const EXAMPLE = <<<'TXT'
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

    /** Suno-style lyrics as [['name' => 'Chorus', 'lines' => [...]], ...]. */
    public static function parseLyrics(?string $lyrics): array
    {
        $sections = [];
        $cur = ['name' => '', 'lines' => []];
        foreach (preg_split('/\r?\n/', (string) $lyrics) as $raw) {
            if (preg_match('/^\s*[\[(]([^\])]+)[\])]\s*$/u', $raw, $m)) {
                if ($cur['lines'] || $cur['name'] !== '') {
                    $sections[] = $cur;
                }
                $cur = ['name' => trim($m[1]), 'lines' => []];
            } elseif (trim($raw) !== '') {
                $cur['lines'][] = (string) preg_replace('/^[-–—]\s*/u', '', trim($raw));
            }
        }
        if ($cur['lines'] || $cur['name'] !== '') {
            $sections[] = $cur;
        }

        return $sections;
    }

    /** The hook: the first chorus line, else the most repeated line, else the first line. */
    public static function hookLine(?string $lyrics): string
    {
        $sections = self::parseLyrics($lyrics);
        foreach ($sections as $s) {
            if (preg_match('/chorus|hook|refrein/i', $s['name']) && $s['lines']) {
                return $s['lines'][0];
            }
        }
        $counts = [];
        foreach ($sections as $s) {
            foreach ($s['lines'] as $l) {
                $counts[$l] = ($counts[$l] ?? 0) + 1;
            }
        }
        $best = '';
        $bestCount = 0;
        foreach ($counts as $line => $c) {
            if ($c > $bestCount) {
                [$best, $bestCount] = [(string) $line, $c];
            }
        }
        if ($bestCount > 1) {
            return $best;
        }
        foreach ($sections as $s) {
            if ($s['lines']) {
                return $s['lines'][0];
            }
        }

        return '';
    }

    public static function bpm(?string $style): ?int
    {
        return preg_match('/(\d{2,3})\s*bpm/i', (string) $style, $m) ? (int) $m[1] : null;
    }

    public static function titleCase(string $s): string
    {
        $s = (string) preg_replace_callback('/(^|[\s\-\/])([a-z])/u', fn ($m) => $m[1].strtoupper($m[2]), mb_strtolower($s));

        return (string) preg_replace(['/\bEdm\b/', '/\bDnb\b/'], ['EDM', 'DnB'], $s);
    }

    public static function styleTags(?string $style): array
    {
        $out = [];
        foreach (preg_split('/[,;·|\n]+/u', (string) $style) as $t) {
            $t = (string) preg_replace('/\.$/', '', trim($t));
            if ($t === '' || mb_strlen($t) > 40 || preg_match('/^\d{2,3}\s*bpm$/i', $t)) {
                continue;
            }
            $tc = self::titleCase($t);
            if (! in_array($tc, $out, true)) {
                $out[] = $tc;
            }
        }

        return array_slice($out, 0, 12);
    }

    public static function hashtag(string $s): string
    {
        $s = mb_strtolower($s);
        if (class_exists(\Normalizer::class)) {
            $s = (string) preg_replace('/\p{Mn}/u', '', (string) \Normalizer::normalize($s, \Normalizer::FORM_KD));
        } elseif (function_exists('iconv')) {
            $s = (string) @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $s);
        }
        $s = (string) preg_replace('/[^a-z0-9]/', '', (string) preg_replace('/^#/', '', $s));

        return $s !== '' ? "#$s" : '';
    }

    /** Unique hashtags, at most 15 (YouTube ignores all of them past 60). */
    public static function mergeHashtags(array ...$lists): array
    {
        $out = [];
        foreach ($lists as $list) {
            foreach ($list as $h) {
                $tag = self::hashtag((string) $h);
                if ($tag !== '' && ! in_array($tag, $out, true)) {
                    $out[] = $tag;
                }
            }
        }

        return array_slice($out, 0, 15);
    }

    /** The comma-separated "Tags" field, under 500 characters. */
    public static function tagField(array $tags): string
    {
        $out = [];
        $len = 0;
        foreach ($tags as $t) {
            $t = trim((string) $t);
            if ($t === '' || in_array($t, $out, true)) {
                continue;
            }
            $add = ($out ? 2 : 0) + mb_strlen($t);
            if ($len + $add > self::LIMITS['tags']) {
                break;
            }
            $out[] = $t;
            $len += $add;
        }

        return implode(', ', $out);
    }

    public static function title(Release $r, array $s): string
    {
        $type = $r->video_type ?: $s['default_video_type'];

        return "{$r->title} — {$s['artist_name']}".($type ? " ($type)" : '');
    }

    /** The description from its parts, in the artist's layout. */
    public static function assemble(array $p, Release $r, array $s): string
    {
        $b = ['# 🎵 '.self::title($r, $s)];
        if (! empty($p['hook_line'])) {
            $b[] = '*"'.preg_replace('/^["“]|["”]$/u', '', (string) $p['hook_line']).'"*';
        }
        foreach ($p['story_paragraphs'] ?? [] as $para) {
            if (trim((string) $para) !== '') {
                $b[] = trim((string) $para);
            }
        }
        $bpm = $p['bpm'] ?: $r->bpm;
        $meta = array_values(array_filter(array_merge([$bpm ? "$bpm BPM" : ''], $p['style_tags'] ?? []), fn ($x) => $x !== '' && $x !== null));
        if ($meta) {
            $b[] = implode(' · ', $meta);
        }
        if ($s['spotify_artist_url']) {
            $b[] = "🎧 More from {$s['artist_name']} on Spotify:  \n{$s['spotify_artist_url']}";
        }
        if ($s['ai_disclosure']) {
            $b[] = $s['ai_disclosure'];
        }
        if (! empty($p['dedication'])) {
            $b[] = trim((string) $p['dedication']);
        }
        if (! empty($p['closing_line'])) {
            $b[] = trim((string) $p['closing_line']);
        }
        $tags = self::mergeHashtags($p['hashtags'] ?? [], preg_split('/\s+/', (string) $s['default_hashtags']));
        if ($tags) {
            $b[] = implode(' ', $tags);
        }

        return implode("\n\n", $b);
    }

    /** The parts without Claude. */
    public static function templateParts(Release $r, array $s): array
    {
        $tags = self::styleTags($r->style);
        $genre = $tags ? mb_strtolower($tags[0]) : 'electronic';
        $sections = self::parseLyrics($r->lyrics);
        $hook = self::hookLine($r->lyrics);
        $artist = (string) preg_replace('/\.$/', '', $s['artist_name'] ?: 'Distant Youth Co.');
        $paras = ["{$r->title} is a $genre track by $artist."];
        if (count($tags) > 1) {
            $paras[] = 'Expect '.implode(', ', array_map('mb_strtolower', array_slice($tags, 1, 5))).' — built for headphones and big speakers alike.';
        }
        $last = $sections ? end($sections) : null;
        $lastLine = $last && $last['lines'] ? end($last['lines']) : '';

        return [
            'hook_line' => $hook,
            'story_paragraphs' => $paras,
            'style_tags' => $tags,
            'bpm' => $r->bpm ?: (self::bpm($r->style) ?? 0),
            'dedication' => '',
            'closing_line' => $lastLine !== '' && $lastLine !== $hook ? $lastLine : '',
            'hashtags' => array_slice($tags, 0, 8),
            'youtube_tags' => array_merge([$r->title, $s['artist_name'] ?: 'Distant Youth Co.'], $tags),
        ];
    }

    // ---------- Claude ----------

    public const SCHEMA = [
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

    public static function systemPrompt(): string
    {
        return "You write YouTube video descriptions for the electronic music artist Distant Youth Co.
You receive a song's title, its style description (often a Suno style prompt) and its lyrics (often with Suno section tags such as [Intro], [Verse], [Chorus], [Drop], [Bridge], [Outro]).
You return the parts of the description as JSON; the application assembles them into the artist's fixed layout (header, quote, story, tag line, Spotify link, AI disclosure, dedication, sign-off, hashtags).

This is a description the artist wrote and wants every release to match in tone and structure:

<example>
".self::EXAMPLE."
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

    /** Title, description, tags, bpm and what made them ("template" or the Claude model). */
    public function __construct(private readonly Claude $claude) {}

    public function generate(Release $r, array $s, bool $useClaude, string $extra): array
    {
        $with = 'template';
        if ($useClaude && $this->claude->configured($s)) {
            $user = implode("\n\n", array_filter([
                "<title>{$r->title}</title>",
                "<style_description>\n".($r->style ?: '(none given)')."\n</style_description>",
                $r->bpm ? "<bpm>{$r->bpm}</bpm>" : '',
                "<lyrics>\n".($r->lyrics ?: '(instrumental)')."\n</lyrics>",
                $extra !== '' ? "<extra_notes_from_artist>\n$extra\n</extra_notes_from_artist>" : '',
            ]));
            [$parts, $with] = $this->claude->json($s, self::systemPrompt(), $user, self::SCHEMA);
        } else {
            $parts = self::templateParts($r, $s);
        }
        if (empty($parts['bpm'])) {
            $parts['bpm'] = $r->bpm ?: (self::bpm($r->style) ?? 0);
        }

        return [
            'title' => mb_substr(self::title($r, $s), 0, self::LIMITS['title']),
            'description' => self::assemble($parts, $r, $s),
            'tags' => self::tagField(array_merge($parts['youtube_tags'] ?? [], [$r->title, $s['artist_name']])),
            'bpm' => $parts['bpm'] ?: null,
            'generated_with' => $with,
        ];
    }
}
