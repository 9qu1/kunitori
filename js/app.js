// クニトリの画面
import { R, VERSION } from './shared/rules.js?v=0.3.1';
import { MapView } from './map.js?v=0.3.1';
import { Net, api } from './net.js?v=0.3.1';
import { prSmall, mountAdSlot, ALL_URL } from './promo.js?v=0.3.1';
import { PAGE_URL } from './config.js?v=0.3.1';

// ---------- 小さな道具 ----------

const $ = (s) => document.querySelector(s);
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'disabled' || k === 'checked' || k === 'hidden') e[k] = !!v;
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
  return e;
}
const LS = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const fmt = (n) => {
  n = Math.floor(n || 0);
  if (n >= 100000) return `${Math.round(n / 10000)}万`;
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return n.toLocaleString('ja-JP');
};
function fmtDur(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}分`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}時間${m % 60}分` : `${h}時間`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}日${h % 24}時間` : `${d}日`;
}
// null や false をのぞいて中身を入れかえる
const put = (box, ...kids) => box.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
const dot = (color) => el('span', { class: 'dot', style: `background:${color}` });
function unrle(r, T, n) {
  const out = new T(n);
  let p = 0;
  for (let k = 0; k < r.length; k += 2) {
    out.fill(r[k], p, p + r[k + 1]);
    p += r[k + 1];
  }
  return out;
}

// ---------- 状態 ----------

const S = {
  tok: LS.get('kt-token'),
  ready: false,
  centered: false,
  w: 0, h: 0, ter: null, owner: null, seed: 0,
  tick: 0, next: 0, skew: 0, tickMs: R.TICK_SEC * 1000,
  nations: new Map(),
  alliances: new Map(),
  stats: new Map(),
  forts: new Map(),
  me: null,
  meLoaded: false,
  chat: [],
  log: [],
  hist: [],
  sel: -1,
  tab: LS.get('kt-tab') || 'policy',
  mode: LS.get('kt-mode') === 'alliance' ? 'alliance' : 'nation',
  pendingTeam: (new URLSearchParams(location.search).get('team') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || null,
  pendingInv: (new URLSearchParams(location.search).get('inv') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || null,
  welcomed: false,
  dragging: false,
  unreadChat: 0,
  keys: {},
};
const ticksToMs = (t) => t * S.tickMs;
const serverNow = () => Date.now() + S.skew;
const nationOf = (id) => S.nations.get(id);
const statOf = (id) => S.stats.get(id) || { cells: 0, troops: 0, cities: 0 };
const isAlly = (n) => !!(S.me && n && (n.id === S.me.id || (S.me.al && n.al === S.me.al)));

// ---------- 地図と通信 ----------

const map = new MapView($('#map'), { onTap: tapCell });
map.mode = S.mode;

const net = new Net({ onSnap, onDiff, onOk, onMe, onChat, onStatus, onReload });
net.tok = S.tok;
net.connect();

function onSnap(m) {
  S.skew = m.now - Date.now();
  S.next = m.next;
  S.tickMs = m.tickMs || S.tickMs;
  S.tick = m.tick;
  if (m.ter) {
    S.w = m.w;
    S.h = m.h;
    S.seed = m.seed;
    S.ter = unrle(m.ter, Uint8Array, m.w * m.h);
    map.setTerrain(S.w, S.h, S.ter);
  }
  S.owner = unrle(m.own, Uint16Array, S.w * S.h);
  map.owner = S.owner;
  S.forts = new Map();
  for (let k = 0; k < m.forts.length; k += 2) S.forts.set(m.forts[k], m.forts[k + 1]);
  map.setForts(S.forts);
  setStats(m.ns);
  setMeta(m.nm, m.am); // ここで地図を塗りなおす
  S.ready = true;
  firstView();
  render();
}

function onDiff(m) {
  const ch = m.ch || [];
  const fortGone = [];
  for (let k = 0; k < ch.length; k += 2) {
    S.owner[ch[k]] = ch[k + 1];
    if (S.forts.delete(ch[k])) fortGone.push(ch[k]);
  }
  if (ch.length) map.changed(ch);
  const fa = m.fa || [];
  const fortNew = [];
  for (let k = 0; k < fa.length; k += 2) { S.forts.set(fa[k], fa[k + 1]); fortNew.push(fa[k]); }
  S.tick = m.tick;
  if (m.next) S.next = m.next;
  if (m.now) S.skew = m.now - Date.now();
  for (const [i, u] of S.forts) if (u <= S.tick) { S.forts.delete(i); fortGone.push(i); }
  if (fortNew.length || fortGone.length) map.fortsChanged([...fortNew, ...fortGone]);
  if (m.ns) setStats(m.ns);
  if (m.nm) setMeta(m.nm, m.am);
  render();
}

function onOk(m) {
  if (m.next) S.next = m.next;
  if (m.now) S.skew = m.now - Date.now();
  render();
}

function onMe(me) {
  S.meLoaded = true;
  if (!me) {
    if (S.tok && !S.me) showStart('前の国が見つかりませんでした（7日以上来ないあいだに滅びた可能性があります）。新しく建国できます。');
    S.me = null;
    map.setMe(0, 0);
    render();
    return;
  }
  if (me.log) S.log = me.log;
  if (me.hist) S.hist = me.hist;
  if (me.chat) S.chat = me.chat;
  const prevAl = S.me?.al;
  S.me = me;
  if (prevAl !== me.al) S.keys = {};
  map.setMe(me.id, me.al);
  map.setFocus(focusIdx(me.focus));
  $('#start').hidden = true;
  const fresh = unseenNews(me.news);
  if (!S.welcomed && me.log) {
    S.welcomed = true;
    if (!maybeWelcome(me, fresh) && fresh.length) toast(fresh[fresh.length - 1].text);
  } else if (fresh.length) {
    toast(fresh[fresh.length - 1].text);
  }
  markNews(me.news);
  saveLast();
  if (S.ready) firstView();
  if (S.pendingTeam && !me.al) askJoinTeam();
  render();
}

function onChat(m) {
  if (!S.me || S.me.al !== m.al) return;
  S.chat.push(m.e);
  if (S.chat.length > 40) S.chat.splice(0, S.chat.length - 40);
  if (m.e.i >= 0) map.ping(m.e.i);
  if (m.e.by !== S.me.id && m.e.s != null) {
    toast(`${nationOf(m.e.by)?.name || '仲間'}：${R.STAMPS[m.e.s]}`);
    if (S.tab !== 'team') S.unreadChat++;
  }
  S.keys.team = null;
  render();
}

let bandTimer = 0;
function onStatus(s) {
  const b = $('#netband');
  clearTimeout(bandTimer);
  if (s === 'down') {
    b.className = '';
    b.textContent = '📡 通信が切れました。つなぎ直し中…';
    b.hidden = false;
  } else if (s === 'back') {
    b.className = 'ok';
    b.textContent = 'つながりました！';
    b.hidden = false;
    bandTimer = setTimeout(() => { b.hidden = true; }, 1600);
  } else {
    b.hidden = true;
  }
}

function onReload() {
  // 新しい版が出た → 読みなおす（くり返さないように60秒あける）
  //   GitHub Pages は10分ほど前の版を返すことがあるので、住所に印を付けて新しい index.html を取りにいく
  let last = 0;
  try { last = Number(sessionStorage.getItem('kt-reload') || 0); } catch {}
  if (Date.now() - last < 60000) return;
  try { sessionStorage.setItem('kt-reload', String(Date.now())); } catch {}
  const q = new URLSearchParams(location.search);
  q.set('r', Date.now().toString(36));
  location.replace(`${location.pathname}?${q}`);
}

function setMeta(nm, am) {
  S.nations = new Map(nm.map((n) => [n.id, n]));
  S.alliances = new Map(am.map((a) => [a.id, a]));
  map.setNations(S.nations, S.alliances);
  if (S.me) map.setFocus(focusIdx(S.me.focus));
  // 国の一覧に関係する画面だけ作りなおす（同盟を作る・入る欄の書きかけは消さない）
  S.keys.rank = null;
  S.keys.policy = null;
  if (S.me?.al) S.keys.team = null;
}

function setStats(ns) {
  const m = new Map();
  for (let k = 0; k < ns.length; k += 4) m.set(ns[k], { cells: ns[k + 1], troops: ns[k + 2], cities: ns[k + 3] });
  S.stats = m;
}

function focusIdx(f) {
  if (!f) return -1;
  if (f.t === 'p') return f.i;
  if (f.t === 'n') return nationOf(f.id)?.cap ?? -1;
  return -1;
}

function firstView() {
  if (S.centered || !S.ready) return;
  updateInsets();
  if (S.me) {
    map.centerOn(S.me.capIdx, 10);
    S.centered = true;
  } else if (S.meLoaded || !S.tok) {
    map.fit();
    S.centered = true;
  }
}

// ---------- 描きなおし ----------

let renderQueued = false;
function render() {
  if (renderQueued) return;
  renderQueued = true;
  const go = () => {
    if (!renderQueued) return;
    renderQueued = false;
    renderHud();
    renderTab();
    renderCellCard();
    renderTabs();
  };
  requestAnimationFrame(go);
  setTimeout(go, 300); // requestAnimationFrame が止まっているときの保険
}

function renderHud() {
  const me = S.me;
  $('#hud-nation').hidden = !me;
  $('#hud-stats').hidden = !me;
  $('#hud-guest').hidden = !!me;
  if (!me) return;
  $('#hud-dot').style.background = me.color;
  $('#hud-name').textContent = me.name;
  const sh = $('#hud-shield');
  sh.hidden = !(me.shield > S.tick);
  if (!sh.hidden) sh.textContent = `保護中 あと${fmtDur(ticksToMs(me.shield - S.tick))}`;
  $('#hud-dormant').hidden = !me.dormant;
  $('#hud-troops').textContent = fmt(me.troops);
  $('#hud-cap').textContent = `/${fmt(me.cap)}`;
  $('#hud-cells').textContent = fmt(me.cells);
  $('#hud-cities').textContent = me.cities ? `町${me.cities}` : '';
  $('#hud-ap').textContent = me.ap;
  const bar = $('#hud-apbar');
  if (bar.children.length !== R.AP_MAX) bar.replaceChildren(...Array.from({ length: R.AP_MAX }, () => el('i')));
  [...bar.children].forEach((c, k) => c.classList.toggle('on', k < me.ap));
}

// タブ（案3: 絵つき）
const TABS = [
  ['policy', '方針', '<path d="M6 3h10l3 3v15H6z"/><path d="M9 9h7M9 13h7M9 17h4"/>'],
  ['act', '行動', '<path d="M4 20 15 9M15 9l2-5 3-1-1 3-5 2M20 20 9 9M9 9 7 4 4 3l1 3 5 2"/>'],
  ['team', '同盟', '<path d="M3 12l4-4 4 3 3-3 4 1 3 3-6 6-3-2-2 2z"/><path d="M11 11l3 3"/>'],
  ['rank', '順位', '<path d="M4 18h16L18 8l-4 4-2-6-2 6-4-4z"/>'],
  ['more', 'その他', '<circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/>'],
];
function buildTabs() {
  const nav = $('#tabs');
  for (const [key, label, svg] of TABS) {
    const b = el('button', { 'data-tab': key });
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${svg}</svg><span class="tl">${label}</span>`;
    b.addEventListener('click', () => openTab(key));
    nav.append(b);
  }
}
function openTab(key) {
  const panel = $('#panel');
  if (key === S.tab && innerWidth < 820) panel.classList.toggle('collapsed');
  else panel.classList.remove('collapsed');
  S.tab = key;
  LS.set('kt-tab', S.tab);
  if (S.tab === 'team') S.unreadChat = 0;
  S.keys[S.tab] = null;
  render();
  requestAnimationFrame(updateInsets);
}

function renderTabs() {
  for (const b of document.querySelectorAll('#tabs button')) {
    b.classList.toggle('on', b.dataset.tab === S.tab);
    const pill = b.querySelector('.pill');
    const n = b.dataset.tab === 'team' ? S.unreadChat : 0;
    if (n > 0 && !pill) b.append(el('span', { class: 'pill', text: n }));
    else if (n > 0) pill.textContent = n;
    else if (pill) pill.remove();
  }
  for (const t of document.querySelectorAll('.tab')) t.hidden = t.id !== `tab-${S.tab}`;
}

function renderTab() {
  ({ policy: renderPolicy, act: renderAct, team: renderTeam, rank: renderRank, more: renderMore })[S.tab]();
}

// 中身が変わったときだけ作りなおす（入力中の文字や選択を消さないため）
function once(name, key, build) {
  if (S.keys[name] === key) return false;
  S.keys[name] = key;
  build();
  return true;
}

function guestBlock(text) {
  return el('div', { class: 'sec' },
    el('p', { class: 'muted', text: text || '建国すると、ここで国の方針を決められます。' }),
    el('button', { class: 'btn gold', onclick: () => showStart() }, '建国する'));
}

// ---------- 方針 ----------

function renderPolicy() {
  const box = $('#tab-policy');
  const me = S.me;
  if (!me) { once('policy', 'guest', () => put(box, guestBlock())); return; }
  if (S.dragging) return;
  const f = me.focus;
  const fname = f?.t === 'n' ? nationOf(f.id)?.name : '';
  once('policy', JSON.stringify([me.aggr, f, fname, me.dormant]), () => {
    const val = el('span', { class: 'aggr-val' });
    const desc = el('p', { class: 'hint' });
    const saved = el('span', { class: 'saved' });
    const show = (v) => {
      val.textContent = v >= 70 ? `攻め ${v}%` : v <= 30 ? `守り ${100 - v}%` : `ふつう ${v}%`;
      desc.textContent = v === 0
        ? '広げずに兵をためます。兵が多いほど、攻められにくくなります。'
        : `5分ごとに、兵力の${Math.round(v * R.SPEND_MAX)}%まで使って自動で広げます。${v >= 70 ? '兵が減るぶん、攻められやすくなります。' : v <= 30 ? '兵がたまり、攻められにくくなります。' : ''}`;
    };
    const range = el('input', { type: 'range', min: 0, max: 100, step: 5, value: me.aggr });
    range.addEventListener('input', () => { S.dragging = true; show(Number(range.value)); });
    range.addEventListener('change', async () => {
      S.dragging = false;
      saved.textContent = '保存中…';
      const r = await api('/api/act', { type: 'policy', aggr: Number(range.value) }, S.tok);
      if (r.error) { saved.textContent = ''; toast(r.error, true); range.value = S.me.aggr; show(S.me.aggr); return; }
      mergeMe(r.me);
      saved.textContent = '保存しました';
      setTimeout(() => { saved.textContent = ''; }, 1500);
    });
    show(me.aggr);
    let ftxt;
    if (!f) ftxt = 'なし（取りやすいところから広げます）';
    else if (f.t === 'p') ftxt = `📍 (${f.i % S.w}, ${Math.floor(f.i / S.w)}) へ向かって広げます`;
    else ftxt = `🎯 ${fname || '？'} を優先して攻めます`;
    put(box, 
      el('div', { class: 'sec' },
        el('h3', {}, '攻めと守り', saved),
        el('div', { class: 'slider-wrap' }, el('span', { text: '守り' }), range, el('span', { text: '攻め' })),
        el('div', { style: 'margin-top:4px' }, val), desc),
      el('div', { class: 'sec' },
        el('h3', {}, '目標'),
        el('div', { class: 'focus-box' },
          el('div', { class: 'txt', text: ftxt }),
          f ? el('button', { class: 'btn small', onclick: (e) => setFocus(null, e.currentTarget) }, '外す') : null),
        el('p', { class: 'hint', text: '地図のマスをタップして「ここを目標にする」「この国を目標にする」を選ぶと、その方向へ自動で広がります。' })),
      me.dormant ? el('p', { class: 'hint', text: '7日以上来なかったので「眠りの国」になっています。何か操作すると目覚めます。' }) : null,
    );
  });
}

async function setFocus(focus, btn) {
  busy(btn, true);
  const r = await api('/api/act', { type: 'policy', focus }, S.tok);
  busy(btn, false);
  if (r.error) { toast(r.error, true); return; }
  mergeMe(r.me);
  toast(focus ? '目標を決めました。5分ごとに、そちらへ広がります' : '目標を外しました');
}

// ---------- 行動 ----------

function renderAct() {
  const box = $('#tab-act');
  const me = S.me;
  if (!me) { once('act', 'guest', () => put(box, guestBlock('建国すると、行動力を使って進軍や要塞づくりができます。'))); return; }
  const apNextMs = ticksToMs(Math.max(0, me.apNext - 1)) + Math.max(0, S.next - serverNow());
  once('act', JSON.stringify([me.ap, Math.round(apNextMs / 60000), me.troops >= me.cap]), () => {
    const cost = (k) => el('span', { class: 'cost', text: `⚡${R.COST[k]}` });
    const card = (key, title, k, text, btn) => el('div', { class: 'act' },
      el('div', { class: 'head' }, el('img', { src: `img/act/${key}.webp`, alt: '', width: 52, height: 52 }),
        el('div', {}, el('h4', { text: title }), cost(k))),
      el('p', { text }), btn);
    const pick = (what) => () => {
      if (innerWidth < 820) $('#panel').classList.add('collapsed');
      requestAnimationFrame(updateInsets);
      toast(what === 'march' ? `地図で、国の外（${R.MARCH_REACH}マス以内）をタップしてください` : '地図で、自分の国をタップしてください');
    };
    put(box,
      el('div', { class: 'sec' },
        el('div', { class: 'ap-big' }, el('b', { text: me.ap }), el('span', { class: 'muted', text: `/ ${R.AP_MAX}` })),
        el('p', { class: 'hint', text: me.ap >= R.AP_MAX ? '行動力が満タンです。使わないと、たまったぶんがむだになります。' : `次の1まで ${fmtDur(apNextMs)}（30分に1ずつ、最大${R.AP_MAX}までたまる）` })),
      el('div', { class: 'acts' },
        card('march', '進軍', 'march', `国の外（${R.MARCH_REACH}マス以内）へ一気に広げる。自動より4割安い`,
          el('button', { class: 'btn small', onclick: pick('march') }, '地図で選ぶ')),
        card('fort', '要塞', 'fort', `まわり半径${R.FORT_RADIUS}マスを24時間、${R.FORT_MUL}倍とられにくく。寝る前に`,
          el('button', { class: 'btn small', onclick: pick('fort') }, '地図で選ぶ')),
        card('draft', '徴兵', 'draft', me.troops >= me.cap ? '兵力は上限です' : `1時間ぶんの兵（約${fmt(Math.min(me.cap - me.troops, me.inc * R.DRAFT_TICKS))}）をすぐ集める`,
          el('button', { class: 'btn small gold', disabled: me.ap < R.COST.draft || me.troops >= me.cap, onclick: (e) => doAct({ type: 'draft' }, e.currentTarget) }, '徴兵する')),
        card('aid', '援軍', 'aid', '同盟の仲間に兵力の25%を送る',
          el('button', { class: 'btn small', onclick: () => openTab('team') }, '同盟タブへ'))),
      el('p', { class: 'hint', text: '放っておいても5分ごとに広がります。行動力を使うと、もっと速く・狙った場所へ広げられます。' }),
    );
  });
}

async function doAct(body, btn) {
  if (!S.tok) { showStart(); return; }
  busy(btn, true);
  const r = await api('/api/act', body, S.tok);
  busy(btn, false);
  if (r.error) {
    if (r.confirm === 'shield') {
      const ok = await confirmBox('プレイヤーの国を攻めると、あなたの保護期間（攻められない時間）が今すぐ終わります。それでも進軍しますか？', '進軍する');
      if (ok) return doAct({ ...body, force: true }, btn);
      return;
    }
    if (r.code === 'auth') { showStart('あなたの国が見つかりませんでした。'); return; }
    toast(r.error, true);
    return;
  }
  mergeMe(r.me);
  if (r.msg) toast(r.msg);
}

function mergeMe(me) {
  if (!me) return;
  S.me = { ...S.me, ...me };
  map.setFocus(focusIdx(S.me.focus));
  render();
}

function busy(btn, on) {
  if (!btn) return;
  btn.classList.toggle('busy', on);
  btn.disabled = on;
}

// ---------- マスをタップ ----------

function tapCell(i) {
  S.sel = i >= 0 && i !== S.sel ? i : -1;
  map.setSel(S.sel);
  S.keys.act = null;
  renderCellCard();
}

function nearOwn(c, reach) {
  if (!S.me) return false;
  const cx = c % S.w, cy = Math.floor(c / S.w);
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (dx * dx + dy * dy > reach * reach) continue;
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= S.w || y >= S.h) continue;
      if (S.owner[y * S.w + x] === S.me.id) return true;
    }
  }
  return false;
}

function renderCellCard() {
  const card = $('#cellcard');
  const i = S.sel;
  if (i < 0 || !S.ter) { card.hidden = true; S.keys.card = null; return; }
  const t = S.ter[i], o = S.owner[i];
  const x = i % S.w, y = Math.floor(i / S.w);
  const n = o ? nationOf(o) : null;
  const me = S.me;
  const icon = ['🌊', '🌾', '🌲', '⛰', '🏘'][t];
  const fortU = S.forts.get(i);
  // 中身が変わったときだけ作りなおす（押している最中のボタンを差しかえると、押したことが消えるため）
  const st0 = n ? (me && n.id === me.id ? me : statOf(n.id)) : null;
  const key = JSON.stringify([i, o, n?.name, n?.al, n?.shield > S.tick, n?.dormant, st0?.cells, st0?.troops,
    fortU > S.tick ? Math.ceil((fortU - S.tick) / 12) : 0, me?.id, me?.ap, me?.al, me && t ? nearOwn(i, R.MARCH_REACH) : 0]);
  if (S.keys.card === key && !card.hidden) return;
  S.keys.card = key;
  const head = el('div', { class: 'head' },
    el('b', { text: `${icon} ${R.TERRAIN_NAMES[t]}` }), el('span', { class: 'muted', text: `(${x}, ${y})` }),
    fortU > S.tick ? el('span', { class: 'badge shield', text: `🛡 要塞 あと${fmtDur(ticksToMs(fortU - S.tick))}` }) : null);
  let owner;
  if (!t) owner = el('div', { class: 'owner muted', text: '海には進めません。' });
  else if (!n) owner = el('div', { class: 'owner muted', text: t === 4 ? '持ち主のいない町（とると収入が増えます）' : '空き地' });
  else {
    const st = me && n.id === me.id ? me : statOf(n.id);
    const al = n.al ? S.alliances.get(n.al) : null;
    owner = el('div', { class: 'owner' },
      dot(n.color), el('b', { text: n.name }),
      me && n.id === me.id ? el('span', { class: 'badge cap', text: 'あなたの国' }) : null,
      me && n.id !== me.id && isAlly(n) ? el('span', { class: 'badge cap', text: '同盟の仲間' }) : null,
      el('span', { class: `badge ${n.cpu ? 'cpu' : 'player'}`, text: n.cpu ? '🤖 CPU' : '👤 プレイヤー' }),
      i === n.cap ? el('span', { class: 'badge cap', text: '👑 首都' }) : null,
      n.shield > S.tick ? el('span', { class: 'badge shield', text: '保護中' }) : null,
      n.dormant ? el('span', { class: 'badge sleep', text: '眠りの国' }) : null,
      el('span', { class: 'muted', text: `領地${fmt(st.cells)}・兵力${fmt(st.troops)}${al ? `・${al.name}` : ''}` }));
  }
  const btns = el('div', { class: 'btns' });
  if (!me) {
    if (t) btns.append(el('button', { class: 'btn gold', onclick: () => showStart() }, '建国して遊ぶ'));
  } else if (t) {
    if (o === me.id) {
      btns.append(el('button', { class: 'btn gold', disabled: me.ap < R.COST.fort, onclick: (e) => doAct({ type: 'fort', i }, e.currentTarget) },
        'ここを要塞に', el('span', { class: 'cost', text: `行動力${R.COST.fort}` })));
    } else if (!isAlly(n)) {
      const reach = nearOwn(i, R.MARCH_REACH);
      const blocked = n && (n.shield > S.tick);
      btns.append(el('button', {
        class: 'btn gold', disabled: me.ap < R.COST.march || !reach || blocked,
        onclick: (e) => doAct({ type: 'march', i }, e.currentTarget),
      }, 'ここへ進軍', el('span', { class: 'cost', text: `行動力${R.COST.march}` })));
      btns.append(el('button', { class: 'btn', onclick: (e) => setFocus({ t: 'p', i }, e.currentTarget) }, '📍 ここを目標に'));
      if (n) btns.append(el('button', { class: 'btn', onclick: (e) => setFocus({ t: 'n', id: n.id }, e.currentTarget) }, '🎯 この国を目標に'));
      if (!reach) btns.append(el('p', { class: 'hint', style: 'width:100%', text: `進軍できるのは、自分の領地から${R.MARCH_REACH}マス以内です。目標にしておけば自動でそちらへ広がります。` }));
      else if (blocked) btns.append(el('p', { class: 'hint', style: 'width:100%', text: 'この国は保護期間中なので、まだ攻められません。' }));
    }
  }
  put(card, el('button', { class: 'close', 'aria-label': '閉じる', onclick: () => tapCell(-1) }, '✕'), head, owner, btns.children.length ? btns : null);
  card.hidden = false;
}

// ---------- 同盟 ----------

// 友達を招待（特典つき）: 同盟タブのいちばん上（同盟の欄とは別に作りなおす）
function renderInvite(host) {
  const me = S.me;
  once('invite', JSON.stringify([me.inv, me.invN, me.invPlayed, me.al, me.alliance?.code]), () => {
    const withTeam = el('input', { type: 'checkbox', checked: !!me.al, disabled: !me.al });
    const link = () => `${PAGE_URL}?inv=${me.inv}${withTeam.checked && me.alliance?.code ? `&team=${me.alliance.code}` : ''}`;
    const left = Math.max(0, R.INVITE_MAX - (me.invN || 0));
    put(host, el('div', { class: 'invite' },
      el('img', { src: 'img/invite.webp', alt: '', width: 64, height: 64 }),
      el('div', {},
        el('h3', {}, '友達を招待'),
        el('ul', { class: 'rewards' },
          el('li', { text: `友達がリンクから建国 → あなたに行動力+${R.INVITE_AP}` }),
          el('li', { text: `友達が次の日も遊ぶ → あなたに兵力（3時間ぶん・最低${R.INVITE_PLAY_MIN}）` }),
          el('li', { text: `友達にも建国ボーナス 兵力+${R.INVITE_NEW_TROOPS}` }))),
      el('div', { class: 'actions' },
        el('button', { class: 'btn small gold', onclick: () => shareLink(link(), 'クニトリで一緒に陣取りしよう！このリンクから建国すると兵力のボーナスつき') }, '招待リンクを送る'),
        el('button', { class: 'btn small', onclick: () => copy(link(), '招待リンクをコピーしました') }, 'コピー'),
        me.al ? el('label', { class: 'hint', style: 'display:flex;gap:4px;align-items:center;margin:0' }, withTeam, '同盟にも誘う') : null),
      el('div', { class: 'count', text: `招待で建国 ${me.invN || 0}人・次の日も遊んだ ${me.invPlayed || 0}人（特典はあと${left}人まで）` })));
  });
}

function renderTeam() {
  const box = $('#tab-team');
  const me = S.me;
  if (!me) { once('team', 'guest', () => { S.keys.invite = null; put(box, guestBlock('建国すると、合言葉で同盟を組めます。')); }); return; }
  S.unreadChat = 0;
  if (!box.querySelector('#invite-host')) {
    put(box, el('div', { id: 'invite-host' }), el('div', { id: 'team-host' }));
    S.keys.invite = null;
    S.keys.team = null;
  }
  renderInvite($('#invite-host'));
  renderTeamBody($('#team-host'), me);
}

function renderTeamBody(box, me) {
  if (!me.al) {
    const wait = me.canJoinAt > S.tick ? ticksToMs(me.canJoinAt - S.tick) : 0;
    once('team', `none:${wait > 0}`, () => {
      const nameIn = el('input', { maxlength: 12, placeholder: '同盟の名前（12文字まで）' });
      const codeIn = el('input', { maxlength: 6, placeholder: '合言葉（6文字）', value: S.pendingTeam || '', style: 'text-transform:uppercase' });
      put(box, 
        el('div', { class: 'sec' },
          el('h3', {}, '同盟を作る'),
          el('div', { class: 'row', style: 'flex-wrap:nowrap' }, nameIn,
            el('button', { class: 'btn gold', disabled: wait > 0, onclick: (e) => team({ op: 'create', name: nameIn.value }, e.currentTarget) }, '作る'))),
        el('div', { class: 'sec' },
          el('h3', {}, '合言葉で入る'),
          el('div', { class: 'row', style: 'flex-wrap:nowrap' }, codeIn,
            el('button', { class: 'btn gold', disabled: wait > 0, onclick: (e) => team({ op: 'join', code: codeIn.value }, e.currentTarget) }, '入る'))),
        wait > 0 ? el('p', { class: 'hint', text: `同盟を抜けたばかりなので、あと${fmtDur(wait)}は入れません。` }) : null,
        el('p', { class: 'hint', text: `同盟は${R.ALLIANCE_MAX}か国まで。仲間どうしは攻め合わず、兵を送り合えます。合言葉を友達に送って誘いましょう。` }),
      );
    });
    return;
  }
  const al = S.alliances.get(me.al) || me.alliance;
  const members = (al?.members || []).map((id) => nationOf(id)).filter(Boolean);
  const stKey = members.map((n) => { const s = statOf(n.id); return `${n.id}:${s.cells}:${s.troops}`; }).join(',');
  once('team', JSON.stringify([me.al, al?.leader, stKey, S.chat.length, S.chat[S.chat.length - 1]?.tk, me.ap, S.sel >= 0]), () => {
    const leader = al?.leader === me.id;
    const code = me.alliance?.code || '';
    const link = `${PAGE_URL}?team=${code}`;
    const withPlace = el('input', { type: 'checkbox', checked: S.sel >= 0, disabled: S.sel < 0 });
    const chat = el('div', { class: 'chat' });
    for (const e of S.chat) {
      const who = nationOf(e.by);
      if (e.sys) chat.append(el('div', { class: 'line sys', text: e.sys }));
      else {
        chat.append(el('div', { class: 'line' },
          who ? dot(who.color) : null, ' ', el('span', { class: 'who', text: who?.name || '？' }), '：', R.STAMPS[e.s] || '',
          e.i >= 0 ? el('button', { class: 'btn small ghost', style: 'padding:0 6px', onclick: () => { map.centerOn(e.i, 12); tapCell(e.i); } }, '📍') : null,
          el('span', { class: 'when', text: `${fmtDur(ticksToMs(S.tick - e.tk))}前` })));
      }
    }
    put(box, 
      el('div', { class: 'sec' },
        el('h3', {}, `🤝 ${al?.name || ''}`),
        el('div', { class: 'row' }, el('span', { class: 'muted', text: '合言葉' }), el('span', { class: 'code', text: code }),
          el('button', { class: 'btn small', onclick: () => copy(code, '合言葉をコピーしました') }, 'コピー'),
          el('button', { class: 'btn small', onclick: () => shareInvite(link, al?.name) }, '招待リンクを送る'))),
      el('div', { class: 'sec' },
        el('h3', {}, `仲間（${members.length}/${R.ALLIANCE_MAX}）`),
        el('div', { class: 'members' }, members.map((n) => {
          const s = statOf(n.id);
          return el('div', { class: 'member' },
            dot(n.color), el('span', { class: 'nm', text: `${n.id === al?.leader ? '👑 ' : ''}${n.name}${n.id === me.id ? '（あなた）' : ''}` }),
            el('span', { class: 'num', text: `領地${fmt(s.cells)}・兵${fmt(s.troops)}` }),
            n.id !== me.id ? el('button', { class: 'btn small', disabled: me.ap < R.COST.aid, onclick: (e) => doAct({ type: 'aid', to: n.id }, e.currentTarget) }, '援軍') : null,
            leader && n.id !== me.id ? el('button', { class: 'btn small ghost', onclick: async (e) => { if (await confirmBox(`${n.name}を同盟から外しますか？`, '外す')) team({ op: 'kick', id: n.id }, e.currentTarget); } }, '外す') : null);
        })),
        el('p', { class: 'hint', text: `援軍は兵力の25%を仲間に送ります（行動力${R.COST.aid}）。` })),
      el('div', { class: 'sec' },
        el('h3', {}, 'スタンプ'),
        el('div', { class: 'stamps' }, R.STAMPS.map((s, k) => el('button', { class: 'btn', onclick: (e) => team({ op: 'stamp', s: k, i: withPlace.checked ? S.sel : -1 }, e.currentTarget) }, s))),
        el('label', { class: 'hint', style: 'display:flex;gap:6px;align-items:center' }, withPlace, S.sel >= 0 ? '📍 地図で選んでいる場所をつけて送る' : '📍 地図でマスを選ぶと、場所をつけて送れます'),
        chat),
      el('button', { class: 'btn danger small', onclick: async (e) => { if (await confirmBox('同盟を抜けますか？ 抜けてから6時間は、ほかの同盟に入れません。', '抜ける')) team({ op: 'leave' }, e.currentTarget); } }, '同盟を抜ける'),
    );
    chat.scrollTop = chat.scrollHeight;
  });
}

async function team(body, btn) {
  busy(btn, true);
  const r = await api('/api/team', body, S.tok);
  busy(btn, false);
  if (r.error) { toast(r.error, true); return false; }
  if (r.me) {
    if (r.me.chat) S.chat = r.me.chat;
    S.me = { ...S.me, ...r.me };
    map.setMe(S.me.id, S.me.al);
  }
  if (body.op === 'join' || body.op === 'create') { S.pendingTeam = null; history.replaceState(null, '', location.pathname); }
  S.keys.team = null;
  const msg = { create: '同盟を作りました！合言葉を友達に送りましょう', join: '同盟に入りました！', leave: '同盟を抜けました', kick: '同盟から外しました' }[body.op];
  if (msg) toast(msg);
  render();
  return true;
}

async function askJoinTeam() {
  const code = S.pendingTeam;
  if (!code || !S.me || S.me.al || askJoinTeam.busy) return;
  askJoinTeam.busy = true;
  const ok = await confirmBox(`合言葉「${code}」の同盟に招待されています。入りますか？`, '同盟に入る');
  askJoinTeam.busy = false;
  if (ok) await team({ op: 'join', code });
  else { S.pendingTeam = null; history.replaceState(null, '', location.pathname); }
}

async function shareInvite(link, name) {
  // 同盟の招待にも、自分の招待の合言葉をつける（建国したら特典）
  shareLink(S.me?.inv ? `${link}&inv=${S.me.inv}` : link, `クニトリで同盟「${name}」を組もう！`);
}

async function shareLink(link, text) {
  if (navigator.share) {
    try { await navigator.share({ title: 'クニトリ', text, url: link }); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  copy(`${text}\n${link}`, '招待リンクをコピーしました');
}

async function copy(text, done) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast('コピーできませんでした。長押しで選んでコピーしてください', true);
  }
}

// ---------- 順位 ----------

function renderRank() {
  const box = $('#tab-rank');
  const list = [...S.nations.values()].map((n) => ({ n, s: statOf(n.id) })).sort((a, b) => b.s.cells - a.s.cells || b.s.troops - a.s.troops);
  const meId = S.me?.id;
  once('rank', JSON.stringify([S.tick, meId, S.nations.size]), () => {
    const myRank = list.findIndex((x) => x.n.id === meId);
    const row = (x, k) => el('button', { class: `r${x.n.id === meId ? ' me' : ''}`, onclick: () => { map.centerOn(x.n.cap, 10); tapCell(x.n.cap); } },
      el('span', { class: 'no', text: k + 1 }), dot(x.n.color),
      el('span', { class: 'nm' }, x.n.name, el('span', { class: `badge ${x.n.cpu ? 'cpu' : 'player'}`, text: x.n.cpu ? '🤖 CPU' : '👤 プレイヤー' })),
      el('span', { class: 'num', text: `${fmt(x.s.cells)}マス${x.s.cities ? `・町${x.s.cities}` : ''}` }));
    const top = list.slice(0, 30).map(row);
    if (myRank >= 30) top.push(el('div', { class: 'muted', style: 'text-align:center', text: '…' }), row(list[myRank], myRank));
    const als = [...S.alliances.values()].map((a) => ({ a, cells: a.members.reduce((s, id) => s + statOf(id).cells, 0) }))
      .sort((p, q) => q.cells - p.cells).slice(0, 12);
    const players = list.filter((x) => !x.n.cpu).length;
    put(box, 
      el('div', { class: 'sec' },
        el('h3', {}, '国の順位（領地）'),
        el('p', { class: 'hint', text: `プレイヤー ${players}か国・コンピューター（CPU） ${list.length - players}か国` }),
        el('div', { class: 'rank' }, top)),
      el('div', { class: 'sec' },
        el('h3', {}, '同盟の順位'),
        el('div', { class: 'rank' }, als.map((x, k) => el('div', { class: `r${x.a.id === S.me?.al ? ' me' : ''}` },
          el('span', { class: 'no', text: k + 1 }), dot(x.a.color || '#888'),
          el('span', { class: 'nm' }, x.a.name, el('span', { class: `badge ${x.a.cpu ? 'cpu' : 'player'}`, text: x.a.cpu ? '🤖 CPU' : '👤 プレイヤー' })),
          el('span', { class: 'num', text: `${fmt(x.cells)}マス・${x.a.members.length}か国` }))))),
    );
  });
}

// ---------- その他 ----------

function renderMore() {
  const box = $('#tab-more');
  once('more', JSON.stringify([!!S.me, S.me?.name, S.mode]), () => {
    const me = S.me;
    const nameIn = el('input', { maxlength: 10, value: me?.name || '' });
    put(box, 
      el('div', { class: 'sec' },
        el('h3', {}, 'デモ版について'),
        el('p', { class: 'demo-box', text: 'いまはデモ版です。遊びのつりあいを見ながら、数字やルールを変えることがあります。世界（地図と国）は予告なく作り直すことがあります。' })),
      el('div', { class: 'sec' },
        el('h3', {}, '遊び方'),
        el('ol', { class: 'rules' },
          el('li', { text: '5分ごとに、あなたの国が自動で広がります。「方針」で攻めと守りの割合、向かう方向（目標）を決められます。' }),
          el('li', { text: '兵力は領地と町の数に応じて増えます。兵が多いほど、攻められにくくなります。' }),
          el('li', { text: `行動力は30分に1たまります（最大${R.AP_MAX}）。進軍・要塞・徴兵・援軍に使います。` }),
          el('li', { text: '首都とそのまわりは守りが固く、首都は取られません。1時間に取られるのは領地の2.5%までです。' }),
          el('li', { text: 'はじめの72時間は、ほかのプレイヤーから攻められません（自分からプレイヤーを攻めると終わります）。' }),
          el('li', { text: '大きい国ほど、広げるのに兵が多く要ります。7日来ないと「眠りの国」になり、首都も取られるようになります。' }))),
      el('div', { class: 'sec' },
        el('h3', {}, '色分け'),
        el('div', { class: 'row' },
          el('button', { class: `btn small${S.mode === 'nation' ? ' gold' : ''}`, onclick: () => setMode('nation') }, '国ごと'),
          el('button', { class: `btn small${S.mode === 'alliance' ? ' gold' : ''}`, onclick: () => setMode('alliance') }, '同盟ごと'))),
      me ? el('div', { class: 'sec' },
        el('h3', {}, '国の名前を変える'),
        el('div', { class: 'row', style: 'flex-wrap:nowrap' }, nameIn,
          el('button', { class: 'btn', onclick: async (e) => {
            busy(e.currentTarget, true);
            const r = await api('/api/rename', { name: nameIn.value }, S.tok);
            busy(e.currentTarget, false);
            if (r.error) toast(r.error, true);
            else { mergeMe(r.me); toast('名前を変えました'); }
          } }, '変える'))) : null,
      el('div', { class: 'sec' },
        el('h3', {}, '引き継ぎ'),
        me ? el('button', { class: 'btn small', onclick: showToken }, '引き継ぎコードを表示') : null,
        el('button', { class: 'btn small ghost', onclick: restore }, '引き継ぎコードで入る'),
        el('p', { class: 'hint', text: '引き継ぎコードがあれば、別のスマホやパソコンでも続きから遊べます。' })),
      el('p', { class: 'credit' }, el('a', { href: 'about.html' }, 'このゲームについて・プライバシーポリシー'), '　', el('span', { text: `v${VERSION}` })),
      el('p', { class: 'credit' }, 'つくった人：くぁくぁ（', el('a', { href: 'https://x.com/9qu1', target: '_blank', rel: 'noopener' }, 'X @9qu1'), '）'),
    );
  });
}

function setMode(mode) {
  S.mode = mode;
  LS.set('kt-mode', mode);
  map.setMode(mode);
  S.keys.more = null;
  toast(mode === 'alliance' ? '同盟ごとの色にしました' : '国ごとの色にしました');
  render();
}

function showToken() {
  modal((close) => [
    el('h2', {}, '引き継ぎコード'),
    el('p', { class: 'hint', text: 'このコードがあれば、別の端末でも続きから遊べます。人には教えないでください（国を操作できてしまいます）。' }),
    el('input', { value: S.tok, readonly: 'readonly', onfocus: (e) => e.target.select() }),
    el('div', { class: 'row', style: 'margin-top:12px' },
      el('button', { class: 'btn gold', onclick: () => copy(S.tok, 'コピーしました') }, 'コピー'),
      el('button', { class: 'btn', onclick: close }, '閉じる')),
  ]);
}

function restore() {
  modal((close) => {
    const inp = el('input', { placeholder: '引き継ぎコード', autocomplete: 'off' });
    return [
      el('h2', {}, '引き継ぎコードで入る'),
      el('p', { class: 'hint', text: S.me ? 'いまの国からは離れます（いまの国の引き継ぎコードを控えておいてください）。' : '前の端末で「その他」→「引き継ぎコードを表示」で出したコードを入れてください。' }),
      inp,
      el('div', { class: 'row', style: 'margin-top:12px' },
        el('button', { class: 'btn gold', onclick: async (e) => {
          const tok = inp.value.trim();
          busy(e.currentTarget, true);
          const r = await api('/api/me', {}, tok);
          busy(e.currentTarget, false);
          if (r.error) { toast(r.code === 'auth' ? 'そのコードの国は見つかりません' : r.error, true); return; }
          useToken(tok);
          close();
          S.centered = false;
          onMe(r.me);
          toast(`「${r.me.name}」に戻りました`);
        } }, '入る'),
        el('button', { class: 'btn', onclick: close }, 'やめる')),
    ];
  });
}

function useToken(tok) {
  S.tok = tok;
  LS.set('kt-token', tok);
  LS.del('kt-last');
  net.tok = tok;
  S.welcomed = true;
  net.hello();
}

// ---------- はじめての画面 ----------

let pickedColor = R.PALETTE[Math.floor(Math.random() * R.PALETTE.length)];
function showStart(msg) {
  const sw = $('#f-colors');
  if (!sw.children.length) {
    for (const c of R.PALETTE) {
      sw.append(el('button', { type: 'button', style: `background:${c}`, 'aria-label': c, 'data-c': c, onclick: () => { pickedColor = c; paintSwatches(); } }));
    }
  }
  paintSwatches();
  const inv = $('#f-invite');
  inv.hidden = !S.pendingInv;
  inv.textContent = `🎁 招待リンクから来ました。建国すると兵力+${R.INVITE_NEW_TROOPS}のボーナス！`;
  const card = $('#start .card');
  card.querySelector('.err-msg')?.remove();
  if (msg) card.prepend(el('p', { class: 'hint err-msg', style: 'color:var(--danger);text-align:center', text: msg }));
  $('#start').hidden = false;
}
function paintSwatches() {
  for (const b of document.querySelectorAll('#f-colors button')) b.classList.toggle('on', b.dataset.c === pickedColor);
}
$('#f-go').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  busy(btn, true);
  const r = await api('/api/join', { name: $('#f-name').value, color: pickedColor, inv: S.pendingInv || undefined });
  busy(btn, false);
  if (r.error) { toast(r.error, true); return; }
  useToken(r.token);
  S.centered = false;
  onMe(r.me);
  $('#start').hidden = true;
  S.pendingInv = null;
  LS.del('kt-inv');
  if (r.invite?.rewarded) toast(`${r.invite.host}の招待で建国しました！ 兵力+${R.INVITE_NEW_TROOPS}のボーナス`);
  else toast('建国しました！はじめの72時間は、ほかのプレイヤーから攻められません');
});
$('#f-look').addEventListener('click', () => { $('#start').hidden = true; LS.set('kt-looked', '1'); });
$('#f-restore').addEventListener('click', () => { $('#start').hidden = true; restore(); });
$('#btn-found').addEventListener('click', () => showStart());

// ---------- おかえり ----------

function saveLast() {
  if (!S.me) return;
  LS.set('kt-last', JSON.stringify({ tick: S.me.tick, cells: S.me.cells, at: Date.now() }));
}
document.addEventListener('visibilitychange', () => { if (document.hidden) saveLast(); });

function unseenNews(list) {
  let seen = [];
  try { seen = JSON.parse(LS.get('kt-news') || '[]'); } catch {}
  return (list || []).filter((e) => !seen.includes(`${e.tk}:${e.text}`));
}
function markNews(list) {
  if (!list?.length) return;
  LS.set('kt-news', JSON.stringify(list.map((e) => `${e.tk}:${e.text}`).slice(-30)));
}

function maybeWelcome(me, fresh = []) {
  let last = null;
  try { last = JSON.parse(LS.get('kt-last') || 'null'); } catch {}
  if (!last || !Number.isFinite(last.tick) || me.tick - last.tick < 6) return false;
  const lost = new Map();
  for (const e of me.log || []) if (e.tk > last.tick) lost.set(e.by, (lost.get(e.by) || 0) + e.n);
  const diff = me.cells - last.cells;
  const tops = [...lost].sort((a, b) => b[1] - a[1]).slice(0, 4);
  modal((close) => [
    el('h2', {}, 'おかえりなさい'),
    el('p', { class: 'muted', text: `前回から ${fmtDur(ticksToMs(me.tick - last.tick))}（${me.tick - last.tick}ターン）` }),
    el('div', { class: 'row', style: 'justify-content:flex-start;align-items:baseline' },
      el('span', { class: 'muted', text: '領地' }),
      el('span', { class: 'welcome-num', text: `${fmt(last.cells)} → ${fmt(me.cells)}` }),
      el('b', { class: diff >= 0 ? 'up' : 'down', text: diff >= 0 ? `+${fmt(diff)}` : `−${fmt(-diff)}` })),
    tops.length
      ? el('ul', { class: 'list' }, tops.map(([by, n]) => el('li', {}, el('b', { text: nationOf(by)?.name || '滅びた国' }), ` に ${n}マス取られました`)))
      : el('p', { class: 'hint', text: 'そのあいだ、どこからも攻められませんでした。' }),
    fresh.length ? el('div', { class: 'news' }, fresh.slice(-5).map((e) => el('div', { text: `🎁 ${e.text}` }))) : null,
    me.ap >= 8 ? el('p', { class: 'hint', text: `行動力が${me.ap}たまっています。進軍や要塞に使いましょう。` }) : null,
    prSmall('welcome'),
    el('div', { class: 'row', style: 'margin-top:12px' }, el('button', { class: 'btn gold', onclick: close }, '地図を見る')),
  ]);
  return true;
}

// ---------- 重ねる画面・知らせ ----------

let modalClose = null;
function modal(build) {
  const close = () => {
    $('#modal').hidden = true;
    const f = modalClose;
    modalClose = null;
    f?.();
  };
  put($('#modal-card'), ...build(close));
  $('#modal').hidden = false;
  return close;
}

function confirmBox(text, okLabel) {
  return new Promise((resolve) => {
    let done = false;
    const close = modal((c) => [
      el('p', { text }),
      el('div', { class: 'row', style: 'margin-top:12px' },
        el('button', { class: 'btn gold', onclick: () => { done = true; c(); resolve(true); } }, okLabel),
        el('button', { class: 'btn', onclick: () => { c(); } }, 'やめる')),
    ]);
    modalClose = () => { if (!done) resolve(false); };
    void close;
  });
}
$('#modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') {
    $('#modal').hidden = true;
    const f = modalClose;
    modalClose = null;
    f?.();
  }
});

let toastT = 0;
function toast(text, err) {
  const t = $('#toast');
  t.textContent = text;
  t.className = err ? 'err' : '';
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, err ? 4000 : 3000);
}

// ---------- 下の枠（忍者AdMax 9割・くぁくぁのほかのサイトの紹介 1割） ----------

// 広告はパネルのいちばん下に固定（追従）。スマホの画面は下の帯 320×50、PC の画面は右のパネルの下 300×250
const adLayout = () => (innerWidth < 820 ? 'bar' : 'side');
$('#promo').replaceChildren(
  el('a', { class: 'more-apps', href: `${ALL_URL}?utm_source=kunitori&utm_medium=pr&utm_content=more`, target: '_blank', rel: 'noopener', text: 'くぁくぁのほかの作品を見る ›' }));
S.adLayout = adLayout();
S.adKind = mountAdSlot($('#ad-slot'), S.adLayout);
// 画面を回すなどで並びが変わったら、その並びの枠に入れなおす
addEventListener('resize', () => {
  clearTimeout(S.adT);
  S.adT = setTimeout(() => {
    if (adLayout() === S.adLayout) return;
    S.adLayout = adLayout();
    S.adKind = mountAdSlot($('#ad-slot'), S.adLayout);
    updateInsets();
  }, 400);
});

// ---------- パネルと地図のボタン ----------

buildTabs();
$('#z-in').addEventListener('click', () => map.zoomBy(1.5));
$('#z-out').addEventListener('click', () => map.zoomBy(1 / 1.5));
$('#z-home').addEventListener('click', () => {
  if (S.me) map.centerOn(S.me.capIdx, Math.max(10, map.scale * 4));
  else map.fit();
});
$('#z-fit').addEventListener('click', () => map.fit());
$('#z-mode').addEventListener('click', () => setMode(S.mode === 'nation' ? 'alliance' : 'nation'));

function updateInsets() {
  const wide = innerWidth >= 820;
  const panel = $('#panel').getBoundingClientRect();
  const hud = $('#hud').getBoundingClientRect();
  const ph = wide ? 0 : Math.round(innerHeight - panel.top);
  document.documentElement.style.setProperty('--panel-h', `${ph}px`);
  // 重ねる画面（はじめの画面・おかえり など）が広告にかぶらないように（AdMax の規約 第10条12号②）
  const adH = wide ? 0 : Math.round(innerHeight - $('#panel-ad').getBoundingClientRect().top);
  document.documentElement.style.setProperty('--ad-h', `${Math.max(0, adH)}px`);
  document.documentElement.style.setProperty('--hud-h', `${Math.round(hud.bottom)}px`);
  map.setInsets({ top: Math.round(hud.bottom), bottom: ph, right: wide ? 380 : 0 });
}
new ResizeObserver(updateInsets).observe($('#panel'));
new ResizeObserver(updateInsets).observe($('#hud'));
addEventListener('resize', updateInsets);

// 次のターンまでの時計
setInterval(() => {
  if (!S.next) return;
  const ms = S.next - serverNow();
  $('#hud-next').textContent = ms <= 0 ? 'まもなく' : `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
  if (S.tab === 'act' && S.me) renderAct();
}, 1000);

// 外枠はスクロールさせない（入力欄にフォーカスしたときなどに、地図とボタンの位置がずれるため）
$('#app').addEventListener('scroll', (e) => { e.currentTarget.scrollTop = 0; e.currentTarget.scrollLeft = 0; });

// 調べもの用（コンソールから kt.S などで見られる）
window.kt = { S, map, net, render };

// 招待リンクの合言葉は、建国するまで覚えておく（いったん見学してから建国しても特典がつく）
if (S.pendingInv) LS.set('kt-inv', S.pendingInv);
else S.pendingInv = LS.get('kt-inv') || null;

// はじめて来た人には説明を出す
if (!S.tok && !LS.get('kt-looked')) showStart();
updateInsets();
render();
