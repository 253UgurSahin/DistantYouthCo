import { ICONS } from './icons.js';

const SVG = 'http://www.w3.org/2000/svg';

/** Builds an element. Text is always set as text, never as HTML. */
export function el(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style') {
      for (const [p, val] of Object.entries(v)) {
        if (p.startsWith('--')) node.style.setProperty(p, val);
        else node.style[p] = val;
      }
    } else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked' || k === 'selected') node[k] = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.firstChild.remove();
  return node;
}

/** A Lucide icon (our own constant markup), coloured by currentColor. */
export function icon(name, cls = '') {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `icon ${cls}`.trim());
  svg.innerHTML = ICONS[name] || '';
  return svg;
}

export const STATUS_WORDS = { live: 'Live', ready: 'Klaar voor YouTube', concept: 'Concept' };
export const YT_WORDS = { live: 'live', ready: 'klaar om te uploaden', none: 'nog niet' };

export function moon(state, size = '') {
  return el('span', { class: `moon moon-${state} ${size}`.trim(), 'aria-hidden': 'true' });
}

export function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '–:––';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtDuration(sec) {
  if (!sec) return '';
  if (sec < 60) return '< 1 min';
  const min = Math.round(sec / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} u ${min % 60} min`;
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function titleCase(s) {
  return s.toLowerCase().replace(/(^|[\s\-/])([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

/** The first few tags of a style description, for a short facts line. */
export function styleFacts(style, n = 3) {
  return String(style || '')
    .split(/[,;·|\n]+/)
    .map((t) => t.trim())
    .filter((t) => t && t.length <= 40 && !/^\d{2,3}\s*bpm$/i.test(t))
    .slice(0, n)
    .map(titleCase);
}

/** Splits Suno-style lyrics into sections (same rules as the server). */
export function parseLyrics(lyrics = '') {
  const sections = [];
  let cur = { name: '', lines: [] };
  for (const raw of String(lyrics).split(/\r?\n/)) {
    const m = raw.match(/^\s*[[(]([^\])]+)[\])]\s*$/);
    if (m) {
      if (cur.lines.length || cur.name) sections.push(cur);
      cur = { name: m[1].trim(), lines: [] };
    } else if (raw.trim()) cur.lines.push(raw.trim());
  }
  if (cur.lines.length || cur.name) sections.push(cur);
  return sections;
}

export function hookLine(lyrics) {
  const secs = parseLyrics(lyrics);
  const chorus = secs.find((s) => /chorus|hook|refrein/i.test(s.name) && s.lines.length);
  return chorus ? chorus.lines[0] : '';
}

// ---------- toasts and dialogs ----------

/**
 * A short message. With an action ({ label, run }) it gets a button and stays longer (10 s); it never
 * goes while the pointer or the keyboard is on it, so there is time to read and press.
 */
export function toast(message, kind = 'ok', { action } = {}) {
  const root = document.getElementById('toasts');
  const t = el('div', { class: `toast ${kind === 'error' ? 'error' : ''}` }, kind === 'error' ? icon('circle-alert', 'sm') : icon('check', 'sm'), el('span', {}, message));
  const close = () => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 300);
  };
  if (action) {
    t.append(el('button', { type: 'button', class: 'toast-action', onclick: () => { close(); action.run(); } }, icon('undo-2', 'sm'), action.label));
  }
  root.append(t);
  let left = action ? 10000 : kind === 'error' ? 6000 : 3000;
  let since = Date.now();
  let timer = setTimeout(close, left);
  const hold = () => { clearTimeout(timer); left -= Date.now() - since; };
  const go = () => { if (t.matches(':hover, :focus-within')) return; since = Date.now(); timer = setTimeout(close, Math.max(left, 2000)); };
  t.addEventListener('pointerenter', hold);
  t.addEventListener('focusin', hold);
  t.addEventListener('pointerleave', go);
  t.addEventListener('focusout', () => setTimeout(go));
}

/** A modal dialog. build(close) returns its content; resolves with what close() was given. */
export function dialog(build, cls = '') {
  return new Promise((resolve) => {
    const dlg = el('dialog', { class: `dlg ${cls}`.trim() });
    const opener = document.activeElement;
    let result;
    const close = (value) => {
      result = value;
      dlg.close();
    };
    dlg.addEventListener('close', () => {
      dlg.remove();
      // Back where you were, for the keyboard.
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
      resolve(result);
    });
    // Tab and Shift+Tab go round inside the dialog, never out of it behind its backdrop.
    dlg.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const stops = [...dlg.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select, textarea, iframe, [tabindex]:not([tabindex="-1"])')]
        .filter((n) => n.offsetParent !== null || n === document.activeElement);
      if (!stops.length) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) close();
    });
    append(dlg, [build(close)]);
    document.body.append(dlg);
    dlg.showModal();
  });
}

export function confirmDialog(title, text, okLabel = 'Verwijderen') {
  return dialog((close) =>
    el('form', { method: 'dialog', onsubmit: (e) => { e.preventDefault(); close(true); } },
      el('h2', { class: 'h-xl' }, title),
      el('p', { class: 'muted' }, text),
      el('div', { class: 'row', style: { justifyContent: 'flex-end' } },
        el('button', { type: 'button', class: 'btn subtle', onclick: () => close(false) }, 'Annuleren'),
        el('button', { type: 'submit', class: 'btn danger' }, okLabel)))
  );
}

/** Asks for one or more text values. fields: [{name, label, value, type, hint}] */
export function formDialog(title, fields, okLabel = 'Opslaan') {
  return dialog((close) => {
    const inputs = {};
    return el('form', {
      onsubmit: (e) => {
        e.preventDefault();
        const out = {};
        for (const [k, inp] of Object.entries(inputs)) out[k] = inp.type === 'checkbox' ? inp.checked : inp.value;
        close(out);
      },
    },
    el('h2', { class: 'h-xl' }, title),
    fields.map((f) => {
      const id = `f-${f.name}-${Math.random().toString(36).slice(2, 7)}`;
      if (f.type === 'checkbox') {
        inputs[f.name] = el('input', { type: 'checkbox', id, checked: Boolean(f.value) });
        return el('label', { class: 'check', for: id }, inputs[f.name], f.label);
      }
      inputs[f.name] = f.type === 'textarea'
        ? el('textarea', { class: 'textarea', id, rows: 3, value: f.value || '' })
        : el('input', { class: 'input', id, type: f.type || 'text', value: f.value || '', required: f.required, autocomplete: f.autocomplete || 'off' });
      return el('div', { class: 'field' }, el('label', { for: id }, f.label), inputs[f.name], f.hint ? el('div', { class: 'hint' }, f.hint) : null);
    }),
    el('div', { class: 'row', style: { justifyContent: 'flex-end' } },
      el('button', { type: 'button', class: 'btn subtle', onclick: () => close(null) }, 'Annuleren'),
      el('button', { type: 'submit', class: 'btn primary' }, okLabel)));
  });
}

export async function copyText(text, label = 'Gekopieerd') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
    return true;
  } catch {
    toast('Kopiëren lukte niet. Selecteer de tekst en kopieer hem zelf.', 'error');
    return false;
  }
}
