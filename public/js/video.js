import { el, icon, fmtTime } from './dom.js';
import { pauseAudio } from './player.js';

/** The id of a YouTube video from its link, as the server reads it (app/Support/Input.php), or null. */
export function youtubeIdOf(link) {
  let u;
  try { u = new URL(String(link).trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = u.pathname === '/watch' ? u.searchParams.get('v') : (u.pathname.match(/^\/(shorts|live|embed|v)\/([^/]+)/) || [])[2];
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

/** Does this release have a video to watch: its own MP4, or one on YouTube. */
export const hasVideo = (r) => Boolean(r.video_url || r.youtube_id);

/**
 * YouTube's player (the privacy version, youtube-nocookie.com) for a release with a YouTube link.
 * Only the video id from the server goes in. With autoplay the frame loads at once (you asked for
 * the video); without, the cover shows first and YouTube is contacted only when you press play.
 */
export function youtubeFrame(r, { autoplay = false, start = 0 } = {}) {
  const frame = () => {
    pauseAudio();
    const q = new URLSearchParams({ rel: '0', playsinline: '1', autoplay: '1' });
    if (start > 1) q.set('start', String(Math.floor(start)));
    return el('iframe', {
      class: 'yt-frame',
      src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(r.youtube_id)}?${q}`,
      title: `${r.title} op YouTube`,
      allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
      allowfullscreen: true,
      // YouTube refuses to play without knowing which site it is on.
      referrerpolicy: 'strict-origin-when-cross-origin',
    });
  };
  const box = el('div', { class: 'video-box yt-box' });
  if (autoplay) {
    box.append(frame());
    return box;
  }
  const facade = el('button', { type: 'button', class: 'yt-facade', 'aria-label': `Speelt af via YouTube: ${r.title}` },
    r.cover_url ? el('img', { src: r.cover_url, alt: '' }) : null,
    el('span', { class: 'vplay', 'aria-hidden': 'true' }, icon('play')),
    el('span', { class: 'yt-note xs' }, 'Speelt af via YouTube'));
  facade.addEventListener('click', () => box.replaceChildren(frame()));
  box.append(facade);
  // Said before anyone presses play (X004): YouTube is another party.
  return el('div', { class: 'stack yt-wrap', style: { gap: '6px' } }, box,
    el('p', { class: 'xs muted', style: { margin: 0 } }, 'Speelt af via YouTube. Pas als je op afspelen drukt, ziet YouTube je IP-adres.'));
}

/** A video player in the app's own style: a round play button, a thin position line, sound, full screen. */
export function videoPlayer(r) {
  if (!r.video_url && r.youtube_id) return youtubeFrame(r);
  const video = el('video', { src: r.video_url, preload: 'metadata', playsinline: true, poster: r.cover_url || undefined });
  const playBtn = el('button', { type: 'button', class: 'icon-btn solid' });
  const bigPlay = el('button', { type: 'button', class: 'vplay', 'aria-hidden': 'true', tabindex: '-1' }, icon('play'));
  const time = el('span', { class: 'xs muted' }, '0:00');
  const total = el('span', { class: 'xs muted' }, '–:––');
  const seek = el('input', { type: 'range', class: 'range', min: 0, max: 1000, value: 0, 'aria-label': 'Positie in de video' });
  const mute = el('button', { type: 'button', class: 'icon-btn plain' });
  const full = el('button', { type: 'button', class: 'icon-btn plain', 'aria-label': 'Volledig scherm' }, icon('maximize', 'sm'));
  const box = el('div', { class: 'vplayer' }, el('div', { class: 'video-box' }, video, bigPlay),
    el('div', { class: 'vbar' }, playBtn, time, seek, total, mute, full));

  const toggle = () => (video.paused ? video.play().catch(() => {}) : video.pause());
  const paint = () => {
    const playing = !video.paused;
    playBtn.replaceChildren(icon(playing ? 'pause' : 'play', 'sm'));
    playBtn.setAttribute('aria-label', playing ? 'Video pauzeren' : 'Video afspelen');
    box.classList.toggle('playing', playing);
    mute.replaceChildren(icon(video.muted ? 'volume-x' : 'volume-2', 'sm'));
    mute.setAttribute('aria-label', video.muted ? 'Geluid aan' : 'Geluid uit');
  };
  const progress = () => {
    const d = video.duration;
    const p = Number.isFinite(d) && d > 0 ? video.currentTime / d : 0;
    seek.value = String(Math.round(p * 1000));
    seek.style.setProperty('--fill', `${p * 100}%`);
    seek.setAttribute('aria-valuetext', `${fmtTime(video.currentTime)} van ${fmtTime(d)}`);
    time.textContent = fmtTime(video.currentTime);
    total.textContent = fmtTime(d);
  };
  playBtn.addEventListener('click', toggle);
  bigPlay.addEventListener('click', toggle);
  video.addEventListener('click', toggle);
  video.addEventListener('play', () => { pauseAudio(); paint(); });
  video.addEventListener('pause', paint);
  video.addEventListener('volumechange', paint);
  video.addEventListener('timeupdate', progress);
  video.addEventListener('loadedmetadata', progress);
  seek.addEventListener('input', () => {
    if (Number.isFinite(video.duration)) video.currentTime = (seek.value / 1000) * video.duration;
  });
  mute.addEventListener('click', () => { video.muted = !video.muted; });
  full.addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : box.requestFullscreen?.()));
  paint();
  return box;
}
