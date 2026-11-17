import { el, icon, moon, parseLyrics, styleFacts, toast, confirmDialog, formDialog, copyText, YT_WORDS } from './dom.js';
import { api, upload, uploadInChunks } from './api.js';
import { session, isAdmin } from './session.js';
import { coverEl } from './parts.js';

const fail = (e) => toast(e.message, 'error');
const field = (id, label, input, hint) =>
  el('div', { class: 'field' }, el('label', { for: id }, label), input, hint ? el('div', { class: 'hint', id: `${id}-hint` }, hint) : null);
const VIDEO_TYPES = ['Official Visualizer', 'Official Lyric Video', 'Official Audio', 'Official Music Video'];

// ---------- S04 New release / edit ----------

const SLOTS = [
  { kind: 'wav', tile: 'WAV', title: 'Audio master', accept: '.wav,audio/wav,audio/x-wav', need: 'verplicht', empty: 'Sleep je WAV hierheen of kies hem' },
  { kind: 'mp3', tile: 'MP3', title: 'MP3', accept: '.mp3,audio/mpeg', need: 'optioneel', empty: 'Leeg laten: we maken er een van 320 kbps uit je WAV' },
  { kind: 'video', tile: 'MP4', title: 'Video voor YouTube', accept: '.mp4,.mov,.m4v,video/mp4,video/quicktime', need: 'optioneel', empty: 'Je visualizer of lyric video' },
  { kind: 'cover', tile: null, title: 'Cover', accept: 'image/jpeg,image/png,image/webp', need: 'optioneel', empty: 'Leeg laten: we pakken een frame uit je video' },
];

export async function editView(id) {
  if (!isAdmin()) throw Object.assign(new Error('Alleen voor admin'), { status: 403 });
  const [{ folders }, settings, existing] = await Promise.all([
    api('/folders'),
    api('/settings'),
    id ? api(`/releases/${id}`).then((x) => x.release) : null,
  ]);
  const r = existing || {};
  const files = {};
  const removed = {};
  const slotEls = {};
  const bars = [];

  // The title's moon waxes as files are added: new, crescent, gibbous, full.
  const titleMoon = el('span', { class: 'title-moon' });
  const drawMoon = () => {
    const n = SLOTS.filter((s) => files[s.kind] || (r.has?.[s.kind] && !removed[s.kind])).length;
    titleMoon.replaceChildren(moon(n === 0 ? 'none' : n >= SLOTS.length ? 'live' : n === 1 ? 'ready' : 'gibbous', 'xl'));
  };
  const slot = (s) => {
    const input = el('input', { type: 'file', accept: s.accept, class: 'sr-only', id: `file-${s.kind}`, 'aria-describedby': `file-${s.kind}-text` });
    const text = el('div', { class: 'xs muted', id: `file-${s.kind}-text` });
    const bar = el('div', { class: 'progress', hidden: true }, el('i'));
    bars.push(bar);
    const has = () => files[s.kind] || (r.has?.[s.kind] && !removed[s.kind]);
    const actions = el('div', { class: 'row' });
    const node = el('div', { class: `slot ${s.kind === 'wav' ? 'lead' : ''}` },
      el('div', { class: 'slot-main' },
        el('span', { class: 'slot-kind', 'aria-hidden': 'true' }, s.tile || icon('image')),
        el('div', { class: 'slot-text' }, el('b', {}, s.title, ' ', el('span', { class: s.need === 'verplicht' ? '' : 'faint', style: { fontWeight: 500 } }, `· ${s.need}`)), text),
        actions),
      bar, input);
    const paint = () => {
      node.classList.toggle('filled', Boolean(has()));
      drawMoon();
      node.classList.remove('invalid');
      const f = files[s.kind];
      text.textContent = f ? `${f.name} · ${(f.size / 1048576).toFixed(1)} MB` : has() ? (s.kind === 'mp3' && r.mp3_generated ? 'Automatisch gemaakt uit de WAV' : s.kind === 'cover' && r.cover_generated ? 'Frame uit je video' : 'Opgeslagen') : s.empty;
      actions.replaceChildren(...[
        el('label', { for: input.id, class: 'btn subtle sm', role: 'button', tabindex: '0', onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } } }, has() ? 'Vervang' : 'Kies bestand'),
        has() && s.kind !== 'wav' ? el('button', { type: 'button', class: 'icon-btn plain', 'aria-label': `${s.title} weghalen`, onclick: () => { delete files[s.kind]; if (r.has?.[s.kind]) removed[s.kind] = true; input.value = ''; paint(); } }, icon('x', 'sm')) : null].filter(Boolean));
    };
    input.addEventListener('change', () => {
      if (input.files[0]) {
        files[s.kind] = input.files[0];
        delete removed[s.kind];
      }
      paint();
    });
    node.addEventListener('dragover', (e) => { e.preventDefault(); node.classList.add('dragover'); });
    node.addEventListener('dragleave', () => node.classList.remove('dragover'));
    node.addEventListener('drop', (e) => {
      e.preventDefault();
      node.classList.remove('dragover');
      const f = e.dataTransfer.files[0];
      if (f) {
        files[s.kind] = f;
        delete removed[s.kind];
        paint();
      }
    });
    slotEls[s.kind] = { node, text, paint };
    paint();
    return node;
  };

  const title = el('input', { class: 'input lg', id: 'u-title', value: r.title || '', required: true, maxlength: 200, autocomplete: 'off' });
  const style = el('textarea', { class: 'textarea', id: 'u-style', rows: 3, value: r.style || '', maxlength: 4000, 'aria-describedby': 'u-style-hint' });
  const lyrics = el('textarea', { class: 'textarea', id: 'u-lyrics', rows: 14, value: r.lyrics || '', maxlength: 20000, placeholder: '[Intro]\n…\n\n[Verse 1]\n…\n\n[Chorus]\n…', 'aria-describedby': 'u-lyrics-hint' });
  const bpm = el('input', { class: 'input', id: 'u-bpm', inputmode: 'numeric', value: r.bpm ?? '', placeholder: 'uit de style' });
  const date = el('input', { class: 'input', id: 'u-date', type: 'date', value: r.release_date || '' });
  const folder = el('select', { class: 'select', id: 'u-folder' },
    el('option', { value: '' }, 'Geen collectie'),
    folders.map((f) => el('option', { value: String(f.id), selected: r.folder_id === f.id }, f.name)),
    el('option', { value: 'new' }, '+ Nieuwe collectie…'));
  folder.addEventListener('change', async () => {
    if (folder.value !== 'new') return;
    const v = await formDialog('Nieuwe collectie', [{ name: 'name', label: 'Naam', required: true }]);
    if (!v?.name) { folder.value = ''; return; }
    try {
      const { folder: f } = await api('/folders', { method: 'POST', body: { name: v.name } });
      folder.insertBefore(el('option', { value: String(f.id) }, f.name), folder.lastChild);
      folder.value = String(f.id);
    } catch (e) { fail(e); folder.value = ''; }
  });
  const vtype = el('select', { class: 'select', id: 'u-type' },
    [...new Set([...VIDEO_TYPES, r.video_type || settings.settings.default_video_type])].map((t) => el('option', { value: t, selected: t === (r.video_type || settings.settings.default_video_type) }, t)));
  const hidden = el('input', { type: 'checkbox', id: 'u-hidden', checked: Boolean(r.hidden) });
  const notes = el('textarea', { class: 'textarea', id: 'u-notes', rows: 3, value: r.notes || '', maxlength: 4000 });
  const errorBox = el('div', { role: 'alert' });

  const save = async (thenKit) => {
    errorBox.replaceChildren();
    if (!title.value.trim()) {
      title.setAttribute('aria-invalid', 'true');
      title.focus();
      errorBox.replaceChildren(el('p', { class: 'error-text' }, icon('circle-alert', 'sm'), 'Geef de release een titel.'));
      return;
    }
    if (!id && !files.wav) {
      slotEls.wav.node.classList.add('invalid');
      errorBox.replaceChildren(el('p', { class: 'error-text' }, icon('circle-alert', 'sm'), 'Een WAV-bestand is verplicht.'));
      return;
    }
    const fd = new FormData();
    fd.append('title', title.value);
    fd.append('style', style.value);
    fd.append('lyrics', lyrics.value);
    fd.append('bpm', bpm.value.trim());
    fd.append('release_date', date.value);
    fd.append('folder_id', folder.value === 'new' ? '' : folder.value);
    fd.append('video_type', vtype.value);
    fd.append('hidden', hidden.checked ? '1' : '0');
    fd.append('notes', notes.value);
    for (const k of Object.keys(removed)) fd.append(`remove_${k}`, '1');
    for (const b of buttons.querySelectorAll('button')) b.disabled = true;
    const showBars = Object.keys(files).length > 0;
    for (const b of bars) b.hidden = !showBars;
    const setBars = (p) => { for (const b of bars) b.firstChild.style.width = `${Math.round(p * 100)}%`; };
    try {
      if (session.uploadChunk) {
        // A host with a small upload limit: every file goes up in pieces first, the form then names them.
        const list = Object.entries(files);
        const total = list.reduce((n, [, f]) => n + f.size, 0) || 1;
        let done = 0;
        for (const [k, f] of list) {
          const token = await uploadInChunks(f, session.uploadChunk, (p) => setBars((done + p * f.size) / total));
          done += f.size;
          fd.append(`${k}_upload`, token);
        }
      } else {
        for (const [k, f] of Object.entries(files)) fd.append(k, f);
      }
      const res = await upload(id ? `/releases/${id}` : '/releases', id ? 'PUT' : 'POST', fd, session.uploadChunk ? null : setBars);
      toast(id ? 'Opgeslagen' : 'Release aangemaakt');
      location.hash = thenKit ? `#/release/${res.release.id}/youtube?generate=1` : `#/release/${res.release.id}`;
    } catch (e) {
      errorBox.replaceChildren(el('p', { class: 'error-text' }, icon('circle-alert', 'sm'), e.message));
      for (const b of bars) b.hidden = true;
    } finally {
      for (const b of buttons.querySelectorAll('button')) b.disabled = false;
    }
  };
  const remove = async () => {
    if (!(await confirmDialog('Release verwijderen?', `"${r.title}" en al zijn bestanden verdwijnen definitief.`))) return;
    await api(`/releases/${id}`, { method: 'DELETE' });
    toast('Verwijderd');
    location.hash = '#/';
  };
  const buttons = el('div', { class: 'form-actions' },
    id ? el('button', { type: 'button', class: 'btn danger', onclick: () => remove().catch(fail) }, icon('trash-2', 'sm'), 'Verwijderen') : null,
    el('span', { class: 'spacer' }),
    el('button', { type: 'button', class: 'btn subtle lg', onclick: () => save(false) }, 'Opslaan'),
    el('button', { type: 'button', class: 'btn primary lg', onclick: () => save(true) }, 'Opslaan en YouTube-kit maken'));

  return el('div', { class: 'wrap page' },
    el('div', {},
      el('a', { href: id ? `#/release/${id}` : '#/', class: 'btn ghost sm', style: { paddingLeft: 0 } }, icon('chevron-left', 'sm'), id ? r.title : 'Releases'),
      el('h1', { class: 'h-xl moon-title', style: { marginTop: '12px' } }, titleMoon, id ? 'Release bewerken' : 'Nieuwe release'),
      el('p', { class: 'muted', style: { margin: '6px 0 0' } }, 'Alleen de WAV en een titel zijn verplicht. De rest kun je later aanvullen.')),
    el('form', { class: 'cols', onsubmit: (e) => { e.preventDefault(); save(false); } },
      el('section', { class: 'side-col sticky-col', 'aria-labelledby': 'files-h' }, el('h2', { id: 'files-h', class: 'label' }, 'Bestanden'), SLOTS.map(slot),
        el('p', { class: 'hint' }, 'Bestanden worden gecontroleerd op hun echte inhoud, niet alleen op de naam.')),
      el('section', { class: 'main-col stack', 'aria-labelledby': 'info-h', style: { gap: 'var(--space-6)' } },
        el('h2', { id: 'info-h', class: 'label' }, 'Info'),
        field('u-title', 'Titel', title),
        field('u-style', 'Style-omschrijving', style, 'Je Suno style-prompt werkt prima. De BPM wordt er automatisch uit gehaald.'),
        field('u-lyrics', 'Lyrics', lyrics, 'Plak ze rechtstreeks uit Suno; tags als [Chorus] en [Drop] helpen de beschrijving.'),
        el('div', { class: 'form-grid' }, field('u-bpm', 'BPM', bpm), field('u-date', 'Releasedatum', date), field('u-folder', 'Collectie', folder), field('u-type', 'Video-type', vtype)),
        field('u-notes', 'Notities (alleen voor jou)', notes),
        el('label', { class: 'check', for: 'u-hidden' }, hidden, 'Concept — verbergen voor luisteraar-accounts'),
        errorBox,
        buttons)));
}

// ---------- S03 YouTube-kit ----------

export async function youtubeView(id, query) {
  if (!isAdmin()) throw Object.assign(new Error('Alleen voor admin'), { status: 403 });
  const [{ release: r, limits }, settings] = await Promise.all([api(`/releases/${id}`), api('/settings')]);
  let mode = settings.claude.configured ? 'claude' : 'template';

  // A two-line field: a full YouTube title fits on a phone too; Enter does not add a line break.
  const titleIn = el('textarea', { class: 'textarea title-field', id: 'yt-title', rows: 2, value: r.yt_title, 'aria-labelledby': 'yt-title-h', 'aria-describedby': 'yt-title-count', onkeydown: (e) => { if (e.key === 'Enter') e.preventDefault(); } });
  const descIn = el('textarea', { class: 'textarea yt-desc', id: 'yt-desc', value: r.yt_description, 'aria-describedby': 'yt-desc-count' });
  const tagsIn = el('textarea', { class: 'textarea', id: 'yt-tags', rows: 3, value: r.yt_tags, 'aria-describedby': 'yt-tags-count' });
  // The description and the tags grow with their text, so no line is cut off.
  // A view is put on the page a frame or two after it is built (a page transition): wait for that.
  const fit = (t, tries = 60) => {
    if (!t.isConnected) { if (tries) requestAnimationFrame(() => fit(t, tries - 1)); return; }
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight + 2}px`;
  };
  for (const t of [descIn, tagsIn]) t.addEventListener('input', () => fit(t));
  requestAnimationFrame(() => { fit(descIn); fit(tagsIn); });
  const counter = (id2, input, max, extra) => {
    const c = el('div', { class: 'counter', id: id2, 'aria-live': 'polite' });
    const upd = () => {
      const n = input.value.length;
      c.textContent = `${n.toLocaleString('nl-NL')} / ${max.toLocaleString('nl-NL')} tekens${extra ? extra() : ''}${n > max ? ' — te lang voor YouTube' : ''}`;
      c.classList.toggle('over', n > max);
    };
    input.addEventListener('input', upd);
    upd();
    return { c, upd };
  };
  const hashCount = () => {
    const n = (descIn.value.match(/(^|\s)#[\p{L}\p{N}_]+/gu) || []).length;
    return n ? ` · ${n} hashtags (YouTube toont de eerste 3 boven je titel)` : '';
  };
  const tc = counter('yt-title-count', titleIn, limits.title);
  const dc = counter('yt-desc-count', descIn, limits.description, hashCount);
  const gc = counter('yt-tags-count', tagsIn, limits.tags);
  const chips = el('div', { class: 'tag-chips', 'aria-hidden': 'true' });
  const drawChips = () => chips.replaceChildren(...tagsIn.value.split(',').map((t) => t.trim()).filter(Boolean).map((t) => el('span', {}, t)));
  tagsIn.addEventListener('input', drawChips);
  drawChips();

  const vtype = el('select', { class: 'select', id: 'yt-type', style: { width: 'auto' } },
    [...new Set([...VIDEO_TYPES, r.video_type])].map((t) => el('option', { value: t, selected: t === r.video_type }, t)));
  vtype.addEventListener('change', () => {
    const re = /\(([^)]*)\)\s*$/;
    titleIn.value = re.test(titleIn.value) ? titleIn.value.replace(re, `(${vtype.value})`) : `${titleIn.value} (${vtype.value})`;
    const first = descIn.value.split('\n')[0];
    if (re.test(first)) descIn.value = descIn.value.replace(first, first.replace(re, `(${vtype.value})`));
    tc.upd();
    dc.upd();
  });

  let dirty = false;
  for (const i of [titleIn, descIn, tagsIn]) i.addEventListener('input', () => { dirty = true; });
  const saveTexts = async (quiet) => {
    await api(`/releases/${id}/youtube`, { method: 'PUT', body: { yt_title: titleIn.value, yt_description: descIn.value, yt_tags: tagsIn.value } });
    dirty = false;
    if (!quiet) toast('Opgeslagen');
  };
  const copyBtn = (label, input, primary) => el('button', { type: 'button', class: `btn ${primary ? 'primary' : 'subtle'}`, onclick: async (e) => {
    const b = e.currentTarget; // read it now: after the await the event has no current target any more
    if (await copyText(input.value, `${label} gekopieerd`)) {
      b.replaceChildren(icon('check', 'sm'), 'Gekopieerd');
      setTimeout(() => b.replaceChildren(icon('copy', 'sm'), primary ? 'Kopieer beschrijving' : 'Kopieer'), 2000);
      if (dirty) saveTexts(true).catch(fail);
    }
  } }, icon('copy', 'sm'), primary ? 'Kopieer beschrijving' : 'Kopieer');

  const extra = el('input', { class: 'input', id: 'yt-extra', maxlength: 1000, placeholder: 'bv. deel 2 van de reeks' });
  const genBtn = el('button', { type: 'button', class: 'btn subtle lg' }, icon('refresh-cw', 'sm'), r.yt_description ? 'Opnieuw genereren' : 'Genereren');
  const genNote = el('div', { class: 'small muted', 'aria-live': 'polite' }, r.yt_generated_with ? `Laatst gemaakt met ${r.yt_generated_with === 'template' ? 'het template' : 'Claude'}` : '');
  const generate = async () => {
    if (r.yt_description && dirty && !(await confirmDialog('Opnieuw genereren?', 'Je aanpassingen in de tekst worden overschreven.', 'Overschrijven'))) return;
    genBtn.disabled = true;
    genBtn.setAttribute('aria-busy', 'true');
    genNote.textContent = mode === 'claude' ? 'Claude schrijft je beschrijving… (meestal 10 tot 30 seconden)' : 'Template wordt ingevuld…';
    try {
      const res = await api(`/releases/${id}/youtube`, { method: 'POST', body: { mode, extra: extra.value } });
      titleIn.value = res.release.yt_title;
      descIn.value = res.release.yt_description;
      tagsIn.value = res.release.yt_tags;
      tc.upd(); dc.upd(); gc.upd(); drawChips(); fit(descIn); fit(tagsIn);
      dirty = false;
      genNote.textContent = `Gemaakt met ${res.generated_with === 'template' ? 'het template' : 'Claude'}. Lees het na en pas aan waar je wilt.`;
      genBtn.lastChild.textContent = 'Opnieuw genereren';
      r.yt_description = res.release.yt_description;
      drawSteps();
    } catch (e) {
      genNote.textContent = '';
      fail(e);
    } finally {
      genBtn.disabled = false;
      genBtn.removeAttribute('aria-busy');
    }
  };
  genBtn.addEventListener('click', generate);
  const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Wie schrijft' },
    el('button', { type: 'button', 'aria-pressed': String(mode === 'claude'), disabled: !settings.claude.configured, title: settings.claude.configured ? '' : 'Voeg een Claude API key toe bij Instellingen', 'aria-describedby': settings.claude.configured ? undefined : 'claude-why', onclick: (e) => { mode = 'claude'; for (const b of seg.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); } }, settings.claude.configured ? null : icon('key-round', 'xs'), 'Claude'),
    el('button', { type: 'button', 'aria-pressed': String(mode === 'template'), onclick: (e) => { mode = 'template'; for (const b of seg.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); } }, 'Template'));

  // Steps.
  const ytUrl = el('input', { class: 'input', id: 'yt-url', type: 'url', placeholder: 'https://youtu.be/…', value: r.youtube_url });
  // The four steps are moons that wax to full as the release gets onto YouTube; the next one is a crescent.
  const [step1, step2, step3, step4] = [1, 2, 3, 4].map(() => el('span', { class: 'step-nr' }));
  const ytMoon = el('span', { class: 'title-moon' });
  const drawSteps = () => {
    const done = [r.has.video, Boolean(r.yt_description), Boolean(r.on_youtube), Boolean(r.on_youtube)];
    const next = done.indexOf(false);
    [step1, step2, step3, step4].forEach((node, i) => {
      node.className = `step-nr${done[i] ? ' done' : i === next ? ' next' : ''}`;
      node.replaceChildren(String(i + 1), done[i] ? el('span', { class: 'sr-only' }, ' (klaar)') : '');
    });
    ytMoon.replaceChildren(moon(r.on_youtube ? 'live' : r.youtube_state, 'xl'));
  };
  drawSteps();
  const markLive = async () => {
    const res = await api(`/releases/${id}/status`, { method: 'POST', body: { youtube_url: ytUrl.value, on_youtube: true } });
    r.on_youtube = 1;
    drawSteps();
    toast(`Op YouTube gezet: ${res.release.title}`);
  };
  const sources = [
    ['Titel', r.title],
    ['Style-omschrijving', r.style ? `${styleFacts(r.style, 99).length} kenmerken` : 'leeg'],
    ['Lyrics', r.lyrics ? `${parseLyrics(r.lyrics).reduce((n, s) => n + s.lines.length, 0)} regels` : 'leeg (instrumentaal)'],
  ];

  if (query.get('generate') === '1' && !r.yt_description) setTimeout(generate, 300);

  return el('div', { class: 'wrap page' },
    el('div', { class: 'row', style: { alignItems: 'flex-end' } },
      el('div', { style: { flex: '1 1 420px' } },
        el('a', { href: `#/release/${id}`, class: 'btn ghost sm', style: { paddingLeft: 0 } }, icon('chevron-left', 'sm'), r.title),
        el('h1', { class: 'h-xl moon-title', style: { marginTop: '12px' } }, ytMoon, 'YouTube-kit'),
        el('p', { class: 'muted', style: { margin: '6px 0 0', maxWidth: '62ch' } }, 'Titel, beschrijving en tags uit je titel, style-omschrijving en lyrics. Pas aan, kopieer, plak in YouTube Studio.')),
      el('div', { class: 'stack gen-col', style: { gap: '6px' } }, el('div', { class: 'row' }, seg, genBtn), settings.claude.configured ? null : el('span', { id: 'claude-why', class: 'xs muted' }, 'Claude: zet eerst een API key bij Instellingen'))),
    el('div', { class: 'cols' },
      el('div', { class: 'main-col stack', style: { gap: 'var(--space-6)' } },
        field('yt-extra', 'Extra wensen voor deze beschrijving (optioneel)', extra),
        genNote,
        el('section', { class: 'panel stack', 'aria-labelledby': 'yt-title-h' },
          el('div', { class: 'row title-row' }, el('h2', { id: 'yt-title-h', class: 'label', style: { flex: 1 } }, 'Titel'), el('span', { class: 'row', style: { gap: '8px' } }, el('label', { for: 'yt-type', class: 'small muted' }, 'Type'), vtype)),
          el('div', { class: 'copy-row' }, titleIn, copyBtn('Titel', titleIn)), tc.c),
        el('section', { class: 'panel stack', 'aria-labelledby': 'yt-desc-h' },
          el('div', { class: 'row' }, el('h2', { id: 'yt-desc-h', class: 'label', style: { flex: 1 } }, 'Beschrijving'), copyBtn('Beschrijving', descIn, true)),
          el('label', { for: 'yt-desc', class: 'sr-only' }, 'YouTube-beschrijving'), descIn, dc.c),
        el('section', { class: 'panel stack', 'aria-labelledby': 'yt-tags-h' },
          el('div', { class: 'row' }, el('h2', { id: 'yt-tags-h', class: 'label', style: { flex: 1 } }, 'Tags'), copyBtn('Tags', tagsIn)),
          chips, el('label', { for: 'yt-tags', class: 'sr-only' }, 'Tags, met komma\'s'), tagsIn, gc.c),
        el('div', { class: 'row', style: { justifyContent: 'flex-end' } }, el('button', { type: 'button', class: 'btn subtle lg', onclick: () => saveTexts().catch(fail) }, 'Tekst opslaan'))),
      el('aside', { class: 'side-col' },
        el('section', { class: 'panel lean-panel', 'aria-labelledby': 'steps-h' },
          el('h2', { id: 'steps-h', class: 'label' }, 'Uploaden naar YouTube'),
          el('ol', { class: 'steps' },
            el('li', {}, step1, el('div', { class: 'grow' }, el('b', { class: 'small' }, 'Download de video'),
              r.has.video ? el('a', { class: 'btn subtle sm', href: `/media/${id}/video?download=1`, style: { alignSelf: 'flex-start' } }, icon('download', 'sm'), 'MP4 downloaden')
                : el('a', { class: 'small', href: `#/release/${id}/bewerken` }, 'Nog geen video — upload er een'))),
            el('li', {}, step2, el('div', { class: 'grow' }, el('b', { class: 'small' }, 'Maak en controleer de tekst'), el('span', { class: 'xs muted' }, 'Links: genereren, nalezen, kopiëren.'))),
            el('li', {}, step3, el('div', { class: 'grow' }, el('b', { class: 'small' }, 'Plak alles in YouTube Studio'),
              el('a', { class: 'small', href: 'https://studio.youtube.com', target: '_blank', rel: 'noopener' }, 'studio.youtube.com ', icon('external-link', 'xs')))),
            el('li', {}, step4, el('div', { class: 'grow' }, el('label', { for: 'yt-url', class: 'small', style: { fontWeight: 700 } }, 'Plak de link van je video'), ytUrl,
              el('button', { type: 'button', class: 'btn subtle', onclick: () => markLive().catch(fail) }, 'Markeer als op YouTube'))))),
        el('section', { class: 'panel', 'aria-labelledby': 'src-h' },
          el('h2', { id: 'src-h', class: 'label' }, 'Gebruikt als bron'),
          el('div', { class: 'stack', style: { gap: '10px' } },
            sources.map(([k, v]) => el('div', { class: 'row small' }, icon('check', 'sm'), el('span', { class: 'spacer' }, k), el('span', { class: 'muted' }, v)))),
          el('a', { class: 'small', href: `#/release/${id}/bewerken`, style: { display: 'inline-block', marginTop: '12px' } }, 'Bron aanpassen')),
        el('section', { class: 'panel quiet stack', style: { gap: '8px' } },
          el('h2', { class: 'label' }, 'Vaste onderdelen'),
          el('p', { class: 'small muted', style: { margin: 0 } }, 'Spotify-link, AI-vermelding en je standaard-hashtags komen uit Instellingen en staan altijd op dezelfde plek.'),
          el('a', { class: 'small', href: '#/instellingen' }, 'Naar Instellingen')))));
}

// ---------- S08 Accounts ----------

export async function accountsView() {
  if (!isAdmin()) throw Object.assign(new Error('Alleen voor admin'), { status: 403 });
  const { users } = await api('/users');
  const reload = () => window.dispatchEvent(new CustomEvent('dyc:reload'));
  const add = async () => {
    const v = await formDialog('Nieuw account', [
      { name: 'username', label: 'Gebruikersnaam', required: true, hint: '3 tot 32 tekens: letters, cijfers, _ . -' },
      { name: 'password', label: 'Wachtwoord', type: 'password', required: true, autocomplete: 'new-password', hint: 'Minstens 8 tekens. Geef het zelf door.' },
      { name: 'admin', label: 'Admin (mag uploaden en alles beheren)', type: 'checkbox' },
    ], 'Aanmaken');
    if (!v) return;
    await api('/users', { method: 'POST', body: { username: v.username, password: v.password, role: v.admin ? 'admin' : 'listener' } });
    toast('Account aangemaakt');
    reload();
  };
  const reset = async (u) => {
    const v = await formDialog(`Nieuw wachtwoord voor ${u.username}`, [{ name: 'password', label: 'Wachtwoord', type: 'password', required: true, autocomplete: 'new-password' }]);
    if (!v) return;
    await api(`/users/${u.id}/password`, { method: 'POST', body: v });
    toast('Wachtwoord gewijzigd; die persoon is uitgelogd');
  };
  const remove = async (u) => {
    if (!(await confirmDialog('Account verwijderen?', `${u.username} kan dan niet meer inloggen. Zijn of haar playlists verdwijnen ook.`))) return;
    await api(`/users/${u.id}`, { method: 'DELETE' });
    reload();
  };
  return el('div', { class: 'wrap page' },
    el('div', { class: 'row' }, el('h1', { class: 'h-xl' }, 'Accounts'), el('span', { class: 'spacer' }),
      el('button', { type: 'button', class: 'btn primary', onclick: () => add().catch(fail) }, icon('plus', 'sm'), 'Nieuw account')),
    el('p', { class: 'muted', style: { margin: 0, maxWidth: '65ch' } }, 'Luisteraars kunnen je releases afspelen (behalve concepten) en hun eigen playlists maken. Alleen admins uploaden en beheren.'),
    el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Naam'), el('th', {}, 'Rol'), el('th', {}, 'Sinds'), el('th', {}, el('span', { class: 'sr-only' }, 'Acties')))),
      el('tbody', {}, users.map((u) => el('tr', {},
        el('td', {}, el('span', { class: 'avatar', 'aria-hidden': 'true' }, u.username.slice(0, 1)), u.username, u.id === session.user.id ? el('span', { class: 'faint' }, ' (jij)') : null,
          el('span', { class: 'm-date' }, `${u.role === 'admin' ? 'Admin' : 'Luisteraar'} · sinds ${new Date(u.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('nl-NL')}`)),
        el('td', {}, u.role === 'admin' ? 'Admin' : 'Luisteraar'),
        el('td', { class: 'muted date' }, new Date(u.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('nl-NL')),
        el('td', { style: { textAlign: 'right' } },
          el('button', { type: 'button', class: 'icon-btn plain', 'aria-label': `Nieuw wachtwoord voor ${u.username}`, onclick: () => reset(u).catch(fail) }, icon('key-round', 'sm')),
          u.id !== session.user.id ? el('button', { type: 'button', class: 'icon-btn plain', 'aria-label': `${u.username} verwijderen`, onclick: () => remove(u).catch(fail) }, icon('trash-2', 'sm')) : el('span', { class: 'icon-slot', 'aria-hidden': 'true' }))))))));
}

// ---------- S09 Settings ----------

export async function settingsView() {
  if (!isAdmin()) throw Object.assign(new Error('Alleen voor admin'), { status: 403 });
  const { settings: s, claude } = await api('/settings');
  const inputs = {};
  const txt = (key, label, hint, type = 'text') => {
    inputs[key] = type === 'textarea'
      ? el('textarea', { class: 'textarea', id: `s-${key}`, rows: 2, value: s[key] })
      : el('input', { class: 'input', id: `s-${key}`, type, value: s[key] });
    return field(`s-${key}`, label, inputs[key], hint);
  };
  const pick = (key, label, hint, options) => {
    inputs[key] = el('select', { class: 'select', id: `s-${key}` }, [...new Set([...options, s[key]])].map((t) => el('option', { value: t, selected: t === s[key] }, t)));
    return field(`s-${key}`, label, inputs[key], hint);
  };
  const key = el('input', { class: 'input', id: 's-key', type: 'password', autocomplete: 'off', placeholder: claude.key_saved ? '•••••••• (opgeslagen)' : 'sk-ant-…' });
  const save = async (e) => {
    e.preventDefault();
    const body = {};
    for (const [k, i] of Object.entries(inputs)) body[k] = i.value;
    if (key.value.trim()) body.anthropic_api_key = key.value.trim();
    await api('/settings', { method: 'PUT', body });
    toast('Instellingen opgeslagen');
    window.dispatchEvent(new CustomEvent('dyc:reload'));
  };
  const clearKey = async () => {
    if (!(await confirmDialog('API key weghalen?', 'De YouTube-kit valt dan terug op het template, en albumnamen voorstellen werkt niet meer.', 'Weghalen'))) return;
    await api('/settings', { method: 'PUT', body: { clear_api_key: true } });
    window.dispatchEvent(new CustomEvent('dyc:reload'));
  };
  return el('div', { class: 'wrap page' },
    el('h1', { class: 'h-xl' }, 'Instellingen'),
    el('form', { class: 'cols', onsubmit: (e) => save(e).catch(fail) },
      el('section', { class: 'main-col stack', style: { gap: 'var(--space-6)' }, 'aria-labelledby': 'set-yt' },
        el('h2', { id: 'set-yt', class: 'label' }, 'Vaste delen van elke beschrijving'),
        txt('artist_name', 'Artiestennaam'),
        txt('spotify_artist_url', 'Spotify-artiestenlink', 'Komt onder "More from … on Spotify".', 'url'),
        txt('youtube_channel_url', 'YouTube-kanaal', '', 'url'),
        txt('ai_disclosure', 'AI-vermelding', 'Precies zoals hij in de beschrijving moet staan.', 'textarea'),
        txt('default_hashtags', 'Standaard-hashtags', 'Komen achter de hashtags van het nummer. Met spaties ertussen.', 'textarea'),
        pick('default_video_type', 'Standaard video-type', 'Het type dat een nieuwe release krijgt.', VIDEO_TYPES)),
      el('aside', { class: 'side-col' },
        el('section', { class: 'panel stack lean-panel', 'aria-labelledby': 'set-claude' },
          el('h2', { id: 'set-claude', class: 'label' }, 'Claude'),
          el('p', { class: 'status claude-moon' }, moon(claude.configured ? 'live' : 'none', 'xl'), claude.configured ? (claude.from_env ? 'Ingesteld via de server (ANTHROPIC_API_KEY)' : 'Ingesteld') : 'Nog niet ingesteld: de YouTube-kit gebruikt dan het template'),
          field('s-key', 'Anthropic API key', key, 'Wordt op de server bewaard en nooit meer getoond. Maak er een op console.anthropic.com.'),
          claude.key_saved ? el('button', { type: 'button', class: 'btn danger sm', style: { alignSelf: 'flex-start' }, onclick: () => clearKey().catch(fail) }, 'Key weghalen') : null)),
      // One Opslaan for both columns, after the Claude key too (on a phone it used to come before it).
      el('div', { class: 'form-actions form-end' }, el('button', { type: 'submit', class: 'btn primary lg' }, 'Opslaan'))));
}

// ---------- Account (password, theme) ----------

export function themeButtons() {
  const current = document.documentElement.dataset.theme || 'dark';
  const wrap = el('div', { class: 'theme-switch', role: 'group', 'aria-label': 'Thema' });
  for (const [t, label, ic] of [['light', 'Licht', 'sun'], ['dark', 'Donker', 'moon'], ['system', 'Systeem', 'monitor']]) {
    wrap.append(el('button', { type: 'button', 'aria-pressed': String(current === t), onclick: () => {
      document.documentElement.dataset.theme = t;
      try { localStorage.setItem('theme', t); } catch { /* not stored */ }
      for (const b of wrap.children) b.setAttribute('aria-pressed', String(b === wrap.children[['light', 'dark', 'system'].indexOf(t)]));
      window.dispatchEvent(new CustomEvent('dyc:theme'));
    } }, icon(ic, 'xs'), label));
  }
  return wrap;
}

export function accountView() {
  const cur = el('input', { class: 'input', id: 'pw-cur', type: 'password', autocomplete: 'current-password', required: true });
  const nw = el('input', { class: 'input', id: 'pw-new', type: 'password', autocomplete: 'new-password', required: true, minlength: 8 });
  const save = async (e) => {
    e.preventDefault();
    await api('/me/password', { method: 'POST', body: { current: cur.value, password: nw.value } });
    cur.value = '';
    nw.value = '';
    toast('Wachtwoord gewijzigd');
  };
  return el('div', { class: 'wrap page' },
    el('h1', { class: 'h-xl' }, 'Account'),
    el('div', { class: 'cols' },
      el('form', { class: 'main-col panel stack', onsubmit: (e) => save(e).catch(fail) },
        el('h2', { class: 'label' }, 'Wachtwoord wijzigen'),
        field('pw-cur', 'Huidig wachtwoord', cur), field('pw-new', 'Nieuw wachtwoord', nw, 'Minstens 8 tekens.'),
        el('button', { type: 'submit', class: 'btn primary', style: { alignSelf: 'flex-start' } }, 'Wijzigen')),
      el('section', { class: 'side-col panel' }, el('h2', { class: 'label' }, 'Thema'), themeButtons())));
}

// ---------- S07 Sign in / first admin ----------

export function authView(setup, onDone) {
  // One card: your name, your password, one button. The name is remembered on this device, so next
  // time only the password is asked; the eye shows what you typed; you stay signed in for 30 days.
  let last = '';
  try { last = localStorage.getItem('dyc-last-user') || ''; } catch { /* private window: nothing remembered */ }
  const user = el('input', { class: 'input lg', id: 'a-user', autocomplete: 'username', required: true, autocapitalize: 'none', spellcheck: 'false', value: setup ? '' : last });
  const pass = el('input', { class: 'input lg', id: 'a-pass', type: 'password', autocomplete: setup ? 'new-password' : 'current-password', required: true });
  const eye = el('button', { type: 'button', class: 'icon-btn plain pass-eye', 'aria-label': 'Laat zien wat je typt', 'aria-pressed': 'false', onclick: () => {
    const show = pass.type === 'password';
    pass.type = show ? 'text' : 'password';
    eye.setAttribute('aria-pressed', String(show));
    eye.setAttribute('aria-label', show ? 'Verberg wat je typt' : 'Laat zien wat je typt');
    eye.replaceChildren(icon(show ? 'eye-off' : 'eye', 'sm'));
    pass.focus();
  } }, icon('eye', 'sm'));
  const err = el('div', { role: 'alert', class: 'auth-err' });
  const btn = el('button', { type: 'submit', class: 'btn primary lg auth-go' }, setup ? 'Account aanmaken' : 'Inloggen');
  const submit = async (e) => {
    e.preventDefault();
    // A password manager offers to save only a password field: hide what was typed again first.
    if (pass.type !== 'password') eye.click();
    err.replaceChildren();
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    try {
      const res = await api(setup ? '/setup' : '/login', { method: 'POST', body: { username: user.value.trim(), password: pass.value } });
      try { localStorage.setItem('dyc-last-user', res.user.username); } catch { /* fine */ }
      onDone(res.user);
    } catch (x) {
      err.replaceChildren(el('p', { class: 'error-text' }, icon('circle-alert', 'sm'), x.message));
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      pass.select();
    }
  };
  const notMe = !setup && last ? el('button', { type: 'button', class: 'link-btn xs', onclick: () => {
    try { localStorage.removeItem('dyc-last-user'); } catch { /* fine */ }
    user.value = '';
    notMe.remove();
    user.focus();
  } }, `Niet ${last}?`) : null;
  if (notMe) user.addEventListener('input', () => { notMe.hidden = user.value.trim().toLowerCase() !== last.toLowerCase(); });
  // Focus where you start typing: the password when the name is already there.
  setTimeout(() => (user.value ? pass : user).focus(), 60);
  return el('div', { class: 'auth-page' },
    el('form', { class: 'auth', onsubmit: submit },
      el('img', { src: '/img/emblem.png', alt: '' }),
      el('div', { class: 'auth-head' },
        el('h1', { class: 'auth-title' }, setup ? 'Welkom' : 'Welkom terug'),
        el('p', { class: 'small muted' }, setup ? 'Maak je eigen account aan. Daarna kun je luisteraars toevoegen.' : 'Distant Youth Studio')),
      field('a-user', 'Gebruikersnaam', user, setup ? '3 tot 32 tekens: letters, cijfers, _ . -' : null),
      el('div', { class: 'field' },
        el('label', { for: 'a-pass' }, 'Wachtwoord'),
        el('div', { class: 'pass-wrap' }, pass, eye),
        setup ? el('div', { class: 'hint' }, 'Minstens 8 tekens.') : null),
      err, btn,
      el('p', { class: 'xs muted auth-foot' }, 'Je blijft 30 dagen ingelogd op dit apparaat.', notMe ? ' ' : null, notMe),
      session.version ? el('p', { class: 'xs faint auth-foot' }, `Versie ${session.version}`) : null));
}

export { coverEl, YT_WORDS };
