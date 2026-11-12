import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseMonth, lastMonths, computeStats } from '../src/stats.js';

const now = new Date('2026-11-12T10:00:00Z');
const r = (o) => ({ wav_file: 'master.wav', on_youtube: 0, on_spotify: 0, video_file: null, yt_description: '', created_at: '2026-11-01 10:00:00', ...o });

test('months are cut in Amsterdam time, not UTC', () => {
  assert.equal(releaseMonth({ created_at: '2026-10-31 23:30:00' }), '2026-11', 'half past midnight on 1 November in Amsterdam');
  assert.equal(releaseMonth({ created_at: '2026-06-30 22:30:00' }), '2026-07', 'summer time: UTC+2');
  assert.equal(releaseMonth({ release_date: '2026-03-31', created_at: '2026-11-01 10:00:00' }), '2026-03', 'the release date wins');
  assert.deepEqual(lastMonths(3, now), ['2026-09', '2026-10', '2026-11']);
  assert.deepEqual(lastMonths(2, new Date('2026-01-15T12:00:00Z')), ['2025-12', '2026-01'], 'across a year');
});

test('counts, the period and the comparison with the period before', () => {
  const list = [
    r({ id: 1, release_date: '2026-11-07', on_spotify: 1, video_file: 'v.mp4', yt_description: 'x' }), // ready
    r({ id: 2, release_date: '2026-09-18', on_youtube: 1 }), // live
    r({ id: 3, release_date: '2026-03-01' }), // concept, previous 6 months
    r({ id: 4, release_date: '2025-01-01' }), // outside both periods
  ];
  const s = computeStats(list, { months: 6, admin: true, now });
  assert.deepEqual(s.counts, { live: 1, ready: 1, concept: 2 });
  assert.equal(s.months.length, 6);
  assert.equal(s.months.at(-1).month, '2026-11');
  assert.equal(s.months.at(-1).by.ready, 1);
  assert.deepEqual(s.comparison, { current: 2, previous: 1, change: 1 });
  assert.equal(computeStats(list, { months: 24, now }).months.length, 24);
});

test('the readiness matrix: the YouTube text column is the admin\'s only', () => {
  const list = [r({ id: 1, title: 'Lanterns', mp3_file: 'audio.mp3', yt_description: 'x' })];
  const a = computeStats(list, { admin: true, now }).matrix;
  assert.ok(a.columns.some((c) => c.key === 'yt_text'));
  assert.deepEqual(a.rows[0].cells, { wav: true, mp3: true, video: false, cover: false, yt_text: true, youtube: false, spotify: false });
  const l = computeStats(list, { admin: false, now }).matrix;
  assert.ok(!l.columns.some((c) => c.key === 'yt_text'));
  assert.equal(l.rows[0].cells.yt_text, undefined);
});

test('nothing at all: zeros and empty rows, no crash', () => {
  const s = computeStats([], { now });
  assert.equal(s.total, 0);
  assert.equal(s.matrix.rows.length, 0);
  assert.deepEqual(s.comparison, { current: 0, previous: 0, change: 0 });
});
