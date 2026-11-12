import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLyrics, findHookLine, extractBpm, styleTags, mergeHashtags, buildTagField, buildTitle,
  assembleDescription, templateParts, LIMITS,
} from '../src/youtube.js';

const settings = {
  artist_name: 'Distant Youth Co.',
  spotify_artist_url: 'https://open.spotify.com/artist/7hbil2HXkg0OniGTxMUHeo',
  ai_disclosure: '🧪 Made with AI — Suno AI (AI-assisted, human-directed).',
  default_hashtags: '#aimusic #sunoai #distantyouthco',
  default_video_type: 'Official Visualizer',
};
const release = {
  title: 'Lanterns in the Rain',
  style: 'heavy melodic dubstep, 140 bpm, koto, taiko drums',
  lyrics: '[Intro]\nClose your eyes\n[Chorus]\nLight it up, light it up, like lanterns in the rain.\n[Outro]\nMake a wish.',
  video_type: 'Official Visualizer',
};

test('lyrics: sections and the hook come from the Suno tags', () => {
  const s = parseLyrics(release.lyrics);
  assert.deepEqual(s.map((x) => x.name), ['Intro', 'Chorus', 'Outro']);
  assert.equal(findHookLine(release.lyrics), 'Light it up, light it up, like lanterns in the rain.');
  assert.equal(findHookLine('a\nb\na'), 'a', 'without a chorus the most repeated line wins');
});

test('style: BPM and tags', () => {
  assert.equal(extractBpm(release.style), 140);
  assert.equal(extractBpm('no tempo'), null);
  assert.deepEqual(styleTags(release.style), ['Heavy Melodic Dubstep', 'Koto', 'Taiko Drums']);
});

test('hashtags: merged, deduplicated, at most 15', () => {
  assert.deepEqual(mergeHashtags(['Koto', '#koto', 'Melodic Dubstep'], ['#aimusic']), ['#koto', '#melodicdubstep', '#aimusic']);
  assert.equal(mergeHashtags(Array.from({ length: 30 }, (_, i) => `tag${i}`)).length, 15);
});

test('tags field stays under YouTube\'s 500 characters', () => {
  const field = buildTagField(Array.from({ length: 200 }, (_, i) => `a long tag number ${i}`));
  assert.ok(field.length <= LIMITS.tags);
});

test('the description follows the artist\'s layout', () => {
  const parts = templateParts(release, settings);
  const d = assembleDescription(parts, release, settings);
  const lines = d.split('\n');
  assert.equal(lines[0], '# 🎵 Lanterns in the Rain — Distant Youth Co. (Official Visualizer)');
  assert.equal(lines[2], '*"Light it up, light it up, like lanterns in the rain."*');
  assert.match(d, /140 BPM · Heavy Melodic Dubstep · Koto · Taiko Drums/);
  assert.match(d, /🎧 More from Distant Youth Co\. on Spotify: {2}\nhttps:\/\/open\.spotify\.com\/artist\/7hbil2HXkg0OniGTxMUHeo/);
  assert.match(d, /🧪 Made with AI — Suno AI/);
  assert.match(lines.at(-1), /#aimusic #sunoai #distantyouthco$/);
  assert.doesNotMatch(d, /Co\.\./);
  assert.equal(buildTitle(release, settings), 'Lanterns in the Rain — Distant Youth Co. (Official Visualizer)');
});
