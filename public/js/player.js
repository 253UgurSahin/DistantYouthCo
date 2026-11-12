import { el, icon, clear, fmtTime, hookLine, dialog, toast } from './dom.js';

const audio = new Audio();
audio.preload = 'metadata';

const state = { queue: [], index: -1, open: false, repeat: false };
const listeners = new Set();
let root;
let parts = {};
let full = null;

export const player = {
  get current() {
    return state.queue[state.index] || null;
  },
  get playing() {
    return !audio.paused;
  },
  /** Plays a list of releases, starting at `start`. */
  playList(releases, start = 0) {
    const playable = releases.filter((r) => r.audio_url);
    if (!playable.length) {
      toast('Er is nog geen audio om af te spelen.', 'error');
      return;
    }
    const first = releases[start];
    state.queue = playable;
    state.index = Math.max(0, playable.indexOf(first));
    load(true);
  },
  play(release) {
    this.playList([release], 0);
  },
  toggle() {
    if (!this.current) return;
    if (audio.paused) audio.play().catch(showError);
    else audio.pause();
  },
  next() {
    if (state.index < state.queue.length - 1) {
      state.index += 1;
      load(true);
    } else if (state.repeat && state.queue.length) {
      state.index = 0;
      load(true);
    }
  },
  prev() {
    if (audio.currentTime > 3 || state.index === 0) audio.currentTime = 0;
    else {
      state.index -= 1;
      load(true);
    }
  },
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  openVideo,
};

function emit() {
  for (const fn of listeners) fn(player.current, !audio.paused);
  render();
}

function showError() {
  if (parts.error) {
    parts.error.hidden = false;
    parts.error.lastChild.textContent = 'Kan dit nummer niet afspelen.';
  }
}

function load(autoplay) {
  const r = player.current;
  if (!r) return;
  audio.src = r.audio_url;
  if (parts.error) parts.error.hidden = true;
  if (autoplay) audio.play().catch(showError);
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: r.title,
      artist: 'Distant Youth Co.',
      album: r.folder_name || '',
      artwork: r.cover_url ? [{ src: r.cover_url, sizes: '600x600', type: 'image/jpeg' }] : [],
    });
  }
  build();
  emit();
}

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => audio.play());
  navigator.mediaSession.setActionHandler('pause', () => audio.pause());
  navigator.mediaSession.setActionHandler('previoustrack', () => player.prev());
  navigator.mediaSession.setActionHandler('nexttrack', () => player.next());
}

audio.addEventListener('play', emit);
audio.addEventListener('pause', emit);
audio.addEventListener('ended', () => player.next());
audio.addEventListener('error', () => audio.src && showError());
audio.addEventListener('timeupdate', progress);
audio.addEventListener('loadedmetadata', progress);

function progress() {
  const d = audio.duration;
  const t = audio.currentTime;
  const p = Number.isFinite(d) && d > 0 ? t / d : 0;
  for (const set of [parts, full?.parts]) {
    if (!set?.seek) continue;
    if (!set.seeking) {
      set.seek.value = String(Math.round(p * 1000));
      set.seek.style.setProperty('--fill', `${p * 100}%`);
    }
    set.seek.setAttribute('aria-valuetext', `${fmtTime(t)} van ${fmtTime(d)}`);
    if (set.time) set.time.textContent = fmtTime(t);
    if (set.total) set.total.textContent = fmtTime(d);
  }
  // The signature: the disc waxes like the moon as the track plays.
  if (parts.disc) parts.disc.style.setProperty('--phase', String(p));
}

function seekRange(set) {
  const seek = el('input', { type: 'range', class: 'range', min: 0, max: 1000, value: 0, 'aria-label': 'Positie in het nummer' });
  seek.addEventListener('input', () => {
    set.seeking = true;
    seek.style.setProperty('--fill', `${seek.value / 10}%`);
  });
  seek.addEventListener('change', () => {
    if (Number.isFinite(audio.duration)) audio.currentTime = (seek.value / 1000) * audio.duration;
    set.seeking = false;
  });
  return seek;
}

function coverFace(r) {
  return r.cover_url ? el('img', { src: r.cover_url, alt: '' }) : el('img', { src: '/img/emblem.png', alt: '' });
}

function build() {
  root = root || document.getElementById('player-root');
  const r = player.current;
  const fresh = !root.firstChild;
  clear(root);
  parts = {};
  if (!r) return;
  parts.disc = el('button', { class: 'disc', type: 'button', 'aria-label': 'Speler groot openen', onclick: openFull }, coverFace(r));
  parts.playBtn = el('button', { class: 'icon-btn solid', type: 'button', onclick: () => player.toggle() });
  parts.time = el('span', {}, '0:00');
  parts.total = el('span', {}, fmtTime(r.duration));
  parts.seek = seekRange(parts);
  const vol = el('input', { type: 'range', class: 'range volume', min: 0, max: 100, value: Math.round(audio.volume * 100), 'aria-label': 'Volume' });
  vol.style.setProperty('--fill', `${audio.volume * 100}%`);
  vol.addEventListener('input', () => {
    audio.volume = vol.value / 100;
    vol.style.setProperty('--fill', `${vol.value}%`);
  });
  parts.error = el('div', { class: 'error-text', hidden: true }, icon('circle-alert', 'sm'), el('span'));
  const bar = el('div', { class: `player ${fresh ? 'enter' : ''}`, role: 'region', 'aria-label': 'Speler' },
    parts.disc,
    el('button', { class: 'meta', type: 'button', onclick: openFull, 'aria-label': `${r.title}: speler groot openen` },
      el('b', {}, r.title), el('small', {}, 'Distant Youth Co.')),
    el('div', { class: 'controls' },
      el('button', { class: 'icon-btn plain', type: 'button', 'aria-label': 'Vorige', onclick: () => player.prev() }, icon('skip-back', 'sm')),
      parts.playBtn,
      el('button', { class: 'icon-btn plain', type: 'button', 'aria-label': 'Volgende', onclick: () => player.next() }, icon('skip-forward', 'sm'))),
    el('div', { class: 'seek' }, parts.time, parts.seek, parts.total),
    el('div', { class: 'extra' },
      el('a', { class: 'icon-btn plain', href: `#/release/${r.id}`, 'aria-label': 'Lyrics' }, icon('message-square-text', 'sm')),
      r.video_url ? el('button', { class: 'icon-btn plain', type: 'button', 'aria-label': 'Video bekijken', onclick: () => openVideo(r) }, icon('video', 'sm')) : null,
      el('button', { class: 'icon-btn plain vol-btn', type: 'button', 'aria-label': audio.muted ? 'Geluid aan' : 'Geluid uit', onclick: (e) => { audio.muted = !audio.muted; e.currentTarget.replaceChildren(icon(audio.muted ? 'volume-x' : 'volume-2', 'sm')); } }, icon(audio.muted ? 'volume-x' : 'volume-2', 'sm')),
      vol),
    parts.error);
  root.append(bar);
  render();
  progress();
}

function render() {
  const playing = !audio.paused;
  for (const set of [parts, full?.parts]) {
    if (!set?.playBtn) continue;
    set.playBtn.replaceChildren(icon(playing ? 'pause' : 'play', 'sm'));
    set.playBtn.setAttribute('aria-label', playing ? 'Pauzeren' : 'Afspelen');
  }
}

// ---------- full-screen player (phone) ----------

function openFull() {
  const r = player.current;
  if (!r || full) return;
  const set = {};
  set.playBtn = el('button', { class: 'icon-btn solid', type: 'button', onclick: () => player.toggle() });
  set.time = el('span');
  set.total = el('span');
  set.seek = seekRange(set);
  let mode = 'audio';
  const media = el('div');
  const showMedia = () => {
    clear(media);
    if (mode === 'video' && r.video_url) {
      const v = el('video', { src: r.video_url, controls: true, playsinline: true, poster: r.cover_url || undefined });
      v.currentTime = audio.currentTime;
      audio.pause();
      v.play().catch(() => {});
      media.append(v);
    } else {
      media.append(el('span', { class: 'cover big' }, el('span', { class: 'cover-face' }, coverFace(r))));
    }
  };
  const segBtn = (m, label) => el('button', { type: 'button', 'aria-pressed': String(mode === m), onclick: (e) => {
    mode = m;
    for (const b of e.currentTarget.parentNode.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
    showMedia();
  } }, label);
  const hook = hookLine(r.lyrics);
  const close = () => {
    node.remove();
    full = null;
    document.removeEventListener('keydown', onKey);
    parts.disc?.focus();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  const node = el('div', { class: 'full-player', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Speler: ${r.title}` },
    el('div', { class: 'top' },
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Speler sluiten', onclick: close }, icon('chevron-down')),
      el('div', { class: 'grow' }, el('span', { class: 'label' }, r.folder_name ? 'Speelt uit collectie' : 'Speelt nu'), el('span', { class: 'title' }, r.folder_name || 'Distant Youth Studio')),
      el('a', { class: 'icon-btn', href: `#/release/${r.id}`, 'aria-label': 'Naar de release', onclick: close }, icon('ellipsis'))),
    media,
    r.video_url ? el('div', { class: 'seg', role: 'group', 'aria-label': 'Weergave', style: { alignSelf: 'center' } }, segBtn('audio', 'Audio'), segBtn('video', 'Video')) : null,
    el('div', {}, el('div', { class: 'h-xl' }, r.title), el('div', { class: 'muted small' }, 'Distant Youth Co.')),
    el('div', { class: 'stack', style: { gap: '4px' } }, set.seek, el('div', { class: 'row xs muted', style: { justifyContent: 'space-between' } }, set.time, set.total)),
    el('div', { class: 'big-controls' },
      el('button', { class: 'icon-btn plain', type: 'button', 'aria-label': state.repeat ? 'Herhalen uit' : 'Herhalen aan', 'aria-pressed': String(state.repeat), onclick: (e) => { state.repeat = !state.repeat; e.currentTarget.setAttribute('aria-pressed', String(state.repeat)); } }, icon('repeat')),
      el('button', { class: 'icon-btn plain', type: 'button', 'aria-label': 'Vorige', onclick: () => player.prev() }, icon('skip-back')),
      set.playBtn,
      el('button', { class: 'icon-btn plain', type: 'button', 'aria-label': 'Volgende', onclick: () => player.next() }, icon('skip-forward')),
      el('a', { class: 'icon-btn plain', href: `#/release/${r.id}`, 'aria-label': 'Lyrics', onclick: close }, icon('message-square-text'))),
    hook ? el('a', { class: 'chorus', href: `#/release/${r.id}`, onclick: close }, el('span', { class: 'label' }, 'Chorus'), el('span', {}, hook)) : null);
  full = { node, parts: set };
  showMedia();
  document.body.append(node);
  document.addEventListener('keydown', onKey);
  node.querySelector('button').focus();
  render();
  progress();
}

// ---------- video ----------

function openVideo(r) {
  if (!r.video_url) return;
  const wasPlaying = player.current?.id === r.id && !audio.paused;
  const start = player.current?.id === r.id ? audio.currentTime : 0;
  audio.pause();
  let video;
  dialog((close) => {
    video = el('video', { src: r.video_url, controls: true, playsinline: true, poster: r.cover_url || undefined, style: { width: '100%' } });
    video.addEventListener('loadedmetadata', () => {
      video.currentTime = start;
      video.play().catch(() => {});
    });
    return el('div', { class: 'stack' },
      el('div', { class: 'row' }, el('span', { class: 'title' }, r.title), el('span', { class: 'spacer' }),
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Video sluiten', onclick: () => close() }, icon('x'))),
      video);
  }, 'video').then(() => {
    if (player.current?.id === r.id) {
      audio.currentTime = video.currentTime;
      if (wasPlaying) audio.play().catch(() => {});
    }
  });
}

// Space plays and pauses when focus is not in a field.
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat || !player.current) return;
  const t = e.target;
  if (t.closest('input, textarea, select, button, a, [contenteditable], video, dialog')) return;
  e.preventDefault();
  player.toggle();
});

export function stopPlayer() {
  audio.pause();
  audio.removeAttribute('src');
  state.queue = [];
  state.index = -1;
  if (root) clear(root);
  full?.node.remove();
  full = null;
}
