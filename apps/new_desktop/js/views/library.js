/* 库视图族：标题栏、侧边导航、文章列表与阅读、媒体网格、社交瀑布流、直播聚合、热搜 */
(function () {
  'use strict';

  var OD = window.OD;
  var S = function () { return OD.store.state; };
  var meta = function () { return OD.store.nodeMeta(S().route); };
  var ui = function () { return OD.ui; };

  /* =====================================================================
     标题栏
     ===================================================================== */
  function titlebar() {
    var st = S();
    var busyAny = Object.keys(st.busy).length > 0;
    var state = st.offline ? 'error' : busyAny ? 'busy' : 'ok';
    var label = st.offline ? '离线' : busyAny ? '更新中' : '已同步';
    var iconName = state === 'busy' ? 'refresh' : state === 'error' ? 'wifiOff' : 'checkCircle';

    return '' +
      '<div class="titlebar-brand">' +
        '<span class="titlebar-mark">' + icon('rss', { size: 14, stroke: 2 }) + '</span>' +
        '<span class="titlebar-name">订阅工作台</span>' +
        '<span class="titlebar-path od-truncate">' + U.esc(meta().title) + '</span>' +
      '</div>' +
      '<div class="titlebar-center">' +
        '<div class="titlebar-search">' + icon('search', { size: 15 }) +
          '<input id="search-input" type="search" value="' + U.esc(st.query) +
            '" placeholder="搜索当前视图的标题、作者与来源" aria-label="在当前视图内搜索">' +
          (st.query
            ? '<button class="icon-btn sm" data-act="clearQuery" aria-label="清空搜索">' + icon('x', { size: 13 }) + '</button>'
            : '') +
        '</div>' +
        '<button class="update-chip" data-act="refreshAll" data-state="' + state + '" title="刷新全部订阅（⌘R）">' +
          icon(iconName, { size: 14 }) + '<span>' + label + '</span>' +
        '</button>' +
      '</div>' +
      '<div class="titlebar-side">' +
        '<button class="icon-btn sm" data-act="openPalette" aria-label="打开命令面板" title="命令面板 ⌘K">' + icon('search', { size: 16 }) + '</button>' +
        '<button class="icon-btn sm" data-act="setOffline" aria-label="' + (st.offline ? '恢复网络' : '模拟离线') +
          '" title="' + (st.offline ? '恢复网络' : '模拟离线') + '" aria-pressed="' + st.offline + '">' +
          icon('wifiOff', { size: 16 }) + '</button>' +
        '<span class="win-controls" aria-hidden="true"><span class="win-dot"></span><span class="win-dot"></span><span class="win-dot"></span></span>' +
      '</div>';
  }

  /* =====================================================================
     侧边导航
     ===================================================================== */
  function navRows(rows, current) {
    // 折叠时行首无展开箭头，标签左边界需与分组行对齐
    var indent = ' style="padding-left:' + (sectionHasCaret(rows) ? 32 : 12) + 'px"';
    return rows.map(function (r) {
      var on = current === r.node;
      return '<button class="nav-row"' + indent + ' data-act="nav" data-node="' + U.esc(r.node) + '"' +
          (on ? ' aria-current="page"' : '') + ' title="' + U.esc(r.label) + '">' +
        icon(r.icon || 'layers', { size: 16, class: r.iconCls || '' }) +
        '<span class="nav-label od-truncate">' + U.esc(r.label) + '</span>' +
        (r.count != null && r.count !== 0
          ? '<span class="nav-count num"' + (r.unread ? ' data-unread="true"' : '') + '>' + r.count + '</span>'
          : '') +
      '</button>';
    }).join('');
  }

  /* 只有订阅分组带展开箭头；其余列表用常规内边距，避免与分组行错位 */
  function sectionHasCaret() { return false; }

  function rail() {
    var st = S();
    var current = st.route;
    var counts = OD.store.kindCounts();

    var tabs = OD.store.TABS.map(function (t) {
      var node = 'tab:' + t.id;
      var unread = OD.store.unreadCount(node);
      return { node: node, label: t.label, icon: t.icon, count: unread || counts[t.id] || 0, unread: unread > 0 };
    });

    var smart = OD.store.SMART.map(function (s) {
      var unread = OD.store.unreadCount(s.id);
      return { node: s.id, label: s.label, icon: s.icon, count: unread, unread: unread > 0 };
    });

    var tree = st.groups.map(function (g) {
      var children = st.subscriptions.filter(function (s) { return s.group === g.id; });
      var open = !!st.openGroups[g.id];
      var unread = children.reduce(function (n, s) { return n + OD.store.subUnread(s.id); }, 0);
      return '<div>' +
        '<div class="nav-row group-head">' +
          '<button class="nav-caret-btn" data-act="toggleGroup" data-id="' + g.id + '" aria-expanded="' + open +
            '" aria-label="' + U.esc((open ? '收起' : '展开') + g.title) + '">' +
            '<svg class="nav-caret" data-open="' + open + '" width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
              'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<path d="m9 6 6 6-6 6"/></svg>' +
          '</button>' +
          '<button class="nav-row-inner" data-act="nav" data-node="group:' + g.id + '"' +
            (current === 'group:' + g.id ? ' aria-current="page"' : '') + '>' +
            '<span class="nav-label od-truncate">' + U.esc(g.title) + '</span>' +
            '<span class="nav-count num"' + (unread ? ' data-unread="true"' : '') + '>' + (unread || children.length) + '</span>' +
          '</button>' +
        '</div>' +
        '<div class="group-children"' + (open ? '' : ' hidden') + '>' +
          children.map(function (s) { return subRow(s, current); }).join('') +
        '</div>' +
      '</div>';
    }).join('');

    var orphan = st.subscriptions.filter(function (s) { return !s.group; });
    var orphanBlock = orphan.length
      ? '<div class="group-children">' + orphan.map(function (s) { return subRow(s, current); }).join('') + '</div>'
      : '';

    return '' +
      '<div class="rail-head">' +
        '<div class="rail-actions">' +
          '<button class="icon-btn" data-act="refreshAll" aria-label="刷新全部订阅" title="刷新全部（⌘R）">' + icon('refresh', { size: 16 }) + '</button>' +
          '<button class="icon-btn" data-act="addSubscription" aria-label="添加订阅" title="添加订阅">' + icon('plus', { size: 16 }) + '</button>' +
          '<button class="icon-btn" data-act="scanLogin" aria-label="扫码登录" title="扫码登录">' + icon('qr', { size: 16 }) + '</button>' +
          '<button class="icon-btn" data-act="toggleTheme" aria-label="切换主题" title="切换深色 / 浅色">' +
            icon(st.settings.theme === 'light' ? 'sun' : 'moon', { size: 16 }) + '</button>' +
          '<button class="icon-btn" data-act="toggleRail" aria-label="折叠侧栏" title="折叠侧栏 ⌘\\">' + icon('panelLeft', { size: 16 }) + '</button>' +
        '</div>' +
      '</div>' +
      '<nav class="rail-scroll scroll-area" aria-label="库导航">' +
        '<div class="rail-section">' +
          '<div class="rail-section-title"><span>内容类型</span></div>' +
          navRows(tabs, current) +
        '</div>' +
        '<div class="rail-section">' +
          '<div class="rail-section-title"><span>智能订阅</span></div>' +
          navRows(smart, current) +
        '</div>' +
        '<div class="rail-section">' +
          '<div class="rail-section-title">' +
            '<span>订阅</span>' +
            '<button data-act="manageGroups" aria-label="管理分组" title="管理分组">' + icon('settings', { size: 13 }) + '</button>' +
          '</div>' +
          (tree || '<p class="rail-empty">还没有订阅。点上方 + 从内置渠道添加。</p>') +
          orphanBlock +
        '</div>' +
      '</nav>' +
      '<div class="rail-foot">' +
        navRows([
          { node: 'page:discover', label: '发现', icon: 'compass' },
          { node: 'page:account', label: '账号与凭证', icon: 'lock' },
          { node: 'page:settings', label: '设置', icon: 'settings' }
        ], current) +
      '</div>';
  }

  function subRow(sub, current) {
    var node = 'sub:' + sub.id;
    var on = current === node;
    var unread = OD.store.subUnread(sub.id);
    var h = OD.store.healthOf(sub);
    var trailing = '';
    if (h === 'error') trailing = '<span class="nav-warn" title="' + U.esc(sub.lastError || '刷新失败') + '">' + icon('alert', { size: 13 }) + '</span>';
    else if (h === 'stale') trailing = '<span class="nav-warn" title="缓存已过期，正在回退展示">' + icon('alertTriangle', { size: 13 }) + '</span>';
    else if (h === 'busy') trailing = '<span class="status-dot" data-state="busy"></span>';
    else if (h === 'disabled') trailing = '<span class="nav-count">停用</span>';
    else if (unread) trailing = '<span class="nav-count num" data-unread="true">' + unread + '</span>';

    return '<button class="nav-row sub-row" data-kind="' + sub.kind + '" data-act="nav" data-node="' + node + '"' +
        (on ? ' aria-current="page"' : '') +
        ' title="' + U.esc(sub.title + ' · ' + sub.channel + (sub.note ? ' · ' + sub.note : '')) + '">' +
      '<span class="sub-dot"></span>' +
      '<span class="nav-label od-truncate">' + U.esc(sub.title) + '</span>' +
      trailing +
    '</button>';
  }

  /* =====================================================================
     内容列表面板
     ===================================================================== */
  function paneHead(m, res) {
    var sub = m.sub;
    var h = sub ? OD.store.healthOf(sub) : 'ok';
    var dot = sub
      ? '<span class="status-dot" data-state="' + h + '" title="' + U.esc({
          ok: '抓取正常', busy: '正在刷新', stale: '缓存过期，回退展示', error: '抓取失败', disabled: '已停用'
        }[h] || '健康') + '"></span>'
      : '';
    var bits = [res.total + ' 条'];
    if (sub && sub.lastFetched && sub.lastError === null) bits.push('更新于 ' + U.timeAgo(sub.lastFetched));

    return '<div class="pane-head">' +
      '<div class="pane-head-main">' +
        '<span class="pane-title od-truncate">' + U.esc(m.title) + '</span>' +
        '<span class="pane-meta">' + dot + '<span class="num">' + U.esc(bits.join(' · ')) + '</span>' +
          (sub && sub.anon === false ? '<span class="tag tag-warn">需登录</span>' : '') +
        '</span>' +
      '</div>' +
      '<div class="pane-tools">' +
        (sub ? '<button class="icon-btn sm" data-act="refreshSub" data-id="' + sub.id + '" aria-label="刷新该订阅" title="刷新">' +
          icon('refresh', { size: 15 }) + '</button>' : '') +
        '<button class="icon-btn sm" data-act="paneFilter" aria-label="筛选与排序" title="筛选与排序">' + icon('filter', { size: 15 }) + '</button>' +
        '<button class="icon-btn sm" data-act="markAllRead" aria-label="全部标为已读" title="全部标为已读">' + icon('check', { size: 15 }) + '</button>' +
      '</div>' +
    '</div>';
  }

  function filterBar(m) {
    var st = S();
    var f = st.filter[st.route] || {};
    var sort = st.sort[st.route] || 'new';
    var subs = [];
    // 已在某条订阅里时不再重复给出「按订阅筛选」
    var inSub = st.route.indexOf('sub:') === 0;
    if (!inSub) {
      OD.store.baseFor(st.route).forEach(function (i) {
        if (subs.indexOf(i.subId) < 0) subs.push(i.subId);
      });
    }

    return '<div class="filterbar">' +
      '<div class="rail-chips" role="group" aria-label="内容筛选">' +
        '<button class="chip chip-sm" data-act="filterUnread" data-active="' + !!f.unreadOnly + '">' +
          (f.unreadOnly ? icon('check', { size: 12 }) : '') + '仅未读</button>' +
        subs.slice(0, 5).map(function (id) {
          var s = OD.store.subsById()[id];
          if (!s) return '';
          return '<button class="chip chip-sm" data-act="filterSub" data-id="' + id + '" data-active="' + (f.subId === id) + '">' +
            U.esc(s.title) + '</button>';
        }).join('') +
      '</div>' +
      '<button class="chip chip-sm" data-act="sortMenu">' + (sort === 'hot' ? '最热' : '最新') + '</button>' +
    '</div>';
  }

  function articlePane(m, res) {
    var st = S();
    if (!res.total) return paneHead(m, res) + '<div class="scroll-area">' + emptyForNode(m) + '</div>';
    return paneHead(m, res) + filterBar(m) +
      '<div class="scroll-area list">' +
        res.list.map(function (i) { return ui().listRow(i, st.selectedArticle); }).join('') +
        (res.hasMore
          ? '<div class="load-more"><button class="btn btn-secondary" data-act="loadMore">加载更多（还有 ' +
            (res.total - res.list.length) + ' 条）</button></div>'
          : '') +
      '</div>';
  }

  function emptyForNode(m) {
    var st = S();
    var sub = m.sub;

    if (sub && sub.lastError) {
      return ui().stateBlock({
        tone: 'error', icon: 'alertTriangle',
        title: '这条订阅抓取失败',
        text: sub.lastError + '。旧缓存仍然保留展示，不会出现内容空窗。',
        actions: [
          { label: '重试', act: 'refreshSub', icon: 'refresh', kind: 'primary' },
          { label: '更新凭证', act: 'navAccount' },
          { label: '编辑订阅', act: 'editSubscription' }
        ]
      });
    }
    if (st.offline) {
      return ui().stateBlock({
        tone: 'warn', icon: 'wifiOff',
        title: '当前离线',
        text: '已切到离线数据，只显示本地缓存内容。恢复网络后可继续增量刷新。',
        actions: [{ label: '恢复网络', act: 'setOffline', icon: 'refresh', kind: 'primary' }]
      });
    }
    if (st.query) {
      return ui().stateBlock({
        icon: 'search', title: '没有匹配的内容',
        text: '当前视图内没有包含「' + st.query + '」的条目。清空顶栏搜索框即可查看全部。'
      });
    }
    if (sub && sub.enabled === false) {
      return ui().stateBlock({
        icon: 'eyeOff', title: '这条订阅已停用',
        text: '停用后不参与刷新，已缓存内容保留可读。重新启用即可恢复自动更新。',
        actions: [{ label: '启用订阅', act: 'editSubscription', kind: 'primary' }]
      });
    }
    if (sub) {
      return ui().stateBlock({
        icon: sub.icon || 'rss', title: '这条订阅还没有内容',
        text: '可能是源站尚未发布新条目，或抓取参数需要调整。',
        actions: [
          { label: '立即刷新', act: 'refreshSub', icon: 'refresh', kind: 'primary' },
          { label: '编辑参数', act: 'editSubscription' }
        ]
      });
    }
    if (m.node === 'starred') {
      return ui().stateBlock({
        icon: 'star', title: '还没有星标内容',
        text: '在列表行或阅读页点星标，即可把条目收藏到这里，方便稍后回看。',
        actions: [{ label: '浏览全部内容', act: 'navAll', kind: 'primary' }]
      });
    }
    if (m.node === 'unread') {
      return ui().stateBlock({
        icon: 'inbox', title: '没有未读内容',
        text: '当前库里所有条目都已读。可以切到「今日」查看今天更新的内容。',
        actions: [{ label: '查看今日', act: 'navToday', kind: 'primary' }]
      });
    }
    return ui().stateBlock({
      icon: 'inbox', title: '这里暂时是空的',
      text: '换一个内容类型，或先刷新订阅拉取最新内容。',
      actions: [
        { label: '查看全部', act: 'navAll', kind: 'primary' },
        { label: '刷新订阅', act: 'refreshAll', icon: 'refresh' }
      ]
    });
  }

  /* =====================================================================
     主区：文章阅读
     ===================================================================== */
  function readerMain(m, res) {
    var st = S();
    var item = st.selectedArticle ? OD.store.itemsById(st.selectedArticle) : res.list[0];
    if (!item) {
      return '<div class="scroll-area"><div class="state-block">' +
        '<span class="state-glyph">' + icon('text', { size: 24 }) + '</span>' +
        '<span class="state-title">选择一篇文章开始阅读</span>' +
        '<span class="state-text">在左侧列表选中条目后，正文会显示在这里。也可以按 ↑ ↓ 在列表内移动。</span>' +
      '</div></div>';
    }

    var sub = OD.store.subsById()[item.subId];
    var s = ui().readStar(item);
    var paras = item.body && item.body.length ? item.body : [item.excerpt];
    var similar = OD.store.baseFor('sub:' + item.subId)
      .filter(function (i) { return i.id !== item.id; }).slice(0, 4);

    return '<div class="progress-bar" id="read-progress" aria-hidden="true"><span></span></div>' +
      '<div class="detail-head">' +
        '<button class="icon-btn sm narrow-only" data-act="closeArticle" aria-label="返回列表" title="返回列表">' +
          icon('list', { size: 16 }) + '</button>' +
        '<button class="icon-btn sm" data-act="toggleRead" data-id="' + item.id + '" title="' +
          (s.read ? '标为未读' : '标为已读') + '" aria-label="' + (s.read ? '标为未读' : '标为已读') + '">' +
          icon(s.read ? 'eyeOff' : 'eye', { size: 16 }) + '</button>' +
        '<button class="icon-btn sm" data-act="star" data-id="' + item.id + '" aria-pressed="' + s.starred +
          '" title="星标" aria-label="' + (s.starred ? '取消星标' : '加星标') + '">' +
          (s.starred ? icon.solid('star', { size: 16 }) : icon('star', { size: 16 })) + '</button>' +
        '<button class="icon-btn sm" data-act="copyLink" data-id="' + item.id + '" aria-label="复制原文链接" title="复制链接">' +
          icon('link', { size: 16 }) + '</button>' +
        '<span class="detail-head-spacer"></span>' +
        '<button class="icon-btn sm" data-act="fontSmaller" aria-label="减小正文字号" title="减小字号">' +
          '<span class="font-btn">A−</span></button>' +
        '<button class="icon-btn sm" data-act="fontLarger" aria-label="增大正文字号" title="增大字号">' +
          '<span class="font-btn">A+</span></button>' +
        '<button class="btn btn-secondary btn-sm" data-act="openOriginal" data-id="' + item.id + '">' +
          icon('external', { size: 14 }) + '打开原文</button>' +
      '</div>' +
      '<div class="scroll-area article-scroll">' +
        '<article class="article">' +
          '<div class="article-kicker">' +
            '<span>' + U.esc(item.source) + '</span><span class="dot-sep"></span>' +
            '<span>' + U.fullDate(item.publishedAt) + '</span><span class="dot-sep"></span>' +
            '<span class="num">' + (item.readMin || 3) + ' 分钟阅读</span>' +
          '</div>' +
          '<h1 class="article-title">' + U.esc(item.title) + '</h1>' +
          '<div class="article-byline">' +
            '<span class="article-avatar">' + U.esc((item.author || '?').slice(0, 1)) + '</span>' +
            '<span class="article-byline-text">' +
              '<span class="t-small article-author">' + U.esc(item.author) + '</span>' +
              '<span class="t-micro t-dim">' + U.esc(sub ? sub.channel : item.source) + '</span>' +
            '</span>' +
          '</div>' +
          (ui().mediaUrl(item)
            ? '<figure class="article-hero" style="aspect-ratio:' + ui().ratioOf(item).toFixed(4) + '">' +
                '<img src="' + U.esc(ui().mediaUrl(item)) + '" alt="' + U.esc(U.clip(item.title, 40)) + '" decoding="async"></figure>'
            : '') +
          '<div class="article-body">' +
            paras.map(function (p, idx) {
              return '<p' + (idx === 0 ? ' class="lede"' : '') + '>' + U.esc(p) + '</p>';
            }).join('') +
          '</div>' +
          '<div class="article-foot">' +
            '<button class="btn btn-secondary btn-sm" data-act="star" data-id="' + item.id + '">' +
              (s.starred ? icon.solid('star', { size: 14 }) : icon('star', { size: 14 })) +
              (s.starred ? '已星标' : '加星标') + '</button>' +
            '<button class="btn btn-secondary btn-sm" data-act="toggleRead" data-id="' + item.id + '">' +
              icon('check', { size: 14 }) + (s.read ? '标为未读' : '标为已读') + '</button>' +
            '<span class="spacer"></span>' +
            '<button class="btn btn-quiet btn-sm" data-act="openOriginal" data-id="' + item.id + '">' +
              icon('external', { size: 14 }) + '原文' + '</button>' +
          '</div>' +
          (similar.length
            ? '<section class="section">' +
                '<div class="section-head"><span class="section-title">来自同一订阅</span></div>' +
                '<div class="result-grid">' + similar.map(function (i) { return ui().cardMini(i, 'openArticle'); }).join('') + '</div>' +
              '</section>'
            : '') +
        '</article>' +
      '</div>';
  }

  /* =====================================================================
     主区：媒体网格
     ===================================================================== */
  function mediaMain(m, res) {
    if (!res.total) return '<div class="scroll-area">' + emptyForNode(m) + '</div>';


    var liveItems = res.list.filter(function (i) { return i.kind === 'live'; });
    var rest = res.list.filter(function (i) { return i.kind !== 'live'; });
    var out = '<div class="scroll-area">';

    if (liveItems.length && rest.length) {
      out += '<section class="rail-block">' +
        '<div class="rail-head">' +
          '<h2 class="grid-title">正在直播</h2>' +
          '<span class="grid-sub num">' + liveItems.length + ' 个在播房间</span>' +
          '<span class="spacer"></span>' +
          '<button class="btn btn-quiet btn-sm" data-act="filterLive">只看直播</button>' +
        '</div>' +
        '<div class="rail-track">' + liveItems.slice(0, 12).map(ui().mediaCard).join('') + '</div>' +
      '</section>';
    }

    // 直播已单独成排时，网格标题与计数只针对余下内容，避免标题说 193 条、网格却只有 125 张
    var hasRail = liveItems.length > 0 && rest.length > 0;
    var shown = rest.length ? rest : res.list;
    out += '<div class="grid-head">' +
        '<h2 class="grid-title">' + U.esc(hasRail ? '其余内容' : m.title) + '</h2>' +
        '<span class="grid-sub num">' + shown.length + ' 条' +
          (hasRail ? '（另有 ' + liveItems.length + ' 个在播房间）' : '') + '</span>' +
        '<span class="spacer"></span>' +
        '<button class="btn btn-quiet btn-sm" data-act="paneFilter">' + icon('filter', { size: 14 }) + '筛选</button>' +
      '</div>' +
      '<div class="media-grid">' + shown.map(ui().mediaCard).join('') + '</div>' +
      (res.hasMore
        ? '<div class="load-more"><button class="btn btn-secondary" data-act="loadMore">加载更多</button></div>'
        : '') +
    '</div>';
    return out;
  }

  /* =====================================================================
     主区：社交瀑布流
     ===================================================================== */
  function socialMain(m, res) {
    if (!res.total) return '<div class="scroll-area">' + emptyForNode(m) + '</div>';
    return '<div class="scroll-area">' +
      '<div class="grid-head">' +
        '<h2 class="grid-title">' + U.esc(m.title) + '</h2>' +
        '<span class="grid-sub num">' + res.total + ' 条</span>' +
        '<span class="spacer"></span>' +
        (m.sub && m.sub.anon === false ? '<span class="tag tag-warn">需要登录态</span>' : '') +
      '</div>' +
      '<div class="masonry">' +
        res.list.map(function (i) { return '<div class="masonry-item">' + ui().socialCard(i) + '</div>'; }).join('') +
      '</div>' +
      (res.hasMore
        ? '<div class="load-more"><button class="btn btn-secondary" data-act="loadMore">加载更多</button></div>'
        : '') +
    '</div>';
  }

  /* =====================================================================
     热搜：词条列表 + 词下内容流
     ===================================================================== */
  function hotPane(m) {
    var st = S();
    var words = st.hotSearches;
    return '<div class="pane-head">' +
        '<div class="pane-head-main">' +
          '<span class="pane-title">微博热搜</span>' +
          '<span class="pane-meta"><span class="num">' + words.length + ' 个词条</span><span>·</span><span>公开榜单单次抓取</span></span>' +
        '</div>' +
        '<div class="pane-tools">' +
          '<button class="icon-btn sm" data-act="refreshHot" aria-label="刷新热搜榜" title="刷新热搜榜">' + icon('refresh', { size: 15 }) + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="scroll-area list hot-list">' +
        words.map(function (w) { return ui().hotRow(w, st.hotWord === w.word); }).join('') +
      '</div>';
  }

  /* 词下内容流：未登录时按库内匹配回退，并明确标注派生了什么 */
  function hotFeed(word) {
    if (!word) {
      return ui().stateBlock({
        icon: 'compass', title: '选择一个热搜词',
        text: '点左侧任一热词，这里会显示对应内容。词下内容流需要完整微博登录 cookie；未登录时按库内条目匹配，并明确标注。',
        actions: [{ label: '更新微博凭证', act: 'navAccount', kind: 'primary' }]
      });
    }

    var tokens = String(word).split(/[\s、，,·]+/).filter(function (t) { return t.length > 1; });
    var matched = S().items.filter(function (i) {
      var hay = (i.title || '') + (i.excerpt || '') + (i.desc || '') + (i.tags || []).join(' ') +
        (i.author || '') + (i.source || '');
      return hay.length > 0 && (tokens.length ? tokens.some(function (t) { return hay.indexOf(t) >= 0; }) : false);
    });
    var derived = matched.length === 0;
    var list = (derived ? S().items.filter(function (i) { return i.kind === 'article'; }) : matched).slice(0, 12);

    return '<div class="scroll-area">' +
      '<div class="grid-head">' +
        '<h2 class="grid-title">' + U.esc(word) + '</h2>' +
        '<span class="grid-sub num">' + list.length + ' 条</span>' +
      '</div>' +
      '<div class="banner-wrap"><div class="banner" data-tone="' + (derived ? 'warn' : '') + '">' +
        icon(derived ? 'alertTriangle' : 'info', { size: 18 }) +
        '<div class="banner-body">' +
          '<span class="banner-title">' + (derived ? '词下内容流不可用，已回退' : '内容来源说明') + '</span>' +
          '<span>' + (derived
            ? '解析热搜词下内容流需要完整微博登录 cookie，当前凭证为空。以下为库内文章作为参照，不代表该词在微博的真实内容。'
            : '以下条目来自本机订阅库中与该词匹配的真实内容，不是微博词下内容流。') + '</span>' +
        '</div>' +
      '</div></div>' +
      '<div class="media-grid">' +
        list.map(function (i) {
          return i.kind === 'article' ? ui().cardMini(i, 'openArticle') : ui().mediaCard(i);
        }).join('') +
      '</div>' +
    '</div>';
  }

  OD.views = OD.views || {};
  OD.views.library = {
    titlebar: titlebar,
    rail: rail,
    articlePane: articlePane,
    paneHead: paneHead,
    emptyForNode: emptyForNode,
    readerMain: readerMain,
    mediaMain: mediaMain,
    socialMain: socialMain,
    hotPane: hotPane,
    hotFeed: hotFeed
  };
})();
