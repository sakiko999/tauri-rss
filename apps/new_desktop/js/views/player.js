/* 播放页：舞台、播放控制、档位与倍速、直播边缘、弹幕层、播放队列、mpv 入口。
   播放区为界面演示：使用条目的真实封面作为画面，弹幕为演示语料并已标注。 */
(function () {
  'use strict';

  var OD = window.OD;
  var S = function () { return OD.store.state; };
  /* 封面字段按 kind 形状不同，统一走归一化，避免把对象写进 src */
  var poster = function (i) { return OD.ui.mediaUrl(i); };

  var stageState = { t: 0, duration: 0, buffered: 0, timer: null };

  /* 弹幕语料：由条目标题与平台常见用语派生，属演示数据 */
  function danmakuPool(item) {
    var pool = [];
    item.title.replace(/[「」【】\[\]（）()·|，。、：]/g, ' ')
      .split(/\s+/)
      .filter(function (w) { return w.length >= 2 && w.length <= 6; })
      .slice(0, 6)
      .forEach(function (w) { pool.push(w); });

    pool = pool.concat([
      '画质不错', '声音有点小', '前排围观', '这段真好', '来了来了',
      '求个时间轴', '已三连', '讲得清楚', '这个字幕好评', '弹幕走一波',
      '哈哈哈哈哈', 'up 加油', '收藏了', '第一遍没看懂，再看一次'
    ]);
    if (item.platform === 'bilibili') pool = pool.concat(['B站打卡', '三连支持', '币已投']);
    if (item.platform === 'douyu' || item.platform === 'huya') pool = pool.concat(['666', '主播加油', '这波操作秀']);
    if (item.kind === 'live') pool = pool.concat(['刚进来，什么情况', '已经关注了', '直播间人不少']);
    return pool;
  }

  function seeded(seed) {
    var x = seed || 1;
    return function () {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      return x / 0x7fffffff;
    };
  }

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
    return h ? h + ':' + mm + ':' + ss : m + ':' + ss;
  }

  function parseDur(d) {
    if (!d) return 600;
    var p = String(d).split(':').map(Number);
    if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
    if (p.length === 2) return p[0] * 60 + p[1];
    return 600;
  }

  /* =====================================================================
     舞台
     ===================================================================== */
  function stage(item) {
    var st = S();
    var s = st.settings;
    var isLive = item.kind === 'live';
    stageState.duration = isLive ? 0 : parseDur(item.duration);
    stageState.buffered = stageState.duration * 0.86;
    if (isLive) stageState.t = Math.max(stageState.t, 0);
    var quality = st.quality || (item.qualities ? item.qualities[0] : item.quality || '原画');

    return '<div class="stage" id="stage" data-idle="false" tabindex="0" aria-label="播放区域，空格键播放暂停">' +
      '<div class="stage-media">' +
        (poster(item)
          ? '<img src="' + U.esc(poster(item)) + '" alt="' + U.esc(U.clip(item.title, 40)) + '" decoding="async">'
          : '') +
        '<span class="stage-poster-scrim"></span>' +
        renderDanmakuLayer(st) +
        (st.playing
          ? ''
          : '<div class="stage-center">' +
              '<button class="stage-bigplay" data-act="togglePlay" aria-label="播放">' + icon.solid('play', { size: 28 }) + '</button>' +
              '<span class="stage-hint">' + (isLive ? '点击接入直播流' : '点击开始播放') + '</span>' +
            '</div>') +
        stageControls(item, quality) +
      '</div>' +
    '</div>';
  }

  function renderDanmakuLayer(st) {
    var on = OD.store.danmakuOn();
    return '<div class="danmaku-layer" id="danmaku" data-opacity="' + (st.settings.danmakuOpacity / 100) + '"' +
      (on ? '' : ' hidden') + ' aria-hidden="true"></div>';
  }

  function stageControls(item, quality) {
    var st = S();
    var isLive = item.kind === 'live';
    var total = stageState.duration;
    var pct = isLive ? 100 : (total ? Math.min(100, (stageState.t / total) * 100) : 0);
    var bufPct = isLive ? 100 : (total ? Math.min(100, (stageState.buffered / total) * 100) : 0);
    var atEdge = isLive && stageState.t < (window.__liveLen || 0) - 5;

    return '<div class="stage-controls">' +
      '<div class="stage-cbar stage-cbar-top">' +
        (isLive ? '<span class="tag tag-live">' + icon('live', { size: 12 }) + '直播中</span>' : '') +
        (atEdge ? '<button class="pctrl pctrl-text" data-act="liveEdge">' + icon('live', { size: 14 }) + '回直播</button>' : '') +
        '<div class="stage-cbar-rail">' +
          (isLive ? '' : '<span class="ptime num" id="t-cur">' + fmt(stageState.t) + '</span>') +
          '<div class="seek" role="slider" tabindex="0" aria-label="播放进度" aria-valuemin="0" ' +
            'aria-valuemax="' + Math.round(total) + '" aria-valuenow="' + Math.round(stageState.t) + '" data-act="seek">' +
            '<span class="seek-track">' +
              '<span class="seek-buffer" style="width:' + bufPct + '%"></span>' +
              '<span class="seek-fill" id="seek-fill" style="width:' + pct + '%"></span>' +
            '</span>' +
            '<span class="seek-knob" id="seek-knob" style="left:' + pct + '%"></span>' +
          '</div>' +
          '<span class="ptime num" id="t-total">' + (isLive ? '实时' : fmt(total)) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="stage-cbar">' +
        '<button class="pctrl" data-act="prev" aria-label="队列上一个">' + icon('skip', { size: 18, class: 'flip' }) + '</button>' +
        '<button class="pctrl" data-act="togglePlay" aria-label="' + (st.playing ? '暂停' : '播放') + '">' +
          (st.playing ? icon.solid('pause', { size: 20 }) : icon.solid('play', { size: 20 })) + '</button>' +
        '<button class="pctrl" data-act="next" aria-label="队列下一个">' + icon('skip', { size: 18 }) + '</button>' +
        '<span class="volume">' +
          '<button class="pctrl" data-act="toggleMute" aria-label="' + (st.muted ? '取消静音' : '静音') + '">' +
            icon(st.muted || st.volume === 0 ? 'mute' : 'volume', { size: 18 }) + '</button>' +
          '<input type="range" min="0" max="100" value="' + Math.round(st.volume * 100) + '" data-act="volume" aria-label="音量">' +
        '</span>' +
        '<span class="spacer"></span>' +
        (item.kind === 'live'
          ? ''
          : '<button class="pctrl pctrl-text" data-act="rateMenu" aria-label="播放速度">' + st.rate + '×</button>') +
        (item.qualities
          ? '<button class="pctrl pctrl-text" data-act="qualityMenu" aria-label="清晰度">' + U.esc(quality) + '</button>'
          : '') +
        '<button class="pctrl" data-act="toggleDanmaku" aria-label="弹幕开关" aria-pressed="' + OD.store.danmakuOn() + '">' +
          icon('danmaku', { size: 18 }) + '</button>' +
        '<button class="pctrl" data-act="danmakuSettings" aria-label="弹幕设置">' + icon('settings', { size: 18 }) + '</button>' +
        '<button class="pctrl" data-act="toggleFullscreen" aria-label="全屏">' + icon('fullscreen', { size: 18 }) + '</button>' +
      '</div>' +
    '</div>';
  }

  /* =====================================================================
     播放页主体
     ===================================================================== */
  function playerView(item) {
    var st = S();
    var sub = OD.store.subsById()[item.subId];
    var queueItems = st.queue.map(function (id) { return OD.store.itemsById(id); }).filter(Boolean);
    var related = OD.store.baseFor(sub ? 'sub:' + sub.id : 'tab:all')
      .filter(function (i) { return i.id !== item.id && i.kind === item.kind; })
      .slice(0, 5);

    return '<div class="player-view">' +
      '<div class="detail-head">' +
        '<button class="icon-btn sm" data-act="back" aria-label="返回内容列表" title="返回">' + icon('x', { size: 16 }) + '</button>' +
        '<span class="t-small t-dim od-truncate">' + U.esc(item.source) + '</span>' +
        '<span class="detail-head-spacer"></span>' +
        '<button class="icon-btn sm" data-act="mpvMenu" aria-label="外部播放器" title="用 mpv 播放">' + icon('mpv', { size: 16 }) + '</button>' +
      '</div>' +
      '<div class="scroll-area player-scroll">' +
        '<div class="player-layout">' +
          '<div>' +
            stage(item) +
            '<div class="player-meta">' +
              '<h1 class="player-title">' + U.esc(item.title) + '</h1>' +
              '<div class="player-sub">' +
                '<span>' + U.esc(item.author) + '</span><span class="dot-sep"></span>' +
                '<span>' + U.fullDate(item.publishedAt) + '</span>' +
                (item.views ? '<span class="dot-sep"></span><span class="num">' + U.count(item.views) + ' 次播放</span>' : '') +
                (item.online ? '<span class="dot-sep"></span><span class="num">' + U.count(item.online) + ' 人在看</span>' : '') +
                (item.area ? '<span class="dot-sep"></span><span>' + U.esc(item.area) + '</span>' : '') +
              '</div>' +
              '<div class="player-actions">' +
                '<button class="btn btn-secondary btn-sm" data-act="star" data-id="' + item.id + '">' +
                  (st.starred[item.id] ? icon.solid('star', { size: 14 }) : icon('star', { size: 14 })) +
                  (st.starred[item.id] ? '已星标' : '加星标') + '</button>' +
                '<button class="btn btn-secondary btn-sm" data-act="addQueue" data-id="' + item.id + '">' +
                  icon('queue', { size: 14 }) + '加入队列</button>' +
                '<button class="btn btn-secondary btn-sm" data-act="copyLink" data-id="' + item.id + '">' +
                  icon('copy', { size: 14 }) + '复制链接</button>' +
                '<button class="btn btn-secondary btn-sm" data-act="mpvMenu">' +
                  icon('mpv', { size: 14 }) + (st.settings.mpvEnabled ? '用 mpv 播放' : '外部播放器') + '</button>' +
                '<button class="btn btn-secondary btn-sm" data-act="openOriginal" data-id="' + item.id + '">' +
                  icon('external', { size: 14 }) + '打开源站</button>' +
              '</div>' +
            '</div>' +
            infoCard(item) +
          '</div>' +
          '<aside>' +
            queuePanel(queueItems) +
            (related.length ? relatedPanel(related) : '') +
          '</aside>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function infoCard(item) {
    var lines = [];
    if (item.kind === 'live') {
      lines.push(['平台', { bilibili: '哔哩哔哩', douyu: '斗鱼', huya: '虎牙' }[item.platform] || item.platform]);
      lines.push(['房间', item.url ? item.url.replace(/^https?:\/\//, '') : '—']);
      lines.push(['可见档位', (item.qualities || []).join(' / ')]);
      if (item.anonLimit) lines.push(['匿名限制', item.anonLimit]);
    } else if (item.kind === 'video') {
      lines.push(['平台', { bilibili: '哔哩哔哩', youtube: 'YouTube' }[item.platform] || item.platform]);
      lines.push(['分区', item.category || '—']);
      lines.push(['弹幕', item.danmaku ? U.count(item.danmaku) + ' 条' : '该源无弹幕']);
    } else {
      lines.push(['类型', item.genre || '音频']);
      lines.push(['平台', item.platform || '—']);
    }

    return '<div class="section">' +
      '<div class="side-card">' +
        '<div class="side-card-head">' + icon('info', { size: 16 }) +
          '<span class="side-card-title">播放信息</span></div>' +
        '<div class="side-card-body pad">' +
          lines.map(function (l) {
            return '<div class="info-row">' +
              '<span class="info-key">' + U.esc(l[0]) + '</span>' +
              '<span class="info-val od-truncate">' + U.esc(String(l[1])) + '</span>' +
            '</div>';
          }).join('') +
          '<div class="banner">' + icon('info', { size: 16 }) +
            '<div class="banner-body"><span>播放区为界面演示：画面使用该条目的真实封面，弹幕为演示语料，不代表真实弹幕流。</span></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function queuePanel(items) {
    var st = S();
    return '<div class="side-card">' +
      '<div class="side-card-head">' + icon('queue', { size: 16 }) +
        '<span class="side-card-title">播放队列</span>' +
        '<span class="spacer"></span>' +
        '<span class="t-micro t-dim num">' + items.length + ' 条</span>' +
        '<button class="icon-btn sm" data-act="clearQueue" aria-label="清空队列" title="清空队列">' + icon('trash', { size: 14 }) + '</button>' +
      '</div>' +
      '<div class="side-card-body">' +
        (items.length
          ? items.map(function (i, idx) {
              var on = st.nowPlaying && st.nowPlaying.id === i.id;
              return '<button class="queue-row" data-act="playId" data-id="' + i.id + '"' + (on ? ' aria-current="true"' : '') + '>' +
                '<span class="queue-rank num">' + (idx + 1) + '</span>' +
                '<span class="queue-thumb">' + (poster(i) ? '<img src="' + U.esc(poster(i)) + '" alt="" loading="lazy">' : '') + '</span>' +
                '<span class="queue-body">' +
                  '<span class="queue-title od-truncate">' + U.esc(i.title) + '</span>' +
                  '<span class="queue-sub od-truncate">' + U.esc(i.author) + ' · ' + U.esc(i.duration || '直播') + '</span>' +
                '</span>' +
                (on ? '<span class="queue-flag">' + icon.solid('play', { size: 14 }) + '</span>' : '') +
              '</button>';
            }).join('')
          : '<div class="state-block state-block-tight">' +
              '<span class="state-glyph state-glyph-sm">' + icon('queue', { size: 18 }) + '</span>' +
              '<span class="state-text">队列为空。在任意视频或直播页点「加入队列」即可连播。</span>' +
            '</div>') +
      '</div>' +
    '</div>';
  }

  function relatedPanel(items) {
    return '<div class="side-card">' +
      '<div class="side-card-head">' + icon('layers', { size: 16 }) +
        '<span class="side-card-title">来自同一订阅</span></div>' +
      '<div class="side-card-body">' +
        items.map(function (i) {
          return '<button class="queue-row" data-act="playId" data-id="' + i.id + '">' +
            '<span class="queue-thumb">' + (poster(i) ? '<img src="' + U.esc(poster(i)) + '" alt="" loading="lazy">' : '') + '</span>' +
            '<span class="queue-body">' +
              '<span class="queue-title od-clamp-2">' + U.esc(i.title) + '</span>' +
              '<span class="queue-sub od-truncate">' + U.esc(i.author) + ' · ' + U.timeAgo(i.publishedAt) + '</span>' +
            '</span>' +
          '</button>';
        }).join('') +
      '</div>' +
    '</div>';
  }

  /* =====================================================================
     弹幕引擎：定时发射，暂停冻结，节点被重绘时自动复挂
     ===================================================================== */
  function startDanmaku(item) {
    stopDanmaku();
    var host = document.getElementById('danmaku');
    if (!host) return;

    var pool = danmakuPool(item);
    var rnd = seeded(item.title.length * 977 + item.id.length * 131);
    var settings = S().settings;
    var areaRatio = { quarter: 0.25, half: 0.52, full: 0.86 }[settings.danmakuArea] || 0.52;
    var speedPx = { slow: 62, standard: 92, fast: 130 }[settings.danmakuSpeed] || 92;
    var interval = item.kind === 'live' ? 620 : 900;
    var acc = 0;

    function layer() {
      var n = document.getElementById('danmaku');
      if (n) host = n;
      return host;
    }

    function spawn() {
      var target = layer();
      if (!target || target.hasAttribute('hidden')) return;
      var rect = target.getBoundingClientRect();
      if (!rect.width) return;
      var laneH = settings.danmakuFontSize + 12;
      var lanes = Math.max(2, Math.floor((rect.height * areaRatio) / laneH));
      var lane = Math.floor(rnd() * lanes);
      var text = pool[Math.floor(rnd() * pool.length)];

      var node = document.createElement('span');
      node.className = 'danmaku-item';
      node.textContent = text;
      node.style.top = (8 + lane * laneH) + 'px';
      node.style.fontSize = settings.danmakuFontSize + 'px';
      node.style.opacity = String(settings.danmakuOpacity / 100);
      node.style.left = '0';
      var dist = rect.width + 260;
      var durMs = Math.max(4000, (dist / speedPx) * 1000);
      node.style.setProperty('--dm-from', rect.width + 'px');
      node.style.setProperty('--dm-to', '-240px');
      node.style.animation = 'dm-scroll ' + durMs + 'ms linear forwards';
      target.appendChild(node);
      setTimeout(function () { node.remove(); }, durMs + 80);
    }

    stageState.timer = setInterval(function () {
      if (!S().playing) return;
      if (!OD.store.danmakuOn()) return;
      acc += 120;
      if (acc < interval) return;
      acc = 0;
      spawn();
    }, 120);
  }

  function stopDanmaku() {
    if (stageState.timer) { clearInterval(stageState.timer); stageState.timer = null; }
    var host = document.getElementById('danmaku');
    if (host) host.innerHTML = '';
  }

  function tick() {
    var item = S().nowPlaying;
    if (!item) { stopDanmaku(); return; }
    startDanmaku(item);
  }

  function advance(dt) {
    var item = S().nowPlaying;
    if (!item || !S().playing) return;
    if (item.kind === 'live') {
      stageState.t += dt;
      window.__liveLen = stageState.t;
      return;
    }
    stageState.t += dt * S().rate;
    if (stageState.duration && stageState.t >= stageState.duration) {
      stageState.t = stageState.duration;
      OD.store.actions.setPlaying(false);
    }
    if (stageState.buffered < stageState.t + 30) {
      stageState.buffered = Math.min(stageState.duration, stageState.t + 90);
    }
  }

  function seekTo(ratio) {
    if (!stageState.duration) return;
    stageState.t = Math.max(0, Math.min(stageState.duration, stageState.duration * ratio));
  }

  function seekFromEvent(e, node) {
    var r = node.getBoundingClientRect();
    var x = e.clientX != null ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : r.left);
    seekTo((x - r.left) / r.width);
  }

  OD.views = OD.views || {};
  OD.views.player = {
    playerView: playerView,
    stage: stage,
    startDanmaku: startDanmaku,
    stopDanmaku: stopDanmaku,
    tick: tick,
    advance: advance,
    seekFromEvent: seekFromEvent,
    seekTo: seekTo,
    stageState: stageState,
    fmt: fmt
  };
})();
