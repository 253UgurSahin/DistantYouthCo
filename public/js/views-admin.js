import { el, icon, moon, parseLyrics, styleFacts, toast, confirmDialog, formDialog, copyText, YT_WORDS } from './dom.js';
import { api, upload } from './api.js';
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

  const slot = (s) => {
    const input = el('input', { type: 'file', accept: s.accept, class: 'sr-only', id: `file-${s.kind}`, 'aria-describedby': `file-${s.kind}-text` });
    const text = el('div', { class: 'xs muted', id: `file-${s.kind}-text` });
    const bar = el('div', { class: 'progress', hidden: true }, el('i'));
    bars.push(bar);
    const has = () => files[s.kind] || (r.has?.[s.kind] && !removed[s.kind]);
    const actions = el('div', { class: 'row' });
    const node = el('div', { class: 'slot' },
      el('div', { class: 'slot-main' },
        el('span', { class: 'slot-kind', 'aria-hidden': 'true' }, s.tile || icon('image')),
        el('div', { class: 'slot-text' }, el('b', {}, s.title, ' ', el('span', { class: s.need === 'verplicht' ? '' : 'faint', style: { fontWeight: 500 } }, `· ${s.need}`)), text),
        actions),
      bar, input);
    const paint = () => {
      node.classList.toggle('filled', Boolean(has()));
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
    for (const [k, f] of Object.entries(files)) fd.append(k, f);
    for (const b of buttons.querySelectorAll('button')) b.disabled = true;
    const showBars = Object.keys(files).length > 0;
    for (const b of bars) b.hidden = !showBars;
    try {
      const res = await upload(id ? `/releases/${id}` : '/releases', id ? 'PUT' : 'POST', fd, (p) => {
        for (const b of bars) b.firstChild.style.width = `${Math.round(p * 100)}%`;
      });
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
      el('h1', { class: 'h-xl', style: { marginTop: '12px' } }, id ? 'Release bewerken' : 'Nieuwe release'),
      el('p', { class: 'muted', style: { margin: '6px 0 0' } }, 'Alleen de WAV en een titel zijn verplicht. De rest kun je later aanvullen.')),
    el('form', { class: 'cols', onsubmit: (e) => { e.preventDefault(); save(false); } },
      el('section', { class: 'side-col', 'aria-labelledby': 'files-h' }, el('h2', { id: 'files-h', class: 'label' }, 'Bestanden'), SLOTS.map(slot),
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

  const titleIn = el('input', { class: 'input lg', id: 'yt-title', value: r.yt_title, 'aria-labelledby': 'yt-title-h', 'aria-describedby': 'yt-title-count' });
  const descIn = el('textarea', { class: 'textarea yt-desc', id: 'yt-desc', value: r.yt_description, 'aria-describedby': 'yt-desc-count' });
  const tagsIn = el('textarea', { class: 'textarea', id: 'yt-tags', rows: 3, value: r.yt_tags, 'aria-describedby': 'yt-tags-count' });
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

  const extra = el('input', { class: 'input', id: 'yt-extra', maxlength: 1000, placeholder: 'bv. noem dat dit deel 2 is van de Japanese-Inspired reeks' });
  const genBtn = el('button', { type: 'button', class: 'btn lg' }, icon('refresh-cw', 'sm'), r.yt_description ? 'Opnieuw genereren' : 'Genereren');
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
      tc.upd(); dc.upd(); gc.upd(); drawChips();
      dirty = false;
      genNote.textContent = `Gemaakt met ${res.generated_with === 'template' ? 'het template' : 'Claude'}. Lees het na en pas aan waar je wilt.`;
      genBtn.lastChild.textContent = 'Opnieuw genereren';
      step2.classList.add('done');
      step2.replaceChildren(icon('check', 'xs'));
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
    el('button', { type: 'button', 'aria-pressed': String(mode === 'claude'), disabled: !settings.claude.configured, title: settings.claude.configured ? '' : 'Voeg een Claude API key toe bij Instellingen', 'aria-describedby': settings.claude.configured ? undefined : 'claude-why', onclick: (e) => { mode = 'claude'; for (const b of seg.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); } }, 'Claude'),
    el('button', { type: 'button', 'aria-pressed': String(mode === 'template'), onclick: (e) => { mode = 'template'; for (const b of seg.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); } }, 'Template'));

  // Steps.
  const ytUrl = el('input', { class: 'input', id: 'yt-url', type: 'url', placeholder: 'https://youtu.be/…', value: r.youtube_url });
  const step1 = el('span', { class: `step-nr ${r.has.video ? 'done' : ''}` }, r.has.video ? icon('check', 'xs') : '1');
  const step2 = el('span', { class: `step-nr ${r.yt_description ? 'done' : ''}` }, r.yt_description ? icon('check', 'xs') : '2');
  const step4 = el('span', { class: `step-nr ${r.on_youtube ? 'done' : ''}` }, r.on_youtube ? icon('check', 'xs') : '4');
    // Ticks step 4 off once the video is live, whichever way it got there (by hand or by the upload below).
    const setLive = () => {
    step4.replaceChildren(icon('check', 'xs'));
    step4.classList.add('done');
    };
  const markLive = async () => {
    const res = await api(`/releases/${id}/status`, { method: 'POST', body: { youtube_url: ytUrl.value, on_youtube: true } });
        setLive();
    toast(`Op YouTube gezet: ${res.release.title}`);
  };

    // ---------- direct upload to the connected channel ----------
    // Without a connected channel this panel only says how to connect one; without an MP4 it says that.
    // The manual steps further down stay, for whoever prefers YouTube Studio.
    const yt = settings.youtube;
    const ACTIVE = ['starting', 'uploading', 'thumbnail'];
    const mb = (n) => (n / 1048576).toLocaleString('nl-NL', { maximumFractionDigits: 1 });
    const fmtWhen = (iso) => new Date(iso).toLocaleString('nl-NL', { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    // A Date as the value a datetime-local input wants (local time, no seconds).
    const localValue = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

    const privacySel = el('select', { class: 'select', id: 'yt-privacy' },
        [['private', 'Privé'], ['unlisted', 'Verborgen (alleen met de link)'], ['public', 'Openbaar'], ['scheduled', 'Inplannen']]
            .map(([v, label]) => el('option', { value: v }, label)));
    privacySel.value = settings.settings.youtube_default_privacy || 'private';
    // The server wants at least 5 minutes ahead; the picker starts at 10 so a slow click still fits.
    const whenIn = el('input', { class: 'input', id: 'yt-when', type: 'datetime-local', min: localValue(new Date(Date.now() + 10 * 60_000)), 'aria-describedby': 'yt-when-hint' });
    const whenField = field('yt-when', 'Live op', whenIn, 'Tot dat moment staat de video op privé. Jouw eigen tijd.');
    const showWhen = () => { whenField.hidden = privacySel.value !== 'scheduled'; };
    privacySel.addEventListener('change', showWhen);
    showWhen();

    const upBtn = el('button', { type: 'button', class: 'btn primary', disabled: !r.has.video }, icon('upload', 'sm'), r.youtube_video_id ? 'Nog een keer uploaden' : 'Upload naar YouTube');
    const upBar = el('div', { class: 'progress', hidden: true, role: 'progressbar', 'aria-label': 'Upload naar YouTube', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, el('i'));
    // The running count is not a live region: it changes every second and would drown out everything else.
    const upCount = el('div', { class: 'xs muted', hidden: true });
    // Start, done and failed are announced, once each.
    const upNote = el('div', { class: 'stack', 'aria-live': 'polite', style: { gap: '6px' } });

    // What YouTube last said about the uploaded video, with a link to it and to YouTube Studio.
    const videoLine = el('p', { class: 'status', style: { margin: 0 } });
    const refreshBtn = el('button', { type: 'button', class: 'btn subtle sm', onclick: () => syncNow(false).catch(fail) }, icon('refresh-cw', 'sm'), 'Status vernieuwen');
    const videoActions = el('div', { class: 'row' });
    const paintVideo = () => {
        const has = Boolean(r.youtube_video_id);
        videoLine.hidden = !has;
        videoActions.hidden = !has;
        if (!has) return;
        const words = r.yt_privacy === 'public' ? 'Openbaar op YouTube'
            : r.yt_privacy === 'unlisted' ? 'Verborgen op YouTube'
                : r.yt_publish_at ? `Ingepland: live op ${fmtWhen(r.yt_publish_at)}`
                    : 'Privé op YouTube';
        videoLine.replaceChildren(moon(r.on_youtube ? 'live' : 'ready'), words);
        videoActions.replaceChildren(
            el('a', { class: 'small', href: r.youtube_url, target: '_blank', rel: 'noopener' }, 'Bekijk ', icon('external-link', 'xs')),
            el('a', { class: 'small', href: `https://studio.youtube.com/video/${encodeURIComponent(r.youtube_video_id)}/edit`, target: '_blank', rel: 'noopener' }, 'YouTube Studio ', icon('external-link', 'xs')),
            refreshBtn);
        upBtn.lastChild.textContent = 'Nog een keer uploaden';
    };

    // Asks the server to ask YouTube (1 quota unit). Quiet when the page does it by itself on opening.
    const syncNow = async (quiet) => {
        refreshBtn.disabled = true;
        try {
            const res = await api(`/releases/${id}/youtube/sync`, { method: 'POST' });
            Object.assign(r, res.release);
            paintVideo();
            if (r.on_youtube) setLive();
            if (res.sync.removed) {
                ytUrl.value = '';
                upBtn.lastChild.textContent = 'Upload naar YouTube';
                toast('Deze video staat niet meer op YouTube. De link is weggehaald.', 'error');
            } else if (res.sync.problem) toast(res.sync.problem, 'error');
            else if (!quiet) toast('Status bijgewerkt');
        } finally {
            refreshBtn.disabled = false;
        }
    };

    // Draws a job: the bar and count on every poll, the announced note only when the phase changes.
    let lastPhase = '';
    const showJob = (job) => {
        const active = ACTIVE.includes(job.state);
        const pct = job.total ? Math.floor((job.sent / job.total) * 100) : 0;
        upBar.hidden = !active;
        upCount.hidden = !active;
        upBar.firstChild.style.width = `${pct}%`;
        upBar.setAttribute('aria-valuenow', String(pct));
        upCount.textContent = job.state === 'thumbnail' ? 'Video staat erop; nu de thumbnail…' : `${pct}% · ${mb(job.sent)} van ${mb(job.total)} MB`;
        upBtn.disabled = active || !r.has.video;
        const phase = job.state === 'starting' ? 'uploading' : job.state;
        if (phase === lastPhase) return;
        lastPhase = phase;
        if (phase === 'uploading') {
            upNote.replaceChildren(el('p', { class: 'xs muted', style: { margin: 0 } }, 'Bezig met uploaden. Dit loopt op de server door, ook als je naar een andere pagina gaat.'));
        } else if (phase === 'done') {
            const res = job.result;
            Object.assign(r, { youtube_video_id: res.video_id, youtube_url: res.url, yt_privacy: res.privacy, yt_publish_at: res.publish_at, on_youtube: res.privacy === 'public' });
            ytUrl.value = res.url;
            paintVideo();
            if (r.on_youtube) setLive();
            upNote.replaceChildren(
                el('p', { class: 'row small', style: { margin: 0, gap: '8px' } }, icon('check', 'sm'), 'Geüpload naar YouTube.'),
                job.warnings.map((w) => el('p', { class: 'xs muted', style: { margin: 0 } }, w)));
        } else if (phase === 'error') {
            upNote.replaceChildren(el('p', { class: 'error-text', style: { margin: 0 } }, icon('circle-alert', 'sm'), job.error));
        }
    };

    // Polls the job while it runs. Stops when the artist has left this page (the upload itself goes on).
    const panelRef = { node: null, seen: false };
    const onPage = () => {
        if (panelRef.node?.isConnected) panelRef.seen = true;
        return Boolean(panelRef.node?.isConnected) || !panelRef.seen;
    };
    const follow = (job) => {
        if (!job) {
            // We were following an upload and the server forgot it: it was restarted halfway.
            if (lastPhase === 'uploading') showJob({ state: 'error', sent: 0, total: 0, error: 'De upload is afgebroken doordat de server opnieuw is opgestart. Start hem opnieuw.', warnings: [] });
            return;
        }
        showJob(job);
        if (!ACTIVE.includes(job.state)) return;
        setTimeout(async () => {
            if (!onPage()) return;
            try {
                follow((await api(`/releases/${id}/youtube/upload`)).job);
            } catch {
                // Offline for a moment, or the server is restarting: keep the last state and ask again.
                follow(job);
            }
        }, 1500);
    };

    const startUpload = async () => {
        if (!titleIn.value.trim()) {
            toast('Geef de video eerst een titel.', 'error');
            titleIn.focus();
            return;
        }
        const body = { privacy: privacySel.value };
        if (privacySel.value === 'scheduled') {
            if (!whenIn.value) {
                toast('Kies wanneer de video live moet gaan.', 'error');
                whenIn.focus();
                return;
            }
            // The picker gives local time without a zone; Date reads it as local, toISOString makes it UTC.
            body.publish_at = new Date(whenIn.value).toISOString();
        }
        if (r.youtube_video_id) {
            const ok = await confirmDialog('Nog een keer uploaden?',
                'Deze release staat al op YouTube. Er komt dan een tweede video op je kanaal; de eerste blijft staan.', 'Toch uploaden');
            if (!ok) return;
            body.force = true;
        }
        upBtn.disabled = true;
        try {
            // Upload exactly what is on the screen: unsaved edits to the texts are saved first.
            await saveTexts(true);
            const { job } = await api(`/releases/${id}/youtube/upload`, { method: 'POST', body });
            lastPhase = '';
            follow(job);
        } catch (e) {
            upBtn.disabled = !r.has.video;
            fail(e);
        }
    };
    upBtn.addEventListener('click', () => startUpload().catch(fail));

    const directPanel = el('section', { class: 'panel stack', 'aria-labelledby': 'direct-h' },
        el('h2', { id: 'direct-h', class: 'label' }, 'Direct naar YouTube'),
        !yt.connected
            ? [
                el('p', { class: 'small muted', style: { margin: 0 } }, 'Koppel je kanaal één keer bij Instellingen. Daarna upload je de video met deze titel, beschrijving en tags rechtstreeks vanaf hier.'),
                el('a', { class: 'btn subtle sm', href: '#/instellingen', style: { alignSelf: 'flex-start' } }, 'Kanaal koppelen'),
            ]
            : [
                el('p', { class: 'xs muted', style: { margin: 0 } }, `Naar ${yt.channel.title}`),
                videoLine,
                videoActions,
                r.has.video ? null : el('p', { class: 'small', style: { margin: 0 } }, 'Deze release heeft nog geen MP4. ', el('a', { href: `#/release/${id}/bewerken` }, 'Video toevoegen')),
                field('yt-privacy', 'Zichtbaarheid', privacySel),
                whenField,
                upBtn,
                upBar,
                upCount,
                upNote,
                el('p', { class: 'hint', style: { margin: 0 } }, r.has.cover ? 'Je cover wordt de thumbnail. ' : '', 'Zolang Google je project niet heeft goedgekeurd, blijft elke upload privé.'),
            ]);
    panelRef.node = directPanel;
    paintVideo();
    if (yt.connected) {
        // Picks up an upload that is still running (the artist left this page and came back), or the
        // error of one that failed meanwhile.
        api(`/releases/${id}/youtube/upload`).then(({ job }) => {
            const recentError = job?.state === 'error' && Date.now() - Date.parse(job.started_at) < 30 * 60_000;
            if (job && (ACTIVE.includes(job.state) || recentError)) follow(job);
        }).catch(() => {});
        // Private or scheduled: maybe it is public by now. Quiet: no message when nothing changed.
        if (r.youtube_video_id && !r.on_youtube) syncNow(true).catch(() => {});
    }
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
        el('h1', { class: 'h-xl', style: { marginTop: '12px' } }, 'YouTube-kit'),
        el('p', { class: 'muted', style: { margin: '6px 0 0' } }, yt.connected
            ? 'Titel, beschrijving en tags uit je titel, style-omschrijving en lyrics. Pas aan en upload direct naar je kanaal.'
            : 'Titel, beschrijving en tags uit je titel, style-omschrijving en lyrics. Pas aan, kopieer, plak in YouTube Studio.')),
      el('div', { class: 'stack', style: { gap: '6px', alignItems: 'flex-end' } }, el('div', { class: 'row' }, seg, genBtn), settings.claude.configured ? null : el('span', { id: 'claude-why', class: 'xs muted' }, 'Claude: zet eerst een API key bij Instellingen'))),
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
            directPanel,
        el('section', { class: 'panel', 'aria-labelledby': 'steps-h' },
            el('h2', { id: 'steps-h', class: 'label' }, yt.connected ? 'Of zelf, via YouTube Studio' : 'Uploaden naar YouTube'),
          el('ol', { class: 'steps' },
            el('li', {}, step1, el('div', { class: 'grow' }, el('b', { class: 'small' }, 'Download de video'),
              r.has.video ? el('a', { class: 'btn subtle sm', href: `/media/${id}/video?download=1`, style: { alignSelf: 'flex-start' } }, icon('download', 'sm'), 'MP4 downloaden')
                : el('a', { class: 'small', href: `#/release/${id}/bewerken` }, 'Nog geen video — upload er een'))),
            el('li', {}, step2, el('div', { class: 'grow' }, el('b', { class: 'small' }, 'Maak en controleer de tekst'), el('span', { class: 'xs muted' }, 'Links: genereren, nalezen, kopiëren.'))),
            el('li', {}, el('span', { class: 'step-nr' }, '3'), el('div', { class: 'grow' }, el('b', { class: 'small' }, 'Plak alles in YouTube Studio'),
              el('a', { class: 'small', href: 'https://studio.youtube.com', target: '_blank', rel: 'noopener' }, 'studio.youtube.com ', icon('external-link', 'xs')))),
            el('li', {}, step4, el('div', { class: 'grow' }, el('label', { for: 'yt-url', class: 'small', style: { fontWeight: 700 } }, 'Plak de link van je video'), ytUrl,
              el('button', { type: 'button', class: 'btn', onclick: () => markLive().catch(fail) }, 'Markeer als op YouTube'))))),
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
    el('p', { class: 'muted', style: { margin: 0 } }, 'Luisteraars kunnen je releases afspelen (behalve concepten) en hun eigen playlists maken. Alleen admins uploaden en beheren.'),
    el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Naam'), el('th', {}, 'Rol'), el('th', {}, 'Sinds'), el('th', {}, el('span', { class: 'sr-only' }, 'Acties')))),
      el('tbody', {}, users.map((u) => el('tr', {},
        el('td', {}, el('span', { class: 'avatar', 'aria-hidden': 'true' }, u.username.slice(0, 1)), u.username, u.id === session.user.id ? el('span', { class: 'faint' }, ' (jij)') : null,
          el('span', { class: 'm-date' }, `sinds ${new Date(u.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('nl-NL')}`)),
        el('td', {}, u.role === 'admin' ? 'Admin' : 'Luisteraar'),
        el('td', { class: 'muted date' }, new Date(u.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('nl-NL')),
        el('td', { style: { textAlign: 'right' } },
          el('button', { type: 'button', class: 'icon-btn plain', 'aria-label': `Nieuw wachtwoord voor ${u.username}`, onclick: () => reset(u).catch(fail) }, icon('key-round', 'sm')),
          u.id !== session.user.id ? el('button', { type: 'button', class: 'icon-btn plain', 'aria-label': `${u.username} verwijderen`, onclick: () => remove(u).catch(fail) }, icon('trash-2', 'sm')) : null)))))));
}

// ---------- S09 Settings ----------

// The privacy choices of a YouTube upload, in the app's own words.
const PRIVACY_WORDS = { private: 'Privé', unlisted: 'Verborgen (alleen met de link)', public: 'Openbaar' };

/** A link that opens outside the app, with the small arrow that says so. */
const outLink = (href, label) => el('a', { href, target: '_blank', rel: 'noopener' }, label, ' ', icon('external-link', 'xs'));

export async function settingsView(query = new URLSearchParams()) {
  if (!isAdmin()) throw Object.assign(new Error('Alleen voor admin'), { status: 403 });
    const { settings: s, claude, youtube: yt } = await api('/settings');
  const inputs = {};
  const txt = (key, label, hint, type = 'text') => {
    inputs[key] = type === 'textarea'
      ? el('textarea', { class: 'textarea', id: `s-${key}`, rows: 2, value: s[key] })
      : el('input', { class: 'input', id: `s-${key}`, type, value: s[key] });
    return field(`s-${key}`, label, inputs[key], hint);
  };
  const key = el('input', { class: 'input', id: 's-key', type: 'password', autocomplete: 'off', placeholder: claude.key_saved ? '•••••••• (opgeslagen)' : 'sk-ant-…' });

    // ---- YouTube channel: the OAuth client, and what an upload does by default ----
    const ytId = el('input', {
        class: 'input', id: 's-yt-id', autocomplete: 'off', spellcheck: 'false', value: yt.client_id || '',
        placeholder: yt.from_env ? 'Ingesteld via de server (YOUTUBE_CLIENT_ID)' : '….apps.googleusercontent.com',
    });
    const ytSecret = el('input', {
        class: 'input', id: 's-yt-secret', type: 'password', autocomplete: 'off', 'aria-describedby': 's-yt-secret-hint',
        placeholder: yt.secret_saved ? '•••••••• (opgeslagen)' : 'GOCSPX-…',
    });
    // Read-only, with a copy button: it has to go into Google Cloud exactly like this.
    const ytRedirect = el('input', { class: 'input', id: 's-yt-redirect', readonly: true, value: yt.redirect_uri, 'aria-describedby': 's-yt-redirect-hint' });
    const ytPrivacy = el('select', { class: 'select', id: 's-yt-privacy' },
        Object.entries(PRIVACY_WORDS).map(([v, label]) => el('option', { value: v, selected: s.youtube_default_privacy === v }, label)));
    const ytAi = el('input', { type: 'checkbox', id: 's-yt-ai', checked: s.youtube_synthetic_media !== '0' });
    // These two save themselves: the form's Opslaan button sits in the other column (on a phone far
    // above this panel), so waiting for it would leave a changed choice unsaved too easily.
    const saveUploadChoices = () => api('/settings', {
        method: 'PUT',
        body: { youtube_default_privacy: ytPrivacy.value, youtube_synthetic_media: ytAi.checked },
    }).then(() => toast('Opgeslagen')).catch(fail);
    ytPrivacy.addEventListener('change', saveUploadChoices);
    ytAi.addEventListener('change', saveUploadChoices);

    /** Everything on the screen, in the shape PUT /api/settings wants. Empty secret fields mean "keep". */
    const collect = () => {
        const body = {};
        for (const [k, i] of Object.entries(inputs)) body[k] = i.value;
        if (key.value.trim()) body.anthropic_api_key = key.value.trim();
        // Once connected the client fields are not on screen; leave the saved client alone then.
        if (!yt.connected) {
            body.youtube_client_id = ytId.value.trim();
            if (ytSecret.value.trim()) body.youtube_client_secret = ytSecret.value.trim();
        }
        body.youtube_default_privacy = ytPrivacy.value;
        body.youtube_synthetic_media = ytAi.checked;
        return body;
    };
  const save = async (e) => {
    e.preventDefault();
        await api('/settings', { method: 'PUT', body: collect() });
    toast('Instellingen opgeslagen');
    window.dispatchEvent(new CustomEvent('dyc:reload'));
  };

    // "Koppel": save first (so a client ID and secret typed just now count), then off to Google.
    // Google sends the browser back to /oauth/youtube/callback, which returns here with ?youtube=klaar.
    const connect = async () => {
        await api('/settings', { method: 'PUT', body: collect() });
        const { youtube: now } = await api('/settings');
        if (!now.configured) {
            toast('Vul eerst de Client ID en het Client secret in.', 'error');
            (ytId.value.trim() ? ytSecret : ytId).focus();
            return;
        }
        location.href = '/oauth/youtube/start';
    };
    const unlink = async () => {
        const ok = await confirmDialog('YouTube ontkoppelen?',
            `De app kan dan niet meer naar ${yt.channel.title} uploaden. Je video's op YouTube blijven gewoon staan.`, 'Ontkoppelen');
        if (!ok) return;
        await api('/youtube/disconnect', { method: 'POST' });
        toast('YouTube ontkoppeld');
        window.dispatchEvent(new CustomEvent('dyc:reload'));
    };

    // Back from Google: show how it went (the server kept the message), and take "klaar" out of the
    // address so a reload does not show it again.
    if (query.get('youtube') === 'klaar') {
        history.replaceState(null, '', '#/instellingen');
        if (yt.last_auth) setTimeout(() => toast(yt.last_auth.message, yt.last_auth.ok ? 'ok' : 'error'), 0);
    }

    const ytPanel = el('section', { class: 'panel stack', 'aria-labelledby': 'set-youtube' },
        el('h2', { id: 'set-youtube', class: 'label' }, 'YouTube-kanaal'),
        el('p', { class: 'status' }, moon(yt.connected ? 'live' : 'none'),
            yt.connected ? `Gekoppeld met ${yt.channel.title}` : 'Nog niet gekoppeld: uploaden gaat dan via YouTube Studio'),
        yt.connected ? null : [
            // The one-time set-up in Google Cloud, short; the README has the long version.
            el('ol', { class: 'setup-steps small muted' },
                el('li', {}, 'Maak een project in ', outLink('https://console.cloud.google.com/projectcreate', 'Google Cloud'),
                    ' en zet daarin de ', outLink('https://console.cloud.google.com/apis/library/youtube.googleapis.com', 'YouTube Data API v3'), ' aan.'),
                el('li', {}, 'Stel het ', outLink('https://console.cloud.google.com/apis/credentials/consent', 'OAuth-toestemmingsscherm'),
                    ' in (extern) en zet het op "In productie". In de testfase vervalt de koppeling na 7 dagen.'),
                el('li', {}, 'Maak bij ', outLink('https://console.cloud.google.com/apis/credentials', 'Inloggegevens'),
                    ' een OAuth-client-ID van het type Webapplicatie, met de omleidings-URI hieronder.'),
                el('li', {}, 'Plak de Client ID en het secret hieronder en klik op Koppel.')),
            field('s-yt-id', 'Client ID', ytId),
            field('s-yt-secret', 'Client secret', ytSecret, 'Wordt op de server bewaard en nooit meer getoond.'),
            el('div', { class: 'field' },
                el('label', { for: 's-yt-redirect' }, 'Omleidings-URI'),
                el('div', { class: 'copy-row' }, ytRedirect,
                    el('button', { type: 'button', class: 'btn subtle', onclick: () => copyText(yt.redirect_uri, 'Omleidings-URI gekopieerd') }, icon('copy', 'sm'), 'Kopieer')),
                el('div', { class: 'hint', id: 's-yt-redirect-hint' }, 'Zet precies dit adres bij "Geautoriseerde omleidings-URI\'s" van je OAuth-client.')),
        ],
        field('s-yt-privacy', 'Standaard zichtbaarheid bij uploaden', ytPrivacy),
        el('label', { class: 'check', for: 's-yt-ai' }, ytAi, 'Meld bij YouTube dat de video AI-materiaal bevat'),
        el('div', { class: 'row' },
            yt.connected
                ? el('button', { type: 'button', class: 'btn danger sm', onclick: () => unlink().catch(fail) }, 'Ontkoppelen')
                : el('button', { type: 'button', class: 'btn primary', onclick: () => connect().catch(fail) }, icon('external-link', 'sm'), 'Koppel YouTube-kanaal')),
        el('p', { class: 'hint', style: { margin: 0 } },
            'Zolang Google je project niet heeft goedgekeurd, zet YouTube elke upload vast op privé. ',
            outLink('https://support.google.com/youtube/contact/yt_api_form', 'Goedkeuring (audit) aanvragen')));
  const clearKey = async () => {
    if (!(await confirmDialog('API key weghalen?', 'De YouTube-kit valt dan terug op het template, en albumnamen voorstellen werkt niet meer.', 'Weghalen'))) return;
    await api('/settings', { method: 'PUT', body: { clear_api_key: true } });
    window.dispatchEvent(new CustomEvent('dyc:reload'));
  };
  return el('div', { class: 'wrap page' },
    el('h1', { class: 'h-xl' }, 'Instellingen'),
    el('form', { class: 'cols', onsubmit: (e) => save(e).catch(fail) },
      el('section', { class: 'main-col stack', style: { gap: 'var(--space-6)' }, 'aria-labelledby': 'set-yt' },
        el('h2', { id: 'set-yt', class: 'label' }, 'Vaste onderdelen van je YouTube-beschrijving'),
        txt('artist_name', 'Artiestennaam'),
        txt('spotify_artist_url', 'Spotify-artiestenlink', 'Komt onder "More from … on Spotify".', 'url'),
        txt('youtube_channel_url', 'YouTube-kanaal', '', 'url'),
        txt('ai_disclosure', 'AI-vermelding', 'Precies zoals hij in de beschrijving moet staan.', 'textarea'),
        txt('default_hashtags', 'Standaard-hashtags', 'Komen achter de hashtags van het nummer. Met spaties ertussen.'),
        txt('default_video_type', 'Standaard video-type', 'Bijvoorbeeld Official Visualizer.'),
        el('div', { class: 'form-actions' }, el('button', { type: 'submit', class: 'btn primary lg' }, 'Opslaan'))),
      el('aside', { class: 'side-col' },
        el('section', { class: 'panel stack', 'aria-labelledby': 'set-claude' },
          el('h2', { id: 'set-claude', class: 'label' }, 'Claude'),
          el('p', { class: 'status' }, moon(claude.configured ? 'live' : 'none'), claude.configured ? (claude.from_env ? 'Ingesteld via de server (ANTHROPIC_API_KEY)' : 'Ingesteld') : 'Nog niet ingesteld: de YouTube-kit gebruikt dan het template'),
          field('s-key', 'Anthropic API key', key, 'Wordt op de server bewaard en nooit meer getoond. Maak er een op console.anthropic.com.'),
          claude.key_saved ? el('button', { type: 'button', class: 'btn danger sm', style: { alignSelf: 'flex-start' }, onclick: () => clearKey().catch(fail) }, 'Key weghalen') : null),
            ytPanel)));
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
  const user = el('input', { class: 'input lg', id: 'a-user', autocomplete: 'username', required: true, autocapitalize: 'none' });
  const pass = el('input', { class: 'input lg', id: 'a-pass', type: 'password', autocomplete: setup ? 'new-password' : 'current-password', required: true });
  const err = el('div', { role: 'alert' });
  const btn = el('button', { type: 'submit', class: 'btn primary lg' }, setup ? 'Admin aanmaken' : 'Inloggen');
  const submit = async (e) => {
    e.preventDefault();
    err.replaceChildren();
    btn.disabled = true;
    try {
      const res = await api(setup ? '/setup' : '/login', { method: 'POST', body: { username: user.value.trim(), password: pass.value } });
      onDone(res.user);
    } catch (x) {
      err.replaceChildren(el('p', { class: 'error-text' }, icon('circle-alert', 'sm'), x.message));
      btn.disabled = false;
    }
  };
  return el('div', { class: 'auth-page' },
    el('form', { class: 'auth', onsubmit: submit },
      el('img', { src: '/img/emblem.png', alt: '' }),
      el('h1', { class: 'title', style: { textAlign: 'center', letterSpacing: '.2em' } }, 'Distant Youth Studio'),
      setup ? el('p', { class: 'small muted', style: { margin: 0, textAlign: 'center' } }, 'Welkom. Maak eerst je eigen admin-account aan. Daarna kun je luisteraars toevoegen.') : null,
      field('a-user', 'Gebruikersnaam', user, setup ? '3 tot 32 tekens: letters, cijfers, _ . -' : null),
      field('a-pass', 'Wachtwoord', pass, setup ? 'Minstens 8 tekens.' : null),
      err, btn));
}

export { coverEl, YT_WORDS };
