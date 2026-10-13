// 地図の描画と操作（ドラッグ・ピンチ・ホイール・タップ）
//   見た目は案3（design/style/style.json）: 地形の色に国の色を薄く重ね、国境は細い線、拡大すると木・山・町・城の絵を置く
//   下絵（1マス＝4ピクセル）= 地形＋国の色。国境・海岸の線は Path2D（変わったときだけ作りなおす）、絵と名前は毎回描く
const S = 4;
const C = {
  seaDeep: [18, 96, 120], seaMid: [36, 126, 145], seaShallow: [99, 167, 174], foam: [212, 229, 215],
  plain: [201, 205, 136], forest: [73, 121, 82], mountain: [144, 147, 139], snow: [232, 236, 226], town: [195, 168, 117],
};
const TER = [null, C.plain, C.forest, C.mountain, C.town];
const TINT = [0, 0.5, 0.4, 0.34, 0.44]; // 国の色の重ね具合（地形が見えるように）
const SPR = {
  castle: 'img/map/castle.webp', keep: 'img/map/keep.webp', tree: 'img/map/tree.webp',
  mountain: 'img/map/mountain.webp', town: 'img/map/town.webp',
};

export const hexRgb = (s) => [1, 3, 5].map((k) => parseInt(s.slice(k, k + 2), 16));
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
function hash(x, y, s = 0) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 1103515245);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// なめらかなむら（6マスくらいの大きさ）
function mottle(x, y) {
  const fx = x / 6, fy = y / 6, xi = Math.floor(fx), yi = Math.floor(fy), u = fx - xi, v = fy - yi;
  const a = hash(xi, yi, 9), b = hash(xi + 1, yi, 9), c = hash(xi, yi + 1, 9), d = hash(xi + 1, yi + 1, 9);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

export class MapView {
  constructor(canvas, opts = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.onTap = opts.onTap || (() => {});
    this.onMove = opts.onMove || (() => {});
    this.scale = 1;
    this.ox = 0;
    this.oy = 0;
    this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    this.me = 0;
    this.myAl = 0;
    this.sel = -1;
    this.focus = -1;
    this.mode = 'nation';
    this.colors = new Map();
    this.alColors = new Map();
    this.nations = new Map();
    this.forts = new Map();
    this.pings = [];
    this.dirty = new Set();
    this.labelsAt = 0;
    this.labels = [];
    this.pathsDirty = true;
    this.pathsAt = 0;
    this.raf = 0;
    this.ready = false;
    this.img = null;
    this.sprites = {};
    for (const [k, src] of Object.entries(SPR)) {
      const im = new Image();
      im.onload = () => this.request();
      im.src = src;
      this.sprites[k] = im;
    }
    if (document.fonts?.ready) document.fonts.ready.then(() => { this.labelsAt = 0; this.request(); });
    this.bindInput();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  // ---------- データ ----------

  setTerrain(w, h, ter) {
    this.w = w;
    this.h = h;
    this.ter = ter;
    this.owner = new Uint16Array(w * h);
    this.base = document.createElement('canvas');
    this.base.width = w * S;
    this.base.height = h * S;
    this.bctx = this.base.getContext('2d');
    this.img = this.bctx.createImageData(w * S, h * S);
    // 陸からの近さ（海の色を岸に近いほど浅くする）
    const N = w * h;
    const dist = new Uint8Array(N).fill(9);
    let front = [];
    for (let i = 0; i < N; i++) if (ter[i]) { dist[i] = 0; front.push(i); }
    for (let d = 1; d <= 6 && front.length; d++) {
      const next = [];
      for (const i of front) {
        const x = i % w;
        for (const j of [i - w, i + w, x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1]) {
          if (j < 0 || j >= N || dist[j] <= d) continue;
          dist[j] = d;
          next.push(j);
        }
      }
      front = next;
    }
    this.seaDist = dist;
    // 飾りの絵の置き場所（2×2マスごとに、森か山が多ければ1つ・位置は少しずらす）
    const deco = [];
    for (let by = 0; by < h - 1; by += 2) {
      for (let bx = 0; bx < w - 1; bx += 2) {
        let f = 0, m = 0;
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const t = ter[(by + dy) * w + bx + dx];
          if (t === 2) f++;
          if (t === 3) m++;
        }
        const hz = hash(bx, by, 3);
        const kind = m >= 3 ? 'mountain' : f >= 2 ? 'tree' : null;
        if (!kind || hz > (kind === 'tree' ? 0.75 : 0.6)) continue;
        deco.push({ kind, x: bx + 1 + (hash(bx, by, 4) - 0.5) * 0.8, y: by + 1.4 + (hash(bx, by, 5) - 0.5) * 0.6, k: 0.85 + hash(bx, by, 6) * 0.3 });
      }
    }
    for (let i = 0; i < N; i++) if (ter[i] === 4) deco.push({ kind: 'town', x: (i % w) + 0.5, y: Math.floor(i / w) + 1, k: 1 });
    deco.sort((a, b) => a.y - b.y);
    this.deco = deco;
    this.sumX = new Float64Array(65536);
    this.sumY = new Float64Array(65536);
    this.cnt = new Int32Array(65536);
    if (!this.ready) { this.ready = true; this.fit(); }
  }

  setOwners(owner) {
    this.owner = owner;
    this.paintAll();
  }

  // ch = [位置, 持ち主, ...]（this.owner はもう書きかわっている）
  changed(ch) {
    for (let k = 0; k < ch.length; k += 2) this.dirty.add(ch[k]);
    this.labelsAt = 0;
    this.pathsDirty = true;
    this.request();
  }

  setNations(nations, alliances) {
    this.nations = nations;
    this.colors = new Map();
    for (const n of nations.values()) this.colors.set(n.id, hexRgb(n.color));
    this.alColors = new Map();
    for (const a of alliances.values()) this.alColors.set(a.id, hexRgb(a.color || '#888888'));
    this.paintAll();
  }

  setForts(forts) {
    this.forts = forts;
  }

  fortsChanged(list) {
    for (const i of list) this.dirty.add(i);
    this.request();
  }

  setMe(id, al) {
    if (id === this.me && al === this.myAl) return;
    this.me = id;
    this.myAl = al;
    this.pathsDirty = true;
    this.request();
  }

  setMode(mode) {
    this.mode = mode;
    this.paintAll();
  }

  setSel(i) { this.sel = i; this.request(); }
  setFocus(i) { this.focus = i; this.request(); }

  ping(i) {
    this.pings.push({ i, at: performance.now() });
    this.request();
  }

  // ---------- 下絵（地形＋国の色） ----------

  colorOf(o) {
    if (this.mode === 'alliance') {
      const n = this.nations.get(o);
      if (n?.al && this.alColors.has(n.al)) return this.alColors.get(n.al);
    }
    return this.colors.get(o) || [200, 0, 200];
  }

  sameSide(a, b) {
    if (a === b) return true;
    if (this.mode !== 'alliance' || !a || !b) return false;
    const na = this.nations.get(a), nb = this.nations.get(b);
    return !!(na?.al && na.al === nb?.al);
  }

  paintAll() {
    if (!this.img) return;
    for (let i = 0; i < this.owner.length; i++) this.paintCell(i);
    this.bctx.putImageData(this.img, 0, 0);
    this.dirty.clear();
    this.labelsAt = 0;
    this.pathsDirty = true;
    this.request();
  }

  paintCell(i) {
    const { w, owner, ter } = this;
    if (i < 0 || i >= owner.length) return;
    const data = this.img.data;
    const x = i % w, y = (i / w) | 0;
    const t = ter[i], o = owner[i];
    const W4 = w * S;
    const put = (px, py, c) => {
      const p = ((y * S + py) * W4 + x * S + px) * 4;
      data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = 255;
    };
    const mt = mottle(x, y);
    if (!t) {
      const d = this.seaDist[i];
      let c = d <= 1 ? C.seaShallow : d <= 3 ? mix(C.seaShallow, C.seaMid, (d - 1) / 2) : mix(C.seaMid, C.seaDeep, Math.min(1, (d - 3) / 3));
      c = shade(c, 1 + mt * 0.03);
      const foam = d === 1 && hash(x, y, 7) < 0.25;
      for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
        put(px, py, foam && py === 1 && px > 0 ? mix(c, C.foam, 0.6) : c);
      }
      return;
    }
    let base = shade(TER[t], 1 + mt * 0.045);
    if (o) base = mix(base, this.colorOf(o), TINT[t]);
    const fort = this.forts.has(i);
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        let c = base;
        // 地形の小さな模様（拡大すると絵が上に乗るので、控えめに）
        if (t === 2 && (px + py * 3 + x + y) % 5 === 0) c = shade(c, 0.88);
        else if (t === 3 && py === 0 && px === 1) c = mix(c, C.snow, 0.5);
        else if (t === 4 && px >= 1 && px <= 2 && py >= 1 && py <= 2) c = py === 1 ? [168, 82, 60] : [96, 78, 60];
        if (fort && (px + py) % 3 === 0) c = mix(c, [40, 34, 26], 0.3);
        put(px, py, c);
      }
    }
  }

  flushDirty() {
    if (!this.dirty.size || !this.img) return;
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (const i of this.dirty) {
      if (i < 0 || i >= this.owner.length) continue;
      this.paintCell(i);
      const x = i % this.w, y = (i / this.w) | 0;
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
    }
    this.dirty.clear();
    if (x1 >= 0) this.bctx.putImageData(this.img, 0, 0, x0 * S, y0 * S, (x1 - x0 + 1) * S, (y1 - y0 + 1) * S);
  }

  // ---------- 線（国境・海岸・自分の国のふち） ----------

  buildPaths() {
    const { w, h, owner, ter, me } = this;
    const nation = new Path2D(), soft = new Path2D(), coast = new Path2D(), mine = new Path2D();
    const N = w * h;
    // a と b のあいだの辺が、どの線になるか
    const kinds = (a, b) => {
      const ta = a >= 0 && a < N ? ter[a] : 0, tb = b >= 0 && b < N ? ter[b] : 0;
      const oa = ta ? owner[a] : 0, ob = tb ? owner[b] : 0;
      let k = 0;
      if (!!ta !== !!tb) k |= 1; // 海岸
      else if (ta && oa !== ob) k |= this.sameSide(oa, ob) ? 4 : 2; // 国境（同盟どうしは薄く）
      if (me && (oa === me) !== (ob === me)) k |= 8; // 自分の国のふち
      return k;
    };
    const paths = [[1, coast], [2, nation], [4, soft], [8, mine]];
    // たての辺（x と x+1 のあいだ）: 同じ種類が続くあいだは1本にまとめる
    for (let x = 0; x < w - 1; x++) {
      const run = [-1, -1, -1, -1];
      for (let y = 0; y <= h; y++) {
        const k = y < h ? kinds(y * w + x, y * w + x + 1) : 0;
        paths.forEach(([bit, p], j) => {
          if (k & bit) { if (run[j] < 0) run[j] = y; }
          else if (run[j] >= 0) { p.moveTo(x + 1, run[j]); p.lineTo(x + 1, y); run[j] = -1; }
        });
      }
    }
    // よこの辺（y と y+1 のあいだ）
    for (let y = 0; y < h - 1; y++) {
      const run = [-1, -1, -1, -1];
      for (let x = 0; x <= w; x++) {
        const k = x < w ? kinds(y * w + x, (y + 1) * w + x) : 0;
        paths.forEach(([bit, p], j) => {
          if (k & bit) { if (run[j] < 0) run[j] = x; }
          else if (run[j] >= 0) { p.moveTo(run[j], y + 1); p.lineTo(x, y + 1); run[j] = -1; }
        });
      }
    }
    this.paths = { nation, soft, coast, mine };
    this.pathsDirty = false;
    this.pathsAt = performance.now();
  }

  // ---------- 表示の位置 ----------

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.cv.getBoundingClientRect();
    this.cw = r.width;
    this.ch = r.height;
    this.cv.width = Math.round(r.width * dpr);
    this.cv.height = Math.round(r.height * dpr);
    this.dpr = dpr;
    // 見えない状態（大きさ0）で開かれたときは、見えたときに合わせなおす
    if (this.cw && this.ch && this.pending) {
      const f = this.pending;
      this.pending = null;
      requestAnimationFrame(f);
    }
    this.clamp();
    this.request();
  }

  setInsets(ins) {
    this.insets = { ...this.insets, ...ins };
  }

  viewRect() {
    const { top, right, bottom, left } = this.insets;
    return { x: left, y: top, w: Math.max(50, this.cw - left - right), h: Math.max(50, this.ch - top - bottom) };
  }

  minScale() {
    if (!this.w) return 0.1;
    const v = this.viewRect();
    return Math.min(v.w / (this.w * S), v.h / (this.h * S)) * 0.9;
  }

  fit() {
    if (!this.w) return;
    if (!this.cw || !this.ch) { this.pending = () => this.fit(); return; }
    const v = this.viewRect();
    this.scale = this.minScale() / 0.9;
    this.ox = v.x + (v.w - this.w * S * this.scale) / 2;
    this.oy = v.y + (v.h - this.h * S * this.scale) / 2;
    this.request();
  }

  // cellPx = 1マスを画面で何ピクセルにするか
  centerOn(i, cellPx) {
    if (!this.w) return;
    if (!this.cw || !this.ch) { this.pending = () => this.centerOn(i, cellPx); return; }
    const v = this.viewRect();
    if (cellPx) this.scale = Math.max(this.minScale(), Math.min(14, cellPx / S));
    const x = ((i % this.w) + 0.5) * S, y = (((i / this.w) | 0) + 0.5) * S;
    this.ox = v.x + v.w / 2 - x * this.scale;
    this.oy = v.y + v.h / 2 - y * this.scale;
    this.clamp();
    this.request();
  }

  zoomAt(f, sx, sy) {
    const ns = Math.max(this.minScale(), Math.min(14, this.scale * f));
    const k = ns / this.scale;
    this.ox = sx - (sx - this.ox) * k;
    this.oy = sy - (sy - this.oy) * k;
    this.scale = ns;
    this.clamp();
    this.request();
  }

  zoomBy(f) {
    const v = this.viewRect();
    this.zoomAt(f, v.x + v.w / 2, v.y + v.h / 2);
  }

  clamp() {
    if (!this.w) return;
    const mw = this.w * S * this.scale, mh = this.h * S * this.scale;
    const v = this.viewRect();
    const pad = 60;
    this.ox = Math.min(v.x + v.w - pad, Math.max(v.x + pad - mw, this.ox));
    this.oy = Math.min(v.y + v.h - pad, Math.max(v.y + pad - mh, this.oy));
  }

  cellAt(sx, sy) {
    const x = Math.floor((sx - this.ox) / this.scale / S);
    const y = Math.floor((sy - this.oy) / this.scale / S);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
    return y * this.w + x;
  }

  cellCenter(i) {
    return [this.ox + ((i % this.w) + 0.5) * S * this.scale, this.oy + (((i / this.w) | 0) + 0.5) * S * this.scale];
  }

  // ---------- 描く ----------

  request() {
    if (this.raf) return;
    const go = () => {
      if (!this.raf) return;
      cancelAnimationFrame(this.raf);
      clearTimeout(this.rafT);
      this.raf = 0;
      this.draw();
    };
    this.raf = requestAnimationFrame(go);
    // 画面が裏にあると requestAnimationFrame が止まることがあるので、保険で必ず描く
    this.rafT = setTimeout(go, 300);
  }

  computeLabels() {
    const { w, owner, sumX, sumY, cnt } = this;
    sumX.fill(0); sumY.fill(0); cnt.fill(0);
    for (let i = 0; i < owner.length; i++) {
      const o = owner[i];
      if (!o) continue;
      sumX[o] += i % w;
      sumY[o] += (i / w) | 0;
      cnt[o]++;
    }
    const out = [];
    let text = '';
    for (const n of this.nations.values()) {
      const c = cnt[n.id];
      if (!c) continue;
      out.push({ id: n.id, x: (n.cap % w) + 0.5, y: Math.floor(n.cap / w) + 1, c, name: n.name, cpu: n.cpu });
      text += n.name;
    }
    out.sort((a, b) => b.c - a.c);
    this.labels = out;
    this.labelsAt = performance.now();
    // 国名に使う文字の書体を読みこんでから描きなおす（読みこむ前の1回目だけ別の書体になるのを防ぐ）
    if (document.fonts?.load && text !== this.fontText) {
      this.fontText = text;
      document.fonts.load('700 16px "Noto Serif JP"', text).then(() => this.request()).catch(() => {});
    }
  }

  drawSprite(name, sx, sy, width, alpha) {
    const im = this.sprites[name];
    if (!im?.complete || !im.naturalWidth) return false;
    const h = (width * im.naturalHeight) / im.naturalWidth;
    const ctx = this.ctx;
    if (alpha < 1) ctx.globalAlpha = alpha;
    ctx.drawImage(im, sx - width / 2, sy - h, width, h);
    if (alpha < 1) ctx.globalAlpha = 1;
    return true;
  }

  draw() {
    const { ctx, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = `rgb(${C.seaDeep.join(',')})`;
    ctx.fillRect(0, 0, this.cw, this.ch);
    if (!this.img) return;
    this.flushDirty();
    const cell = S * this.scale;
    // 拡大すると、ますの角をぼかして絵の具のように
    ctx.imageSmoothingEnabled = cell >= 7;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.base, this.ox, this.oy, this.w * cell, this.h * cell);
    ctx.imageSmoothingEnabled = true;

    // 線（国境・海岸・自分の国のふち）: マスの単位で作った線を、画面の太さで描く
    if (this.pathsDirty && (performance.now() - this.pathsAt > 250 || !this.paths)) this.buildPaths();
    else if (this.pathsDirty) setTimeout(() => this.request(), 260);
    if (this.paths) {
      const k = cell;
      ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * this.ox, dpr * this.oy);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const lw = (px) => Math.min(px, cell * 0.45) / k;
      ctx.strokeStyle = 'rgba(233,217,167,0.9)';
      ctx.lineWidth = lw(1.3);
      ctx.stroke(this.paths.coast);
      ctx.strokeStyle = 'rgba(119,104,75,0.5)';
      ctx.lineWidth = lw(2.6);
      ctx.stroke(this.paths.nation);
      ctx.strokeStyle = '#FFF2CE';
      ctx.lineWidth = lw(1.3);
      ctx.stroke(this.paths.nation);
      ctx.strokeStyle = 'rgba(255,242,206,0.55)';
      ctx.lineWidth = lw(1);
      ctx.stroke(this.paths.soft);
      if (this.me) {
        ctx.strokeStyle = 'rgba(16,170,153,0.35)';
        ctx.lineWidth = lw(6);
        ctx.stroke(this.paths.mine);
        ctx.strokeStyle = '#A6FFF0';
        ctx.lineWidth = lw(2.4);
        ctx.stroke(this.paths.mine);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // 見えている範囲（マス）
    const vx0 = -this.ox / cell - 3, vy0 = -this.oy / cell - 3;
    const vx1 = (this.cw - this.ox) / cell + 3, vy1 = (this.ch - this.oy) / cell + 6;
    const inView = (x, y) => x > vx0 && x < vx1 && y > vy0 && y < vy1;
    const sx = (x) => this.ox + x * cell, sy = (y) => this.oy + y * cell;

    // 木・山・町（4〜8ピクセルで少しずつ出す）
    const fade = Math.min(1, Math.max(0, (cell - 4) / 4));
    const townA = Math.min(1, Math.max(0, (cell - 5) / 3));
    if (fade > 0 || townA > 0) {
      for (const d of this.deco) {
        if (!inView(d.x, d.y)) continue;
        if (d.kind === 'town') { if (townA > 0) this.drawSprite('town', sx(d.x), sy(d.y), cell * 2.2, townA); continue; }
        if (fade <= 0) continue;
        if (d.kind === 'tree') this.drawSprite('tree', sx(d.x), sy(d.y), cell * 1.9 * d.k, fade * 0.95);
        else this.drawSprite('mountain', sx(d.x), sy(d.y), cell * 3.6 * d.k, fade);
      }
    }

    // 首都: プレイヤーは城、コンピューターは石の砦（小さいときは印だけ）
    const caps = [...this.nations.values()].sort((a, b) => Math.floor(a.cap / this.w) - Math.floor(b.cap / this.w));
    for (const n of caps) {
      const x = (n.cap % this.w) + 0.5, y = Math.floor(n.cap / this.w) + 1;
      if (!inView(x, y)) continue;
      const mine = n.id === this.me;
      if (cell >= 3 || mine) {
        const width = n.cpu ? Math.max(16, cell * 3.2) : Math.max(mine ? 26 : 20, cell * 4);
        if (this.drawSprite(n.cpu ? 'keep' : 'castle', sx(x), sy(y) + cell * 0.3, Math.min(width, 120), 1)) continue;
      }
      // 印: プレイヤーは金の王冠、コンピューターは灰色の四角
      const px = sx(x), py = sy(y - 0.5);
      if (n.cpu) {
        ctx.fillStyle = '#666B68';
        ctx.strokeStyle = '#FFF8E8';
        ctx.lineWidth = 1;
        ctx.fillRect(px - 2.5, py - 2.5, 5, 5);
        ctx.strokeRect(px - 2.5, py - 2.5, 5, 5);
      } else {
        drawCrown(ctx, px, py, mine ? 7 : 4.5, mine ? '#FFD23F' : '#F5D989');
      }
    }

    // 国の名前と「プレイヤー／CPU」の札（大きい国から、重ならないものだけ）
    if (performance.now() - this.labelsAt > 1500) this.computeLabels();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const placed = [];
    for (const l of this.labels) {
      const size = Math.min(24, Math.sqrt(l.c) * cell * 0.3);
      if (size < 11) continue;
      const x = sx(l.x), y = sy(l.y) + cell * 0.3 + size * 0.75; // 城の足もとの下
      if (x < -120 || y < -40 || x > this.cw + 120 || y > this.ch + 40) continue;
      ctx.font = `700 ${size}px "Noto Serif JP", "Hiragino Mincho ProN", serif`;
      const tw = ctx.measureText(l.name).width;
      const ps = Math.max(9, Math.round(size * 0.5));
      const pill = l.cpu ? '🤖 CPU' : '👤 プレイヤー';
      const box = [x - Math.max(tw, ps * 5) / 2 - 3, y - size / 2, x + Math.max(tw, ps * 5) / 2 + 3, y + size / 2 + ps + 6];
      if (placed.some((b) => b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3])) continue;
      placed.push(box);
      ctx.lineWidth = Math.max(3, size / 4);
      ctx.strokeStyle = 'rgba(255,248,232,0.9)';
      ctx.strokeText(l.name, x, y);
      ctx.fillStyle = l.id === this.me ? '#004955' : '#102C36';
      ctx.fillText(l.name, x, y);
      // 札
      ctx.font = `700 ${ps}px "Noto Sans JP", system-ui, sans-serif`;
      const pw = ctx.measureText(pill).width + ps * 1.1;
      const py = y + size / 2 + ps * 0.75 + 2;
      ctx.fillStyle = l.cpu ? 'rgba(102,107,104,0.92)' : 'rgba(18,62,74,0.94)';
      roundRect(ctx, x - pw / 2, py - ps * 0.72, pw, ps * 1.44, ps * 0.72);
      ctx.fill();
      ctx.fillStyle = '#FFFCF2';
      ctx.fillText(pill, x, py + 0.5);
    }

    // 目標
    if (this.focus >= 0) {
      const [fx, fy] = this.cellCenter(this.focus);
      drawFlag(ctx, fx, fy, Math.max(12, Math.min(20, cell * 1.4)));
    }
    // 選んだマス（金の点線）
    if (this.sel >= 0) {
      const [cx, cy] = this.cellCenter(this.sel);
      const r = Math.max(6, cell * 0.7);
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#D3A33D';
      ctx.strokeRect(cx - r, cy - r, r * 2, r * 2);
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(16,44,54,0.8)';
      ctx.strokeRect(cx - r - 2, cy - r - 2, r * 2 + 4, r * 2 + 4);
    }
    // 仲間の合図（3秒で消える輪）
    const now = performance.now();
    this.pings = this.pings.filter((p) => now - p.at < 3000);
    for (const p of this.pings) {
      const [px, py] = this.cellCenter(p.i);
      const k = (now - p.at) / 3000;
      ctx.strokeStyle = `rgba(211,163,61,${1 - k})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(px, py, 8 + k * 40, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (this.pings.length) this.request();
  }

  // ---------- 操作 ----------

  bindInput() {
    const cv = this.cv;
    const pts = new Map();
    let start = null, pinch = null;
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pts.size === 1) start = { x: e.offsetX, y: e.offsetY, ox: this.ox, oy: this.oy, at: performance.now(), moved: 0 };
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: this.scale, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        if (start) start.moved = 99;
      }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        const target = Math.max(this.minScale(), Math.min(14, (pinch.scale * d) / Math.max(10, pinch.d)));
        this.zoomAt(target / this.scale, cx, cy);
        this.ox += cx - pinch.cx;
        this.oy += cy - pinch.cy;
        pinch.cx = cx;
        pinch.cy = cy;
        this.clamp();
        this.onMove();
      } else if (pts.size === 1 && start) {
        const dx = e.offsetX - start.x, dy = e.offsetY - start.y;
        start.moved = Math.max(start.moved, Math.hypot(dx, dy));
        if (start.moved > 6) {
          this.ox = start.ox + dx;
          this.oy = start.oy + dy;
          this.clamp();
          this.request();
          this.onMove();
        }
      }
    });
    const end = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size === 0 && start) {
        if (start.moved <= 6 && performance.now() - start.at < 600) {
          const i = this.cellAt(e.offsetX, e.offsetY);
          this.onTap(i);
        }
        start = null;
      }
      if (pts.size === 1) {
        const [p] = [...pts.values()];
        start = { x: p.x, y: p.y, ox: this.ox, oy: this.oy, at: 0, moved: 99 };
      }
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomAt(Math.pow(1.0015, -e.deltaY), e.offsetX, e.offsetY);
      this.onMove();
    }, { passive: false });
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCrown(ctx, x, y, r, fill) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(-r, r * 0.6);
  ctx.lineTo(-r, -r * 0.4);
  ctx.lineTo(-r * 0.5, r * 0.1);
  ctx.lineTo(0, -r * 0.7);
  ctx.lineTo(r * 0.5, r * 0.1);
  ctx.lineTo(r, -r * 0.4);
  ctx.lineTo(r, r * 0.6);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.strokeStyle = '#3a2c1c';
  ctx.lineWidth = Math.max(1, r / 5);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawFlag(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = '#3a2c1c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -s);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.lineTo(s * 0.8, -s * 0.75);
  ctx.lineTo(0, -s * 0.5);
  ctx.closePath();
  ctx.fillStyle = '#AF4436';
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
