/* 共享组件：浮层、提示、卡片、列表行、骨架、状态块 */
(function () {
  'use strict';

  var OD = window.OD;
  var overlayRoot = document.getElementById('overlay-root');
  var toastRoot = document.getElementById('toast-root');
  var openOverlays = [];

  /* ---------- 提示 ---------- */
  function toast(tone, title, text) {
    var iconName = { ok: 'checkCircle', warn: 'alertTriangle', error: 'alert', info: 'info' }[tone] || 'info';
    var node = U.el(
      '<div class="toast" data-tone="' + tone + '" role="' + (tone === 'error' ? 'alert' : 'status') + '">' +
        icon(iconName, { size: 18 }) +
        '<div class="toast-body">' +
          '<span class="toast-title">' + U.esc(title) + '</span>' +
          (text ? '<span class="toast-text">' + U.esc(text) + '</span>' : '') +
        '</div>' +
      '</div>'
    );
    toastRoot.appendChild(node);
    setTimeout(function () {
      node.style.transition = 'opacity var(--dur-base) var(--ease-out), translate var(--dur-base) var(--ease-out)';
      node.style.opacity = '0';
      node.style.translate = '0 8px';
      setTimeout(function () { node.remove(); }, 240);
    }, 4200);
  }

  /* ---------- 浮层 ---------- */
  function closeTop() {
    var top = openOverlays[openOverlays.length - 1];
    if (top) top.close();
  }

  function mount(opts) {
    var scrim = U.el('<div class="scrim" data-variant="' + (opts.variant || 'center') + '">' + opts.html + '</div>');
    overlayRoot.appendChild(scrim);
    var panel = scrim.firstElementChild;
    var released = null;

    function close(result) {
      var top = openOverlays[openOverlays.length - 1];
      if (!top || top.node !== scrim) return;
      openOverlays.pop();
      if (released) released();
      scrim.style.transition = 'opacity var(--dur-fast) var(--ease-out)';
      scrim.style.opacity = '0';
      panel.style.transition = 'opacity var(--dur-fast) var(--ease-out), translate var(--dur-fast) var(--ease-out)';
      panel.style.opacity = '0';
      panel.style.translate = '0 6px';
      setTimeout(function () { scrim.remove(); }, 160);
      if (opts.onClose) opts.onClose(result);
    }

    openOverlays.push({ node: scrim, close: close });

    scrim.addEventListener('mousedown', function (e) {
      if (e.target === scrim) close(null);
    });

    released = U.trapFocus(panel, function () { close(null); });
    if (opts.onMount) opts.onMount(panel, close);

    return { panel: panel, close: close, node: scrim };
  }

  function modal(opts) {
    var foot = opts.footer ? '<div class="modal-foot">' + opts.footer + '</div>' : '';
    return mount({
      variant: 'center',
      html:
        '<div class="modal' + (opts.size === 'wide' ? ' modal-wide' : '') + (opts.flush ? ' modal-flush' : '') + '" role="dialog" aria-modal="true" aria-label="' + U.esc(opts.title) + '">' +
          '<div class="modal-head">' +
            '<div class="modal-head-text">' +
              '<span class="modal-title">' + U.esc(opts.title) + '</span>' +
              (opts.desc ? '<span class="modal-desc">' + U.esc(opts.desc) + '</span>' : '') +
            '</div>' +
            '<button class="icon-btn sm" data-act="close" aria-label="关闭">' + icon('x', { size: 16 }) + '</button>' +
          '</div>' +
          '<div class="modal-body' + (opts.flush ? ' flush' : '') + '">' + opts.body + '</div>' +
          foot +
        '</div>',
      onMount: function (panel, close) {
        U.bind(panel, { close: close });
        if (opts.onMount) opts.onMount(panel, close);
      },
      onClose: opts.onClose
    });
  }

  function confirm(opts) {
    return modal({
      title: opts.title,
      desc: opts.desc,
      body:
        '<p class="t-small t-muted" style="line-height:1.7">' + U.esc(opts.text || '') + '</p>' +
        (opts.detail
          ? '<div class="banner" data-tone="warn">' + icon('alertTriangle', { size: 18 }) +
              '<div class="banner-body">' +
                '<span class="banner-title">' + U.esc(opts.detailTitle || '影响范围') + '</span>' +
                '<span>' + U.esc(opts.detail) + '</span>' +
              '</div></div>'
          : ''),
      footer:
        '<div class="spacer" style="flex:1"></div>' +
        '<button class="btn btn-secondary" data-act="cancel">取消</button>' +
        '<button class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '" data-act="ok">' + U.esc(opts.okLabel || '确认') + '</button>',
      onMount: function (panel, close) {
        U.bind(panel, {
          cancel: function () { close(); },
          ok: function () { close(); if (opts.onOk) opts.onOk(); }
        });
      }
    });
  }

  /* 上下文菜单：锚定触发元素，超出视口自动翻转 */
  function menu(anchor, items) {
    var rect = anchor.getBoundingClientRect();
    var node = U.el('<div class="menu" role="menu"></div>');
    items.forEach(function (it) {
      if (it.sep) { node.appendChild(U.el('<div class="menu-sep"></div>')); return; }
      var btn = U.el(
        '<button class="menu-item" role="menuitemradio" aria-checked="' + !!it.checked + '">' +
          '<svg class="check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            (it.checked ? '<path d="m5 12.5 4.5 4.5L19 7"/>' : '') +
          '</svg>' +
          '<span class="od-truncate">' + U.esc(it.label) + '</span>' +
          '<span class="spacer"></span>' +
          (it.hint ? '<span class="menu-hint">' + U.esc(it.hint) + '</span>' : '') +
        '</button>'
      );
      btn.addEventListener('click', function () { close(); if (it.onPick) it.onPick(); });
      node.appendChild(btn);
    });
    document.body.appendChild(node);

    var w = node.offsetWidth || 200, h = node.offsetHeight || 160;
    var left = Math.max(12, Math.min(rect.left, window.innerWidth - w - 12));
    var top = rect.bottom + 6;
    if (top + h > window.innerHeight - 12) top = Math.max(12, rect.top - h - 6);
    node.style.left = left + 'px';
    node.style.top = top + 'px';

    function onDoc(e) { if (!node.contains(e.target)) close(); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    function close() {
      node.remove();
      document.removeEventListener('mousedown', onDoc, true);
      document.removeEventListener('keydown', onKey, true);
    }
    setTimeout(function () {
      document.addEventListener('mousedown', onDoc, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);
    var first = node.querySelector('.menu-item');
    if (first) first.focus();
    return close;
  }

  /* ---------- 状态块与骨架 ---------- */
  function stateBlock(opts) {
    return '<div class="state-block">' +
      '<span class="state-glyph" data-tone="' + (opts.tone || 'idle') + '">' + icon(opts.icon || 'inbox', { size: 24 }) + '</span>' +
      '<span class="state-title">' + U.esc(opts.title) + '</span>' +
      '<span class="state-text">' + U.esc(opts.text) + '</span>' +
      (opts.actions && opts.actions.length
        ? '<div class="state-actions">' + opts.actions.map(function (a) {
            return '<button class="btn ' + (a.kind === 'primary' ? 'btn-primary' : 'btn-secondary') + '" data-act="' + a.act + '">' +
              (a.icon ? icon(a.icon, { size: 16 }) : '') + U.esc(a.label) + '</button>';
          }).join('') + '</div>'
        : '') +
    '</div>';
  }

  function skeletonRows(n) {
    var out = [];
    for (var i = 0; i < (n || 6); i++) {
      out.push('<div class="list-row">' +
        '<span class="skeleton" style="width:6px;height:6px;border-radius:50%;margin-top:8px"></span>' +
        '<div class="list-body">' +
          '<span class="skeleton sk-line sk-title"></span>' +
          '<span class="skeleton sk-line" style="width:88%"></span>' +
          '<span class="skeleton sk-line" style="width:40%"></span>' +
        '</div>' +
        '<span class="skeleton list-thumb"></span>' +
      '</div>');
    }
    return out.join('');
  }

  function skeletonCards(n) {
    var out = [];
    for (var i = 0; i < (n || 8); i++) {
      out.push('<div class="card">' +
        '<span class="skeleton sk-thumb" style="aspect-ratio:16/9;border-radius:0"></span>' +
        '<div class="card-body">' +
          '<span class="skeleton sk-line" style="width:92%"></span>' +
          '<span class="skeleton sk-line" style="width:64%"></span>' +
          '<span class="skeleton sk-line" style="width:38%"></span>' +
        '</div>' +
      '</div>');
    }
    return out.join('');
  }

  /* ---------- 通用片段 ---------- */
  function platformMark(platform, size) {
    var names = {
      bilibili: 'bilibili', youtube: 'youtube', weibo: 'weibo', xiaohongshu: 'xiaohongshu',
      douyu: 'douyu', huya: 'huya', podcast: 'podcast', music: 'music', rss: 'rss', rsshub: 'rsshub',
      douyin: 'live'
    };
    return icon(names[platform] || 'rss', { size: size || 16 });
  }

  /* 各类条目的图片字段不同：媒体用 cover（字符串），文章用 image（{file,w,h} 对象），
     社交用 images[0].src。统一归一化成可用作 src 的字符串，否则对象会被 esc 成 "[object Object]"。 */
  function mediaUrl(item) {
    var v = item.cover || item.image || (item.images && item.images[0] && item.images[0].src);
    if (!v) return null;
    return typeof v === 'string' ? v : (v.file || v.src || null);
  }

  /* 图片真实宽高：优先查构建期实测的 assetSizes，其次文章自带的 image.{w,h}。
     注意 social.images[0].ratio 存的是高/宽，方向与 CSS aspect-ratio（宽/高）相反，
     直接当比例用会把竖图压成横图——必须换算。 */
  function imgSize(src, item) {
    var a = (typeof OD_CONTENT !== 'undefined' && OD_CONTENT.assetSizes) || {};
    var s = src ? a[src] : null;
    if (s && s.w && s.h) return { w: s.w, h: s.h };
    if (item && item.image && item.image.w && item.image.h) return { w: item.image.w, h: item.image.h };
    return null;
  }

  /* 宽/高，用于按原比例渲染（不裁切） */
  function ratioOf(item) {
    if (item.coverRatio) return item.coverRatio;
    var s = imgSize(mediaUrl(item), item);
    return s ? s.w / s.h : 1.778;
  }

  /* 卡片图统一到同一条 16:9 带：网格与横排轨道才不会因源比例不一而高低错落。
     裁切属刻意为之（目录式缩略图），正文与详情页仍是完整原图。 */
  function cover(item, overlay, alt) {
    var src = mediaUrl(item);
    if (!src) {
      return '<span class="card-media" style="aspect-ratio:16 / 9">' +
        '<span class="cover-missing">' + icon('image', { size: 22 }) + '</span>' +
      '</span>';
    }
    return '<span class="card-media" style="aspect-ratio:16 / 9">' +
      '<img src="' + U.esc(src) + '" alt="' + U.esc(alt || '') + '" loading="lazy" decoding="async">' +
      (overlay || '') +
    '</span>';
  }

  function readStar(item) {
    var st = OD.store.state;
    return {
      read: !!st.read[item.id],
      starred: !!st.starred[item.id]
    };
  }

  function actionsCell(item, s) {
    return '<button class="icon-btn sm" data-act="star" data-id="' + item.id + '" aria-label="' +
        (s.starred ? '取消星标' : '加星标') + '" aria-pressed="' + s.starred + '">' +
        (s.starred ? icon.solid('star', { size: 14 }) : icon('star', { size: 14 })) + '</button>' +
      '<button class="icon-btn sm" data-act="toggleRead" data-id="' + item.id + '" aria-label="' +
        (s.read ? '标为未读' : '标为已读') + '">' + icon(s.read ? 'eyeOff' : 'eye', { size: 14 }) + '</button>';
  }

  /* ---------- 卡片 ---------- */
  function mediaCard(item) {
    var s = readStar(item);
    var overlay = '';
    if (item.kind === 'video' || item.kind === 'audio') {
      overlay = '<span class="card-play"><span>' + icon.solid('play', { size: 20 }) + '</span></span>' +
        (item.kind === 'audio' && item.duration
          ? '<span class="card-duration num">' + U.esc(item.duration) + '</span>'
          : '');
    }
    if (item.kind === 'live') {
      overlay = '<span class="live-pulse"><span class="status-dot" data-state="live"></span>直播中</span>' +
        '<span class="live-online num">' + U.count(item.online) + ' 人在看</span>' +
        '<span class="card-play"><span>' + icon.solid('play', { size: 20 }) + '</span></span>';
    } else if (item.duration) {
      overlay += '<span class="card-duration num">' + U.esc(item.duration) + '</span>';
    }

    var meta = [];
    if (item.kind === 'video') {
      meta.push(U.count(item.views) + ' 次播放');
      if (item.quality) meta.push(item.quality);
    } else if (item.kind === 'audio') {
      meta.push(item.genre || '播客');
      if (item.episodes) meta.push(item.episodes + ' 集');
    } else if (item.kind === 'live') {
      meta.push(item.area || '综合');
    }

    return '<article class="card' + (item.kind === 'live' ? ' live-card' : '') + '" data-act="open" data-id="' + item.id +
        '" tabindex="0" role="button" data-act-enter="open" aria-label="' + U.esc((item.kind === 'live' ? '直播：' : '') + item.title) + '">' +
      cover(item, overlay, item.title) +
      '<div class="card-body">' +
        '<h3 class="card-title od-clamp-2">' + U.esc(item.title) + '</h3>' +
        '<div class="card-meta">' +
          '<span class="od-truncate">' + U.esc(item.author) + '</span>' +
          '<span class="dot-sep"></span>' +
          '<span>' + U.timeAgo(item.publishedAt) + '</span>' +
        '</div>' +
        (meta.length
          ? '<div class="card-meta">' + meta.map(function (m, i) {
              return (i ? '<span class="dot-sep"></span>' : '') + '<span class="num">' + U.esc(m) + '</span>';
            }).join('') + '</div>'
          : '') +
        '<div class="card-foot">' +
          '<span class="od-truncate">' + U.esc(item.source) + '</span>' +
          '<span class="spacer"></span>' +
          actionsCell(item, s) +
        '</div>' +
      '</div>' +
    '</article>';
  }

  /* 紧凑卡：用于「来自同一订阅」与词下内容流；正文与主网格同构，只是信息更少 */
  function cardMini(item, act) {
    var s = readStar(item);
    var isLive = item.kind === 'live';
    return '<article class="card" data-act="' + (act || 'open') + '" data-id="' + item.id + '" tabindex="0" ' +
        'role="button" data-act-enter="' + (act || 'open') + '">' +
      cover(item, isLive
        ? '<span class="live-pulse"><span class="status-dot" data-state="live"></span>直播中</span>'
        : (item.kind === 'video' || item.kind === 'audio'
            ? '<span class="card-play"><span>' + icon.solid('play', { size: 18 }) + '</span></span>' +
              (item.duration ? '<span class="card-duration num">' + U.esc(item.duration) + '</span>' : '')
            : ''), item.title) +
      '<div class="card-body">' +
        '<h3 class="card-title od-clamp-2">' + U.esc(item.title) + '</h3>' +
        '<div class="card-meta">' +
          '<span class="od-truncate">' + U.esc(item.author) + '</span>' +
          '<span class="dot-sep"></span>' +
          '<span>' + U.timeAgo(item.publishedAt) + '</span>' +
        '</div>' +
        (isLive
          ? '<div class="card-foot"><span class="od-truncate">' + U.esc(item.area || '综合') + '</span>' +
              '<span class="spacer"></span><span class="num">' + U.count(item.online) + ' 在看</span></div>'
          : '') +
      '</div>' +
    '</article>';
  }

  function socialCard(item) {
    var img = item.images && item.images[0];
    var media = '';
    if (img) {
      // 竖图在瀑布流里过高会把一列拉得很长，给比例设一个下限；同时按实测宽高预留位
      var r = Math.max(ratioOf(item), 0.66);
      media = '<span class="social-media">' +
        '<img src="' + U.esc(img.src) + '" alt="' + U.esc(U.clip(item.title || item.desc, 40)) + '" ' +
          'loading="lazy" decoding="async" style="aspect-ratio:' + r.toFixed(4) + '">' +
        (item.video ? '<span class="social-video-badge">' + icon.solid('play', { size: 11 }) + '视频</span>' : '') +
      '</span>';
    }
    return '<article class="social-card" data-act="openSocial" data-id="' + item.id + '" tabindex="0" role="button" data-act-enter="openSocial">' +
      media +
      '<div class="social-body">' +
        '<p class="social-title od-clamp-3">' + U.esc(item.desc || item.title) + '</p>' +
        (item.tags && item.tags.length
          ? '<div class="social-tags">' + item.tags.slice(0, 3).map(function (t) {
              return '<span class="tag">' + U.esc(String(t).replace(/#/g, '')) + '</span>';
            }).join('') + '</div>'
          : '') +
        '<div class="social-foot">' +
          '<span class="social-author">' +
            (item.avatar
              ? '<img class="social-avatar" src="' + U.esc(item.avatar) + '" alt="" loading="lazy" width="20" height="20">'
              : '<span class="social-avatar social-avatar-letter">' + U.esc((item.author || '?').slice(0, 1)) + '</span>') +
            '<span class="social-author-name od-truncate">' + U.esc(item.author) + '</span>' +
          '</span>' +
          '<span class="social-stats">' +
            '<span>' + icon('heart', { size: 12 }) + '<span class="num">' + U.esc(item.likes) + '</span></span>' +
            '<span>' + icon('message', { size: 12 }) + '<span class="num">' + U.esc(item.comments) + '</span></span>' +
          '</span>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function listRow(item, activeId) {
    var s = readStar(item);
    return '<article class="list-row" data-read="' + s.read + '"' + (activeId === item.id ? ' aria-current="true"' : '') +
        ' data-act="openArticle" data-id="' + item.id + '" tabindex="0" role="button" data-act-enter="openArticle">' +
      '<span class="unread-dot" data-read="' + s.read + '" title="' + (s.read ? '已读' : '未读') + '"></span>' +
      '<div class="list-body">' +
        '<h3 class="list-title od-clamp-2">' + U.esc(item.title) + '</h3>' +
        '<p class="list-excerpt od-clamp-2">' + U.esc(U.clip(item.excerpt, 96)) + '</p>' +
        '<div class="list-meta">' +
          '<span>' + U.esc(item.source) + '</span>' +
          '<span class="dot-sep"></span>' +
          '<span>' + U.timeAgo(item.publishedAt) + '</span>' +
          '<span class="dot-sep"></span>' +
          '<span class="num">' + (item.readMin || 3) + ' 分钟</span>' +
        '</div>' +
      '</div>' +
      (mediaUrl(item) ? '<span class="list-thumb"><img src="' + U.esc(mediaUrl(item)) + '" alt="" loading="lazy" decoding="async"></span>' : '') +
      '<div class="list-actions">' + actionsCell(item, s) + '</div>' +
    '</article>';
  }

  function hotRow(w, active) {
    return '<button class="hot-row" data-act="pickHot" data-word="' + U.esc(w.word) + '"' + (active ? ' aria-current="true"' : '') + '>' +
      '<span class="hot-rank num"' + (w.rank <= 3 ? ' data-top="true"' : '') + '>' + w.rank + '</span>' +
      '<span class="hot-body">' +
        '<span class="hot-word od-truncate">' + U.esc(w.word) + '</span>' +
        '<span class="hot-heat num">热度 ' + U.count(w.heat) + (w.label ? ' · ' + U.esc(w.label) : '') + '</span>' +
      '</span>' +
      icon('external', { size: 14 }) +
    '</button>';
  }

  function settingRow(key, label, help, control) {
    return '<div class="setting-row">' +
      '<div class="setting-text">' +
        '<span class="setting-label" id="lbl-' + key + '">' + U.esc(label) + '</span>' +
        (help ? '<span class="setting-help">' + U.esc(help) + '</span>' : '') +
      '</div>' +
      '<div class="setting-control">' + control + '</div>' +
    '</div>';
  }

  OD.toast = toast;
  OD.ui = {
    modal: modal, confirm: confirm, menu: menu, mount: mount, closeTop: closeTop,
    stateBlock: stateBlock, skeletonRows: skeletonRows, skeletonCards: skeletonCards,
    platformMark: platformMark, cover: cover, mediaUrl: mediaUrl, ratioOf: ratioOf,
    imgSize: imgSize, readStar: readStar,
    mediaCard: mediaCard, cardMini: cardMini, socialCard: socialCard,
    listRow: listRow, hotRow: hotRow, settingRow: settingRow, icon: icon
  };
  window.icon = icon;
})();
