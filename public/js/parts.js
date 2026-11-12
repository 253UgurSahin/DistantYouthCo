import { el, icon, moon, fmtTime, fmtDuration, STATUS_WORDS, toast, formDialog, dialog, append } from './dom.js';
import { api } from './api.js';
import { player } from './player.js';
import { session } from './session.js';

export function coverEl(r, cls = '', { gray = false, tilt = false } = {}) {
  const face = r?.cover_url
    ? el('span', { class: 'cover-face', ...(tilt ? { 'data-depth-layer': '1' } : {}) }, el('img', { src: r.cover_url, alt: '', loading: 'lazy' }))
    : el('span', { class: 'cover-face empty', ...(tilt ? { 'data-depth-layer': '1' } : {}) }, el('img', { src: '/img/emblem.png', alt: '' }));
  return el('span', { class: `cover ${cls} ${gray ? 'gray' : ''}`.trim(), ...(tilt ? { 'data-depth': 'tilt' } : {}) }, face);
}

export function sectionHead(title, link) {
  return el('div', { class: 'section-head' }, el('h2', {}, title), el('span', { class: 'rule', 'aria-hidden': 'true' }), link || null);
}

export function emptyState(text, action) {
  return el('div', { class: 'empty' }, el('img', { src: '/img/emblem.png', alt: '' }), el('p', {}, text), action || null);
}

export function releaseCard(r, list, i) {
  const isPlaying = player.current?.id === r.id;
  return el('div', { class: `card rise ${isPlaying ? 'playing' : ''}`, style: { '--i': String(Math.min(i, 8)) } },
    el('div', { class: 'cover-wrap' },
      el('a', { href: `#/release/${r.id}`, 'aria-label': r.title }, coverEl(r, '', { gray: true, tilt: true })),
      r.audio_url
        ? el('button', { class: 'icon-btn solid play-on-cover', type: 'button', 'aria-label': `Speel ${r.title}`, onclick: () => player.playList(list, i) }, icon('play', 'sm'))
        : null),
    el('a', { href: `#/release/${r.id}`, class: 'title', style: { textDecoration: 'none' } }, r.title),
    el('span', { class: 'status' }, moon(r.status, 'sm'), STATUS_WORDS[r.status]));
}

export function collectionCard(f, nr) {
  return el('a', { class: 'coll-card scroll-in', href: `#/collectie/${f.id}` },
    el('span', { class: 'nr', 'aria-hidden': 'true' }, String(nr).padStart(2, '0')),
    el('span', { class: 'grow' },
      el('span', { class: 'title' }, f.name),
      el('span', { class: 'small muted' }, f.count ? `${f.count} ${f.count === 1 ? 'release' : 'releases'}${f.duration ? ' · ' + fmtDuration(f.duration) : ''}` : 'Nog leeg')),
    icon('chevron-right'));
}

export function playlistCard(p, nr) {
  return el('a', { class: 'coll-card scroll-in', href: `#/playlist/${p.id}` },
    el('span', { class: 'nr', 'aria-hidden': 'true' }, String(nr).padStart(2, '0')),
    el('span', { class: 'grow' },
      el('span', { class: 'title' }, p.name),
      el('span', { class: 'small muted' }, `${p.count} ${p.count === 1 ? 'nummer' : 'nummers'} · ${p.mine ? 'van jou' : 'van ' + p.owner}${p.is_public ? ' · gedeeld' : ''}`)),
    icon('chevron-right'));
}

const YT = { live: 'live', ready: 'klaar', none: 'nog niet' };

/** One row of a track list. tools: extra controls (playlist editing). */
export function trackRow(r, list, i, tools) {
  const playing = player.current?.id === r.id;
  return el('li', { class: `track ${playing ? 'playing' : ''} ${tools ? 'has-tools' : ''}` },
    el('span', { class: 'nr' }, String(i + 1).padStart(2, '0')),
    r.audio_url
      ? el('button', { type: 'button', class: 'cover-btn', style: { background: 'none', border: '0', padding: '0' }, 'aria-label': `Speel ${r.title}`, onclick: () => player.playList(list, i) }, coverEl(r, 'xs', { gray: true }))
      : coverEl(r, 'xs', { gray: true }),
    el('a', { class: 't', href: `#/release/${r.id}` }, el('span', { class: 'title' }, r.title), el('span', { class: 'small muted' }, r.style ? r.style.split(',')[0] : '')),
    el('span', { class: 'badges', 'aria-label': 'Bestanden' },
      el('span', {}, 'WAV'), el('span', { class: r.has.mp3 ? '' : 'off' }, 'MP3'), el('span', { class: r.has.video ? '' : 'off' }, 'MP4')),
    el('span', { class: 'st' },
      el('span', {}, moon(r.youtube_state === 'none' ? 'none' : r.youtube_state, 'sm'), `YouTube · ${YT[r.youtube_state]}`),
      el('span', {}, moon(r.on_spotify ? 'live' : 'none', 'sm'), `Spotify · ${r.on_spotify ? 'live' : 'niet uit'}`)),
    el('span', { class: 'dur' }, r.duration ? fmtTime(r.duration) : '–:––'),
    tools || null);
}

/** "Add to playlist": a small dialog with the user's own playlists and a new one. */
export async function addToPlaylist(release) {
  const { playlists } = await api('/playlists');
  const mine = playlists.filter((p) => p.can_edit);
  const choice = await dialog((close) =>
    el('div', { class: 'stack' },
      el('h2', { class: 'h-xl' }, 'Aan playlist toevoegen'),
      mine.length
        ? el('div', { class: 'stack', style: { gap: '8px' } },
          mine.map((p) => el('button', { type: 'button', class: 'btn subtle', style: { justifyContent: 'flex-start' }, onclick: () => close(p) }, icon('list-music', 'sm'), p.name)))
        : el('p', { class: 'muted' }, 'Je hebt nog geen playlists.'),
      el('div', { class: 'row', style: { justifyContent: 'flex-end' } },
        el('button', { type: 'button', class: 'btn subtle', onclick: () => close(null) }, 'Annuleren'),
        el('button', { type: 'button', class: 'btn primary', onclick: () => close('new') }, icon('plus', 'sm'), 'Nieuwe playlist'))));
  if (!choice) return;
  let target = choice;
  if (choice === 'new') {
    const v = await formDialog('Nieuwe playlist', [{ name: 'name', label: 'Naam', required: true }]);
    if (!v?.name) return;
    target = (await api('/playlists', { method: 'POST', body: { name: v.name } })).playlist;
  }
  await api(`/playlists/${target.id}/items`, { method: 'POST', body: { release_id: release.id } });
  toast(`Toegevoegd aan ${target.name}`);
}

/** The album-name panel for a collection or playlist. */
export function namesPanel(kind, id, onUse) {
  const out = el('div', { class: 'names' });
  const dir = el('input', { class: 'input', id: `dir-${kind}`, placeholder: 'bv. kort, één woord, iets met nacht', maxlength: 300 });
  const btn = el('button', { type: 'button', class: 'btn primary lg' }, 'Stel namen voor');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    out.replaceChildren(...[0, 1, 2].map(() => el('div', { class: 'skeleton', 'aria-hidden': 'true' })), el('span', { class: 'sr-only' }, 'Claude denkt na…'));
    try {
      const res = await api(`/${kind}/${id}/suggest-names`, { method: 'POST', body: { direction: dir.value } });
      out.replaceChildren(el('div', { class: 'label' }, 'Voorstellen'), ...res.suggestions.map((s) =>
        el('div', { class: 'name-row' },
          el('span', { class: 'grow' }, el('span', { class: 'title' }, s.name), el('span', { class: 'small muted' }, s.why)),
          el('button', { type: 'button', class: 'btn subtle sm', onclick: () => onUse(s.name) }, 'Gebruik'))));
    } catch (e) {
      out.replaceChildren(...[el('p', { class: 'error-text' }, icon('circle-alert', 'sm'), e.message),
        session.user?.role === 'admin' && /Instellingen/.test(e.message) ? el('a', { href: '#/instellingen', class: 'small' }, 'Naar Instellingen') : null].filter(Boolean));
    } finally {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    }
  });
  return el('aside', { class: 'panel', 'aria-labelledby': `names-${kind}` },
    el('div', { class: 'stack' },
      el('div', { class: 'row' }, icon('moon'), el('h2', { class: 'title', id: `names-${kind}` }, 'Albumnaam voorstellen')),
      el('p', { class: 'small muted', style: { margin: 0 } }, 'Claude leest de titels, styles en lyrics van de nummers hierin en zoekt de rode draad.'),
      el('div', { class: 'field' }, el('label', { for: `dir-${kind}` }, 'Richting (optioneel)'), dir),
      btn,
      out));
}

export function loading() {
  return el('div', { class: 'wrap page', 'aria-busy': 'true' }, el('div', { class: 'skeleton', style: { height: '320px' } }), el('span', { class: 'sr-only' }, 'Laden…'));
}

export function errorPage(e) {
  return el('div', { class: 'wrap page' }, emptyState(e.status === 404 ? 'Dit bestaat niet (meer).' : e.message, el('a', { class: 'btn subtle', href: '#/' }, 'Naar releases')));
}

export { append };
