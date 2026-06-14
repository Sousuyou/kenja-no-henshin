/* =====================================================================
 * app.js — 「賢者の返信」のロジック（黄金比デザイン版）
 *  1. 悩みのテキストからテーマを判定
 *  2. テーマに合う名言を、別々の哲学者から数件選ぶ
 *  3. カードを描画し、シェア（画像生成 / X / コピー / リンク）を提供
 *  4. お気に入り保存（localStorage）と、結果のパーマリンク（URL共有）
 *  5. 背景の放射状サンバースト＋星屑アニメーション
 * ===================================================================== */

(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  const els = {
    hero:       $('#hero'),
    composer:   $('#composer'),
    worry:      $('#worry'),
    count:      $('#count'),
    askBtn:     $('#askBtn'),
    chips:      $('#chips'),
    favOpen:    $('#favOpen'),
    favCount:   $('#favCount'),
    results:    $('#results'),
    resultHead: $('#resultHead'),
    tools:      $('#resultTools'),
    copyLinkBtn:$('#copyLinkBtn'),
    rerollBtn:  $('#rerollBtn'),
    battleBtn:  $('#battleBtn'),
    cards:      $('#cards'),
    resetBtn:   $('#resetBtn'),
    canvas:     $('#shareCanvas'),
    daily:      $('#daily'),
    dailyHook:  $('#dailyHook'),
    dailyName:  $('#dailyName'),
    dailyStreak:$('#dailyStreak'),
    dailyOpen:  $('#dailyOpen'),
  };

  const NUM_CARDS = 1;
  const FAV_KEY    = 'kenja_favs_v1';
  const STREAK_KEY = 'kenja_streak_v1';
  const BVOTE_KEY  = 'kenja_battle_votes_v1';
  const BASE_URL  = location.origin + location.pathname;
  /* 共有画像に焼き込む本番URL（スクショからの流入導線） */
  const SHARE_URL = 'sousuyou.github.io/kenja-no-henshin';

  let state = { worry: '', themeKey: null, mode: 'result', scored: null, grief: false, battle: null };

  /* 名言のID（哲学者キー＋本文ハッシュ）と逆引きマップ */
  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
    return (h >>> 0).toString(36);
  }
  function quoteId(q) { return q.phil + '-' + hashStr(q.quote); }
  const QUOTES_BY_ID = {};
  QUOTES.forEach((q) => { QUOTES_BY_ID[quoteId(q)] = q; });

  /* 関連度マッチング用：各名言の文字bigram集合（名言＋ひとこと＋決めゼリフ） */
  function bigrams(s) {
    const clean = String(s).replace(/[\s　、。，．・…「」『』（）()【】〈〉《》！？!?,.\-—~＝=:：;；’”'"]/g, '');
    const set = new Set();
    for (let i = 0; i < clean.length - 1; i++) set.add(clean.substr(i, 2));
    return set;
  }
  const QUOTE_BIGRAMS = QUOTES.map((q) => bigrams(q.quote + ' ' + q.note + ' ' + (q.hook || '')));
  const isContentBg = (bg) => /[一-鿿゠-ヿ々]/.test(bg); // 漢字・カタカナを含む＝内容語

  /* 大切な存在を失った悲しみ（＝死への恐怖ではなくグリーフ）か */
  const GRIEF_RE = /(亡く|喪失|失っ|失く|逝|他界|死別|大切な人|ペット|立ち直れ|涙)/;
  function isGrief(text) { return GRIEF_RE.test(text || ''); }

  /* ---------------------------------------------------------------
   * 賢者の気質（バトル用）。同じ悩みに「逆の答え」を返す2人を作るための軸。
   *   do  = 前へ進め派（行動・克己・喝）
   *   sei = 力を抜け派（受容・手放し・自然体）
   * ------------------------------------------------------------- */
  const TEMPER = {
    socrates:'do', platon:'do', aristoteles:'do', diogenes:'sei', epicurus:'sei',
    heraclitus:'do', epictetus:'do', seneca:'do', aurelius:'do', montaigne:'sei',
    pascal:'sei', spinoza:'sei', kant:'do', rousseau:'sei', goethe:'do',
    schopenhauer:'sei', kierkegaard:'do', nietzsche:'do', emerson:'do', thoreau:'sei',
    mill:'do', russell:'do', wittgenstein:'sei', sartre:'do', camus:'do',
    beauvoir:'do', arendt:'do', weil:'sei', alain:'do', laozi:'sei',
    zhuangzi:'sei', confucius:'do', mencius:'do', buddha:'sei', nishida:'sei',
  };
  const CAMP = {
    do:  { label: '前へ進め', sub: '攻めの一手', color: '#c0708a' },
    sei: { label: '力を抜け', sub: '受けの一手', color: '#7fa99b' },
  };
  function temperOf(phil) { return TEMPER[phil] || 'do'; }
  function campOf(phil)   { return CAMP[temperOf(phil)]; }

  /* ---------------------------------------------------------------
   * 日替わり「今日の賢者」＋連続来訪（ストリーク）
   * ------------------------------------------------------------- */
  function todayStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  /* 日付シードで全員に同じ1枚（＝「今日の賢者◯◯だった」が同時多発する） */
  function dailyQuote() {
    const idx = parseInt(hashStr('day:' + todayStr()), 36) % QUOTES.length;
    return QUOTES[idx];
  }
  function updateStreak() {
    let s;
    try { s = JSON.parse(localStorage.getItem(STREAK_KEY) || 'null'); } catch { s = null; }
    const today = todayStr();
    if (!s || !s.last) {
      s = { last: today, count: 1, best: 1 };
    } else if (s.last !== today) {
      const y = new Date(); y.setDate(y.getDate() - 1);
      s.count = (s.last === todayStr(y)) ? (s.count + 1) : 1;
      s.last = today;
      if (s.count > (s.best || 0)) s.best = s.count;
    }
    try { localStorage.setItem(STREAK_KEY, JSON.stringify(s)); } catch {}
    return s;
  }

  /* バトルの投票（この端末内の集計・正直なローカル値） */
  function loadBVotes() { try { return JSON.parse(localStorage.getItem(BVOTE_KEY) || '{}'); } catch { return {}; } }
  function bumpBVote(camp) {
    const v = loadBVotes(); v[camp] = (v[camp] || 0) + 1;
    try { localStorage.setItem(BVOTE_KEY, JSON.stringify(v)); } catch {}
    return v;
  }

  /* ---------------------------------------------------------------
   * お気に入り（localStorage）
   * ------------------------------------------------------------- */
  function loadFavs() {
    try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]')); }
    catch { return new Set(); }
  }
  let favs = loadFavs();
  function saveFavs() { try { localStorage.setItem(FAV_KEY, JSON.stringify([...favs])); } catch {} }
  function isFav(q) { return favs.has(quoteId(q)); }
  function toggleFav(q) {
    const id = quoteId(q);
    if (favs.has(id)) favs.delete(id); else favs.add(id);
    saveFavs(); updateFavUI();
  }
  function updateFavUI() {
    els.favCount.textContent = favs.size;
    els.favOpen.hidden = favs.size === 0 && state.mode !== 'fav';
  }

  /* ---------------------------------------------------------------
   * テーマ判定 ＆ 名言選定
   * ------------------------------------------------------------- */
  /* 悩みの文章を解析：テーマの当たり具合（キーワード一致数） */
  function analyzeThemes(text) {
    const hits = {};
    for (const [key, t] of Object.entries(THEMES)) {
      let s = 0;
      for (const kw of t.keywords) { if (text.includes(kw)) s += 1; }
      if (s > 0) hits[key] = s;
    }
    return hits;
  }

  /* 全名言を、悩みとの「関連度」で採点して降順に並べる
   * total = テーマ一致(重め) + 文字bigramの重なり（内容語を重み付け） */
  function scoreAll(worry) {
    const hits = analyzeThemes(worry);
    const wbig = bigrams(worry);
    const primary = Object.keys(hits).length
      ? Object.entries(hits).sort((a, b) => b[1] - a[1])[0][0] : null;
    // 「大切な存在を失った悲しみ」か（＝死への恐怖ではなく、喪失・グリーフ）
    const grief = /(亡く|喪失|失っ|失く|逝|他界|死別|大切な人|ペット|立ち直れ|涙)/.test(worry);
    const scored = QUOTES.map((q, i) => {
      let t = 0;
      for (const th of q.themes) t += (hits[th] || 0);
      if (primary && q.themes.includes(primary)) t += 2;
      let b = 0;
      const qb = QUOTE_BIGRAMS[i];
      for (const bg of wbig) { if (qb.has(bg)) b += isContentBg(bg) ? 2 : 1; }
      let total = t * 4 + b;
      // 喪失の悩みには、寄り添う名言を上げ、「死を恐れるな」系を下げる
      if (grief) {
        const txt = q.quote + q.note + (q.hook || '');
        if (q.themes.includes('shi') && /(失|喪|返し|手放|忘れ|悲し|そば|残る|預か)/.test(txt)) total += 8;
        if (/(恐れ|恐怖|怖)/.test(txt)) total -= 6;
      }
      return { q, total };
    }).sort((a, b) => b.total - a.total);
    const themeKey = (primary && hits[primary]) ? primary
      : (scored[0] && scored[0].q.themes[0]) || 'imi';
    return { scored, themeKey };
  }

  /* パーマリンク復元など、悩み文がない場合のフォールバック採点 */
  function scoredByTheme(themeKey) {
    return QUOTES.map((q) => ({ q, total: q.themes.includes(themeKey) ? 10 : 0 }))
      .sort((a, b) => b.total - a.total);
  }

  /* 上位から、別々の哲学者で n 件選ぶ。
   * forceTop=true なら最も関連度の高い1件を必ず先頭に。残りは上位プールから重み付き抽選。 */
  function pickTop(scored, n, forceTop) {
    const pool = scored.slice(0, Math.max(n * 4, 12));
    const chosen = [], used = new Set();
    let rest = pool.slice();
    if (forceTop && rest.length) {
      const top = rest.shift();
      used.add(top.q.phil); chosen.push(top.q);
    }
    while (chosen.length < n && rest.length) {
      const weights = rest.map((x) => Math.pow(x.total + 1, 1.6));
      const sum = weights.reduce((a, b) => a + b, 0);
      let r = Math.random() * sum, idx = 0;
      for (; idx < rest.length; idx++) { r -= weights[idx]; if (r <= 0) break; }
      idx = Math.min(idx, rest.length - 1);
      const pick = rest.splice(idx, 1)[0];
      if (used.has(pick.q.phil)) continue;
      used.add(pick.q.phil); chosen.push(pick.q);
    }
    if (chosen.length < n) {
      for (const x of scored) {
        if (used.has(x.q.phil)) continue;
        used.add(x.q.phil); chosen.push(x.q);
        if (chosen.length === n) break;
      }
    }
    return chosen;
  }

  /* ---------------------------------------------------------------
   * カード描画（黄金比デザイン）
   * ------------------------------------------------------------- */
  const EMBLEM = `<svg viewBox="0 0 100 100" aria-hidden="true"><g stroke-width="1.3"><circle cx="50" cy="50" r="30"/><path d="M50 20 L50 80 M20 50 L80 50" stroke-opacity=".5"/><path d="M50 20 L60 50 L50 80 L40 50 Z"/><circle cx="50" cy="50" r="6"/></g></svg>`;
  const CCNR =
    `<svg class="ccnr tl" viewBox="0 0 26 26" aria-hidden="true"><path d="M1 11 L1 1 L11 1"/></svg>` +
    `<svg class="ccnr tr" viewBox="0 0 26 26" aria-hidden="true"><path d="M1 11 L1 1 L11 1"/></svg>` +
    `<svg class="ccnr bl" viewBox="0 0 26 26" aria-hidden="true"><path d="M1 11 L1 1 L11 1"/></svg>` +
    `<svg class="ccnr br" viewBox="0 0 26 26" aria-hidden="true"><path d="M1 11 L1 1 L11 1"/></svg>`;
  const ICON = {
    save: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M3 17 L9 11 L13 15 L17 11 L21 15"/></svg>`,
    x:    `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3 L10 12.5 L3.5 21 M6 21 L11 14.5 L16 21 L21 21 L13.5 10.5 L20.5 3 L17 3 L11.7 8.7 L7.5 3 Z"/></svg>`,
    copy: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="8.5" width="11.5" height="11.5" rx="1.5"/><path d="M5 15.5 L4 15.5 L4 4 L15.5 4 L15.5 5"/></svg>`,
    heart:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21 C12 21 3 14.5 3 8.5 C3 5.5 5.2 3.5 7.8 3.5 C9.6 3.5 11 4.6 12 6 C13 4.6 14.4 3.5 16.2 3.5 C18.8 3.5 21 5.5 21 8.5 C21 14.5 12 21 12 21 Z"/></svg>`,
  };

  function cardElement(q, i) {
    const p = PHILOSOPHERS[q.phil];
    const card = document.createElement('article');
    card.className = 'card';
    card.style.setProperty('--accent', p.color);
    card.style.setProperty('--cd', (i * 0.14) + 's');
    const faved = isFav(q);

    card.innerHTML = `
      ${CCNR}
      <header class="card-head">
        <div class="card-emblem">${EMBLEM}</div>
        <div class="philosopher">${escapeHTML(p.name)}</div>
        <div class="pedigree">${escapeHTML(p.dates)}<b>・${escapeHTML(p.era)}</b></div>
      </header>
      ${q.hook ? `<div class="reply"><span class="reply-tag">賢者からの返信</span><p class="hook">${escapeHTML(q.hook)}</p></div>` : ''}
      <blockquote class="quote"><span class="mk">“</span>${escapeHTML(q.quote)}<span class="mk">”</span></blockquote>
      <p class="source">${q.source ? escapeHTML(q.source) : ''}</p>
      <div class="modern-wrap">
        <span class="modern-tag">現代語のひとこと</span>
        <p class="modern">${escapeHTML(q.note)}</p>
      </div>
      <div class="card-actions">
        <button class="chip action-save" type="button">${ICON.save}画像で保存</button>
        <button class="chip action-x" type="button">${ICON.x}Xでシェア</button>
        <button class="chip action-copy" type="button">${ICON.copy}コピー</button>
        <button class="chip heart fav-toggle ${faved ? 'is-fav' : ''}" type="button" aria-label="お気に入り">${ICON.heart}</button>
      </div>
    `;

    const favBtn = card.querySelector('.fav-toggle');
    favBtn.addEventListener('click', () => {
      toggleFav(q);
      const nowFav = isFav(q);
      favBtn.classList.toggle('is-fav', nowFav);
      toast(nowFav ? '保存しました ♥' : '保存を解除しました');
      if (state.mode === 'fav' && !nowFav) card.remove();
    });
    card.querySelector('.action-save').addEventListener('click', () => shareImage(q));
    card.querySelector('.action-x').addEventListener('click', () => shareToX(q));
    card.querySelector('.action-copy').addEventListener('click', () => copyText(q));
    return card;
  }

  function renderCards(quotes) {
    els.cards.innerHTML = '';
    quotes.forEach((q, i) => els.cards.appendChild(cardElement(q, i)));
  }

  function showResult(themeKey, quotes, opts = {}) {
    state.mode = opts.mode || 'result';
    state.themeKey = themeKey;
    state.battle = null;
    els.tools.hidden = false;
    els.resultHead.innerHTML = opts.headerHTML
      || (`今のあなたの心は『<span class="hl">${escapeHTML(THEMES[themeKey].label)}</span>』。`
        + `賢者からの返信が<span class="hl">${quotes.length}通</span>、届きました`);
    renderCards(quotes);
    // ツールの出し分け：実際の悩みに対する結果のときだけ「引き直し」「対決」を出す
    const real = state.mode === 'result' && !!state.worry;
    els.rerollBtn.hidden = !real;
    if (els.battleBtn) els.battleBtn.hidden = !(real && state.scored && !state.grief);
    els.results.hidden = false;
    if (opts.scroll !== false) els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    updateFavUI();
  }

  function showFavorites() {
    state.mode = 'fav';
    const quotes = [...favs].map((id) => QUOTES_BY_ID[id]).filter(Boolean);
    els.tools.hidden = true;
    els.resultHead.innerHTML = quotes.length
      ? `保存した言葉 <span class="hl">${quotes.length}</span>件`
      : `保存した言葉はまだありません`;
    renderCards(quotes);
    els.results.hidden = false;
    els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    updateFavUI();
  }

  /* 単体表示（バトルから「この人だけ読む」／日替わりの今日の賢者） */
  function showSingle(q, headerHTML, allowBattle) {
    state.mode = 'single';
    state.battle = null;
    els.tools.hidden = false;
    els.resultHead.innerHTML = headerHTML;
    renderCards([q]);
    els.rerollBtn.hidden = true;
    if (els.battleBtn) els.battleBtn.hidden = !(allowBattle && state.worry && state.scored && !state.grief);
    els.results.hidden = false;
    els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    updateFavUI();
  }

  /* ---------------------------------------------------------------
   * 賢者バトル：同じ悩みに、気質の逆な2人が逆の答えを返す
   * ------------------------------------------------------------- */
  /* A=最も刺さる1件。B=反対の気質から最上位（避けたい哲学者は除外して別対決に） */
  function pickBattle(scored, avoid) {
    if (!scored || !scored.length) return null;
    const avoidPhil = avoid ? new Set(avoid.map((q) => q.phil)) : null;
    const poolA = scored.filter((x) => x.total > 0).slice(0, 16);
    let a = avoidPhil
      ? (poolA.find((x) => !avoidPhil.has(x.q.phil)) || poolA[0] || scored[0])
      : scored[0];
    if (!a) a = scored[0];
    const want = temperOf(a.q.phil) === 'do' ? 'sei' : 'do';
    const diff = (x) => x.q.phil !== a.q.phil && (!avoidPhil || !avoidPhil.has(x.q.phil));
    const b = scored.find((x) => diff(x) && temperOf(x.q.phil) === want && x.total > 0)
           || scored.find((x) => x.q.phil !== a.q.phil && temperOf(x.q.phil) === want)
           || scored.find((x) => diff(x))
           || scored.find((x) => x.q.phil !== a.q.phil);
    if (!b) return null;
    return [a.q, b.q];
  }

  function buildBattle(pair) {
    const [qa, qb] = pair;
    const wrap = document.createElement('div');
    wrap.className = 'battle';

    const cardHTML = (q, side) => {
      const p = PHILOSOPHERS[q.phil], c = campOf(q.phil);
      return `
        <article class="bcard side-${side}" style="--accent:${p.color};--camp:${c.color}">
          ${CCNR}
          <span class="bcamp">“${escapeHTML(c.label)}”</span>
          <div class="bname">${escapeHTML(p.name)}</div>
          <div class="bdates">${escapeHTML(p.dates)}</div>
          ${q.hook ? `<p class="bhook">${escapeHTML(q.hook)}</p>` : ''}
          <blockquote class="bquote">${escapeHTML(q.quote)}</blockquote>
          ${q.source ? `<p class="bsource">${escapeHTML(q.source)}</p>` : ''}
          <button class="bsolo" type="button" data-side="${side}">▸ この人だけで読む</button>
        </article>`;
    };

    wrap.innerHTML = `
      <div class="battle-arena">
        ${cardHTML(qa, 'a')}
        <div class="vs" aria-hidden="true"><span>VS</span></div>
        ${cardHTML(qb, 'b')}
      </div>
      <p class="battle-ask">どちらの言葉が、いまのあなたに刺さった？</p>
      <div class="battle-vote">
        <button class="vote-btn" type="button" data-pick="a">${escapeHTML(PHILOSOPHERS[qa.phil].name)}</button>
        <button class="vote-btn" type="button" data-pick="b">${escapeHTML(PHILOSOPHERS[qb.phil].name)}</button>
      </div>
      <div class="battle-result" hidden></div>
      <div class="battle-foot">
        <button class="chip-tool battle-share" type="button">⚔ この対決を画像でシェア</button>
        <button class="chip-tool" data-act="more" type="button">別の対決を見る ↻</button>
      </div>`;

    const arena = wrap.querySelector('.battle-arena');
    const resultBox = wrap.querySelector('.battle-result');
    const voteBtns = wrap.querySelectorAll('.vote-btn');
    let voted = false;
    voteBtns.forEach((btn) => btn.addEventListener('click', () => {
      if (voted) return; voted = true;
      const pick = btn.dataset.pick;
      const q = pick === 'a' ? qa : qb;
      const v = bumpBVote(temperOf(q.phil));
      arena.querySelector('.side-' + pick).classList.add('is-pick');
      arena.querySelector('.side-' + (pick === 'a' ? 'b' : 'a')).classList.add('is-faded');
      voteBtns.forEach((b) => { b.disabled = true; b.classList.toggle('chosen', b === btn); });
      const total = (v.do || 0) + (v.sei || 0);
      const pct = (k) => total ? Math.round((v[k] || 0) / total * 100) : 0;
      resultBox.hidden = false;
      resultBox.innerHTML =
        `<p class="br-lead">あなたは <b>${escapeHTML(PHILOSOPHERS[q.phil].name)}</b>（${escapeHTML(campOf(q.phil).label)}派）を選びました。</p>`
        + `<p class="br-tally">この端末の投票　前へ進め <b>${pct('do')}%</b> ／ 力を抜け <b>${pct('sei')}%</b> <span class="br-n">（計${total}回）</span></p>`;
    }));

    wrap.querySelector('.battle-share').addEventListener('click', () => shareBattle(pair));
    wrap.querySelector('[data-act="more"]').addEventListener('click', () => {
      const next = pickBattle(state.scored, pair);
      if (next) renderBattle(next); else toast('別の対決が見つかりませんでした');
    });
    wrap.querySelectorAll('.bsolo').forEach((b) => b.addEventListener('click', () => {
      const q = b.dataset.side === 'a' ? qa : qb;
      showSingle(q, `<span class="hl">${escapeHTML(PHILOSOPHERS[q.phil].name)}</span> の返信`, true);
    }));
    return wrap;
  }

  function renderBattle(pair) {
    state.battle = pair;
    state.mode = 'battle';
    els.resultHead.innerHTML = `2人の賢者が、逆の答えを返した。<span class="hl">あなたはどっち？</span>`;
    els.rerollBtn.hidden = true;
    els.battleBtn.hidden = true;
    els.cards.innerHTML = '';
    els.cards.appendChild(buildBattle(pair));
    els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function shareBattle(pair) {
    toast('画像を作成中…');
    try {
      await ensureFontsReady();
      const blob = await drawBattle(pair);
      const file = new File([blob], 'kenja-battle.png', { type: 'image/png' });
      const text = `「${(state.worry || 'この悩み').slice(0, 40)}」に、2人の賢者が逆の答え。あなたはどっち？`;
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: text + '\n\n#賢者の返信' });
        return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'kenja-battle.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('画像を保存しました');
    } catch (e) { console.error(e); toast('画像の作成に失敗しました'); }
  }

  /* ---------------------------------------------------------------
   * パーマリンク（結果をURLで共有）
   * ------------------------------------------------------------- */
  function buildPermalink(themeKey, quotes, worry) {
    const ids = quotes.map(quoteId).join('.');
    let h = `#t=${themeKey}&ids=${ids}`;
    if (worry) h += `&w=${encodeURIComponent(worry.slice(0, 120))}`;
    return BASE_URL + h;
  }
  function updateHash(themeKey, quotes, worry) {
    try { history.replaceState(null, '', buildPermalink(themeKey, quotes, worry)); } catch {}
  }
  function parseHash() {
    const h = location.hash.replace(/^#/, '');
    if (!h) return null;
    const params = {};
    h.split('&').forEach((kv) => { const i = kv.indexOf('='); if (i > 0) params[kv.slice(0, i)] = kv.slice(i + 1); });
    if (!params.t || !params.ids) return null;
    const quotes = params.ids.split('.').map((id) => QUOTES_BY_ID[id]).filter(Boolean);
    if (!quotes.length || !THEMES[params.t]) return null;
    return { themeKey: params.t, quotes, worry: params.w ? decodeURIComponent(params.w) : '' };
  }
  function copyResultLink() {
    if (state.mode !== 'result' || !state.themeKey) return;
    navigator.clipboard.writeText(location.href)
      .then(() => toast('結果のリンクをコピーしました'))
      .catch(() => toast('コピーできませんでした'));
  }

  /* ---------------------------------------------------------------
   * シェア：テキスト / X / 画像
   * ------------------------------------------------------------- */
  function quoteToText(q) {
    const p = PHILOSOPHERS[q.phil];
    const src = q.source ? `『${q.source}』` : '';
    const hook = q.hook ? `${q.hook}\n\n` : '';
    return `${hook}「${q.quote}」\n— ${p.name}${src}`;
  }
  function copyText(q) {
    navigator.clipboard.writeText(quoteToText(q) + `\n\n#賢者の返信`)
      .then(() => toast('コピーしました'))
      .catch(() => toast('コピーできませんでした'));
  }
  function shareToX(q) {
    const url = 'https://twitter.com/intent/tweet'
      + '?text=' + encodeURIComponent(quoteToText(q) + '\n\n')
      + '&hashtags=' + encodeURIComponent('賢者の返信')
      + '&url=' + encodeURIComponent(location.href.split('#')[0]);
    window.open(url, '_blank', 'noopener');
  }

  async function shareImage(q) {
    toast('画像を作成中…');
    try {
      await ensureFontsReady();
      const blob = await drawCard(q);
      const file = new File([blob], 'kenja.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: quoteToText(q) + '\n\n#賢者の返信' });
        return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'kenja-' + q.phil + '.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('画像を保存しました');
    } catch (e) {
      console.error(e);
      toast('画像の作成に失敗しました');
    }
  }

  function ensureFontsReady() {
    if (document.fonts && document.fonts.load) {
      return Promise.all([
        document.fonts.load('700 48px "Shippori Mincho"'),
        document.fonts.load('600 58px "Shippori Mincho"'),
        document.fonts.load('italic 27px "Cormorant Garamond"'),
      ]).catch(() => {});
    }
    return Promise.resolve();
  }

  /* 共有画像（1080×1080・黄金比デザイン） */
  function drawCard(q) {
    const p = PHILOSOPHERS[q.phil];
    const cv = els.canvas, ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height, CX = W / 2;
    const GOLD = '#d4af5a', GOLDB = '#f3d898', PARCH = '#efe6cf';

    // 背景（藍のラジアル＋哲学者カラーの淡いにじみ）
    const g = ctx.createRadialGradient(CX, 360, 60, CX, 560, 860);
    g.addColorStop(0, '#19244f'); g.addColorStop(0.5, '#0c1330'); g.addColorStop(1, '#05070f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const tint = ctx.createRadialGradient(CX, 210, 0, CX, 210, 540);
    tint.addColorStop(0, hexA(p.color, 0.14)); tint.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = tint; ctx.fillRect(0, 0, W, H);

    // 二重金枠
    ctx.strokeStyle = hexA(GOLD, 0.75); ctx.lineWidth = 2.5; ctx.strokeRect(50, 50, W - 100, H - 100);
    ctx.strokeStyle = hexA(GOLD, 0.4); ctx.lineWidth = 1.5; ctx.strokeRect(66, 66, W - 132, H - 132);

    // 四隅のかぎ括弧
    ctx.strokeStyle = GOLD; ctx.lineWidth = 2;
    const off = 50, L = 34;
    for (const [x, y, sx, sy] of [[off, off, 1, 1], [W - off, off, -1, 1], [off, H - off, 1, -1], [W - off, H - off, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(x, y + sy * L); ctx.lineTo(x, y); ctx.lineTo(x + sx * L, y); ctx.stroke();
    }

    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';

    // 悩み（Q）— スクショ単体でも「何への返信か」が伝わるように
    const wtxt = (state.worry || '').trim();
    if (wtxt && (state.mode === 'result' || state.mode === 'single')) {
      const body = wtxt.length > 24 ? wtxt.slice(0, 24) + '…' : wtxt;
      ctx.fillStyle = hexA(GOLD, 0.7); ctx.font = 'italic 25px "Cormorant Garamond", serif';
      ctx.fillText('Q.  「' + body + '」', CX, 112);
    }

    // 紋章
    drawEmblem(ctx, CX, 170, GOLDB);

    // 名前
    setLS(ctx, 8);
    ctx.fillStyle = GOLDB; ctx.font = '700 48px "Shippori Mincho", serif';
    ctx.fillText(p.name, CX + 4, 272);
    setLS(ctx, 0);
    // 生没年・流派
    ctx.fillStyle = 'rgba(239,230,207,.62)'; ctx.font = 'italic 27px "Cormorant Garamond", serif';
    ctx.fillText(p.dates + '  ・  ' + p.era, CX, 312);

    const innerW = W - 260, maxY = 826;
    let quoteTop = 408;

    // フック（決めゼリフ・金のキッカー）
    if (q.hook) {
      let hfs = 42, hlines = [];
      while (hfs >= 28) {
        ctx.font = `700 ${hfs}px "Shippori Mincho", serif`;
        hlines = wrapJa(ctx, q.hook, innerW);
        if (hlines.length <= 2) break;
        hfs -= 2;
      }
      const hlh = hfs * 1.55;
      let hy = 384;
      ctx.fillStyle = GOLDB; ctx.font = `700 ${hfs}px "Shippori Mincho", serif`;
      for (const line of hlines) { ctx.fillText(line, CX, hy); hy += hlh; }
      quoteTop = hy + 18;
      decoDivider(ctx, CX, quoteTop, GOLD);
      quoteTop += 44;
    } else {
      decoDivider(ctx, CX, 356, GOLD);
    }

    // 名言（自動フィット・中央寄せ）
    let fs = q.hook ? 44 : 56, lines = [];
    while (fs >= 28) {
      ctx.font = `600 ${fs}px "Shippori Mincho", serif`;
      lines = wrapJa(ctx, q.quote, innerW);
      if (lines.length * fs * 1.8 <= (maxY - quoteTop)) break;
      fs -= 2;
    }
    const lh = fs * 1.8;
    let y = quoteTop + ((maxY - quoteTop) - lines.length * lh) / 2 + fs;
    ctx.fillStyle = PARCH; ctx.font = `600 ${fs}px "Shippori Mincho", serif`;
    for (const line of lines) { ctx.fillText(line, CX, y); y += lh; }

    decoDivider(ctx, CX, 888, GOLD);

    // 出典
    if (q.source) {
      setLS(ctx, 6);
      ctx.fillStyle = GOLD; ctx.font = '400 26px "Shippori Mincho", serif';
      ctx.fillText('—　' + q.source + '　—', CX + 3, 940);
      setLS(ctx, 0);
    }

    // フッター（本番URLを焼き込む＝転載1枚からの送客）
    ctx.fillStyle = 'rgba(239,230,207,.55)'; ctx.font = 'italic 26px "Cormorant Garamond", serif';
    ctx.fillText('賢者の返信   ·   ' + SHARE_URL, CX, H - 74);

    return new Promise((resolve) => cv.toBlob((b) => resolve(b), 'image/png'));
  }

  /* 賢者バトルの共有画像（1080×1080・Q&A構造＋URL入りで流入導線） */
  function drawBattle(pair) {
    const [qa, qb] = pair;
    const cv = els.canvas, ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height, CX = W / 2;
    const GOLD = '#d4af5a', GOLDB = '#f3d898', PARCH = '#efe6cf';

    // 背景
    const g = ctx.createRadialGradient(CX, 420, 60, CX, 560, 880);
    g.addColorStop(0, '#19244f'); g.addColorStop(0.5, '#0c1330'); g.addColorStop(1, '#05070f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // 二重金枠＋四隅
    ctx.strokeStyle = hexA(GOLD, 0.75); ctx.lineWidth = 2.5; ctx.strokeRect(50, 50, W - 100, H - 100);
    ctx.strokeStyle = hexA(GOLD, 0.4); ctx.lineWidth = 1.5; ctx.strokeRect(66, 66, W - 132, H - 132);
    ctx.strokeStyle = GOLD; ctx.lineWidth = 2;
    const off = 50, L = 34;
    for (const [x, y, sx, sy] of [[off, off, 1, 1], [W - off, off, -1, 1], [off, H - off, 1, -1], [W - off, H - off, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(x, y + sy * L); ctx.lineTo(x, y); ctx.lineTo(x + sx * L, y); ctx.stroke();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';

    // 見出し
    setLS(ctx, 12);
    ctx.fillStyle = GOLD; ctx.font = '700 30px "Shippori Mincho", serif';
    ctx.fillText('賢 者 バ ト ル', CX, 130);
    setLS(ctx, 0);

    // Q（悩み）
    let qy = 184;
    const qtext = (state.worry || '').trim();
    ctx.font = '500 30px "Shippori Mincho", serif'; ctx.fillStyle = hexA(PARCH, 0.92);
    if (qtext) {
      const body = qtext.length > 46 ? qtext.slice(0, 46) + '…' : qtext;
      const lines = wrapJa(ctx, '「' + body + '」', W - 260).slice(0, 2);
      for (const ln of lines) { ctx.fillText(ln, CX, qy); qy += 42; }
    } else {
      ctx.fillText('ひとつの悩みに、二つの答え。', CX, qy); qy += 42;
    }
    decoDivider(ctx, CX, qy + 2, GOLD);

    const top = qy + 26, bottom = 900;

    // 中央の縦仕切り（VSの位置を空ける）
    ctx.strokeStyle = hexA(GOLD, 0.45); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(CX, top + 8); ctx.lineTo(CX, 506); ctx.moveTo(CX, 626); ctx.lineTo(CX, bottom - 8); ctx.stroke();

    // 左右
    drawBattleSide(ctx, 292, qa, top, GOLD, GOLDB, PARCH);
    drawBattleSide(ctx, W - 292, qb, top, GOLD, GOLDB, PARCH);

    // VS
    drawVS(ctx, CX, 566, GOLD, GOLDB);

    // フッター
    decoDivider(ctx, CX, bottom + 6, GOLD);
    ctx.fillStyle = GOLDB; ctx.font = '700 36px "Shippori Mincho", serif';
    ctx.fillText('あなたは、どっち派？', CX, bottom + 60);
    ctx.fillStyle = hexA(PARCH, 0.55); ctx.font = 'italic 26px "Cormorant Garamond", serif';
    ctx.fillText('賢者の返信  ·  ' + SHARE_URL, CX, H - 70);

    return new Promise((resolve) => cv.toBlob((b) => resolve(b), 'image/png'));
  }

  function drawBattleSide(ctx, cx, q, top, GOLD, GOLDB, PARCH) {
    const p = PHILOSOPHERS[q.phil], c = campOf(q.phil), maxW = 372;
    let y = top + 44;
    // 流派ラベル
    setLS(ctx, 4);
    ctx.fillStyle = c.color; ctx.font = '700 26px "Shippori Mincho", serif';
    ctx.fillText('“' + c.label + '”', cx, y);
    setLS(ctx, 0);
    y += 56;
    // 名前（長名はフィット）
    let nf = 40;
    while (nf > 26) { ctx.font = `700 ${nf}px "Shippori Mincho", serif`; if (ctx.measureText(p.name).width <= maxW) break; nf -= 2; }
    ctx.fillStyle = GOLDB; ctx.fillText(p.name, cx, y);
    y += 30;
    ctx.fillStyle = hexA(PARCH, 0.55); ctx.font = 'italic 22px "Cormorant Garamond", serif';
    ctx.fillText(p.dates, cx, y);
    y += 46;
    // フック
    if (q.hook) {
      let hf = 30, hl = [];
      while (hf >= 22) { ctx.font = `700 ${hf}px "Shippori Mincho", serif`; hl = wrapJa(ctx, q.hook, maxW); if (hl.length <= 3) break; hf -= 2; }
      ctx.fillStyle = GOLDB; ctx.font = `700 ${hf}px "Shippori Mincho", serif`;
      for (const ln of hl.slice(0, 3)) { ctx.fillText(ln, cx, y); y += hf * 1.5; }
      y += 10;
    }
    // 仕切り
    ctx.strokeStyle = hexA(GOLD, 0.4); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - 56, y - 6); ctx.lineTo(cx + 56, y - 6); ctx.stroke();
    y += 30;
    // 名言（フィット＋はみ出しは…で省略）
    let qf = 24, ql = [];
    while (qf >= 17) { ctx.font = `500 ${qf}px "Shippori Mincho", serif`; ql = wrapJa(ctx, q.quote, maxW); if (ql.length * qf * 1.7 <= (878 - y)) break; qf -= 1; }
    const maxLines = Math.max(1, Math.floor((878 - y) / (qf * 1.7)));
    if (ql.length > maxLines) { ql = ql.slice(0, maxLines); ql[maxLines - 1] = ql[maxLines - 1].slice(0, -1) + '…'; }
    ctx.fillStyle = PARCH; ctx.font = `500 ${qf}px "Shippori Mincho", serif`;
    for (const ln of ql) { ctx.fillText(ln, cx, y); y += qf * 1.7; }
  }

  function drawVS(ctx, cx, cy, GOLD, GOLDB) {
    ctx.save();
    ctx.beginPath(); ctx.moveTo(cx, cy - 46); ctx.lineTo(cx + 40, cy); ctx.lineTo(cx, cy + 46); ctx.lineTo(cx - 40, cy); ctx.closePath();
    ctx.fillStyle = '#0c1330'; ctx.fill();
    ctx.strokeStyle = GOLD; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = GOLDB; ctx.font = '700 34px "Cormorant Garamond", serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('VS', cx, cy + 1);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  function setLS(ctx, px) { try { ctx.letterSpacing = px + 'px'; } catch (e) {} }

  function drawEmblem(ctx, cx, cy, color) {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(cx, cy, 30, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.moveTo(cx, cy - 30); ctx.lineTo(cx, cy + 30); ctx.moveTo(cx - 30, cy); ctx.lineTo(cx + 30, cy); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.moveTo(cx, cy - 30); ctx.lineTo(cx + 12, cy); ctx.lineTo(cx, cy + 30); ctx.lineTo(cx - 12, cy); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function decoDivider(ctx, cx, y, color) {
    ctx.save();
    ctx.strokeStyle = hexA(color, 0.5); ctx.fillStyle = color; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - 130, y); ctx.lineTo(cx - 16, y); ctx.moveTo(cx + 16, y); ctx.lineTo(cx + 130, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, y - 5); ctx.lineTo(cx + 5, y); ctx.lineTo(cx, y + 5); ctx.lineTo(cx - 5, y); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  /* 日本語の行折り返し（文字単位・約物の行頭禁則を簡易対応） */
  function wrapJa(ctx, text, maxWidth) {
    const noHead = '、。，．）」』】〉》ー…！？';
    const lines = [];
    let line = '';
    for (const ch of text) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line !== '') {
        if (noHead.includes(ch)) { line = test; }
        else { lines.push(line); line = ch; }
      } else { line = test; }
    }
    if (line) lines.push(line);
    return lines;
  }

  /* ---------------------------------------------------------------
   * 背景：放射状サンバースト＋星屑
   * ------------------------------------------------------------- */
  function initBackground() {
    const setHTML = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
    const pt = (n) => n.toFixed(1);

    let rays = '';
    for (let i = 0; i < 48; i++) {
      const a = i * (360 / 48) * Math.PI / 180;
      rays += `<line x1="${pt(500 + Math.cos(a) * 125)}" y1="${pt(500 + Math.sin(a) * 125)}" x2="${pt(500 + Math.cos(a) * 470)}" y2="${pt(500 + Math.sin(a) * 470)}"/>`;
    }
    setHTML('rays', rays);

    let dia = '';
    for (let j = 0; j < 24; j++) {
      const a = j * (360 / 24) * Math.PI / 180, cx = 500 + Math.cos(a) * 300, cy = 500 + Math.sin(a) * 300;
      dia += `<path d="M${pt(cx)} ${pt(cy - 15)} L${pt(cx + 10)} ${pt(cy)} L${pt(cx)} ${pt(cy + 15)} L${pt(cx - 10)} ${pt(cy)} Z"/>`;
    }
    setHTML('diamonds', dia);

    let fan = '';
    for (let k = 0; k < 16; k++) {
      const a = k * (360 / 16) * Math.PI / 180, ex = 500 + Math.cos(a) * 440, ey = 500 + Math.sin(a) * 440;
      fan += `<path d="M500 500 L${pt(ex)} ${pt(ey)}"/>`;
    }
    setHTML('fan', fan);

    let sd = '';
    for (let m = 0; m < 8; m++) {
      const a = m * (360 / 8) * Math.PI / 180, sx = 500 + Math.cos(a) * 410, sy = 500 + Math.sin(a) * 410;
      sd += `<path d="M${pt(sx)} ${pt(sy - 12)} L${pt(sx + 4)} ${pt(sy - 4)} L${pt(sx + 12)} ${pt(sy)} L${pt(sx + 4)} ${pt(sy + 4)} L${pt(sx)} ${pt(sy + 12)} L${pt(sx - 4)} ${pt(sy + 4)} L${pt(sx - 12)} ${pt(sy)} L${pt(sx - 4)} ${pt(sy - 4)} Z"/>`;
    }
    setHTML('starsDeco', sd);

    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cv = document.getElementById('stars');
    if (reduce || !cv) return;
    const ctx = cv.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let stars = [];
    function resize() {
      cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
      cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(innerWidth * innerHeight / 9000);
      stars = [];
      for (let i = 0; i < count; i++) {
        stars.push({
          x: Math.random() * innerWidth, y: Math.random() * innerHeight,
          r: Math.random() * 1.3 + 0.3, base: Math.random() * 0.5 + 0.15,
          amp: Math.random() * 0.5 + 0.3, sp: Math.random() * 0.9 + 0.25,
          ph: Math.random() * Math.PI * 2, gold: Math.random() < 0.55,
        });
      }
    }
    function frame(t) {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      const s = t * 0.001;
      for (const st of stars) {
        let tw = st.base + st.amp * (0.5 + 0.5 * Math.sin(s * st.sp + st.ph));
        if (tw < 0) tw = 0;
        ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
        ctx.fillStyle = st.gold ? `rgba(243,216,152,${tw.toFixed(3)})` : `rgba(220,230,255,${tw.toFixed(3)})`;
        ctx.fill();
      }
      requestAnimationFrame(frame);
    }
    resize();
    window.addEventListener('resize', resize);
    requestAnimationFrame(frame);
  }

  /* ---------------------------------------------------------------
   * ユーティリティ
   * ------------------------------------------------------------- */
  function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function hexA(hex, a) { const { r, g, b } = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }

  let toastTimer = null;
  function toast(msg) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  /* ---------------------------------------------------------------
   * メイン操作
   * ------------------------------------------------------------- */
  function ask() {
    const worry = els.worry.value.trim();
    if (!worry) { toast('まず、悩みを書いてください'); els.worry.focus(); return; }
    state.worry = worry;
    const { scored, themeKey } = scoreAll(worry);
    state.scored = scored;
    state.themeKey = themeKey;
    state.grief = isGrief(worry);
    const quotes = pickTop(scored, NUM_CARDS, true);
    showResult(themeKey, quotes);
    updateHash(themeKey, quotes, worry);
  }

  els.composer.addEventListener('submit', (e) => { e.preventDefault(); ask(); });
  els.worry.addEventListener('input', () => { els.count.textContent = els.worry.value.length; });
  els.worry.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); ask(); }
  });
  els.chips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip-ex');
    if (!chip) return;
    els.worry.value = chip.textContent;
    els.count.textContent = els.worry.value.length;
    ask();
  });

  els.rerollBtn.addEventListener('click', () => {
    if (!state.scored) return;
    const quotes = pickTop(state.scored, NUM_CARDS, false);
    showResult(state.themeKey, quotes, { scroll: false });
    updateHash(state.themeKey, quotes, state.worry);
  });
  if (els.battleBtn) els.battleBtn.addEventListener('click', () => {
    if (!state.scored) { toast('まず悩みを入力してください'); return; }
    const pair = pickBattle(state.scored);
    if (pair) renderBattle(pair); else toast('対決できる相手が見つかりませんでした');
  });
  if (els.dailyOpen) els.dailyOpen.addEventListener('click', () => {
    const q = dailyQuote();
    state.worry = '';
    showSingle(q, `🌅 <span class="hl">今日の賢者</span>　${escapeHTML(PHILOSOPHERS[q.phil].name)}`, false);
  });
  els.copyLinkBtn.addEventListener('click', copyResultLink);
  els.favOpen.addEventListener('click', showFavorites);

  els.resetBtn.addEventListener('click', () => {
    els.results.hidden = true;
    els.worry.value = '';
    els.count.textContent = '0';
    state.mode = 'result';
    try { history.replaceState(null, '', BASE_URL); } catch {}
    updateFavUI();
    els.hero.scrollIntoView({ behavior: 'smooth', block: 'start' });
    els.worry.focus();
  });

  /* 日替わりパネルの初期化（今日の賢者＋連続来訪） */
  function initDaily() {
    if (!els.daily) return;
    const q = dailyQuote(), p = PHILOSOPHERS[q.phil];
    const s = updateStreak();
    els.dailyHook.textContent = q.hook || q.quote;
    els.dailyName.textContent = '— ' + p.name;
    if (s.count >= 2) {
      els.dailyStreak.hidden = false;
      els.dailyStreak.textContent = `${s.count}日連続`;
    } else {
      els.dailyStreak.hidden = true;
    }
    els.daily.hidden = false;
  }

  /* 起動 */
  function boot() {
    initBackground();
    updateFavUI();
    initDaily();
    const fromHash = parseHash();
    if (fromHash) {
      if (fromHash.worry) { els.worry.value = fromHash.worry; els.count.textContent = fromHash.worry.length; }
      state.worry = fromHash.worry;
      state.themeKey = fromHash.themeKey;
      state.scored = fromHash.worry ? scoreAll(fromHash.worry).scored : scoredByTheme(fromHash.themeKey);
      showResult(fromHash.themeKey, fromHash.quotes);
    }
  }
  boot();
})();
