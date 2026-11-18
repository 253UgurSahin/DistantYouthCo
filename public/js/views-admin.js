import { el, icon, moon, parseLyrics, styleFacts, toast, confirmDialog, formDialog, copyText, YT_WORDS } from './dom.js';
import { api, sendRelease } from './api.js';
import { session, isAdmin } from './session.js';
import { coverEl } from './parts.js';
import { youtubeIdOf } from './video.js';

const fail = (e) => toast(e.message, 'error');
const field = (id, label, input, hint) =>
  el('div', { class: 'field' }, el('label', { for: id }, label), input, hint ? el('div', { class: 'hint', id: `${id}-hint` }, hint) : null);
export const PRIVACY_WORDS = { private: 'Privé', unlisted: 'Verborgen (alleen met de link)', public: 'Openbaar' };
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
  const [{ folders }, settings, existing, all] = await Promise.all([
    api('/folders'),
    api('/settings'),
    id ? api(`/releases/${id}`).then((x) => x.release) : null,
    id ? null : api('/releases').then((x) => x.releases),
  ]);
  const r = existing || {};
  const files = {};
  const removed = {};
  const slotEls = {};
  const bars = [];

  // The title's moon waxes as files are added: new, crescent, gibbous, full.
  const titleMoon = el('span', { class: 'title-moon' });
  const drawMoon = () => {
    const n = SLOTS.filter((s) => files[s.kind] || (r.has?.[s.kind] && !removed[s.kind]) || (s.kind === 'video' && ytLink?.value.trim())).length;
    titleMoon.replaceChildren(moon(n === 0 ? 'none' : n >= SLOTS.length ? 'live' : n === 1 ? 'ready' : 'gibbous', 'xl'));
  };
  // A file goes to its own slot by its kind, wherever it is dropped; several at once go each to theirs.
  const kindOf = (f) => (/\.wav$/i.test(f.name) ? 'wav' : /\.mp3$/i.test(f.name) ? 'mp3' : /\.(mp4|m4v|mov)$/i.test(f.name) ? 'video' : /\.(jpe?g|png|webp)$/i.test(f.name) ? 'cover' : null);
  const takeFiles = (list, fallback) => {
    const many = list.length > 1;
    for (const f of list) {
      const k = (many ? kindOf(f) : kindOf(f) || fallback) || fallback;
      if (!k) continue;
      files[k] = f;
      delete removed[k];
      slotEls[k]?.paint();
      // The title from the WAV's name, while there is none yet: "Lanterns_in_the_Rain.wav" -> "Lanterns in the Rain".
      if (k === 'wav' && !title.value.trim()) {
        title.value = f.name.replace(/\.[^.]+$/, '').replace(/_+/g, ' ').replace(/\s*\(\d+\)$/, '').trim();
        title.dispatchEvent(new Event('input'));
      }
    }
  };
  const slot = (s) => {
    const input = el('input', { type: 'file', accept: s.accept, multiple: !id, class: 'sr-only', tabindex: '-1', id: `file-${s.kind}`, 'aria-describedby': `file-${s.kind}-text` });
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
      takeFiles([...input.files], s.kind);
      paint();
    });
    node.addEventListener('dragover', (e) => { e.preventDefault(); node.classList.add('dragover'); });
    node.addEventListener('dragleave', () => node.classList.remove('dragover'));
    node.addEventListener('drop', (e) => {
      e.preventDefault();
      node.classList.remove('dragover');
      takeFiles([...e.dataTransfer.files], s.kind);
      paint();
    });
    slotEls[s.kind] = { node, text, paint };
    paint();
    return node;
  };

  // A video already on YouTube can stand in for the MP4: the app plays it from YouTube.
  const ytLink = el('input', { class: 'input', id: 'u-yt', type: 'url', inputmode: 'url', value: r.youtube_url || '', placeholder: 'https://youtu.be/…', 'aria-describedby': 'u-yt-hint', maxlength: 500 });
  ytLink.addEventListener('input', () => { ytLink.removeAttribute('aria-invalid'); drawMoon(); });

  const title = el('input', { class: 'input lg', id: 'u-title', value: r.title || '', required: true, maxlength: 200, autocomplete: 'off', 'aria-describedby': 'u-title-dup' });
  const dup = el('div', { class: 'hint dup-hint', id: 'u-title-dup', 'aria-live': 'polite' });
  title.addEventListener('input', () => {
    const same = all?.find((x) => x.title.trim().toLowerCase() === title.value.trim().toLowerCase());
    dup.replaceChildren(...(same ? [icon('circle-alert', 'xs'), 'Er is al een release met deze titel. ', el('a', { href: `#/release/${same.id}` }, 'Bekijk die')] : []));
  });
  const remembered = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const remember = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };
  const lastFolder = id ? '' : remembered('dyc-last-folder');
  const lastType = id ? '' : remembered('dyc-last-type');
  const style = el('textarea', { class: 'textarea', id: 'u-style', rows: 3, value: r.style || '', maxlength: 4000, 'aria-describedby': 'u-style-hint' });
  const lyrics = el('textarea', { class: 'textarea', id: 'u-lyrics', rows: 14, value: r.lyrics || '', maxlength: 20000, placeholder: '[Intro]\n…\n\n[Verse 1]\n…\n\n[Chorus]\n…', 'aria-describedby': 'u-lyrics-hint' });
  const bpm = el('input', { class: 'input', id: 'u-bpm', inputmode: 'numeric', value: r.bpm ?? '', placeholder: 'uit de style' });
  const date = el('input', { class: 'input', id: 'u-date', type: 'date', value: r.release_date || '' });
  const folder = el('select', { class: 'select', id: 'u-folder' },
    el('option', { value: '' }, 'Geen collectie'),
    folders.map((f) => el('option', { value: String(f.id), selected: id ? r.folder_id === f.id : String(f.id) === lastFolder }, f.name)),
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
  const startType = r.video_type || (VIDEO_TYPES.includes(lastType) ? lastType : settings.settings.default_video_type);
  const vtype = el('select', { class: 'select', id: 'u-type' },
    [...new Set([...VIDEO_TYPES, startType])].map((t) => el('option', { value: t, selected: t === startType }, t)));
  const hidden = el('input', { type: 'checkbox', id: 'u-hidden', checked: Boolean(r.hidden) });
  const notes = el('textarea', { class: 'textarea', id: 'u-notes', rows: 3, value: r.notes || '', maxlength: 4000 });
  const errorBox = el('div', { role: 'alert' });

  const save = async () => {
    errorBox.replaceChildren();
    if (!title.value.trim()) {
      title.setAttribute('aria-invalid', 'true');
      title.focus();
      errorBox.replaceChildren(el('p', { class: 'error-text' }, icon('circle-alert', 'sm'), 'Geef de release een titel.'));
      return;
    }
    const link = ytLink.value.trim();
    if (link && link !== (r.youtube_url || '') && !youtubeIdOf(link)) {
      ytLink.setAttribute('aria-invalid', 'true');
      ytLink.focus();
      errorBox.replaceChildren(el('p', { class: 'error-text' }, icon('circle-alert', 'sm'), 'Dit is geen link naar een YouTube-video. Plak de link van de video zelf, bijvoorbeeld https://youtu.be/…'));
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
    if (id) fd.append('version', String(r.version ?? ''));
    fd.append('youtube_url', ytLink.value.trim());
    for (const k of Object.keys(removed)) fd.append(`remove_${k}`, '1');
    for (const b of buttons.querySelectorAll('button')) b.disabled = true;
    const showBars = Object.keys(files).length > 0;
    for (const b of bars) b.hidden = !showBars;
    const setBars = (p) => { for (const b of bars) b.firstChild.style.width = `${Math.round(p * 100)}%`; };
    try {
      if (!id) { remember('dyc-last-folder', folder.value === 'new' ? '' : folder.value); remember('dyc-last-type', vtype.value); }
      const res = await sendRelease(id ? `/releases/${id}` : '/releases', id ? 'PUT' : 'POST', fd, files, session.uploadChunk, setBars);
      toast(id ? 'Opgeslagen' : 'Release aangemaakt');
      location.hash = `#/release/${res.release.id}`;
    } catch (e) {
      errorBox.replaceChildren(el('p', { class: 'error-text' }, icon('circle-alert', 'sm'), e.message));
      for (const b of bars) b.hidden = true;
    } finally {
      for (const b of buttons.querySelectorAll('button')) b.disabled = false;
    }
  };
  const remove = async () => {
    if (!(await confirmDialog('Release verwijderen?', `"${r.title}" en al zijn bestanden verdwijnen. Direct daarna kun je het nog ongedaan maken.`))) return;
    await api(`/releases/${id}`, { method: 'DELETE' });
    toast(`"${r.title}" verwijderd`, 'ok', { action: { label: 'Ongedaan maken', run: async () => {
      try {
        await api(`/releases/${id}/restore`, { method: 'POST' });
        toast(`"${r.title}" is terug`);
        location.hash = `#/release/${id}`;
      } catch (e) { fail(e); }
    } } });
    location.hash = '#/';
  };
  const buttons = el('div', { class: 'form-actions' },
    id ? el('button', { type: 'button', class: 'btn danger', onclick: () => remove().catch(fail) }, icon('trash-2', 'sm'), 'Verwijderen') : null,
    el('span', { class: 'spacer' }),
    // A submit button: Enter in a field saves too.
    el('button', { type: 'submit', class: 'btn primary lg' }, 'Opslaan'));

  return el('div', { class: 'wrap page' },
    el('div', {},
      el('a', { href: id ? `#/release/${id}` : '#/', class: 'btn ghost sm', style: { paddingLeft: 0 } }, icon('chevron-left', 'sm'), id ? r.title : 'Releases'),
      el('h1', { class: 'h-xl moon-title', style: { marginTop: '12px' } }, titleMoon, id ? 'Release bewerken' : 'Nieuwe release'),
      el('p', { class: 'muted', style: { margin: '6px 0 0' } }, id ? 'Alleen de WAV en een titel zijn verplicht.' : 'Sleep je WAV (en eventueel MP4 en cover) erin: de titel komt uit de bestandsnaam en de YouTube-tekst maakt de app zelf.')),
    el('form', { class: 'cols', novalidate: true, onsubmit: (e) => { e.preventDefault(); save(); },
      // Files dropped anywhere on the form (not on a slot) go to their own slots too.
      ondragover: (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); },
      ondrop: (e) => { if (e.defaultPrevented || !e.dataTransfer?.files.length) return; e.preventDefault(); takeFiles([...e.dataTransfer.files], null); } },
      el('section', { class: 'side-col sticky-col', 'aria-labelledby': 'files-h' }, el('h2', { id: 'files-h', class: 'label' }, 'Bestanden'), SLOTS.map(slot),
        field('u-yt', 'Of een YouTube-link in plaats van de MP4', ytLink, 'Staat de video al op YouTube? Plak de link: de app speelt hem dan af via YouTube.'),
        el('p', { class: 'hint' }, 'Bestanden worden gecontroleerd op hun echte inhoud, niet alleen op de naam.'),
        id ? null : el('a', { href: '#/meerdere', class: 'btn subtle sm', style: { alignSelf: 'flex-start' } }, icon('files', 'sm'), 'Meerdere releases tegelijk')),
      el('section', { class: 'main-col stack', 'aria-labelledby': 'info-h', style: { gap: 'var(--space-6)' } },
        el('h2', { id: 'info-h', class: 'label' }, 'Info'),
        field('u-title', 'Titel', title), dup,
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
  const [{ release: r, limits }, settings, { youtube: yt }, upNow] = await Promise.all([api(`/releases/${id}`), api('/settings'), api('/youtube'), api(`/releases/${id}/youtube-upload`)]);
  let lastUpload = upNow.upload;
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

  const vtype = el('select', { class: 'select', id: 'yt-type', style: { width: 'auto' } },
    [...new Set([...VIDEO_TYPES, r.video_type])].map((t) => el('option', { value: t, selected: t === r.video_type }, t)));
  vtype.addEventListener('change', () => {
    const re = /\(([^)]*)\)\s*$/;
    titleIn.value = re.test(titleIn.value) ? titleIn.value.replace(re, `(${vtype.value})`) : `${titleIn.value} (${vtype.value})`;
    const first = descIn.value.split('\n')[0];
    if (re.test(first)) descIn.value = descIn.value.replace(first, first.replace(re, `(${vtype.value})`));
    tc.upd();
    dc.upd();
    dirty = true;
    saveTexts();
  });

  // Every change is kept by itself, a moment after you stop typing: no button to forget.
  let dirty = false;
  let saveTimer = 0;
  const saved = el('span', { class: 'xs muted save-state', 'aria-live': 'polite' });
  const saveTexts = async () => {
    clearTimeout(saveTimer);
    saved.textContent = 'Opslaan…';
    try {
      const res = await api(`/releases/${id}/youtube`, { method: 'PUT', body: { yt_title: titleIn.value, yt_description: descIn.value, yt_tags: tagsIn.value, version: r.version } });
      r.version = res.release.version;
      dirty = false;
      r.yt_generated_with = 'edited';
      saved.textContent = 'Opgeslagen';
    } catch (e) {
      saved.textContent = 'Niet bewaard';
      fail(e);
    }
  };
  for (const i of [titleIn, descIn, tagsIn]) {
    i.addEventListener('input', () => {
      dirty = true;
      saved.textContent = '';
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveTexts, 900);
    });
  }
  window.addEventListener('hashchange', () => { if (dirty) saveTexts(); }, { once: true });
  const copyBtn = (label, input, primary) => el('button', { type: 'button', class: `btn ${primary ? 'primary' : 'subtle'}`, onclick: async (e) => {
    const b = e.currentTarget; // read it now: after the await the event has no current target any more
    if (await copyText(input.value, `${label} gekopieerd`)) {
      b.replaceChildren(icon('check', 'sm'), 'Gekopieerd');
      setTimeout(() => b.replaceChildren(icon('copy', 'sm'), primary ? 'Kopieer beschrijving' : 'Kopieer'), 2000);
      if (dirty) saveTexts();
    }
  } }, icon('copy', 'sm'), primary ? 'Kopieer beschrijving' : 'Kopieer');

  const extra = el('input', { class: 'input', id: 'yt-extra', maxlength: 1000, placeholder: 'bv. deel 2 van de reeks' });
  const genBtn = el('button', { type: 'button', class: 'btn subtle lg' }, icon('refresh-cw', 'sm'), r.yt_description ? 'Opnieuw genereren' : 'Genereren');
  const genNote = el('div', { class: 'small muted', 'aria-live': 'polite' }, ({ '': '', template: 'Vanzelf ingevuld met het template. Wijzig je titel, style of lyrics, dan gaat de tekst mee — tot je hem zelf aanpast.', edited: 'Door jou aangepast: blijft zoals hij is.' })[r.yt_generated_with || ''] ?? 'Geschreven door Claude.');
  const generate = async () => {
    if (r.yt_description && (dirty || r.yt_generated_with === 'edited') && !(await confirmDialog('Opnieuw genereren?', 'Je aanpassingen in de tekst worden overschreven.', 'Overschrijven'))) return;
    genBtn.disabled = true;
    genBtn.setAttribute('aria-busy', 'true');
    genNote.textContent = mode === 'claude' ? 'Claude schrijft je beschrijving… (meestal 10 tot 30 seconden)' : 'Template wordt ingevuld…';
    try {
      const res = await api(`/releases/${id}/youtube`, { method: 'POST', body: { mode, extra: extra.value, version: r.version } });
      r.version = res.release.version;
      titleIn.value = res.release.yt_title;
      descIn.value = res.release.yt_description;
      tagsIn.value = res.release.yt_tags;
      tc.upd(); dc.upd(); gc.upd(); fit(descIn); fit(tagsIn);
      clearTimeout(saveTimer);
      r.yt_generated_with = res.generated_with;
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
    const done = [r.has.video || Boolean(r.youtube_id), Boolean(r.yt_description), Boolean(r.on_youtube), Boolean(r.on_youtube)];
    const next = done.indexOf(false);
    [step1, step2, step3, step4].forEach((node, i) => {
      node.className = `step-nr${done[i] ? ' done' : i === next ? ' next' : ''}`;
      node.replaceChildren(String(i + 1), done[i] ? el('span', { class: 'sr-only' }, ' (klaar)') : '');
    });
    ytMoon.replaceChildren(moon(r.on_youtube ? 'live' : r.youtube_state, 'xl'));
  };
  drawSteps();
  const markLive = async () => {
    const res = await api(`/releases/${id}/status`, { method: 'POST', body: { youtube_url: ytUrl.value, on_youtube: true, version: r.version } });
    r.version = res.release.version;
    r.on_youtube = 1;
    r.youtube_url = ytUrl.value;
    drawSteps();
    toast(`Op YouTube gezet: ${res.release.title}`);
  };
  // Pasting the link of the video is enough: it is marked as on YouTube at once.
  ytUrl.addEventListener('input', () => {
    if (youtubeIdOf(ytUrl.value) && ytUrl.value.trim() !== (r.youtube_url || '')) markLive().catch(fail);
  });
  const sources = [
    ['Titel', r.title],
    ['Style-omschrijving', r.style ? `${styleFacts(r.style, 99).length} kenmerken` : 'leeg'],
    ['Lyrics', r.lyrics ? `${parseLyrics(r.lyrics).reduce((n, s) => n + s.lines.length, 0)} regels` : 'leeg (instrumentaal)'],
  ];

  // ---- Direct naar YouTube: the server sends the MP4 to the channel piece by piece; this page drives it. ----
  function directPanel() {
    const box = el('section', { class: 'panel stack direct-yt', 'aria-labelledby': 'direct-h', style: { gap: 'var(--space-4)' } },
      el('h2', { id: 'direct-h', class: 'label' }, 'Direct naar YouTube'));
    if (!yt.connected) {
      box.append(el('p', { class: 'small muted', style: { margin: 0 } }, 'Koppel je kanaal één keer bij Instellingen. Daarna upload je de video met deze titel, beschrijving en tags rechtstreeks vanaf hier.'),
        el('a', { class: 'btn subtle', href: '#/instellingen', style: { alignSelf: 'flex-start' } }, 'Kanaal koppelen'));
      return box;
    }
    if (!r.has.video) {
      box.append(el('p', { class: 'small muted', style: { margin: 0 } }, 'Deze release heeft nog geen MP4. ', el('a', { href: `#/release/${id}/bewerken` }, 'Video toevoegen')));
      return box;
    }
    const privacy = el('select', { class: 'select', id: 'yt-privacy' },
      [...Object.entries(PRIVACY_WORDS), ['scheduled', 'Ingepland (op een moment dat jij kiest)']].map(([v, label]) => el('option', { value: v, selected: v === (yt.default_privacy || 'private') }, label)));
    const when = el('input', { class: 'input', id: 'yt-when', type: 'datetime-local' });
    const whenField = field('yt-when', 'Live op (Nederlandse tijd)', when, 'Tot dat moment staat de video op privé.');
    whenField.hidden = true;
    privacy.addEventListener('change', () => { whenField.hidden = privacy.value !== 'scheduled'; });
    const bar = el('div', { class: 'progress', hidden: true }, el('i'));
    const line = el('p', { class: 'small', role: 'status', style: { margin: 0 } });
    const result = el('div', { class: 'stack', style: { gap: '8px' } });
    const go = el('button', { type: 'button', class: 'btn primary' }, icon('upload', 'sm'), el('span', {}, 'Upload naar YouTube'));
    const mb = (n) => `${(n / 1048576).toFixed(1).replace('.', ',')} MB`;
    const show = (u) => {
      bar.hidden = !u || !['uploading', 'thumbnail'].includes(u.state);
      if (u) bar.firstChild.style.width = `${Math.round(u.progress * 100)}%`;
      line.textContent = !u ? '' : {
        uploading: `Bezig met uploaden: ${Math.round(u.progress * 100)}% (${mb(u.sent)} van ${mb(u.size)})${u.error ? `. ${u.error}` : ''}`,
        thumbnail: 'Video staat erop; nu de thumbnail…',
        done: 'Geüpload naar YouTube.',
        failed: u.error || 'De upload is mislukt.',
      }[u.state];
      line.className = `small ${u?.state === 'failed' ? 'error-text' : ''}`;
      result.replaceChildren(...(u?.state === 'done' ? [
        el('div', { class: 'row', style: { gap: '8px' } },
          el('a', { class: 'btn subtle sm', href: u.url, target: '_blank', rel: 'noopener' }, icon('external-link', 'sm'), 'Bekijk op YouTube'),
          el('a', { class: 'btn subtle sm', href: u.studio_url, target: '_blank', rel: 'noopener' }, 'YouTube Studio')),
        ...u.warnings.map((w) => el('p', { class: 'xs muted', style: { margin: 0 } }, icon('circle-alert', 'xs'), ' ', w)),
      ] : []));
      go.lastChild.textContent = u && ['uploading', 'thumbnail'].includes(u.state) ? 'Verder uploaden' : r.youtube_video_id ? 'Nog een keer uploaden' : 'Upload naar YouTube';
    };
    let running = false;
    const leave = (e) => { e.preventDefault(); e.returnValue = ''; };
    const run = async () => {
      running = true;
      go.disabled = true;
      window.addEventListener('beforeunload', leave);
      let u = null;
      let misses = 0;
      try {
        // One piece per request, until YouTube has all of it (stops when you leave this page; "Verder uploaden" picks it up).
        while (box.isConnected) {
          try {
            ({ upload: u } = await api(`/releases/${id}/youtube-upload/step`, { method: 'POST' }));
            misses = 0;
          } catch (e) {
            if (e.status && e.status !== 0 && e.status < 500) throw e;
            if (++misses > 5) throw e;
            line.textContent = `${e.message} Nog een poging…`;
            await new Promise((res) => setTimeout(res, 2000 * misses));
            continue;
          }
          show(u);
          lastUpload = u; // what the button does next follows how far it got
          if (!['uploading', 'thumbnail'].includes(u.state)) break;
        }
        if (u?.state === 'done') {
          const fresh = (await api(`/releases/${id}`)).release;
          Object.assign(r, fresh);
          ytUrl.value = r.youtube_url || '';
          drawSteps();
          toast('Geüpload naar YouTube');
        }
      } catch (e) {
        fail(e);
      } finally {
        running = false;
        go.disabled = false;
        window.removeEventListener('beforeunload', leave);
      }
    };
    go.addEventListener('click', async () => {
      if (running) return;
      try {
        if (lastUpload && ['uploading', 'thumbnail'].includes(lastUpload.state)) { await run(); return; }
        if (r.youtube_video_id && !(await confirmDialog('Nog een keer uploaden?', 'Deze release staat al op YouTube. Er komt dan een tweede video op je kanaal; de eerste blijft staan.', 'Toch uploaden'))) return;
        if (dirty) await saveTexts(); // the texts as they are on screen
        if (privacy.value === 'scheduled' && !when.value) { when.focus(); throw new Error('Kies wanneer de video live moet gaan.'); }
        const body = privacy.value === 'scheduled' ? { privacy: 'private', publish_at: when.value } : { privacy: privacy.value };
        const { upload: u } = await api(`/releases/${id}/youtube-upload`, { method: 'POST', body });
        lastUpload = u;
        show(u);
        await run();
      } catch (e) { fail(e); }
    });
    const refresh = el('button', { type: 'button', class: 'btn ghost sm', onclick: async () => {
      try {
        const res = await api(`/releases/${id}/youtube-sync`, { method: 'POST' });
        Object.assign(r, res.release);
        ytUrl.value = r.youtube_url || '';
        drawSteps();
        toast(res.gone ? 'Deze video staat niet meer op YouTube. De link is weggehaald.' : `Status bijgewerkt: ${PRIVACY_WORDS[res.privacy] || res.privacy}`);
      } catch (e) { fail(e); }
    } }, icon('refresh-cw', 'sm'), 'Status vernieuwen');
    box.append(
      el('p', { class: 'small muted', style: { margin: 0 } }, `Naar ${yt.channel_title}, met de titel, beschrijving en tags hiernaast, in de categorie Muziek. Je cover wordt de thumbnail.`),
      field('yt-privacy', 'Zichtbaarheid', privacy), whenField, go, bar, line, result,
      r.youtube_video_id ? el('div', { class: 'row small' }, el('span', { class: 'muted' }, `${PRIVACY_WORDS[r.youtube_privacy] || 'Op'} YouTube`), el('span', { class: 'spacer' }), refresh) : null);
    show(lastUpload);
    return box;
  }

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
          el('label', { for: 'yt-tags', class: 'sr-only' }, 'Tags, met komma\'s'), tagsIn, gc.c),
        el('p', { class: 'xs muted', style: { margin: 0, textAlign: 'right' } }, 'Wijzigingen worden vanzelf bewaard. ', saved)),
      el('aside', { class: 'side-col' },
        directPanel(),
        el('section', { class: 'panel lean-panel', 'aria-labelledby': 'steps-h' },
          el('h2', { id: 'steps-h', class: 'label' }, yt.connected ? 'Of zelf, via YouTube Studio' : 'Uploaden naar YouTube'),
          el('ol', { class: 'steps' },
            el('li', {}, step1, el('div', { class: 'grow' }, el('b', { class: 'small' }, 'Download de video'),
              r.has.video ? el('a', { class: 'btn subtle sm', href: `/media/${id}/video?download=1`, style: { alignSelf: 'flex-start' } }, icon('download', 'sm'), 'MP4 downloaden')
                : el('a', { class: 'small', href: `#/release/${id}/bewerken` }, 'Nog geen video — upload er een'))),
            el('li', {}, step2, el('div', { class: 'grow' }, el('b', { class: 'small' }, 'Lees de tekst na en kopieer'), el('span', { class: 'xs muted' }, 'Staat al klaar; laat Claude hem herschrijven als je wilt.'))),
            el('li', {}, step3, el('div', { class: 'grow' }, el('b', { class: 'small' }, 'Plak alles in YouTube Studio'),
              el('a', { class: 'small', href: 'https://studio.youtube.com', target: '_blank', rel: 'noopener' }, 'studio.youtube.com ', icon('external-link', 'xs')))),
            el('li', {}, step4, el('div', { class: 'grow' }, el('label', { for: 'yt-url', class: 'small', style: { fontWeight: 700 } }, 'Plak de link van je video'), ytUrl,
              el('button', { type: 'button', class: 'btn subtle', onclick: () => markLive().catch(fail) }, 'Markeer als op YouTube'))))),
        el('section', { class: 'panel stack', 'aria-labelledby': 'src-h', style: { gap: '10px' } },
          el('h2', { id: 'src-h', class: 'label' }, 'Waar de tekst uit komt'),
          sources.map(([k, v]) => el('div', { class: 'row small' }, icon('check', 'sm'), el('span', { class: 'spacer' }, k), el('span', { class: 'muted' }, v))),
          el('p', { class: 'small muted', style: { margin: '4px 0 0' } }, 'Spotify-link, AI-vermelding en standaard-hashtags komen uit ', el('a', { href: '#/instellingen' }, 'Instellingen'), '.'),
          el('a', { class: 'small', href: `#/release/${id}/bewerken` }, 'Titel, style of lyrics aanpassen')))));
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

export async function settingsView(query = new URLSearchParams()) {
  if (!isAdmin()) throw Object.assign(new Error('Alleen voor admin'), { status: 403 });
  const [{ settings: s, claude, youtube_secret_saved: ytSecretSaved }, { youtube: yt }] = await Promise.all([api('/settings'), api('/youtube')]);
  // Back from Google: say how it went, once.
  if (query.get('youtube')) setTimeout(() => toast(`YouTube-kanaal gekoppeld: ${query.get('youtube')}`), 300);
  if (query.get('youtube_error')) setTimeout(() => toast(query.get('youtube_error'), 'error'), 300);
  if (query.get('youtube') || query.get('youtube_error')) history.replaceState(null, '', '#/instellingen');
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
  // YouTube-kanaal: the OAuth client of the artist's own Google project, and the connection.
  const ytId = el('input', { class: 'input', id: 's-yt-id', autocomplete: 'off', spellcheck: 'false', value: s.youtube_client_id || '', placeholder: yt.from_env ? `${yt.client_id} (via de server)` : '…apps.googleusercontent.com' });
  const ytSecret = el('input', { class: 'input', id: 's-yt-secret', type: 'password', autocomplete: 'off', placeholder: ytSecretSaved ? '•••••••• (opgeslagen)' : 'GOCSPX-…' });
  const ytPrivacy = el('select', { class: 'select', id: 's-yt-privacy' }, Object.entries(PRIVACY_WORDS).map(([v, label]) => el('option', { value: v, selected: v === s.youtube_default_privacy }, label)));
  const ytAi = el('input', { type: 'checkbox', id: 's-yt-ai', checked: s.youtube_ai_label === '1' });
  const body = () => {
    const b = {};
    for (const [k, i] of Object.entries(inputs)) b[k] = i.value;
    if (key.value.trim()) b.anthropic_api_key = key.value.trim();
    b.youtube_client_id = ytId.value.trim();
    if (ytSecret.value.trim()) b.youtube_client_secret = ytSecret.value.trim();
    b.youtube_default_privacy = ytPrivacy.value;
    b.youtube_ai_label = ytAi.checked;
    return b;
  };
  const save = async (e) => {
    e.preventDefault();
    await api('/settings', { method: 'PUT', body: body() });
    toast('Instellingen opgeslagen');
    window.dispatchEvent(new CustomEvent('dyc:reload'));
  };
  const connect = async () => {
    await api('/settings', { method: 'PUT', body: body() }); // what was just typed counts
    const { url } = await api('/youtube/connect', { method: 'POST' });
    location.href = url; // Google's consent screen; it sends you back here
  };
  const disconnect = async () => {
    if (!(await confirmDialog('YouTube ontkoppelen?', 'De app kan dan niet meer uploaden naar je kanaal. Video\'s die er al staan blijven staan.', 'Ontkoppelen'))) return;
    await api('/youtube/connection', { method: 'DELETE' });
    toast('YouTube ontkoppeld');
    window.dispatchEvent(new CustomEvent('dyc:reload'));
  };
  const redirect = el('code', { class: 'redirect-uri' }, yt.redirect_uri);
  const ytPanel = el('section', { class: 'panel stack', 'aria-labelledby': 'set-ytc', style: { gap: 'var(--space-4)' } },
    el('h2', { id: 'set-ytc', class: 'label' }, 'YouTube-kanaal'),
    el('p', { class: 'status claude-moon' }, moon(yt.connected ? 'live' : 'none', 'xl'), yt.connected ? `Gekoppeld: ${yt.channel_title}` : 'Nog niet gekoppeld: uploaden gaat dan via YouTube Studio'),
    yt.connected ? null : el('ol', { class: 'small muted setup-steps' },
      el('li', {}, 'Maak een project in ', el('a', { href: 'https://console.cloud.google.com/projectcreate', target: '_blank', rel: 'noopener' }, 'Google Cloud'), ' en zet de ', el('a', { href: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com', target: '_blank', rel: 'noopener' }, 'YouTube Data API v3'), ' aan.'),
      el('li', {}, 'Stel het ', el('a', { href: 'https://console.cloud.google.com/apis/credentials/consent', target: '_blank', rel: 'noopener' }, 'OAuth-toestemmingsscherm'), ' in (extern, jezelf als testgebruiker) en zet het op In productie.'),
      el('li', {}, 'Maak bij ', el('a', { href: 'https://console.cloud.google.com/apis/credentials', target: '_blank', rel: 'noopener' }, 'Inloggegevens'), ' een OAuth-client-ID (Webapplicatie) met de omleidings-URI hieronder.'),
      el('li', {}, 'Plak de Client ID en het secret hieronder en klik op Koppel.')),
    el('div', { class: 'field' }, el('span', { class: 'small', style: { fontWeight: 600 } }, 'Omleidings-URI'),
      el('div', { class: 'row', style: { gap: '8px', flexWrap: 'nowrap' } }, redirect,
        el('button', { type: 'button', class: 'icon-btn plain', 'aria-label': 'Omleidings-URI kopiëren', onclick: () => copyText(yt.redirect_uri, 'Omleidings-URI gekopieerd') }, icon('copy', 'sm'))),
      el('div', { class: 'hint' }, 'Zet precies dit adres bij "Geautoriseerde omleidings-URI\'s" van je OAuth-client.')),
    field('s-yt-id', 'Client ID', ytId),
    field('s-yt-secret', 'Client secret', ytSecret, 'Wordt op de server bewaard en nooit meer getoond.'),
    field('s-yt-privacy', 'Standaard zichtbaarheid bij uploaden', ytPrivacy),
    el('label', { class: 'check', for: 's-yt-ai' }, ytAi, 'Meld bij YouTube dat de video AI-materiaal bevat'),
    el('div', { class: 'row' },
      yt.connected
        ? el('button', { type: 'button', class: 'btn danger sm', onclick: () => disconnect().catch(fail) }, 'Ontkoppelen')
        : el('button', { type: 'button', class: 'btn primary', onclick: () => connect().catch(fail) }, icon('external-link', 'sm'), 'Koppel YouTube-kanaal')),
    el('p', { class: 'xs muted', style: { margin: 0 } }, 'Zolang Google je project niet heeft goedgekeurd, zet YouTube elke upload vast op privé. ',
      el('a', { href: 'https://support.google.com/youtube/contact/yt_api_form', target: '_blank', rel: 'noopener' }, 'Goedkeuring (audit) aanvragen')));
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
          claude.key_saved ? el('button', { type: 'button', class: 'btn danger sm', style: { alignSelf: 'flex-start' }, onclick: () => clearKey().catch(fail) }, 'Key weghalen') : null),
        ytPanel),
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
