import { el, icon, fmtTime } from './dom.js';
import { pauseAudio } from './player.js';

/** A video player in the app's own style: a round play button, a thin position line, sound, full screen. */
export function videoPlayer(r) {
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
