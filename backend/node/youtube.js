import { claudeConfigured, claudeJson } from './claude.js';

export { claudeConfigured };

// The reference description the generator imitates (supplied by the artist).
export const EXAMPLE_DESCRIPTION = `# 🎵 Lanterns in the Rain — Distant Youth Co. (Official Visualizer)

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

#dubstep #melodicdubstep #japanesedubstep #heavydubstep #taiko #koto #festivaldubstep #aimusic #sunoai #bassmusic #electronicmusic #distantyouthco`;

export const LIMITS = { title: 100, description: 5000, tags: 500 };

// ---------- helpers ----------

const SECTION_RE = /^\s*[\[(]([^\])]+)[\])]\s*$/;

/** Split Suno-style lyrics into { name, lines } sections. */
export function parseLyrics(lyrics = '') {
  const sections = [];
  let current = { name: '', lines: [] };
  for (const raw of String(lyrics).split(/\r?\n/)) {
    const m = raw.match(SECTION_RE);
    if (m) {
      if (current.lines.length || current.name) sections.push(current);
      current = { name: m[1].trim(), lines: [] };
    } else if (raw.trim()) {
      current.lines.push(raw.trim().replace(/^[-–—]\s*/, ''));
    }
  }
  if (current.lines.length || current.name) sections.push(current);
  return sections;
}

/** Best guess at the hook: first chorus line, else the most repeated line. */
export function findHookLine(lyrics) {
  const sections = parseLyrics(lyrics);
  const chorus = sections.find((s) => /chorus|hook|refrein/i.test(s.name) && s.lines.length);
  if (chorus) return chorus.lines[0];
  const counts = new Map();
  for (const s of sections) for (const l of s.lines) counts.set(l, (counts.get(l) || 0) + 1);
  let best = '';
  let bestCount = 0;
  for (const [line, c] of counts) if (c > bestCount) [best, bestCount] = [line, c];
  return bestCount > 1 ? best : sections.flatMap((s) => s.lines)[0] || '';
}

export function extractBpm(style = '') {
  const m = String(style).match(/(\d{2,3})\s*bpm/i);
  return m ? Number(m[1]) : null;
}

const titleCase = (s) =>
  s
    .toLowerCase()
    .replace(/(^|[\s\-/])([a-z])/g, (_, p, c) => p + c.toUpperCase())
    .replace(/\bEdm\b/g, 'EDM')
    .replace(/\bDnb\b/g, 'DnB');

export function styleTags(style = '') {
  return [
    ...new Set(
      String(style)
        .split(/[,;·|\n]+/)
        .map((t) => t.trim().replace(/\.$/, ''))
        .filter((t) => t && t.length <= 40 && !/^\d{2,3}\s*bpm$/i.test(t))
        .map(titleCase)
    ),
  ].slice(0, 12);
}

export function toHashtag(s) {
  const slug = String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^#/, '')
    .replace(/[^a-z0-9]/g, '');
  return slug ? `#${slug}` : '';
}

export function mergeHashtags(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const h of list) {
      const tag = toHashtag(h);
      if (tag && !seen.has(tag)) {
        seen.add(tag);
        out.push(tag);
      }
    }
  }
  // YouTube ignores all hashtags when there are more than 60; keep it tidy.
  return out.slice(0, 15);
}

/** Comma-separated tag list for YouTube's "Tags" field, kept under 500 chars. */
export function buildTagField(tags) {
  const out = [];
  let len = 0;
  for (const t of [...new Set(tags.map((x) => String(x).trim()).filter(Boolean))]) {
    const add = (out.length ? 2 : 0) + t.length;
    if (len + add > LIMITS.tags) break;
    out.push(t);
    len += add;
  }
  return out.join(', ');
}

export function buildTitle(release, settings) {
  const type = release.video_type || settings.default_video_type;
  return `${release.title} — ${settings.artist_name}${type ? ` (${type})` : ''}`;
}

/** Assemble the final description text from its parts, in the artist's fixed layout. */
export function assembleDescription(parts, release, settings) {
  const blocks = [];
  blocks.push(`# 🎵 ${buildTitle(release, settings)}`);
  if (parts.hook_line) blocks.push(`*"${parts.hook_line.replace(/^["“]|["”]$/g, '')}"*`);
  blocks.push(...parts.story_paragraphs.map((p) => p.trim()).filter(Boolean));
  const bpm = parts.bpm || release.bpm;
  const meta = [bpm ? `${bpm} BPM` : '', ...parts.style_tags].filter(Boolean);
  if (meta.length) blocks.push(meta.join(' · '));
  if (settings.spotify_artist_url) {
    blocks.push(`🎧 More from ${settings.artist_name} on Spotify:  \n${settings.spotify_artist_url}`);
  }
  if (settings.ai_disclosure) blocks.push(settings.ai_disclosure);
  if (parts.dedication) blocks.push(parts.dedication.trim());
  if (parts.closing_line) blocks.push(parts.closing_line.trim());
  const hashtags = mergeHashtags(parts.hashtags || [], settings.default_hashtags.split(/\s+/));
  if (hashtags.length) blocks.push(hashtags.join(' '));
  return blocks.join('\n\n');
}

// ---------- template (no API key) ----------

export function templateParts(release, settings = {}) {
  const tags = styleTags(release.style);
  const genre = tags[0] ? tags[0].toLowerCase() : 'electronic';
  const sections = parseLyrics(release.lyrics);
  const hook = findHookLine(release.lyrics);
  const paragraphs = [
    `${release.title} is a ${genre} track by ${(settings.artist_name || 'Distant Youth Co.').replace(/\.$/, '')}.`,
  ];
  if (tags.length > 1) {
    paragraphs.push(`Expect ${tags.slice(1, 6).map((t) => t.toLowerCase()).join(', ')} — built for headphones and big speakers alike.`);
  }
  const lastLine = sections.at(-1)?.lines.at(-1);
  return {
    hook_line: hook,
    story_paragraphs: paragraphs,
    style_tags: tags,
    bpm: release.bpm || extractBpm(release.style) || 0,
    dedication: '',
    closing_line: lastLine && lastLine !== hook ? lastLine : '',
    hashtags: tags.slice(0, 8),
    youtube_tags: [release.title, settings.artist_name || 'Distant Youth Co.', ...tags],
  };
}

// ---------- Claude ----------

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hook_line', 'story_paragraphs', 'style_tags', 'bpm', 'dedication', 'closing_line', 'hashtags', 'youtube_tags'],
  properties: {
    hook_line: { type: 'string', description: 'One memorable line quoted verbatim from the lyrics, usually from the chorus. No quote marks.' },
    story_paragraphs: {
      type: 'array',
      items: { type: 'string' },
      description: 'The narrative body, one array entry per paragraph (short one-line paragraphs count as entries).',
    },
    style_tags: { type: 'array', items: { type: 'string' }, description: 'Title Case genre / instrument / vocal tags for the "·" line, without the BPM.' },
    bpm: { type: 'integer', description: 'Tempo if known from the input, otherwise 0.' },
    dedication: { type: 'string', description: 'A one-sentence dedication in the spirit of the song.' },
    closing_line: { type: 'string', description: 'A very short sign-off, ideally a lyric fragment.' },
    hashtags: { type: 'array', items: { type: 'string' }, description: 'Lowercase hashtags without "#" and without spaces, most specific first.' },
    youtube_tags: { type: 'array', items: { type: 'string' }, description: 'Search tags for the YouTube tags field (plain words/phrases).' },
  },
};

const SYSTEM_PROMPT = `You write YouTube video descriptions for the electronic music artist Distant Youth Co.
You receive a song's title, its style description (often a Suno style prompt) and its lyrics (often with Suno section tags such as [Intro], [Verse], [Chorus], [Drop], [Bridge], [Outro]).
You return the parts of the description as JSON; the application assembles them into the artist's fixed layout (header, quote, story, tag line, Spotify link, AI disclosure, dedication, sign-off, hashtags).

This is a description the artist wrote and wants every release to match in tone and structure:

<example>
${EXAMPLE_DESCRIPTION}
</example>

How to write the story_paragraphs:
- Write in English, whatever language the input is in.
- Start with one sentence of the form "<Title> is a <genre> track about <theme>." The theme comes from the lyrics.
- Then walk through the song in order, using the section tags and the style description: how it opens, what the vocals tell, how the chorus feels, the build-up and drop, any switch in direction, and how it ends.
- Mix fuller paragraphs with short one-line beats ("Then the energy takes over.", "But there's another surprise.") as the example does, but only where the song really has such a moment.
- Name instruments, vocal types and sound design only if the style description or lyrics support them. Do not invent a section, instrument or tempo that is not in the input. Quote lyric fragments exactly.
- Paint the song's imagery vividly but keep sentences plain and readable; no clichés about "sonic journeys" or "soundscapes".
- Do not mention AI, Suno, Spotify or hashtags in the story; the layout adds those.
- Keep the whole story under 2,800 characters.

Other fields:
- style_tags: 6–10 tags like the example's tag line (genre first, then instruments, vocals, special sections).
- hashtags: 6–9 song-specific hashtags; the application appends the artist's standard ones.
- youtube_tags: 10–20 search phrases, including the song title and "Distant Youth Co.".`;

export async function claudeParts(release, settings, extra = '') {
  const user = [
    `<title>${release.title}</title>`,
    `<style_description>\n${release.style || '(none given)'}\n</style_description>`,
    release.bpm ? `<bpm>${release.bpm}</bpm>` : '',
    `<lyrics>\n${release.lyrics || '(instrumental)'}\n</lyrics>`,
    extra ? `<extra_notes_from_artist>\n${extra}\n</extra_notes_from_artist>` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const { data, model } = await claudeJson(settings, { system: SYSTEM_PROMPT, user, schema: OUTPUT_SCHEMA });
  return { parts: data, model };
}

/** Generate YouTube title, description and tags for a release. */
export async function generateYoutubeKit(release, settings, { useClaude = true, extra = '' } = {}) {
  let parts;
  let generatedWith = 'template';
  if (useClaude && claudeConfigured(settings)) {
    const r = await claudeParts(release, settings, extra);
    parts = r.parts;
    generatedWith = r.model;
  } else {
    parts = templateParts(release, settings);
  }
  if (!parts.bpm) parts.bpm = release.bpm || extractBpm(release.style) || 0;
  const description = assembleDescription(parts, release, settings);
  const tags = buildTagField([...parts.youtube_tags, release.title, settings.artist_name]);
  return {
    title: buildTitle(release, settings).slice(0, LIMITS.title),
    description,
    tags,
    bpm: parts.bpm || null,
    generatedWith,
  };
}
