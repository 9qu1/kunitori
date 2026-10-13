// 広告の枠: 忍者AdMax（9割）と、くぁくぁのほかのサイトの紹介（1割）
//   紹介の文はドコマデ列車の js/pr.js と同じ。絵は 9qu1.com のトップと同じ画面写真とアイコン（img/pr/）
import { ADS } from './config.js?v=0.3.1';

export const PR_SITES = [
  { id: 'rikaido', name: 'リカイド', catch: '友達の理解度チェック', desc: '2択のじぶんクイズを作って友達にシェア。「本人ならどっち？」を予想して、正解数でランキング。', url: 'https://rikaido.me/', cta: 'つくってみる' },
  { id: 'nakamido', name: 'ナカミド', catch: 'あなたの中身を、ちゃんと測る', desc: 'ひとりで答える診断、友達に答えてもらう診断、反応の速さのテスト。登録なしで無料。', url: 'https://nakamido.com/', cta: '診断してみる' },
  { id: 'tokumasu', name: 'トクマス', catch: '毎日3問のパズル', desc: 'ナンプレ・クロスワード・ノノグラムが毎日1問ずつ届く。解くとポイントが貯まる。', url: 'https://tokumasu.net/', cta: '遊んでみる' },
  { id: 'amayadori', name: 'アマヤドリ', catch: '雨音とポモドーロで集中', desc: '雨・焚き火・タイピングの音を流しながら、ポモドーロタイマーで集中できる夜の部屋。', url: 'https://9qu1.com/amayadori/', cta: '使ってみる' },
  { id: 'dokomade', name: 'ドコマデ列車', catch: '放置で走る魔法の列車のRPG', desc: '放置しても走りつづける魔法の列車のドットRPG。どこまで行けるかを全国ランキングで競う。', url: 'https://9qu1.com/dokomade/', cta: '遊んでみる' },
];
export const ALL_URL = 'https://9qu1.com/';

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c);
  return e;
};

// どこから来たかが分かるように、リンクに印を付ける（各サイトのアクセス解析で見える）
export function prHref(s, where) {
  const u = new URL(s.url);
  u.searchParams.set('utm_source', 'kunitori');
  u.searchParams.set('utm_medium', 'pr');
  if (where) u.searchParams.set('utm_content', where);
  return u.toString();
}

let order = shuffle(PR_SITES.map((_, i) => i));
let next = 0;
export function pickPr() {
  if (next >= order.length) { order = shuffle(order); next = 0; }
  return PR_SITES[order[next++]];
}

// 大きい紹介（広告の枠と同じ 300×250 の場所に入れる）
export function prBig(where = 'panel') {
  const s = pickPr();
  return el('a', { class: 'pr-big', href: prHref(s, where), target: '_blank', rel: 'noopener', 'aria-label': `${s.name}（${s.catch}）を開く` },
    el('span', { class: 'pr-shot', style: `background-image:url('img/pr/${s.id}.webp')` },
      el('span', { class: 'pr-tag', text: 'PR' })),
    el('span', { class: 'pr-body' },
      el('img', { class: 'pr-icon', src: `img/pr/${s.id}-icon.webp`, alt: '', width: 40, height: 40 }),
      el('span', { class: 'pr-text' }, el('b', { text: s.name }), el('small', { text: s.catch })),
      el('em', { class: 'pr-go', text: `${s.cta} ›` })),
    el('span', { class: 'pr-desc', text: s.desc }));
}

// 帯の紹介（スマホの画面の下の帯・320×50）
export function prBar(where = 'bar') {
  const s = pickPr();
  return el('a', { class: 'pr-bar', href: prHref(s, where), target: '_blank', rel: 'noopener', 'aria-label': `${s.name}（${s.catch}）を開く` },
    el('img', { src: `img/pr/${s.id}-icon.webp`, alt: '', width: 36, height: 36 }),
    el('span', { class: 'pr-text' }, el('b', { text: s.name }), el('small', { text: s.catch })),
    el('em', { class: 'pr-go', text: `${s.cta} ›` }),
    el('span', { class: 'pr-tag', text: 'PR' }));
}

// 小さい紹介（おかえりの画面など）
export function prSmall(where = 'welcome') {
  const s = pickPr();
  return el('a', { class: 'promo-card', href: prHref(s, where), target: '_blank', rel: 'noopener' },
    el('img', { src: `img/pr/${s.id}-icon.webp`, alt: '', width: 42, height: 42 }),
    el('div', { class: 't' }, el('span', { class: 'tag', text: 'PR' }), el('b', { text: s.name }), el('span', { text: s.catch })),
    el('span', { class: 'go', text: `${s.cta} ↗` }));
}

// スマホかどうか（AdMax のスマホ用の枠はスマホにしか出ないので、出し分ける）
export const isPhone = () => /iPhone|iPod|Android.+Mobile|Windows Phone|Mobile.+Firefox/i.test(navigator.userAgent);

// パネルの下の枠（追従）に入れるものを決めて入れる。戻り値は 'admax' か 'pr'
//   AdMax か紹介かは、ページを開いたときに1回だけ決める（並びが変わって入れなおすときも同じほう）
//   layout: 'bar'（スマホの画面・320×50）か 'side'（PC の画面・300×250）
const useAdmax = ADS.force ? ADS.force === 'admax' : ADS.enabled && Math.random() < ADS.admaxShare;
export function mountAdSlot(box, layout) {
  box.replaceChildren();
  box.dataset.layout = layout;
  // スマホ用の帯の枠はスマホにしか出ない → スマホでなければ紹介にする
  if (!useAdmax || (layout === 'bar' && !isPhone())) {
    box.append(layout === 'bar' ? prBar('bar') : prBig('panel'));
    box.dataset.kind = 'pr';
    return 'pr';
  }
  const id = layout === 'bar' ? ADS.admax.bar : isPhone() ? ADS.admax.sp : ADS.admax.pc;
  const [w, h] = layout === 'bar' ? [320, 50] : [300, 250];
  box.dataset.kind = 'admax';
  box.append(el('div', { class: 'admax-ads', 'data-admax-id': id, style: `display:inline-block;width:${w}px;height:${h}px;` }));
  // 忍者AdMax の非同期タグ（管理画面の「非同期タグ」と同じ中身。script は DOM に足したものしか動かないので作って足す）
  (window.admaxads = window.admaxads || []).push({ admax_id: id, type: 'banner' });
  document.querySelector('script[data-admax]')?.remove();
  const sc = document.createElement('script');
  sc.src = 'https://adm.shinobi.jp/st/t.js';
  sc.async = true;
  sc.charset = 'utf-8';
  sc.dataset.admax = '1';
  document.body.append(sc);
  return 'admax';
}

function shuffle(a) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}
