import { el, icon, moon, STATUS_WORDS } from './dom.js';
import { api } from './api.js';
import { isAdmin } from './session.js';
import { coverEl, emptyState } from './parts.js';

// Downloads: every release's video in one place. One MP4 with one click, or tick several (all are
// ticked to begin with) and get them together as one ZIP, each file named after its release.

const size = (n) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1).replace('.', ',')} GB` : `${Math.max(0.1, n / 1048576).toFixed(1).replace('.', ',')} MB`);

export async function downloadsView() {
  if (!isAdmin()) throw Object.assign(new Error('Alleen voor admin'), { status: 403 });
  const { videos } = await api('/downloads');

  const head = el('div', { class: 'page-head' },
    el('h1', { class: 'h-xl moon-title' }, el('span', { class: 'title-moon' }, icon('clapperboard')), 'Downloads'),
    el('p', { class: 'muted measure' }, 'Alle video\'s van je releases op één plek. Download er één, of kies er meer en haal ze in één ZIP binnen: elk bestand heet naar zijn release.'));
  if (!videos.length) {
    return el('div', { class: 'wrap page' }, head,
      emptyState('Nog geen video\'s. Upload een MP4 bij een release, dan staat hij hier.', el('a', { class: 'btn primary', href: '#/nieuw' }, icon('plus', 'sm'), 'Nieuwe release')));
  }

  const chosen = new Set(videos.map((v) => v.id));
  let filter = 'all';
  const todoCount = videos.filter((v) => !v.on_youtube).length;
  const shown = () => videos.filter((v) => filter === 'all' || !v.on_youtube);

  const list = el('ul', { class: 'dl-list', 'aria-label': 'Video\'s' });
  const summary = el('span', { class: 'dl-sum', 'aria-live': 'polite' });
  const zipBtn = el('a', { class: 'btn primary lg', download: '' }, icon('archive', 'sm'), el('span', {}, 'Download als ZIP'));
  const all = el('input', { type: 'checkbox', id: 'dl-all' });

  const sync = () => {
    const vis = shown();
    const picked = vis.filter((v) => chosen.has(v.id));
    const bytes = picked.reduce((n, v) => n + v.video_size, 0);
    summary.textContent = picked.length ? `${picked.length} van ${vis.length} gekozen · ${size(bytes)}` : 'Niets gekozen';
    all.checked = picked.length === vis.length;
    all.indeterminate = picked.length > 0 && picked.length < vis.length;
    if (picked.length) {
      zipBtn.href = `/downloads/videos.zip?ids=${picked.map((v) => v.id).join(',')}`;
      zipBtn.removeAttribute('aria-disabled');
      zipBtn.lastChild.textContent = picked.length === 1 ? 'Download 1 video' : `Download ${picked.length} als ZIP`;
    } else {
      zipBtn.removeAttribute('href');
      zipBtn.setAttribute('aria-disabled', 'true');
      zipBtn.lastChild.textContent = 'Download als ZIP';
    }
    // One video: the plain MP4, no ZIP around it.
    if (picked.length === 1) zipBtn.href = picked[0].download_url;
  };

  const row = (v) => {
    const box = el('input', { type: 'checkbox', id: `dl-${v.id}`, checked: chosen.has(v.id), onchange: () => { if (box.checked) chosen.add(v.id); else chosen.delete(v.id); sync(); } });
    const meta = [v.video_type, v.folder_name, v.release_date ? new Date(v.release_date).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : null].filter(Boolean).join(' · ');
    return el('li', { class: 'dl-row' },
      el('label', { class: 'dl-pick check', for: `dl-${v.id}` }, box,
        coverEl(v, 'xs'),
        el('span', { class: 'dl-text' }, el('b', {}, v.title), el('span', { class: 'xs muted' }, meta))),
      el('span', { class: 'status dl-state' }, moon(v.status, 'sm'), v.on_youtube ? 'Op YouTube' : STATUS_WORDS[v.status]),
      el('span', { class: 'dl-size xs muted' }, size(v.video_size)),
      el('a', { class: 'btn subtle sm', href: v.download_url, download: '', 'aria-label': `MP4 van ${v.title} downloaden` }, icon('download', 'sm'), 'MP4'));
  };

  const draw = () => {
    list.replaceChildren(...shown().map(row));
    for (const b of chips.children) b.setAttribute('aria-pressed', String(b.dataset.f === filter));
    sync();
  };
  all.addEventListener('change', () => {
    for (const v of shown()) { if (all.checked) chosen.add(v.id); else chosen.delete(v.id); }
    draw();
  });
  const chips = el('div', { class: 'chips', role: 'group', 'aria-label': 'Welke video\'s' },
    el('button', { type: 'button', class: 'chip', dataset: { f: 'all' }, onclick: () => { filter = 'all'; draw(); } }, `Alle video's · ${videos.length}`),
    el('button', { type: 'button', class: 'chip', dataset: { f: 'todo' }, onclick: () => { filter = 'todo'; draw(); } }, moon('ready', 'sm'), `Nog niet op YouTube · ${todoCount}`));

  const bar = el('div', { class: 'dl-bar' },
    el('label', { class: 'check', for: 'dl-all' }, all, 'Alles kiezen'),
    summary, el('span', { class: 'spacer' }), zipBtn);
  draw();
  return el('div', { class: 'wrap page' }, head,
    el('section', { class: 'stack', style: { gap: 'var(--space-4)' }, 'aria-label': 'Video\'s downloaden' }, chips, bar, list));
}
