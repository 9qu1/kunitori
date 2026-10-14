// クニトリのルールの数字（サーバーと画面の両方が読む）
//   数字を変えたら node tools/sim.mjs で7日ぶん回して、放置と操作の差・寝ている間に減る量を確かめる

export const VERSION = '0.3.2';

export const R = {
  W: 320,
  H: 200,
  TICK_SEC: 300, // 1ターン＝5分（手元は .dev.vars の TICK_SEC で短くできる）
  CHUNK_ROWS: 10, // 地図を保存するときの区切り（10行ずつ）
  CATCHUP_MAX: 36, // サーバーが止まっていたぶんを、まとめて進めるのは3時間まで

  // 地形 0海 1平地 2森 3山 4町
  TERRAIN_NAMES: ['海', '平地', '森', '山', '町'],
  NEUTRAL_COST: [0, 6, 10, 18, 24], // 空き地をとるのに使う兵力
  DEF_TERRAIN: [0, 1, 1.3, 2, 1.5], // 守りやすさ

  // 兵力
  START_TROOPS: 160,
  BASE_INCOME: 3,
  INCOME_PER_CELL: 0.1,
  INCOME_PER_CITY: 4,
  CPU_INCOME: 0.9,
  CAP_BASE: 120,
  CAP_PER_CELL: 8,
  CAP_PER_CITY: 60,
  GROW_FLOOR: 0.2, // 上限に近いほど増えにくい（いちばん遅くても2割）

  // 自動でひろげる
  SPEND_MAX: 0.25, // 「攻め100%」で1ターンに使う兵力の割合
  TICK_CAP_BASE: 2, // 1ターンにとれるマス数の上限 = 2 + √領地 × 0.25
  TICK_CAP_SQRT: 0.25,
  DIST_DIV: 45, // 首都から遠いほど高くつく（45マスで2倍）
  SIZE_SOFT: 900, // 大きい国ほど高くつく（900マスで2倍・1800マスで5倍）＝1国が大陸をのみこまない（10/13 100人規模なので600から緩めた）

  // 攻められたとき
  ENEMY_BASE: 3,
  DENS_MUL: 1,
  DEF_ADV: 1.5, // 守る側が有利
  DEF_LOSS: 0.8, // 1マス取られると、そのマスの兵の8割を失う
  CORE_RADIUS: 4, // 首都のまわりは守りが固い
  CORE_MUL: 2,
  LOSS_WINDOW: 12, // 1時間ごとに数えなおす
  LOSS_RATIO: 0.025, // 1時間に失うのは領地の2.5%まで（最低3マス）＝寝ている8時間で2割まで
  LOSS_MIN: 3,

  // 行動力
  AP_MAX: 12,
  AP_EVERY: 6, // 6ターン（30分）に1
  COST: { march: 2, fort: 2, draft: 3, aid: 1 },

  // 進軍（行動力2）: 選んだ場所へ向かって一気にとる・空き地も敵も4割引
  MARCH_DISCOUNT: 0.6,
  MARCH_SPEND: 0.6, // 兵力の6割まで使う
  MARCH_REACH: 8, // 自分の領地から8マス以内
  MARCH_BASE: 6, // とれるマス数 = 6 + √領地 × 0.6
  MARCH_SQRT: 0.6,

  // 要塞（行動力2）: 半径3の自分のマスを24時間、2.5倍かたくする
  FORT_RADIUS: 3,
  FORT_TICKS: 288,
  FORT_MUL: 2.5,

  // 徴兵（行動力3）: 1時間ぶんの収入をすぐ受け取る
  DRAFT_TICKS: 12,

  // 援軍（行動力1）: 兵力の25%を同盟の仲間へ
  AID_PCT: 0.25,
  OVERCAP: 1.5, // 援軍で上限の1.5倍まで持てる（あふれたぶんは毎ターン2%へる）

  // はじめての人
  START_RADIUS: 3,
  SHIELD_TICKS: 864, // 72時間は攻められない（自分からプレイヤーを攻めると切れる）
  SPAWN_MIN_DIST: 12,
  DONOR_MIN_CELLS: 600, // 大陸に空きがないとき、この大きさ以上のプレイヤーの国からも土地を分けてもらう

  // しばらく来ない人
  DORMANT_MS: 7 * 24 * 3600 * 1000, // 7日来ないと「眠りの国」（首都も取られるようになる）

  // 招待特典（10/13 ユーザーの希望）
  INVITE_AP: 6, // 友達が招待リンクから建国した瞬間、招待した人に行動力+6（上限12をこえてよい）
  AP_HARD: 30, // 特典でたまる行動力の上限
  INVITE_NEW_TROOPS: 150, // 招待で来た人の建国ボーナス（兵力+150）
  INVITE_PLAY_TICKS: 240, // 建国から20時間たってから来たら「遊んだ」
  INVITE_PLAY_INCOME: 36, // そのとき招待した人に、3時間ぶんの収入を兵力で（最低300）
  INVITE_PLAY_MIN: 300,
  INVITE_MAX: 10, // 特典がもらえるのは10人まで

  // 同盟
  ALLIANCE_MAX: 6,
  REJOIN_TICKS: 72, // 抜けてから6時間は別の同盟に入れない
  STAMPS: ['おはよう', 'おやすみ', 'たすけて！', 'ここを攻める', 'ここを守って', '了解！', 'ナイス！', 'ありがとう', 'ごめん', '待って'],

  // コンピューターの国
  CPU_NATIONS: 24, // 10/13 64→24（人の国を大きくできるように。100人で7日目のこまめな人 371→643マス）
  CPU_ALLIANCES: 6,
  CPU_INDEPENDENT: 0.2,
  PRESIM_TICKS: 120, // 世界を作ったとき10時間ぶん進めておく

  // プレイヤーが選べる色
  PALETTE: [
    '#10AA99', '#2E86C1', '#C0392B', '#E1B12C', '#D96C9A', '#7D5BA6', '#E07B39', '#3E9E5A',
    '#1F5F8B', '#A0522D', '#6E9F2A', '#B03A6E', '#4A6FA5', '#8E44AD', '#16A085', '#D35400',
  ],
};

export const apCostText = (k) => `行動力${R.COST[k]}`;
