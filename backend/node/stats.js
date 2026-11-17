import { releaseStatus, youtubeState } from './model.js';

export const TIME_ZONE = 'Europe/Amsterdam';
export const PERIODS = [6, 12, 24];

const monthFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit' });

/** The month (YYYY-MM) a release belongs to: its release date, else when it was added, in Amsterdam time. */
export function releaseMonth(r) {
  if (r.release_date) return r.release_date.slice(0, 7);
  if (!r.created_at) return null;
  return monthFmt.format(new Date(r.created_at.replace(' ', 'T') + 'Z')).slice(0, 7);
}

/** The last `n` months up to and including the month of `now`, oldest first, cut in Amsterdam time. */
export function lastMonths(n, now = new Date()) {
  const [y, m] = monthFmt.format(now).split('-').map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

const MATRIX_COLUMNS = [
  ['wav', 'WAV'], ['mp3', 'MP3'], ['video', 'MP4'], ['cover', 'Cover'], ['yt_text', 'YouTube-tekst'], ['youtube', 'Op YouTube'], ['spotify', 'Op Spotify'],
];

/**
 * The numbers of "De stand van de nacht" for the releases this user may see.
 * Nothing here queries on its own: the caller passes the releases that user is allowed to see.
 */
export function computeStats(releases, { months: period = 12, admin = false, now = new Date() } = {}) {
  const counts = { live: 0, ready: 0, concept: 0 };
  for (const r of releases) counts[releaseStatus(r)] += 1;

  const both = lastMonths(period * 2, now);
  const previousMonths = new Set(both.slice(0, period));
  const months = both.slice(period).map((month) => ({ month, count: 0, by: { live: 0, ready: 0, concept: 0 } }));
  const index = new Map(months.map((m, i) => [m.month, i]));
  let previous = 0;
  for (const r of releases) {
    const m = releaseMonth(r);
    if (index.has(m)) {
      const slot = months[index.get(m)];
      slot.count += 1;
      slot.by[releaseStatus(r)] += 1;
    } else if (previousMonths.has(m)) previous += 1;
  }
  const current = months.reduce((s, m) => s + m.count, 0);

  const columns = MATRIX_COLUMNS.filter(([key]) => admin || key !== 'yt_text');
  const rows = releases.slice(0, 12).map((r) => {
    const cells = {
      wav: Boolean(r.wav_file),
      mp3: Boolean(r.mp3_file),
      video: Boolean(r.video_file),
      cover: Boolean(r.cover_file),
      yt_text: Boolean(r.yt_description),
      youtube: youtubeState(r) === 'live',
      spotify: Boolean(r.on_spotify),
    };
    if (!admin) delete cells.yt_text;
    return { id: r.id, title: r.title, status: releaseStatus(r), cells, done: Object.values(cells).filter(Boolean).length };
  });

  return {
    period,
    time_zone: TIME_ZONE,
    generated_at: now.toISOString(),
    total: releases.length,
    counts,
    months,
    comparison: { current, previous, change: current - previous },
    matrix: { columns: columns.map(([key, label]) => ({ key, label })), rows },
  };
}
