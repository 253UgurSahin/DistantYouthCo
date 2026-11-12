import { el, icon, moon, fmtTime, fmtDate, fmtDuration, styleFacts, parseLyrics, hookLine, STATUS_WORDS, YT_WORDS, toast, confirmDialog, formDialog } from './dom.js';
import { api } from './api.js';
import { player } from './player.js';
import { isAdmin } from './session.js';
import { standPanel } from './dashboard.js';
import { videoPlayer } from './video.js';
import { coverEl, sectionHead, emptyState, releaseCard, collectionCard, playlistCard, trackRow, addToPlaylist, namesPanel } from './parts.js';


// ---------- S01 Releases (home) ----------

export async function homeView(query) {
  const [{ releases }, { folders }, stats] = await Promise.all([api('/releases'), api('/folders'), api('/stats?months=12')]);
  const latest = releases.find((r) => r.audio_url) || releases[0];
  const page = el('div');

  // Hero: the pier, in layers.
  const hero = el('section', { class: 'hero', 'data-depth': 'scene', 'aria-labelledby': 'hero-title' },
    el('div', { class: 'hero-sky', 'data-depth-layer': '-2', 'aria-hidden': 'true' }),
    el('div', { class: 'hero-photo', 'data-depth-layer': '-1', role: 'img', 'aria-label': 'Silhouet op een steiger aan een meer onder de maan' }));
  const front = el('div', { class: 'hero-front' });
  if (latest) {
    const facts = [...styleFacts(latest.style), latest.bpm ? `${latest.bpm} BPM` : null, latest.duration ? fmtTime(latest.duration) : null].filter(Boolean);
    front.append(el('div', { class: 'wrap' },
      el('div', { class: 'hero-copy' },
        // The words float on their own layer; the buttons stay still, so they are sharp and easy to hit.
        el('div', { class: 'hero-words', 'data-depth-layer': '1' },
          el('div', { class: 'label rise', style: { '--i': '1' } }, `Laatste release${latest.folder_name ? ' · ' + latest.folder_name : ''}`),
          el('h1', { id: 'hero-title', class: 'h-display rise', style: { '--i': '2' } }, latest.title),
          facts.length ? el('div', { class: 'facts rise', style: { '--i': '3' } }, facts.join(' · ')) : null),
        el('div', { class: 'hero-actions rise', style: { '--i': '4' } },
          latest.audio_url ? el('button', { type: 'button', class: 'btn on-photo primary lg', onclick: () => player.playList(releases, releases.indexOf(latest)) }, icon('play', 'sm'), 'Afspelen') : null,
          isAdmin() ? el('a', { class: 'btn on-photo lg', href: `#/release/${latest.id}/youtube` }, 'YouTube-kit') : null,
          el('a', { class: 'btn on-photo lg', href: `#/release/${latest.id}` }, latest.lyrics ? 'Lyrics' : 'Bekijken'))),
      // The status card turns toward the pointer (a tilt card) on top of its rest lean (app.css, .lean-stage).
      el('div', { 'data-depth-layer': '2', class: 'rise lean-stage', style: { '--i': '3' } },
        el('div', { class: 'lean', 'data-depth': 'tilt', 'data-depth-tone': 'dark' },
          el('div', { class: 'label' }, 'Onderweg naar live'),
          el('div', { class: 'lean-row' }, moon(latest.on_spotify ? 'live' : 'none', 'lg'), `Spotify — ${latest.on_spotify ? 'live' : 'nog niet'}`),
          el('div', { class: 'lean-row' }, moon(latest.youtube_state, 'lg'), `YouTube — ${YT_WORDS[latest.youtube_state]}`),
          el('div', { class: 'lean-row' }, moon(latest.has.video ? 'live' : 'none', 'lg'), `Video — ${latest.has.video ? 'klaar' : 'nog niet geüpload'}`)))));
  } else {
    front.append(el('div', { class: 'wrap' }, el('div', { class: 'hero-copy', 'data-depth-layer': '1' },
      el('div', { class: 'label' }, 'Distant Youth Studio'),
      el('h1', { id: 'hero-title', class: 'h-display' }, 'Nog geen releases'),
      el('div', { class: 'facts' }, isAdmin() ? 'Begin met je WAV. De rest kun je later aanvullen.' : 'Zodra er muziek is, staat die hier.'),
      isAdmin() ? el('div', { class: 'hero-actions' }, el('a', { class: 'btn on-photo primary lg', href: '#/nieuw' }, icon('plus', 'sm'), 'Nieuwe release')) : null)));
  }
  hero.append(front);
  page.append(hero);

  const body = el('div', { class: 'wrap page' });
  page.append(body);
  if (!releases.length) return page;

  // Releases with filter and search.
  let filter = query.get('status') || 'all';
  let term = query.get('q') || '';
  const grid = el('div', { class: 'grid' });
  const count = el('span', { class: 'small faint' });
  const chipsEl = el('div', { class: 'chips', role: 'group', 'aria-label': 'Filter op status' });
  let stand = null;
  const draw = () => {
    const t = term.toLowerCase();
    const shown = releases.filter((r) => (filter === 'all' || r.status === filter) &&
      (!t || [r.title, r.style, r.lyrics].some((s) => (s || '').toLowerCase().includes(t))));
    grid.replaceChildren(...(shown.length ? shown.map((r, i) => releaseCard(r, shown, i)) : [emptyState('Niets gevonden met dit filter.')]));
    grid.classList.toggle('few', shown.length > 0 && shown.length <= 4);
    grid.style.setProperty('--n', String(Math.max(1, shown.length)));
    count.textContent = `${shown.length} van ${releases.length}`;
    for (const b of chipsEl.children) b.setAttribute('aria-pressed', String(b.dataset.f === filter));
    stand?.setActive(filter);
    window.dispatchEvent(new CustomEvent('dyc:content'));
  };
  const setFilter = (f) => {
    filter = filter === f && f !== 'all' ? 'all' : f;
    draw();
  };
  for (const [f, label] of [['all', 'Alles'], ['concept', 'Concept'], ['ready', 'Klaar voor YouTube'], ['live', 'Live']]) {
    chipsEl.append(el('button', { type: 'button', class: 'chip', dataset: { f }, onclick: () => setFilter(f) }, f === 'all' ? null : moon(f, 'sm'), label));
  }
  const search = el('input', { type: 'search', id: 'search', placeholder: 'Zoek op titel, stijl of lyrics', value: term, 'aria-label': 'Zoek in je muziek' });
  search.addEventListener('input', () => {
    term = search.value;
    draw();
  });
  body.append(el('section', { class: 'stack', 'aria-labelledby': 'rel-h', style: { gap: 'var(--space-6)' } },
    el('div', { class: 'section-head' }, el('h2', { id: 'rel-h' }, 'Releases'), count, el('span', { class: 'rule' })),
    el('div', { class: 'toolbar' }, chipsEl, el('span', { class: 'spacer' }), el('label', { class: 'search' }, icon('search', 'sm'), search)),
    grid));

  // Collections.
  if (folders.length) {
    body.append(el('section', { class: 'stack', style: { gap: 'var(--space-6)' } },
      sectionHead('Collecties', el('a', { href: '#/collecties' }, 'Alle collecties')),
      el('div', { class: 'coll-grid' }, folders.slice(0, 6).map((f, i) => collectionCard(f, i + 1)))));
  }

  // The stand of the night: the dashboard of this app (level 3). A number drills down to the grid.
  stand = standPanel(stats, (f) => {
    filter = f;
    draw();
    grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  body.append(stand);

  draw();
  if (query.get('focus') === 'search') setTimeout(() => search.focus(), 50);
  return page;
}

// ---------- S02 Release ----------

export async function releaseView(id) {
  const { release: r } = await api(`/releases/${id}`);
  const admin = isAdmin();
  const facts = ['Distant Youth Co.', r.release_date ? fmtDate(r.release_date) : null, r.duration ? fmtTime(r.duration) : null, r.bpm ? `${r.bpm} BPM` : null].filter(Boolean);
  const hook = hookLine(r.lyrics);
  const sections = parseLyrics(r.lyrics);

  // The head is a depth scene: the cover lies behind, the words in front, the status card nearest.
  // No drift, so the buttons rest; the layers move with the pointer and as the page scrolls.
  const head = el('section', { class: 'release-head', 'data-depth': 'scene', 'data-depth-drift': '0' },
    el('div', { 'data-depth-layer': '-1', class: 'cover-layer' }, coverEl(r, 'big', { tilt: true })),
    el('div', { class: 'copy', 'data-depth-layer': '1' },
      el('div', { class: 'label rise', style: { '--i': '1' } }, r.folder_name ? [el('span', { class: 'wide-only' }, 'Release · '), `collectie ${r.folder_name}`] : 'Release', admin && r.hidden ? ' · concept, verborgen' : ''),
      el('h1', { class: 'h-display rise', style: { '--i': '2' } }, r.title),
      el('div', { class: 'muted rise', style: { '--i': '3' } }, facts.join(' · ')),
      // On a phone the status card falls below the first screen: the release's moon shows here too.
      el('div', { class: 'phone-status rise', style: { '--i': '3' }, 'aria-hidden': 'true' }, moon(r.status), STATUS_WORDS[r.status]),
      el('div', { class: 'row rise', style: { '--i': '4' } },
        r.audio_url ? el('button', { type: 'button', class: 'btn primary lg', onclick: () => player.play(r) }, icon('play', 'sm'), 'Afspelen') : null,
        r.video_url ? el('button', { type: 'button', class: 'btn subtle lg', onclick: () => player.openVideo(r) }, icon('video', 'sm'), 'Video') : null,
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Aan playlist toevoegen', onclick: () => addToPlaylist(r).catch((e) => toast(e.message, 'error')) }, icon('plus', 'sm')),
        el('span', { class: 'spacer' }),
        admin ? el('a', { class: 'btn subtle lg', href: `#/release/${r.id}/youtube` }, 'YouTube-kit') : null,
        admin ? el('a', { class: 'btn subtle lg', href: `#/release/${r.id}/bewerken` }, icon('pencil', 'sm'), 'Bewerken') : null),
      el('div', { class: 'lean lean-plain status-rows rise', style: { '--i': '5' }, role: 'group', 'aria-label': 'Onderweg naar live' },
        el('span', { class: 'label' }, 'Onderweg naar live'),
        el('span', { class: 'status' }, moon(r.on_spotify ? 'live' : 'none'), `Spotify — ${r.on_spotify ? 'live' : 'nog niet'}`,
          r.spotify_url ? el('a', { href: r.spotify_url, target: '_blank', rel: 'noopener', 'aria-label': 'Open op Spotify' }, icon('external-link', 'xs')) : null),
        el('span', { class: 'status' }, moon(r.youtube_state), `YouTube — ${YT_WORDS[r.youtube_state]}`,
          r.youtube_url ? el('a', { href: r.youtube_url, target: '_blank', rel: 'noopener', 'aria-label': 'Open op YouTube' }, icon('external-link', 'xs')) : null))));

  const lyrics = el('section', { class: 'lyrics rise', style: { '--i': '5' }, 'aria-labelledby': 'lyr-h' },
    el('h2', { id: 'lyr-h', class: 'label' }, 'Lyrics'),
    sections.some((s) => s.lines.length)
      ? sections.filter((s) => s.lines.length).map((s) => el('div', {},
        s.name ? el('h3', {}, s.name) : null,
        s.lines.map((line) => el('p', { class: line === hook ? 'hook' : '' }, line))))
      : el('p', {}, 'Geen lyrics — instrumentaal of nog niet ingevuld.'));

  const side = el('div', { class: 'side-col' });
  if (r.video_url) {
    side.append(el('section', { class: 'stack', style: { gap: '12px' }, 'aria-labelledby': 'vid-h' },
      el('h2', { id: 'vid-h', class: 'label' }, r.video_type || 'Video'),
      videoPlayer(r)));
  }
  if (admin) {
    side.append(el('section', { class: 'panel quiet', 'aria-labelledby': 'files-h' },
      el('h2', { id: 'files-h', class: 'label' }, 'Bestanden'),
      [['wav', 'WAV', 'Master (origineel)', r.has.wav], ['mp3', 'MP3', r.mp3_generated ? '320 kbps — automatisch uit WAV' : 'Geüpload', r.has.mp3], ['video', 'MP4', r.video_type || 'Video', r.has.video]]
        .filter((f) => f[3])
        .map(([k, kind, what]) => el('div', { class: 'file-row' }, el('span', { class: 'kind' }, kind), el('span', { class: 'what' }, what),
          el('a', { class: 'icon-btn plain', href: `/media/${r.id}/${k}?download=1`, 'aria-label': `${kind} downloaden` }, icon('download', 'sm')))),
      r.processing ? el('p', { class: 'small muted' }, 'MP3 en cover worden nog gemaakt…') : null));
    if (r.notes) side.append(el('section', { class: 'panel quiet stack', style: { gap: '8px' } }, el('h2', { class: 'label' }, 'Notities'), el('p', { class: 'small', style: { margin: 0, whiteSpace: 'pre-line' } }, r.notes)));
  }

  const style = r.style ? el('section', { class: 'panel quiet stack', style: { gap: '8px' } }, el('h2', { class: 'label' }, 'Style'), el('p', { class: 'small', style: { margin: 0 } }, r.style)) : null;
  return el('div', { class: 'wrap page' }, head, el('div', { class: 'cols' }, el('div', { class: 'main-col stack' }, lyrics, style), side));
}

// ---------- S05 Collections and playlists ----------

export async function collectionsView() {
  const { folders } = await api('/folders');
  const add = async () => {
    const v = await formDialog('Nieuwe collectie', [{ name: 'name', label: 'Naam', required: true, hint: 'Een album, EP of reeks. Je kunt Claude later een naam laten voorstellen.' }, { name: 'description', label: 'Omschrijving', type: 'textarea' }]);
    if (!v?.name) return;
    const { folder } = await api('/folders', { method: 'POST', body: v });
    location.hash = `#/collectie/${folder.id}`;
  };
  return el('div', { class: 'wrap page' },
    el('div', { class: 'row' }, el('h1', { class: 'h-xl' }, 'Collecties'), el('span', { class: 'spacer' }),
      isAdmin() ? el('button', { type: 'button', class: 'btn primary', onclick: () => add().catch((e) => toast(e.message, 'error')) }, icon('plus', 'sm'), 'Nieuwe collectie') : null),
    folders.length ? el('div', { class: 'coll-grid' }, folders.map((f, i) => collectionCard(f, i + 1)))
      : emptyState(isAdmin() ? 'Nog geen collecties. Maak er een voor een album, EP of reeks.' : 'Nog geen collecties.'));
}

function listHead({ label, name, description, meta, covers, actions }) {
  return el('section', { class: 'release-head' },
    el('div', { class: 'stacked', 'aria-hidden': 'true' },
      (covers.length ? covers : [null]).slice(0, 3).map((c) => el('span', { class: 'cover' }, c
        ? el('span', { class: 'cover-face' }, el('img', { src: c, alt: '' }))
        : el('span', { class: 'cover-face empty' }, el('img', { src: '/img/emblem.png', alt: '' }))))),
    el('div', { class: 'copy' },
      el('div', { class: 'label' }, label),
      el('h1', { class: 'h-display' }, name),
      description ? el('p', { class: 'muted', style: { margin: 0 } }, description) : null,
      el('div', { class: 'small muted' }, meta),
      el('div', { class: 'row' }, actions)));
}

export async function collectionView(id) {
  const { folder: f } = await api(`/folders/${id}`);
  const list = f.releases;
  const admin = isAdmin();
  const edit = async () => {
    const v = await formDialog('Collectie bewerken', [{ name: 'name', label: 'Naam', value: f.name, required: true }, { name: 'description', label: 'Omschrijving', type: 'textarea', value: f.description }]);
    if (!v?.name) return;
    await api(`/folders/${f.id}`, { method: 'PUT', body: v });
    toast('Opgeslagen');
    window.dispatchEvent(new CustomEvent('dyc:reload'));
  };
  const remove = async () => {
    if (!(await confirmDialog('Collectie verwijderen?', `"${f.name}" verdwijnt. De releases zelf blijven bestaan.`))) return;
    await api(`/folders/${f.id}`, { method: 'DELETE' });
    location.hash = '#/collecties';
  };
  const actions = [
    list.some((r) => r.audio_url) ? el('button', { type: 'button', class: 'btn primary lg', onclick: () => player.playList(list, 0) }, icon('play', 'sm'), 'Afspelen') : null,
    list.length > 1 ? el('button', { type: 'button', class: 'btn subtle lg', onclick: () => { const s = [...list].sort(() => Math.random() - 0.5); player.playList(s, 0); } }, icon('shuffle', 'sm'), 'Shuffle') : null,
    admin ? el('button', { type: 'button', class: 'btn subtle lg', onclick: () => edit().catch((e) => toast(e.message, 'error')) }, icon('pencil', 'sm'), 'Bewerken') : null,
    admin ? el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Collectie verwijderen', onclick: () => remove().catch((e) => toast(e.message, 'error')) }, icon('trash-2', 'sm')) : null,
  ];
  const useName = async (name) => {
    await api(`/folders/${f.id}`, { method: 'PUT', body: { name, description: f.description } });
    toast(`De collectie heet nu ${name}`);
    window.dispatchEvent(new CustomEvent('dyc:reload'));
  };
  return el('div', { class: 'wrap page' },
    listHead({ label: 'Collectie', name: f.name, description: f.description, meta: `${list.length} ${list.length === 1 ? 'release' : 'releases'}${f.duration ? ' · ' + fmtDuration(f.duration) : ''}`, covers: f.covers, actions }),
    el('div', { class: 'cols' },
      el('section', { class: 'main-col', 'aria-labelledby': 'trk-h' },
        el('h2', { id: 'trk-h', class: 'label', style: { marginBottom: '12px' } }, 'Nummers'),
        list.length ? el('ol', { class: 'tracks' }, list.map((r, i) => trackRow(r, list, i)))
          : emptyState(admin ? 'Nog geen nummers. Kies deze collectie bij een release (Bewerken → Collectie).' : 'Nog geen nummers.')),
      admin ? el('div', { class: 'side-col' }, list.length ? namesPanel('folders', f.id, (n) => useName(n).catch((e) => toast(e.message, 'error'))) : null) : null));
}

export async function playlistsView() {
  const { playlists } = await api('/playlists');
  const add = async () => {
    const v = await formDialog('Nieuwe playlist', [{ name: 'name', label: 'Naam', required: true }, { name: 'is_public', label: 'Zichtbaar voor alle accounts', type: 'checkbox' }]);
    if (!v?.name) return;
    const { playlist } = await api('/playlists', { method: 'POST', body: v });
    location.hash = `#/playlist/${playlist.id}`;
  };
  return el('div', { class: 'wrap page' },
    el('div', { class: 'row' }, el('h1', { class: 'h-xl' }, 'Playlists'), el('span', { class: 'spacer' }),
      el('button', { type: 'button', class: 'btn primary', onclick: () => add().catch((e) => toast(e.message, 'error')) }, icon('plus', 'sm'), 'Nieuwe playlist')),
    playlists.length ? el('div', { class: 'coll-grid' }, playlists.map((p, i) => playlistCard(p, i + 1)))
      : emptyState('Nog geen playlists. Voeg nummers toe met de + bij een release.'));
}

export async function playlistView(id) {
  const { playlist: p } = await api(`/playlists/${id}`);
  const list = p.releases;
  const reload = () => window.dispatchEvent(new CustomEvent('dyc:reload'));
  const fail = (e) => toast(e.message, 'error');
  const move = async (i, d) => {
    const ids = list.map((r) => r.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    await api(`/playlists/${p.id}/order`, { method: 'PUT', body: { release_ids: ids } });
    reload();
  };
  const tools = (r, i) => p.can_edit ? el('span', { class: 'tools' },
    el('button', { type: 'button', class: 'icon-btn plain', 'aria-label': `${r.title} omhoog`, disabled: i === 0, onclick: () => move(i, -1).catch(fail) }, icon('arrow-up', 'sm')),
    el('button', { type: 'button', class: 'icon-btn plain', 'aria-label': `${r.title} omlaag`, disabled: i === list.length - 1, onclick: () => move(i, 1).catch(fail) }, icon('arrow-down', 'sm')),
    el('button', { type: 'button', class: 'icon-btn plain', 'aria-label': `${r.title} uit de playlist halen`, onclick: () => api(`/playlists/${p.id}/items/${r.id}`, { method: 'DELETE' }).then(reload, fail) }, icon('x', 'sm'))) : null;
  const edit = async () => {
    const v = await formDialog('Playlist bewerken', [{ name: 'name', label: 'Naam', value: p.name, required: true }, { name: 'description', label: 'Omschrijving', type: 'textarea', value: p.description }, { name: 'is_public', label: 'Zichtbaar voor alle accounts', type: 'checkbox', value: p.is_public }]);
    if (!v?.name) return;
    await api(`/playlists/${p.id}`, { method: 'PUT', body: v });
    reload();
  };
  const remove = async () => {
    if (!(await confirmDialog('Playlist verwijderen?', `"${p.name}" verdwijnt. De nummers zelf blijven bestaan.`))) return;
    await api(`/playlists/${p.id}`, { method: 'DELETE' });
    location.hash = '#/playlists';
  };
  const useName = async (name) => {
    await api(`/playlists/${p.id}`, { method: 'PUT', body: { name, description: p.description, is_public: p.is_public } });
    toast(`De playlist heet nu ${name}`);
    reload();
  };
  const actions = [
    list.some((r) => r.audio_url) ? el('button', { type: 'button', class: 'btn primary lg', onclick: () => player.playList(list, 0) }, icon('play', 'sm'), 'Afspelen') : null,
    p.can_edit ? el('button', { type: 'button', class: 'btn subtle lg', onclick: () => edit().catch(fail) }, icon('pencil', 'sm'), 'Bewerken') : null,
    p.can_edit ? el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Playlist verwijderen', onclick: () => remove().catch(fail) }, icon('trash-2', 'sm')) : null,
  ];
  return el('div', { class: 'wrap page' },
    listHead({ label: `Playlist · ${p.mine ? 'van jou' : 'van ' + p.owner}${p.is_public ? ' · gedeeld' : ''}`, name: p.name, description: p.description,
      meta: `${list.length} ${list.length === 1 ? 'nummer' : 'nummers'}${p.duration ? ' · ' + fmtDuration(p.duration) : ''}`, covers: list.filter((r) => r.cover_url).map((r) => r.cover_url), actions }),
    el('div', { class: 'cols' },
      el('section', { class: 'main-col', 'aria-labelledby': 'trk-h' },
        el('h2', { id: 'trk-h', class: 'label', style: { marginBottom: '12px' } }, 'Nummers'),
        list.length ? el('ol', { class: 'tracks' }, list.map((r, i) => trackRow(r, list, i, tools(r, i))))
          : emptyState('Nog leeg. Voeg nummers toe met de + op een release-pagina.')),
      p.can_edit && list.length ? el('div', { class: 'side-col' }, namesPanel('playlists', p.id, (n) => useName(n).catch(fail))) : null));
}

export { STATUS_WORDS };
