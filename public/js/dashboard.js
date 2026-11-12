import { el, icon, moon, STATUS_WORDS } from './dom.js';
import { api } from './api.js';

const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const LONG = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
const SLOTS = 24; // the chart always holds 24 bars; a shorter period folds the oldest away, so it morphs
const REFRESH_MS = 45_000;
const label = (m) => MONTHS[Number(m.slice(5)) - 1];
const longLabel = (m) => `${LONG[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
const hhmm = (iso) => new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

/** Counts a number up (or down) from what it shows now to `to`; at once for reduced motion. */
function countTo(node, to) {
  const from = Number(node.dataset.value ?? 0);
  node.dataset.value = String(to);
  if (reducedMotion.matches || from === to) {
    node.textContent = String(to);
    return;
  }
  const start = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - start) / 700);
    node.textContent = String(Math.round(from + (to - from) * (1 - (1 - p) ** 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** A small line of the last months for one status, as inline SVG. */
function spark(values) {
  const w = 96;
  const h = 24;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${((i / Math.max(1, values.length - 1)) * w).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(' ');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('class', 'spark');
  svg.setAttribute('aria-hidden', 'true');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  line.setAttribute('points', pts);
  line.setAttribute('pathLength', '1');
  svg.append(line);
  return svg;
}

/**
 * "De stand van de nacht": the numbers of this app at dashboard level 3.
 * onFilter(status) narrows the release grid to the releases behind a number (the drill-down).
 */
export function standPanel(first, onFilter) {
  let data = first;
  let period = first.period;
  let paused = false;
  let active = 'all';
  let timer = null;

  const updated = el('span', { class: 'small faint' });
  // The numbers live across redraws, so a refresh or a new period counts from the old value.
  const numbers = { live: el('b', {}, '0'), ready: el('b', {}, '0'), concept: el('b', {}, '0') };
  const currentNumber = el('b', {}, '0');
  const tileButton = (s, node, value) => {
    countTo(numbers[s], value);
    return node;
  };
  const summary = el('p', { class: 'sr-only', 'aria-live': 'polite' });
  const compare = el('p', { class: 'compare' });
  const tiles = el('div', { class: 'stats' });
  const bars = el('div', { class: 'bars', role: 'img' });
  const barLabels = el('div', { class: 'bar-labels', 'aria-hidden': 'true' });
  const chartTable = el('table', { class: 'table', hidden: true });
  const matrix = el('div', { class: 'table-wrap' });
  const error = el('div', { role: 'alert' });
  const tableBtn = el('button', { type: 'button', class: 'btn ghost sm', 'aria-expanded': 'false', onclick: () => {
    chartTable.hidden = !chartTable.hidden;
    tableBtn.setAttribute('aria-expanded', String(!chartTable.hidden));
    tableBtn.lastChild.textContent = chartTable.hidden ? 'Toon als tabel' : 'Verberg tabel';
  } }, icon('list', 'sm'), el('span', {}, 'Toon als tabel'));

  // 24 bars, made once: every refresh or period change only moves their heights and widths.
  const barEls = Array.from({ length: SLOTS }, (_, i) => el('i', { style: { '--i': String(i) } }));
  const labelEls = Array.from({ length: SLOTS }, () => el('span'));
  bars.append(...barEls);
  barLabels.append(...labelEls);

  const periodSeg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Periode' },
    [6, 12, 24].map((n) => el('button', { type: 'button', 'aria-pressed': String(n === period), onclick: () => setPeriod(n) }, `${n} mnd`)));
  const pauseBtn = el('button', { type: 'button', class: 'icon-btn plain', 'aria-pressed': 'false', 'aria-label': 'Live verversen pauzeren', onclick: () => {
    paused = !paused;
    pauseBtn.setAttribute('aria-pressed', String(paused));
    pauseBtn.setAttribute('aria-label', paused ? 'Live verversen hervatten' : 'Live verversen pauzeren');
    pauseBtn.replaceChildren(icon(paused ? 'play' : 'pause', 'sm'));
    drawUpdated();
    schedule();
  } }, icon('pause', 'sm'));

  function drawUpdated() {
    updated.replaceChildren(el('span', { class: `live-dot ${paused ? 'paused' : ''}`, 'aria-hidden': 'true' }), paused ? `gepauzeerd · ${hhmm(data.generated_at)}` : `live · bijgewerkt ${hhmm(data.generated_at)}`);
  }

  function draw() {
    const d = data;
    error.replaceChildren();
    // Tiles: number, moon, words, a spark line of the period; a click shows the releases behind it.
    tiles.replaceChildren(...['live', 'ready', 'concept'].map((s) => tileButton(s, el('button', {
      type: 'button', class: 'stat', 'aria-pressed': String(active === s),
      onclick: () => {
        active = active === s ? 'all' : s;
        onFilter(active);
        draw();
      },
    }, numbers[s], el('span', {}, moon(s, 'sm'), STATUS_WORDS[s], el('span', { class: 'sr-only' }, ': toon deze releases')), spark(d.months.map((m) => m.by[s]))), d.counts[s])));

    // The comparison with the period before.
    const c = d.comparison;
    const sign = c.change > 0 ? `+${c.change}` : String(c.change);
    countTo(currentNumber, c.current);
    compare.replaceChildren(currentNumber, ` ${c.current === 1 ? 'release' : 'releases'} in de laatste ${d.period} maanden `,
      el('span', { class: `delta ${c.change > 0 ? 'up' : c.change < 0 ? 'down' : ''}` }, `${sign} t.o.v. de ${d.period} maanden ervoor (${c.previous})`));

    // The bars morph: the oldest slots fold to zero width when the period is shorter.
    const max = Math.max(1, ...d.months.map((m) => m.count));
    const offset = SLOTS - d.months.length;
    barEls.forEach((b, i) => {
      const m = d.months[i - offset];
      b.classList.toggle('folded', !m);
      b.classList.toggle('zero', Boolean(m) && m.count === 0);
      b.classList.toggle('now', Boolean(m) && i === SLOTS - 1);
      b.style.setProperty('--h', m ? `${m.count ? Math.max(8, (m.count / max) * 100) : 3}%` : '0%');
      b.title = m ? `${longLabel(m.month)}: ${m.count}` : '';
      labelEls[i].textContent = m ? label(m.month) : '';
      labelEls[i].classList.toggle('folded', !m);
    });
    const peak = d.months.reduce((a, m) => (m.count > a.count ? m : a), d.months[0]);
    const desc = `Releases per maand, ${longLabel(d.months[0].month)} tot ${longLabel(d.months.at(-1).month)}: in totaal ${c.current}, het meest in ${longLabel(peak.month)} (${peak.count}).`;
    bars.setAttribute('aria-label', desc);
    chartTable.replaceChildren(
      el('caption', { class: 'sr-only' }, 'Releases per maand'),
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Maand'), el('th', { scope: 'col' }, 'Releases'), el('th', { scope: 'col' }, 'Live'), el('th', { scope: 'col' }, 'Klaar'), el('th', { scope: 'col' }, 'Concept'))),
      el('tbody', {}, d.months.map((m) => el('tr', {}, el('td', {}, longLabel(m.month)), el('td', {}, String(m.count)), el('td', {}, String(m.by.live)), el('td', {}, String(m.by.ready)), el('td', {}, String(m.by.concept))))));
    summary.textContent = `${d.counts.live} live, ${d.counts.ready} klaar voor YouTube, ${d.counts.concept} concept.`;

    // The readiness matrix: what each release still needs.
    const cols = d.matrix.columns;
    matrix.replaceChildren(el('table', { class: 'table matrix' },
      el('caption', { class: 'sr-only' }, 'Wat elke release al heeft'),
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Release'), cols.map((c2) => el('th', { scope: 'col' }, c2.label)), el('th', { scope: 'col' }, 'Klaar'))),
      el('tbody', {}, d.matrix.rows.map((r) => el('tr', {},
        el('th', { scope: 'row' }, el('a', { href: `#/release/${r.id}` }, moon(r.status, 'sm'), r.title)),
        cols.map((c2) => el('td', {}, el('span', { class: `cell ${r.cells[c2.key] ? 'on' : ''}` }, el('span', { class: 'sr-only' }, r.cells[c2.key] ? 'ja' : 'nee')))),
        el('td', {}, el('span', { class: 'heat', style: { '--level': String(Math.round((r.done / cols.length) * 4) + 1) } }, `${r.done}/${cols.length}`)))))));
    drawUpdated();
  }

  async function load() {
    try {
      data = await api(`/stats?months=${period}`);
      draw();
    } catch (e) {
      error.replaceChildren(el('p', { class: 'error-text' }, icon('circle-alert', 'sm'), `De cijfers konden niet laden: ${e.message}`),
        el('button', { type: 'button', class: 'btn subtle sm', onclick: load }, icon('refresh-cw', 'sm'), 'Opnieuw'));
    }
  }

  function setPeriod(n) {
    period = n;
    for (const b of periodSeg.children) b.setAttribute('aria-pressed', String(b.textContent === `${n} mnd`));
    load();
  }

  // Live refresh: every 45 seconds while the page is open and visible, never while paused.
  function schedule() {
    clearTimeout(timer);
    if (paused) return;
    timer = setTimeout(async () => {
      if (!node.isConnected) return;
      if (!document.hidden) await load();
      schedule();
    }, REFRESH_MS);
  }
  document.addEventListener('visibilitychange', () => {
    if (node.isConnected && !document.hidden && !paused) load();
  });

  const node = el('section', { class: 'panel stand stack', 'aria-labelledby': 'stand-h', style: { gap: 'var(--space-6)' } },
    el('div', { class: 'section-head' }, el('h2', { id: 'stand-h' }, 'De stand van de nacht'), el('span', { class: 'rule' }), updated, pauseBtn),
    el('div', { class: 'toolbar' }, compare, el('span', { class: 'spacer' }), periodSeg),
    tiles,
    summary,
    error,
    el('div', { class: 'stack', style: { gap: '6px' } }, bars, barLabels,
      el('div', { class: 'row' }, el('span', { class: 'xs faint' }, `Per maand, Nederlandse tijd`), el('span', { class: 'spacer' }), tableBtn)),
    el('div', { class: 'table-wrap' }, chartTable),
    el('div', { class: 'stack', style: { gap: 'var(--space-3)' } }, el('h3', { class: 'label' }, 'Wat elke release al heeft'), matrix));

  node.setActive = (s) => {
    active = s;
    draw();
  };
  draw();
  schedule();
  return node;
}
