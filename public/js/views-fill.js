import { el, icon, toast, styleFacts } from './dom.js';
import { api, upload } from './api.js';
import { isAdmin } from './session.js';
import { player } from './player.js';
import { coverEl } from './parts.js';

// "Aanvullen": one release after another that still has no style or no lyrics, with room to paste
// both and a button to listen while you do. Saving sends only these two (the rest stays as it is);
// the BPM and the YouTube text follow by themselves.

export const needsWords = (r) => !(r.style || '').trim() || !(r.lyrics || '').trim();

// The view is put on the page a frame or two after it is built: focus once it is there.
const focusSoon = (node, tries = 60) => {
  if (!node) return;
  if (node.isConnected) node.focus();
  else if (tries) requestAnimationFrame(() => focusSoon(node, tries - 1));
};

export async function fillView(query) {
  if (!isAdmin()) throw Object.assign(new Error('Alleen voor admin'), { status: 403 });
  const { releases } = await api('/releases');
  // Only those asked for (after "Meerdere releases"), or every release that still needs words.
  const only = (query.get('ids') || '').split(',').map(Number).filter(Boolean);
  const queue = releases.filter((r) => needsWords(r) && (!only.length || only.includes(r.id)));
  const total = queue.length;
  let at = 0;
  let saved = 0;

  const page = el('div', { class: 'wrap page' });
  const head = el('div', {},
    el('a', { href: '#/', class: 'btn ghost sm', style: { paddingLeft: 0 } }, icon('chevron-left', 'sm'), 'Releases'),
    el('h1', { class: 'h-xl moon-title', style: { marginTop: '12px' } }, el('span', { class: 'title-moon' }, icon('wand-sparkles')), 'Aanvullen'),
    el('p', { class: 'muted measure', style: { margin: '6px 0 0' } }, 'Eén voor één de releases zonder style of lyrics. Plak ze uit Suno; de BPM en de YouTube-tekst gaan vanzelf mee.'));
  const body = el('div', { class: 'stack', style: { gap: 'var(--space-6)' } });
  page.append(head, body);

  const finish = () => {
    body.replaceChildren(el('section', { class: 'panel stack fill-done', style: { gap: 'var(--space-4)' } },
      el('p', { class: 'todo-done', style: { margin: 0 } }, icon('circle-check', 'sm'),
        total ? `Klaar: ${saved} van ${total} aangevuld.` : 'Alles is al aangevuld: elke release heeft style en lyrics.'),
      el('div', { class: 'row' }, el('a', { class: 'btn primary', href: '#/' }, 'Naar de releases'))));
    focusSoon(body.querySelector('a'));
  };

  const show = () => {
    if (at >= queue.length) { finish(); return; }
    const r = queue[at];
    const style = el('textarea', { class: 'textarea', id: 'f-style', rows: 3, maxlength: 4000, value: r.style || '', placeholder: 'bv. heavy melodic dubstep, 140 bpm, koto, female vocals' });
    const lyrics = el('textarea', { class: 'textarea', id: 'f-lyrics', rows: 12, maxlength: 20000, value: r.lyrics || '', placeholder: '[Intro]\n…\n\n[Chorus]\n…' });
    const facts = el('div', { class: 'xs muted', 'aria-live': 'polite' });
    const drawFacts = () => {
      const bpm = style.value.match(/(\d{2,3})\s*bpm/i)?.[1];
      const f = [bpm ? `${bpm} BPM` : null, ...styleFacts(style.value, 6)].filter(Boolean);
      facts.textContent = f.length ? `Herkend: ${f.join(' · ')}` : '';
    };
    style.addEventListener('input', drawFacts);
    drawFacts();
    const errorBox = el('div', { role: 'alert' });
    const saveBtn = el('button', { type: 'submit', class: 'btn primary lg' }, at + 1 < queue.length ? 'Opslaan en volgende' : 'Opslaan en klaar');
    const skipBtn = el('button', { type: 'button', class: 'btn subtle lg', onclick: () => { at++; show(); } }, 'Overslaan');
    const save = async (e) => {
      e.preventDefault();
      errorBox.replaceChildren();
      saveBtn.disabled = true;
      try {
        const fd = new FormData();
        fd.append('style', style.value);
        fd.append('lyrics', lyrics.value);
        await upload(`/releases/${r.id}`, 'PUT', fd);
        saved++;
        toast(`${r.title}: opgeslagen`);
        at++;
        show();
      } catch (err) {
        errorBox.replaceChildren(el('p', { class: 'error-text' }, icon('circle-alert', 'sm'), err.message));
        saveBtn.disabled = false;
      }
    };
    body.replaceChildren(
      el('div', { class: 'fill-progress', role: 'group', 'aria-label': 'Voortgang' },
        el('span', { class: 'small muted' }, `${at + 1} van ${total}`),
        el('div', { class: 'progress', 'aria-hidden': 'true' }, el('i', { style: { width: `${Math.round((at / Math.max(1, total)) * 100)}%` } }))),
      el('form', { class: 'panel stack fill-card', style: { gap: 'var(--space-6)' }, onsubmit: save, 'aria-labelledby': 'f-title' },
        el('div', { class: 'row fill-head' },
          coverEl(r, 'md'),
          el('div', { class: 'grow' }, el('h2', { id: 'f-title', class: 'fill-title' }, r.title), el('a', { class: 'small', href: `#/release/${r.id}/bewerken` }, 'Alles bewerken')),
          r.audio_url ? el('button', { type: 'button', class: 'btn subtle', onclick: () => player.play(r) }, icon('play', 'sm'), 'Luister') : null),
        el('div', { class: 'field' }, el('label', { for: 'f-style' }, 'Style-omschrijving'), style, facts),
        el('div', { class: 'field' }, el('label', { for: 'f-lyrics' }, 'Lyrics'), lyrics),
        errorBox,
        el('div', { class: 'form-actions' }, skipBtn, el('span', { class: 'spacer' }), saveBtn)));
    focusSoon(style.value ? lyrics : style);
  };

  if (!total) finish();
  else show();
  return page;
}
