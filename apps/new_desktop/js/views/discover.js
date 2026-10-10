/* 发现层：四平台能力矩阵、分区浏览、搜房间与搜主播、可订阅榜单 */
(function () {
  'use strict';

  var OD = window.OD;
  var S = function () { return OD.store.state; };
  var ui = function () { return OD.ui; };

  var PLATFORM_LABEL = { bilibili: '哔哩哔哩', douyu: '斗鱼', huya: '虎牙', douyin: '抖音' };
  var CAP_LABEL = { category: '分区树', rooms: '按分区列房', search: '搜房间', anchor: '搜主播' };

  function page(title, lead, body) {
    return '<div class="page"><div class="scroll-area page-scroll">' +
      '<div class="page-wrap">' +
        '<h1 class="page-title">' + U.esc(title) + '</h1>' +
        (lead ? '<p class="page-lead">' + U.esc(lead) + '</p>' : '') +
        body +
      '</div>' +
    '</div></div>';
  }

  /* =====================================================================
     发现首页
     ===================================================================== */
  function discoverPage() {
    var d = S().discovery;
    return page('发现',
      '从这里浏览平台分区、搜索在播房间与主播，或直接订阅平台榜单。每个平台的能力状态标注为实测结论，受限项会说明原因。',
      '<div class="section">' +
        '<div class="section-head">' +
          '<span class="section-title">平台能力</span>' +
          '<span class="section-desc">匿名可用性实测结论</span>' +
        '</div>' +
        '<div class="platform-grid">' + d.platforms.map(platformCard).join('') + '</div>' +
      '</div>' +
      '<div class="section">' +
        '<div class="section-head"><span class="section-title">可订阅榜单</span></div>' +
        '<div class="platform-grid">' + d.boards.map(boardCard).join('') + '</div>' +
      '</div>' +
      '<div class="section">' +
        '<div class="section-head">' +
          '<span class="section-title">分区浏览</span>' +
          '<span class="section-desc">选平台与分区，查看当前在播房间</span>' +
        '</div>' +
        '<div class="chip-row">' + d.platforms.map(function (p) {
          return '<button class="chip" data-act="discoverPlatform" data-id="' + p.id + '" data-active="' +
            (S().discoverPlatform === p.id) + '">' + ui().platformMark(p.id, 14) + U.esc(PLATFORM_LABEL[p.id] || p.label) + '</button>';
        }).join('') + '</div>' +
        categorySection() +
      '</div>'
    );
  }

  function platformCard(p) {
    return '<div class="platform-card">' +
      '<div class="platform-head">' +
        '<span class="platform-mark">' + ui().platformMark(p.id, 18) + '</span>' +
        '<span class="platform-name">' + U.esc(PLATFORM_LABEL[p.id] || p.label) + '</span>' +
      '</div>' +
      '<div class="cap-list">' +
        Object.keys(CAP_LABEL).map(function (k) {
          var on = !!p.capabilities[k];
          return '<div class="cap-row" data-on="' + on + '">' +
            icon(on ? 'checkCircle' : 'x', { size: 14 }) +
            '<span>' + CAP_LABEL[k] + '</span>' +
            '<span class="spacer"></span>' +
            '<span class="t-micro t-dim">' + (on ? '可用' : '受限') + '</span>' +
          '</div>';
        }).join('') +
      '</div>' +
      '<ul class="platform-notes">' + p.notes.map(function (n) { return '<li>' + U.esc(n) + '</li>'; }).join('') + '</ul>' +
      '<div class="chip-row">' +
        '<button class="btn btn-secondary btn-sm" data-act="discoverPlatform" data-id="' + p.id + '">' +
          icon('grid', { size: 14 }) + '查看分区</button>' +
        '<button class="btn btn-secondary btn-sm" data-act="openSearch" data-id="' + p.id + '">' +
          icon('search', { size: 14 }) + '搜索</button>' +
      '</div>' +
    '</div>';
  }

  function boardCard(b) {
    var subscribed = !!OD.store.subsById()[b.subscription];
    return '<div class="platform-card">' +
      '<div class="platform-head">' +
        '<span class="platform-mark">' + ui().platformMark(b.platform, 18) + '</span>' +
        '<span class="platform-title">' +
          '<span class="platform-name">' + U.esc(b.title) + '</span>' +
          '<span class="t-micro t-dim mono">' + U.esc(b.id) + '</span>' +
        '</span>' +
      '</div>' +
      '<p class="t-small t-muted">' + U.esc(b.desc) + '</p>' +
      '<div class="chip-row">' +
        (subscribed
          ? '<button class="btn btn-secondary btn-sm" data-act="nav" data-node="sub:' + b.subscription + '">' +
              icon('layers', { size: 14 }) + '查看内容</button><span class="tag tag-ok">已订阅</span>'
          : '<button class="btn btn-primary btn-sm" data-act="subscribeBoard" data-sub="' + b.subscription +
              '" data-key="' + U.esc(b.id) + '">' + icon('plus', { size: 14 }) + '一键订阅</button>') +
      '</div>' +
    '</div>';
  }

  function categorySection() {
    var d = S().discovery;
    var pid = S().discoverPlatform || 'bilibili';
    var p = d.platforms.filter(function (x) { return x.id === pid; })[0];
    if (!p) return '';
    var picked = S().discoverCategory;

    return '<div class="cat-grid">' +
        p.categories.map(function (c) {
          return '<button class="cat-tile" data-act="pickCategory" data-id="' + U.esc(c.name) + '" aria-pressed="' +
            (picked === c.name) + '">' +
            '<span class="cat-name">' + U.esc(c.name) + '</span>' +
            '<span class="cat-id">' + U.esc(String(c.id)) + '</span>' +
          '</button>';
        }).join('') +
      '</div>' +
      (picked ? categoryRooms(p, picked) : commonNote(p));
  }

  function commonNote(p) {
    var on = p.capabilities.rooms;
    return '<div class="banner" data-tone="' + (on ? '' : 'warn') + '">' +
      icon(on ? 'info' : 'alertTriangle', { size: 18 }) +
      '<div class="banner-body">' +
        '<span class="banner-title">' + (on ? '选择分区开始浏览' : '该平台按分区列房受限') + '</span>' +
        '<span>' + (on
          ? '房间列表按抓取时刻的真实数据展示；列房接口匿名可用。'
          : '该平台列房接口需要登录态或浏览器模拟，匿名请求会被拒绝。可先订阅榜单，由后台按调度抓取。') + '</span>' +
      '</div>' +
    '</div>';
  }

  function categoryRooms(p, cat) {
    var all = S().items.filter(function (i) { return i.kind === 'live' && i.platform === p.id; });
    var rooms = all.filter(function (i) { return i.area && (i.area === cat || cat.indexOf(i.area) >= 0 || i.area.indexOf(cat) >= 0); });
    var exact = rooms.length > 0;
    if (!exact) rooms = all.slice(0, 12);

    return '<div class="section">' +
      '<div class="section-head">' +
        '<span class="section-title">' + U.esc(cat) + ' · 在播房间</span>' +
        '<span class="section-desc num">' + rooms.length + ' 个</span>' +
        '<span class="spacer"></span>' +
        '<button class="btn btn-secondary btn-sm" data-act="subscribeCategory" data-platform="' + p.id +
          '" data-cat="' + U.esc(cat) + '">' + icon('plus', { size: 14 }) + '订阅该分区</button>' +
      '</div>' +
      (!exact && rooms.length
        ? '<div class="banner" data-tone="warn">' + icon('alertTriangle', { size: 18 }) +
            '<div class="banner-body"><span>该分区在当前抓取结果中没有独立房间，以下按同一平台的在播房间回退展示，不代表该分区真实排序。</span></div></div>'
        : '') +
      (rooms.length
        ? '<div class="media-grid media-grid-flush">' + rooms.map(ui().mediaCard).join('') + '</div>'
        : ui().stateBlock({
            icon: 'radio',
            title: '该分区暂无可展示的房间',
            text: '可能该分区当前无在播房间，或列房接口返回风控错误。换一个分区，或先订阅该分区由后台定时抓取。'
          })) +
    '</div>';
  }

  /* =====================================================================
     搜索
     ===================================================================== */
  function searchPage() {
    var pid = S().searchPlatform || 'bilibili';
    var tab = S().searchTab || 'rooms';
    var q = S().searchQuery || '';
    var result = q ? runSearch(pid, q, tab) : null;

    return page('搜索房间与主播',
      '搜索能力按平台实测结论标注：斗鱼与哔哩哔哩匿名可用，虎牙结果不可分页，抖音只有游戏名级关键词能命中。',
      '<div class="section section-first">' +
        '<div class="chip-row">' + Object.keys(PLATFORM_LABEL).map(function (k) {
          var p = S().discovery.platforms.filter(function (x) { return x.id === k; })[0];
          var cap = tab === 'rooms' ? p.capabilities.search : p.capabilities.anchor;
          return '<button class="chip" data-act="searchPlatform" data-id="' + k + '" data-active="' + (pid === k) + '">' +
            ui().platformMark(k, 14) + U.esc(PLATFORM_LABEL[k]) +
            (cap ? '' : '<span class="tag tag-warn chip-tag">受限</span>') + '</button>';
        }).join('') + '</div>' +
        '<div class="segmented">' +
          '<button data-act="searchTab" data-id="rooms" aria-pressed="' + (tab === 'rooms') + '">搜房间</button>' +
          '<button data-act="searchTab" data-id="anchor" aria-pressed="' + (tab === 'anchor') + '">搜主播</button>' +
        '</div>' +
        '<div class="field field-narrow">' +
          '<label class="field-label" for="dsearch">' + (tab === 'rooms' ? '房间关键词' : '主播昵称') + '</label>' +
          '<div class="input-group">' + icon('search', { size: 16 }) +
            '<input class="input" id="dsearch" type="search" value="' + U.esc(q) + '" placeholder="例如：英雄联盟 / 原神 / 洞主">' +
          '</div>' +
          '<span class="field-help">抖音仅「游戏名级」关键词有效，舞蹈、美食、聊天类会返回空。</span>' +
        '</div>' +
        '<div class="section">' +
          '<div class="section-head">' +
            '<span class="section-title">结果</span>' +
            '<span class="section-desc num">' + (result ? result.list.length : 0) + ' 条</span>' +
          '</div>' +
          (!q
            ? ui().stateBlock({
                icon: 'search', title: '输入关键词开始搜索',
                text: '先选平台与搜索类型，再输入关键词。未登录时部分平台会返回「请先登录」。'
              })
            : (result.list.length
                ? (result.exact ? '' : '<div class="banner" data-tone="warn">' + icon('alertTriangle', { size: 18 }) +
                    '<div class="banner-body"><span>关键词在库内没有精确命中，以下按该平台在播房间回退展示，不代表搜索结果排序。</span></div></div>') +
                  '<div class="result-grid">' + result.list.map(ui().mediaCard).join('') + '</div>'
                : ui().stateBlock({
                    icon: 'search', title: '没有匹配的房间',
                    text: '换一个关键词或平台。抖音搜索只认游戏名级关键词，虎牙搜索结果不可分页。',
                    actions: [{ label: '去分区浏览', act: 'openBrowse', kind: 'primary' }]
                  }))) +
        '</div>' +
      '</div>'
    );
  }

  function runSearch(pid, q, tab) {
    var key = q.trim().toLowerCase();
    var pool = S().items.filter(function (i) { return i.kind === 'live' && i.platform === pid; });
    if (!pool.length) return { list: [], exact: true };

    if (tab === 'anchor') {
      var anchors = pool.filter(function (i) { return (i.author || '').toLowerCase().indexOf(key) >= 0; });
      return { list: anchors.slice(0, 12), exact: anchors.length > 0 };
    }
    var rooms = pool.filter(function (i) {
      return ((i.title || '') + ' ' + (i.area || '')).toLowerCase().indexOf(key) >= 0;
    });
    if (!rooms.length) return { list: pool.slice(0, 8), exact: false };
    return { list: rooms.slice(0, 12), exact: true };
  }

  OD.views = OD.views || {};
  OD.views.discover = { discoverPage: discoverPage, searchPage: searchPage, page: page };
})();
