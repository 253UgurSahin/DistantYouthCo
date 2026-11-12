import { el, icon, clear, toast } from './dom.js';
import { api } from './api.js';
import { session, isAdmin } from './session.js';
import { player, stopPlayer } from './player.js';
import { mount as mountDepth } from '/vendor/depth.js';
import { homeView, releaseView, collectionsView, collectionView, playlistsView, playlistView } from './views-listen.js';
import { editView, youtubeView, accountsView, settingsView, accountView, authView, themeButtons } from './views-admin.js';
import { loading, errorPage } from './parts.js';

const shell = document.getElementById('shell');
const main = document.getElementById('main');
let depth = null;
let renderId = 0;
let closeMenu = () => {};
document.addEventListener('click', (e) => { if (!e.target.closest('.menu')) closeMenu(); });

const ROUTES = [
  [/^\/?$/, (m, q) => homeView(q), 'releases'],
  [/^\/release\/(\d+)\/youtube$/, (m, q) => youtubeView(m[1], q), 'releases'],
  [/^\/release\/(\d+)\/bewerken$/, (m) => editView(m[1]), 'releases'],
  [/^\/release\/(\d+)$/, (m) => releaseView(m[1]), 'releases'],
  [/^\/nieuw$/, () => editView(null), 'releases'],
  [/^\/collecties$/, () => collectionsView(), 'collecties'],
  [/^\/collectie\/(\d+)$/, (m) => collectionView(m[1]), 'collecties'],
  [/^\/playlists$/, () => playlistsView(), 'playlists'],
  [/^\/playlist\/(\d+)$/, (m) => playlistView(m[1]), 'playlists'],
  [/^\/accounts$/, () => accountsView(), ''],
  [/^\/instellingen$/, () => settingsView(), ''],
  [/^\/account$/, () => accountView(), ''],
];

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { path, query: new URLSearchParams(qs || '') };
}

// ---------- the header ----------

function header(active) {
  const menuPanel = el('div', { class: 'menu-panel', id: 'account-menu', hidden: true },
    el('div', { class: 'label', style: { padding: '8px 12px 4px' } }, 'Thema'),
    themeButtons(),
    el('hr'),
    el('a', { href: '#/account' }, icon('key-round', 'sm'), 'Wachtwoord wijzigen'),
    isAdmin() ? el('a', { href: '#/accounts' }, icon('users', 'sm'), 'Accounts') : null,
    isAdmin() ? el('a', { href: '#/instellingen' }, icon('settings', 'sm'), 'Instellingen') : null,
    el('hr'),
    el('button', { type: 'button', onclick: logout }, icon('log-out', 'sm'), 'Uitloggen'));
  const menuBtn = el('button', { type: 'button', class: 'icon-btn', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-controls': 'account-menu', 'aria-label': `Account: ${session.user.username}` },
    el('span', { class: 'caps', style: { fontWeight: '600', fontSize: '13px' } }, session.user.username.slice(0, 1)));
  const setOpen = (open) => {
    menuPanel.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
  };
  menuBtn.addEventListener('click', () => setOpen(menuPanel.hidden));
  closeMenu = () => setOpen(false);
  menuPanel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { setOpen(false); menuBtn.focus(); } });
  menuPanel.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  const navLink = (href, label, key) => el('a', { href, ...(active === key ? { 'aria-current': 'page' } : {}) }, label);
  return el('header', { class: 'header' }, el('div', { class: 'wrap' },
    el('a', { class: 'brand', href: '#/' }, el('img', { src: '/img/emblem.png', alt: '' }), el('span', {}, el('b', {}, 'DISTANT YOUTH'), el('small', {}, 'STUDIO'))),
    el('nav', { class: 'nav', 'aria-label': 'Hoofdmenu' }, navLink('#/', 'Releases', 'releases'), navLink('#/collecties', 'Collecties', 'collecties'), navLink('#/playlists', 'Playlists', 'playlists')),
    el('a', { class: 'icon-btn', href: '#/?focus=search', 'aria-label': 'Zoeken' }, icon('search', 'sm')),
    isAdmin() ? el('a', { class: 'btn primary btn-new', href: '#/nieuw', 'aria-label': 'Nieuwe release' }, icon('plus', 'sm'), el('span', {}, 'Nieuwe release')) : null,
    el('div', { class: 'menu' }, menuBtn, menuPanel)));
}

async function logout() {
  await api('/logout', { method: 'POST' }).catch(() => {});
  session.user = null;
  stopPlayer();
  location.hash = '#/';
  route();
}

// ---------- routing ----------

function remountDepth() {
  depth?.destroy();
  depth = mountDepth(main, { tilt: 7, rest: 0, shift: 14, scrollShift: 48 });
}

async function route() {
  const id = ++renderId;
  depth?.destroy();
  depth = null;
  if (!session.user) {
    clear(shell);
    main.replaceChildren(authView(session.needsSetup, (user) => {
      session.user = user;
      session.needsSetup = false;
      route();
    }));
    main.querySelector('input')?.focus();
    return;
  }
  const { path, query } = parseHash();
  const found = ROUTES.find(([re]) => re.test(path));
  const active = found ? found[2] : '';
  shell.replaceChildren(header(active));
  main.replaceChildren(loading());
  let view;
  try {
    view = found ? await found[1](path.match(found[0]), query) : errorPage({ status: 404 });
  } catch (e) {
    if (e.status === 401) return;
    view = errorPage(e);
  }
  if (id !== renderId) return;
  main.replaceChildren(view);
  document.title = `${main.querySelector('h1')?.textContent || 'Releases'} — Distant Youth Studio`;
  window.scrollTo(0, 0);
  remountDepth();
}

window.addEventListener('hashchange', route);
window.addEventListener('dyc:reload', route);
window.addEventListener('dyc:content', () => depth && remountDepth());
window.addEventListener('dyc:signed-out', () => {
  if (!session.user) return;
  session.user = null;
  toast('Je bent uitgelogd. Log opnieuw in.', 'error');
  stopPlayer();
  route();
});
player.onChange(() => {
  for (const card of main.querySelectorAll('.card, .track')) card.classList.remove('playing');
});

(async function start() {
  try {
    const s = await api('/session');
    session.user = s.user;
    session.needsSetup = s.needsSetup;
  } catch {
    main.replaceChildren(errorPage({ message: 'Kan de server niet bereiken.' }));
    return;
  }
  route();
})();
