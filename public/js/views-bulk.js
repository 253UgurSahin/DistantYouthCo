import { el, icon, toast } from './dom.js';
import { api, sendRelease } from './api.js';
import { session, isAdmin } from './session.js';
import { youtubeIdOf } from './video.js';

// Several releases at once: drop a pile of files, every WAV becomes a release and the MP4, MP3 and
// cover with the same name (or a name like "<title> cover") go with it. Titles come from the file
// names and can be changed here; the rest (style, lyrics) later on each release.

const KINDS = [
  ['wav', /\.wav$/i, 'WAV'],
  ['mp3', /\.mp3$/i, 'MP3'],
  ['video', /\.(mp4|m4v|mov)$/i, 'MP4'],
  ['cover', /\.(jpe?g|png|webp)$/i, 'cover'],
];
const VIDEO_TYPES = ['Official Visualizer', 'Official Lyric Video', 'Official Audio', 'Official Music Video'];
const kindOf = (f) => KINDS.find(([, re]) => re.test(f.name))?.[0] ?? null;
const base = (name) => name.replace(/\.[^.]+$/, '');
// "Lanterns_in_the_Rain (1)" -> "Lanterns in the Rain"
const titleOf = (name) => base(name).replace(/[_]+/g, ' ').replace(/\s*\(\d+\)$/, '').replace(/\s+/g, ' ').trim();
const keyOf = (name) => titleOf(name).toLowerCase();
// "Lanterns in the Rain - cover", "… (Official Visualizer)", "…_video": the same release.
const looseKey = (name) => keyOf(name).replace(/[\s\-_.([]*(official\s+)?(lyric\s+video|music\s+video|visualizer|video|cover|artwork|art|audio)[)\]]?$/i, '').trim();
const mb = (n) => (n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1).replace('.', ',')} MB`);

export async function bulkView() {
  if (!isAdmin()) throw Object.assign(new Error('Alleen voor admin'), { status: 403 });
  const [{ folders }, settings, { releases }] = await Promise.all([api('/folders'), api('/settings'), api('/releases')]);
  const existing = new Set(releases.map((r) => r.title.trim().toLowerCase()));

  /** @type {{ key: string, title: string, files: Record<string, File>, youtube: string, state: string, error?: string, id?: number }[]} */
  let groups = [];
  let loose = []; // files without a WAV to go with
  let busy = false;

  const addFiles = (list) => {
    const incoming = [...list];
    for (const f of incoming.filter((f) => kindOf(f) === 'wav')) {
      const key = keyOf(f.name);
      const g = groups.find((x) => x.key === key && x.state !== 'done');
      if (g) g.files.wav = f;
      else groups.push({ key, title: titleOf(f.name), files: { wav: f }, youtube: '', state: 'ready', skip: existing.has(key) });
    }
    const rest = [...loose, ...incoming.filter((f) => kindOf(f) && kindOf(f) !== 'wav')];
    loose = [];
    for (const f of rest) {
      const open = groups.filter((x) => x.state !== 'done');
      const g = open.find((x) => x.key === keyOf(f.name)) || open.find((x) => x.key === looseKey(f.name) || looseKey(x.title) === looseKey(f.name));
      if (g) g.files[kindOf(f)] = f;
      else loose.push(f);
    }
    // One release and the other files did not match by name: they are its files.
    const open = groups.filter((x) => x.state !== 'done');
    if (open.length === 1) {
      for (const f of [...loose]) {
        if (!open[0].files[kindOf(f)]) {
          open[0].files[kindOf(f)] = f;
          loose.splice(loose.indexOf(f), 1);
        }
      }
    }
    const unknown = incoming.filter((f) => !kindOf(f));
    if (unknown.length) toast(`${unknown.length === 1 ? `${unknown[0].name} is` : `${unknown.length} bestanden zijn`} geen WAV, MP3, MP4 of afbeelding en ${unknown.length === 1 ? 'blijft' : 'blijven'} buiten.`, 'error');
    paint();
  };

  // ---------- the drop zone ----------
  const picker = el('input', { type: 'file', multiple: true, class: 'sr-only', tabindex: '-1', id: 'bulk-files', accept: '.wav,.mp3,.mp4,.m4v,.mov,.jpg,.jpeg,.png,.webp,audio/wav,audio/mpeg,video/mp4,image/*' });
  picker.addEventListener('change', () => { addFiles(picker.files); picker.value = ''; });
  const drop = el('div', { class: 'bulk-drop slot lead' },
    el('span', { class: 'slot-kind', 'aria-hidden': 'true' }, icon('files')),
    el('div', { class: 'slot-text' },
      el('b', {}, 'Sleep al je bestanden tegelijk hierheen'),
      el('div', { class: 'xs muted' }, 'Elke WAV wordt een release. Een MP4, MP3 of cover met dezelfde naam gaat erbij, bijvoorbeeld "Lanterns in the Rain.wav" en "Lanterns in the Rain.mp4".')),
    el('label', { for: 'bulk-files', class: 'btn primary', role: 'button', tabindex: '0', onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); } } }, icon('upload', 'sm'), 'Kies bestanden'),
    picker);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('dragover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('dragover'); if (!busy) addFiles(e.dataTransfer.files); });

  // ---------- for all of them ----------
  const remembered = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const remember = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };
  const lastType = VIDEO_TYPES.includes(remembered('dyc-last-type')) ? remembered('dyc-last-type') : settings.settings.default_video_type;
  const folder = el('select', { class: 'select', id: 'b-folder' }, el('option', { value: '' }, 'Geen collectie'), folders.map((f) => el('option', { value: String(f.id), selected: String(f.id) === remembered('dyc-last-folder') }, f.name)));
  const vtype = el('select', { class: 'select', id: 'b-type' }, VIDEO_TYPES.map((t) => el('option', { value: t, selected: t === lastType }, t)));
  const hidden = el('input', { type: 'checkbox', id: 'b-hidden' });
  const shared = el('div', { class: 'form-grid' },
    el('div', { class: 'field' }, el('label', { for: 'b-folder' }, 'Collectie voor allemaal'), folder),
    el('div', { class: 'field' }, el('label', { for: 'b-type' }, 'Video-type'), vtype));

  // ---------- the list ----------
  const list = el('ol', { class: 'bulk-list', 'aria-label': 'Releases om te uploaden' });
  const looseBox = el('div', { role: 'status' });
  const summary = el('p', { class: 'small muted', 'aria-live': 'polite' });
  const go = el('button', { type: 'button', class: 'btn primary lg' }, icon('upload', 'sm'), el('span', {}, 'Uploaden'));

  const chip = (g, kind, label) => {
    const f = g.files[kind];
    if (!f) return null;
    return el('span', { class: 'bulk-chip' }, el('b', {}, label), el('span', { class: 'xs muted' }, mb(f.size)),
      kind !== 'wav' && g.state === 'ready' && !busy ? el('button', { type: 'button', class: 'icon-btn plain xs-btn', 'aria-label': `${label} weghalen bij ${g.title}`, onclick: () => { delete g.files[kind]; paint(); } }, icon('x', 'xs')) : null);
  };
  const row = (g, i) => {
    const id = `b-title-${i}`;
    const title = el('input', { class: 'input', id, value: g.title, maxlength: 200, disabled: g.state !== 'ready' && g.state !== 'error', 'aria-invalid': g.title.trim() ? undefined : 'true' });
    // A release that is already there is skipped, unless you say otherwise: no doubles by accident.
    const isDup = () => existing.has(g.title.trim().toLowerCase());
    title.addEventListener('change', () => { g.title = title.value; g.skip = isDup(); paint(); });
    title.addEventListener('input', () => { g.title = title.value; });
    const dup = isDup() && (g.state === 'ready' || g.state === 'error')
      ? el('div', { class: 'xs bulk-warn row', style: { gap: '8px' } }, icon('circle-alert', 'xs'),
        g.skip ? 'Bestaat al: wordt overgeslagen.' : 'Bestaat al: wordt toch nog een keer geüpload.',
        el('button', { type: 'button', class: 'btn ghost sm', disabled: busy, onclick: () => { g.skip = !g.skip; paint(); } }, g.skip ? 'Toch uploaden' : 'Overslaan'))
      : null;
    const yt = el('input', { class: 'input', type: 'url', inputmode: 'url', id: `b-yt-${i}`, value: g.youtube, placeholder: 'https://youtu.be/…', disabled: g.state !== 'ready' && g.state !== 'error' });
    yt.addEventListener('input', () => { g.youtube = yt.value.trim(); });
    const bar = el('div', { class: 'progress', hidden: g.state !== 'busy' }, el('i'));
    g.bar = bar;
    const state = {
      ready: null,
      waiting: el('span', { class: 'xs muted' }, 'Wacht op zijn beurt…'),
      busy: el('span', { class: 'xs muted' }, 'Bezig met uploaden…'),
      done: el('a', { class: 'xs bulk-ok', href: `#/release/${g.id}` }, icon('circle-check', 'xs'), 'Klaar: naar de release'),
      error: el('span', { class: 'xs error-text', role: 'alert' }, icon('circle-x', 'xs'), g.error || 'Mislukt'),
    }[g.state];
    return el('li', { class: `bulk-row ${g.state}${g.skip ? ' skipped' : ''}` },
      el('div', { class: 'bulk-head' },
        el('div', { class: 'field grow' }, el('label', { for: id, class: 'sr-only' }, `Titel ${i + 1}`), title),
        g.state === 'ready' || g.state === 'error' ? el('button', { type: 'button', class: 'icon-btn plain', disabled: busy, 'aria-label': `${g.title || 'Release'} niet uploaden`, onclick: () => { groups.splice(groups.indexOf(g), 1); paint(); } }, icon('x', 'sm')) : null),
      dup,
      el('div', { class: 'bulk-chips' }, chip(g, 'wav', 'WAV'), chip(g, 'video', 'MP4'), chip(g, 'mp3', 'MP3'), chip(g, 'cover', 'Cover')),
      g.files.video ? null : el('div', { class: 'field' }, el('label', { for: `b-yt-${i}`, class: 'xs muted' }, 'Geen MP4? YouTube-link (optioneel)'), yt),
      bar, state);
  };

  const paint = () => {
    list.replaceChildren(...groups.map(row));
    looseBox.replaceChildren(loose.length
      ? el('p', { class: 'small bulk-warn' }, icon('circle-alert', 'sm'), `Geen WAV gevonden voor: ${loose.map((f) => f.name).join(', ')}. Voeg de WAV met dezelfde naam toe, of laat ze weg.`)
      : '');
    const todo = groups.filter((g) => (g.state === 'ready' || g.state === 'error') && !g.skip);
    const bytes = todo.reduce((n, g) => n + Object.values(g.files).reduce((m, f) => m + f.size, 0), 0);
    const done = groups.filter((g) => g.state === 'done').length;
    const skipped = groups.filter((g) => g.skip && g.state !== 'done').length;
    summary.textContent = groups.length
      ? [todo.length ? `${todo.length} ${todo.length === 1 ? 'release' : 'releases'} klaar om te uploaden · ${mb(bytes)}` : '', skipped ? `${skipped} overgeslagen (bestaat al)` : '', done ? `${done} geüpload` : ''].filter(Boolean).join(' · ')
      : 'Nog geen bestanden gekozen.';
    go.disabled = busy || !todo.length;
    go.lastChild.textContent = busy ? 'Bezig…' : todo.length > 1 ? `Upload ${todo.length} releases` : 'Upload 1 release';
    if (!todo.length && !busy) go.lastChild.textContent = 'Uploaden';
    doneLink.hidden = busy || !done;
    const doneIds = groups.filter((g) => g.state === 'done').map((g) => g.id);
    fillLink.hidden = busy || !doneIds.length;
    fillLink.href = `#/aanvullen?ids=${doneIds.join(',')}`;
    go.hidden = !busy && !todo.length && doneIds.length > 0;
  };
  const doneLink = el('a', { class: 'btn subtle lg', href: '#/', hidden: true }, 'Naar de releases');
  // Next step after uploading: style and lyrics, one release after another.
  const fillLink = el('a', { class: 'btn primary lg', hidden: true }, icon('wand-sparkles', 'sm'), 'Style en lyrics aanvullen');

  const leaveGuard = (e) => { e.preventDefault(); e.returnValue = ''; };
  go.addEventListener('click', async () => {
    const todo = groups.filter((g) => (g.state === 'ready' || g.state === 'error') && !g.skip);
    const empty = todo.find((g) => !g.title.trim());
    if (empty) { toast('Elke release heeft een titel nodig.', 'error'); paint(); return; }
    const badLink = todo.find((g) => g.youtube && !g.files.video && !youtubeIdOf(g.youtube));
    if (badLink) { toast(`${badLink.title}: dit is geen link naar een YouTube-video.`, 'error'); return; }
    busy = true;
    remember('dyc-last-folder', folder.value);
    remember('dyc-last-type', vtype.value);
    for (const g of todo) g.state = 'waiting';
    window.addEventListener('beforeunload', leaveGuard);
    paint();
    let ok = 0;
    for (const g of todo) {
      g.state = 'busy';
      paint();
      const fd = new FormData();
      fd.append('title', g.title.trim());
      fd.append('folder_id', folder.value);
      fd.append('video_type', vtype.value);
      fd.append('hidden', hidden.checked ? '1' : '0');
      if (g.youtube && !g.files.video) fd.append('youtube_url', g.youtube);
      try {
        const res = await sendRelease('/releases', 'POST', fd, { ...g.files }, session.uploadChunk, (p) => { g.bar.firstChild.style.width = `${Math.round(p * 100)}%`; });
        g.state = 'done';
        g.id = res.release.id;
        existing.add(g.title.trim().toLowerCase());
        ok++;
      } catch (e) {
        g.state = 'error';
        g.error = e.message;
      }
      paint();
    }
    busy = false;
    window.removeEventListener('beforeunload', leaveGuard);
    paint();
    const failed = todo.length - ok;
    toast(failed ? `${ok} geüpload, ${failed} mislukt: kijk bij de rode regels.` : `${ok} ${ok === 1 ? 'release' : 'releases'} geüpload`, failed ? 'error' : undefined);
  });

  paint();
  return el('div', { class: 'wrap page' },
    el('div', {},
      el('a', { href: '#/nieuw', class: 'btn ghost sm', style: { paddingLeft: 0 } }, icon('chevron-left', 'sm'), 'Eén release'),
      el('h1', { class: 'h-xl moon-title', style: { marginTop: '12px' } }, el('span', { class: 'title-moon' }, icon('files')), 'Meerdere releases'),
      el('p', { class: 'muted measure', style: { margin: '6px 0 0' } }, 'Upload een hele stapel in één keer. Titels komen uit de bestandsnamen; style en lyrics vul je later per release aan.')),
    el('div', { class: 'stack', style: { gap: 'var(--space-6)' } },
      drop,
      looseBox,
      el('section', { class: 'stack', 'aria-labelledby': 'bulk-h', style: { gap: 'var(--space-4)' } },
        el('h2', { id: 'bulk-h', class: 'label' }, 'Releases'),
        list,
        summary),
      el('section', { class: 'stack', 'aria-labelledby': 'bulk-all-h', style: { gap: 'var(--space-4)' } },
        el('h2', { id: 'bulk-all-h', class: 'label' }, 'Voor allemaal'),
        shared,
        el('label', { class: 'check', for: 'b-hidden' }, hidden, 'Concept — verbergen voor luisteraar-accounts')),
      el('div', { class: 'form-actions' }, el('span', { class: 'spacer' }), doneLink, fillLink, go)));
}
