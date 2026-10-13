// どこにつなぐか・広告の設定
//   本番: 画面は GitHub Pages（https://9qu1.com/kunitori/）、通信は Cloudflare（https://kunitori.nakamido.workers.dev）
//   手元: 画面も通信も wrangler dev（同じ場所）

const PROD_PAGE_HOSTS = ['9qu1.com', '9qu1.github.io'];
const IS_PROD_PAGE = PROD_PAGE_HOSTS.includes(location.hostname);
export const API_ORIGIN = IS_PROD_PAGE ? 'https://kunitori.nakamido.workers.dev' : '';
export const WS_URL = IS_PROD_PAGE
  ? 'wss://kunitori.nakamido.workers.dev/ws'
  : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
// このページの住所（招待リンクなどに使う。/kunitori/ の下でも、手元の / でも）
export const PAGE_URL = location.origin + location.pathname.replace(/[^/]*$/, '');

// 広告（2026-10-13 ユーザー: 忍者AdMax を9割・自分のサイトの紹介を1割）
//   ページを開くたびに、下の枠にどちらを出すか決める（開いているあいだは変えない）
//   手元（localhost）では AdMax を読まない（審査や数字に手元の表示を混ぜない）。?ads=admax / ?ads=pr で試せる
const q = new URLSearchParams(location.search);
export const ADS = {
  admaxShare: 0.9,
  admax: {
    sp: '73ec52f7699807c7ddef28c425f1002d', // クニトリ スマホ300x250（オーバーレイOFF・アダルト非表示・ゲーム）
    pc: '4ca6b12c4a7155e449017670d9ab948b', // クニトリ PC300x250
  },
  force: q.get('ads') === 'admax' || q.get('ads') === 'pr' ? q.get('ads') : null,
  enabled: IS_PROD_PAGE || q.get('ads') === 'admax',
};
