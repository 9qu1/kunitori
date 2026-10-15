// 通信: 地図の変化は WebSocket で受け取り、操作は HTTP で送る（返事で届いたか分かる）
//   切れにくくする仕組み（100ピタの一式を WebSocket 向けにしたもの）
//   ・切れたら 0.5〜2秒でつなぎ直し、hello で「最後に受け取った番号」を伝えて抜けたぶんだけもらう
//   ・番号が飛んだら（抜けがあったら）すぐ hello で取りなおす
//   ・画面に戻った / focus / online で hello。5秒なにも届かなければ張りなおす（凍った接続）
//   ・12秒ごとに ping。30秒なにも届かなければ張りなおす
//   ・切断が1.5秒続いたら帯を出す（すぐ戻る切断ではちらつかせない）
import { VERSION } from './shared/rules.js?v=0.3.3';
import { API_ORIGIN, WS_URL } from './config.js?v=0.3.3';

export class Net {
  constructor(h) {
    this.h = h;
    this.seq = 0;
    this.terSeed = null;
    this.tok = null;
    this.ws = null;
    this.lastRx = 0;
    this.retry = 0;
    this.downSince = 0;
    this.resyncing = false;
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.wake(); });
    window.addEventListener('focus', () => this.wake());
    window.addEventListener('online', () => this.wake());
    setInterval(() => this.heartbeat(), 12000);
  }

  connect() {
    clearTimeout(this.rt);
    if (this.ws && this.ws.readyState <= 1) return;
    let ws;
    try {
      ws = new WebSocket(WS_URL);
    } catch {
      this.lost(null);
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.retry = 0;
      this.lastRx = Date.now();
      this.hello();
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      this.lastRx = Date.now();
      this.onMessage(e.data);
    };
    ws.onclose = ws.onerror = () => this.lost(ws);
  }

  lost(ws) {
    if (ws && this.ws !== ws) return;
    this.ws = null;
    this.down();
    clearTimeout(this.rt);
    // 画面が うしろの あいだは つなぎなおさない（まえに もどった ときの wake で つなぐ）
    if (document.hidden) return;
    // 待ち時間は 0.5秒から 倍に して 最大 60秒（みんなが いっせいに つなぎなおさない ように ±20% ずらす）
    //   2026-10-14: もとは 最大 2秒・回数の 上限 なしで、サーバーが ことわり つづけると タブ 1枚で 月 130万回 つなぎに きていた
    const wait = Math.min(60000, 500 * 2 ** Math.min(this.retry++, 7)) * (0.8 + Math.random() * 0.4);
    this.rt = setTimeout(() => this.connect(), wait);
  }

  // 凍った接続を捨てて張りなおす
  reopen() {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = ws.onerror = ws.onmessage = null;
      try { ws.close(); } catch {}
    }
    this.down();
    this.connect();
  }

  down() {
    if (this.downSince) return;
    this.downSince = Date.now();
    clearTimeout(this.bandT);
    this.bandT = setTimeout(() => this.h.onStatus('down'), 1500);
  }

  up() {
    if (!this.downSince) return;
    clearTimeout(this.bandT);
    const shown = Date.now() - this.downSince >= 1500;
    this.downSince = 0;
    this.h.onStatus(shown ? 'back' : 'up');
  }

  get connected() {
    return this.ws?.readyState === 1;
  }

  send(o) {
    if (this.ws?.readyState !== 1) return false;
    try { this.ws.send(JSON.stringify(o)); return true; } catch { return false; }
  }

  hello() {
    this.resyncing = true;
    this.send({ t: 'hello', v: VERSION, tok: this.tok || undefined, seq: this.seq, ter: this.terSeed });
  }

  // 画面に戻ったとき
  wake() {
    if (!this.ws || this.ws.readyState > 1) { this.connect(); return; }
    if (this.ws.readyState !== 1) return;
    const t0 = Date.now();
    this.hello();
    clearTimeout(this.wd);
    this.wd = setTimeout(() => { if (this.lastRx < t0) this.reopen(); }, 5000);
  }

  heartbeat() {
    if (document.hidden) return;
    if (!this.ws || this.ws.readyState > 1) { this.connect(); return; }
    if (this.ws.readyState !== 1) return;
    if (Date.now() - this.lastRx > 30000) { this.reopen(); return; }
    this.send({ t: 'ping' });
  }

  onMessage(data) {
    let m;
    try { m = JSON.parse(data); } catch { return; }
    switch (m.t) {
      case 'pong':
        return;
      case 'reload':
        this.h.onReload(m.v);
        return;
      case 'snap':
        this.seq = m.seq;
        if (m.ter) this.terSeed = m.seed;
        this.resyncing = false;
        this.up();
        this.h.onSnap(m);
        return;
      case 'ok':
        this.resyncing = false;
        this.up();
        this.h.onOk(m);
        return;
      case 'd':
        if (m.seq <= this.seq) return;
        if (m.seq !== this.seq + 1) {
          if (!this.resyncing) this.hello(); // 抜けがある → 取りなおす
          return;
        }
        this.seq = m.seq;
        this.h.onDiff(m);
        return;
      case 'me':
        this.h.onMe(m.me);
        return;
      case 'chat':
        this.h.onChat(m);
        return;
      default:
    }
  }
}

// 操作を送る（8秒で返事がなければ失敗として、押しなおせるようにする）
export async function api(path, body, tok) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(API_ORIGIN + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
      body: JSON.stringify(body || {}),
      signal: ctl.signal,
    });
    let j = {};
    try { j = await res.json(); } catch {}
    if (!res.ok) return { error: j.error || `うまくいきませんでした（${res.status}）`, code: j.code, confirm: j.confirm, status: res.status };
    return j;
  } catch {
    return { error: '📡 通信できませんでした。もう一度押してね', net: true };
  } finally {
    clearTimeout(timer);
  }
}
