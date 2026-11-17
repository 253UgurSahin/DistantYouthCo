import { claudeJson } from './claude.js';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['suggestions'],
  properties: {
    suggestions: {
      type: 'array',
      description: 'Five album, EP or playlist names, best first.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'why'],
        properties: {
          name: { type: 'string', description: 'The name itself, without quotes. At most 40 characters.' },
          why: { type: 'string', description: 'One short sentence in Dutch: which shared thread in the tracks it comes from.' },
        },
      },
    },
  },
};

const SYSTEM = `You name albums, EPs and playlists for the electronic music artist Distant Youth Co.
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
- The "why" is one short sentence in Dutch naming the shared thread.`;

/** Suggest names for a collection of releases. */
export async function suggestNames(settings, collectionName, releases, direction = '') {
  const tracks = releases
    .map((r, i) => [
      `<track n="${i + 1}">`,
      `<title>${r.title}</title>`,
      `<style>${r.style || '-'}</style>`,
      `<lyrics>\n${(r.lyrics || '(instrumental)').slice(0, 6000)}\n</lyrics>`,
      '</track>',
    ].join('\n'))
    .join('\n\n');
  const user = [
    `<current_name>${collectionName}</current_name>`,
    tracks,
    direction ? `<direction_from_artist>${direction}</direction_from_artist>` : '',
  ].filter(Boolean).join('\n\n');
  const { data, model } = await claudeJson(settings, { system: SYSTEM, user, schema: SCHEMA });
  const suggestions = (data.suggestions || [])
    .filter((s) => s && typeof s.name === 'string' && s.name.trim())
    .slice(0, 5)
    .map((s) => ({ name: s.name.trim().slice(0, 60), why: String(s.why || '').trim() }));
  return { suggestions, model };
}
