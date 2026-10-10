/* 应用装配：渲染、事件委托、键盘、路由、命令面板、播放时钟 */
(function () {
  'use strict';

  var OD = window.OD;
  var S = function () { return OD.store.state; };
  var A = function () { return OD.store.actions; };
  var V = function () { return OD.views; };
  var ui = function () { return OD.ui; };

  var appRoot = document.getElementById('app');
  var scrollMemo = {};
  var focusMemo = null;
  var shellSig = '';

  /* =====================================================================
     渲染
     ===================================================================== */
  /* 中栏与主区必须是 .app-body 的并列子元素：把 .pane 塞进 <main> 会让整个主区
     落进 --col 那一列，右侧 minmax(0,1fr) 空着。故外壳只拼这两个片段。 */
  function shell(view, paneHtml, mainHtml) {
    var st = S();
    var railOpen = !st.collapsedRail;
    return {
      view: view,
      rail: railOpen,
      // 窄屏单栏导航需要知道是否已选中条目
      sel: view === 'reader' ? (st.selectedArticle ? 'true' : 'false') : '',
      paneHtml: paneHtml || '',
      mainHtml: mainHtml
    };
  }

  function bodyFor(st, m) {
    if (m.type === 'page') return shell('wide', null, pageFor(m));

    if (m.type === 'player') {
      var item = st.nowPlaying || OD.store.itemsById(String(st.route).slice(5));
      return shell('wide', null, item
        ? V().player.playerView(item)
        : ui().stateBlock({ icon: 'play', title: '没有正在播放的内容', text: '从任意视频、音频或直播卡片进入播放页。' }));
    }

    // 热搜订阅走词条列表 + 词下内容流，优先于通用文章视图
    if (m.sub && m.sub.channel === 'weibo:hot') {
      return shell('reader', V().library.hotPane(m), V().library.hotFeed(st.hotWord));
    }

    if (m.type === 'reader') {
      var res = OD.store.query(st.route, { paged: true });
      return shell('reader', V().library.articlePane(m, res), V().library.readerMain(m, OD.store.query(st.route)));
    }

    var mres = OD.store.query(st.route, { paged: true });
    return shell('media', null, st.loadingView
      ? skeletonMain()
      : (m.kind === 'social' ? V().library.socialMain(m, mres) : V().library.mediaMain(m, mres)));
  }

  /* 中栏片段：包成 .pane 后作为 .app-body 的直接子元素 */
  function paneRegion(paneHtml) {
    return paneHtml ? '<section class="pane col-pane" id="pane-region">' + paneHtml + '</section>' : '';
  }
  function mainRegion(mainHtml) {
    return '<main class="main-region" id="main-region" tabindex="-1">' + mainHtml + '</main>';
  }

  function render() {
    var st = S();
    var m = OD.store.nodeMeta(st.route);

    // 宽屏时主区常驻：未选中就落在一篇上；窄屏单栏保持仅列表，避免一进视图就吞掉列表
    if (m.type === 'reader' && !st.selectedArticle && window.innerWidth > 900) {
      var first = OD.store.query(st.route, { paged: true }).list[0];
      if (first) st.selectedArticle = first.id;
    }

    var s = bodyFor(st, m);
    // route 与 openGroups 必须参与：侧栏高亮由 route 决定，只换中栏与主区不会更新它，
    // 否则点导航后左侧激活项会停在旧节点。其余项用于侧栏自身的结构与计数。
    var sig = [s.view, s.rail, s.sel, st.route, Object.keys(st.openGroups).filter(function (k) { return st.openGroups[k]; }).join(','),
      st.offline, st.settings.theme, st.hotWord,
      Object.keys(st.busy).join(','), st.subscriptions.length, st.groups.length, st.collapsedRail].join('|');

    var bodyHtml = paneRegion(s.paneHtml) + mainRegion(s.mainHtml);

    if (sig !== shellSig) {
      captureScroll();
      shellSig = sig;
      appRoot.innerHTML = chrome(st) +
        '<div class="app-body" data-view="' + s.view + '" data-rail="' + (s.rail ? 'open' : 'collapsed') + '"' +
          (s.sel ? ' data-sel="' + s.sel + '"' : '') + '>' +
          '<div class="rail' + (s.rail ? '' : ' rail-collapsed') + '" role="navigation">' + V().library.rail() + '</div>' +
          bodyHtml +
        '</div>';
      restoreScroll();
    } else {
      // 外壳不变：只替换中栏与主区，保住侧栏滚动位置与分组展开态
      var tmp = document.createElement('template');
      tmp.innerHTML = bodyHtml;
      var pane = document.getElementById('pane-region');
      var main = document.getElementById('main-region');
      var newPane = tmp.content.querySelector('#pane-region');
      var newMain = tmp.content.querySelector('#main-region');
      var bodyEl = appRoot.querySelector('.app-body');

      if (pane && newPane) {
        var ps = pane.scrollTop;
        pane.innerHTML = newPane.innerHTML;
        pane.scrollTop = ps;
      } else if (newPane && !pane && bodyEl && main) {
        bodyEl.insertBefore(newPane, main);
      } else if (!newPane && pane) {
        pane.remove();
      }
      if (main && newMain) {
        var ms = main.scrollTop;
        main.innerHTML = newMain.innerHTML;
        main.scrollTop = ms;
      }
      restoreScroll();
    }
    applyMasonry();
  }

  function chrome(st) {
    return '<div class="titlebar">' + V().library.titlebar() + '</div>' +
      (st.offline
        ? '<div class="chrome-banner"><div class="banner" data-tone="warn">' + icon('wifiOff', { size: 18 }) +
            '<div class="banner-body">' +
              '<span class="banner-title">离线模式</span>' +
              '<span>只展示本地缓存内容，刷新与登录相关操作已暂停。恢复网络后可继续增量拉取。</span>' +
            '</div>' +
            '<button class="btn btn-secondary btn-sm" data-act="setOffline">恢复网络</button>' +
          '</div></div>'
        : '');
  }

  function pageFor(m) {
    if (m.node === 'page:settings') return V().manage.settingsPage();
    if (m.node === 'page:account') return V().manage.accountPage();
    if (m.node === 'page:discover') {
      return S().discoverView === 'search' ? V().discover.searchPage() : V().discover.discoverPage();
    }
    return ui().stateBlock({ icon: 'compass', title: '页面不存在', text: '返回库视图继续浏览。' });
  }

  function skeletonMain() {
    return '<div class="scroll-area">' +
      '<div class="grid-head"><span class="skeleton sk-title" style="width:180px"></span></div>' +
      '<div class="media-grid media-grid-flush">' + ui().skeletonCards(8) + '</div>' +
    '</div>';
  }

  function applyMasonry() {
    var node = document.querySelector('.masonry');
    if (!node) return;
    var w = node.clientWidth || window.innerWidth;
    node.style.setProperty('--masonry-cols', w >= 1400 ? 4 : w >= 1000 ? 3 : w >= 640 ? 2 : 1);
  }

  function regionKey(n) {
    if (n.closest('.col-pane')) return 'pane';
    if (n.closest('main')) return 'main';
    if (n.closest('.rail')) return 'rail';
    return 'other';
  }

  function captureScroll() {
    var seen = {};
    U.qa('.scroll-area').forEach(function (n) {
      var key = regionKey(n);
      seen[key] = (seen[key] || 0) + 1;
      scrollMemo[key + ':' + (seen[key] - 1)] = n.scrollTop;
    });
    var a = document.activeElement;
    if (!a || !a.tagName) { focusMemo = null; return; }
    if (a.id && /^(search-input|dsearch|new-group|fi-|ed-)/.test(a.id)) {
      focusMemo = { id: a.id, start: a.selectionStart, end: a.selectionEnd };
    } else if (a.dataset && a.dataset.param) {
      focusMemo = { sel: '[data-param="' + a.dataset.param + '"]', start: a.selectionStart, end: a.selectionEnd };
    } else {
      focusMemo = null;
    }
  }

  function restoreScroll() {
    var seen = {};
    U.qa('.scroll-area').forEach(function (n) {
      var key = regionKey(n);
      seen[key] = (seen[key] || 0) + 1;
      var v = scrollMemo[key + ':' + (seen[key] - 1)];
      if (v) n.scrollTop = v;
    });
    if (!focusMemo) return;
    var node = focusMemo.id ? document.getElementById(focusMemo.id) : document.querySelector(focusMemo.sel);
    if (!node) return;
    node.focus();
    try { node.setSelectionRange(focusMemo.start, focusMemo.end); } catch (e) {}
  }

  /* =====================================================================
     动作表
     ===================================================================== */
  var ACT = {
    /* 导航 */
    nav: function (node) { A().navigate(node.dataset.node); },
    navAll: function () { A().navigate('tab:all'); },
    navToday: function () { A().navigate('today'); },
    navAccount: function () { A().navigate('page:account'); },
    openBrowse: function () { OD.store.set({ discoverView: 'browse' }, { persist: false }); },
    toggleRail: function () { A().toggleRail(); },
    toggleGroup: function (node) { A().toggleGroup(node.dataset.id); },
    back: function () { A().navigate(S().lastList || 'tab:all'); },
    closeArticle: function () { OD.store.set({ selectedArticle: null }, { persist: false }); },

    /* 外观与设置 */
    toggleTheme: function () { A().setSetting('theme', S().settings.theme === 'light' ? 'dark' : 'light'); },
    settingSwitch: function (node) { A().setSetting(node.dataset.key, !S().settings[node.dataset.key]); },
    settingRadio: function (node) { A().setSetting(node.dataset.key, node.dataset.value); },
    settingsTab: function (node) { OD.store.set({ settingsTab: node.dataset.id }, { persist: false }); },
    logSwitch: function (node) {
      var on = node.getAttribute('aria-checked') !== 'true';
      node.setAttribute('aria-checked', String(on));
      OD.toast('info', (on ? '已开启' : '已关闭') + '日志域', 'log:' + node.dataset.key + ' = ' + (on ? '1' : '0'));
    },
    clearContentCache: function () {
      ui().confirm({
        title: '清除内容缓存', okLabel: '清除', danger: true,
        text: '将删除所有订阅的 RSS 原文与图片缓存，不影响订阅列表、已读与星标状态。',
        detail: '下次刷新会重新抓取全部订阅，反爬平台可能触发频率限制。',
        onOk: function () { OD.toast('ok', '缓存已清除', '释放约 1.9 GB；下次刷新将重新抓取。'); }
      });
    },
    exportData: function () { OD.toast('ok', '已导出 OPML', '共 ' + S().subscriptions.length + ' 条订阅，含分组层级。'); },
    verifyAssets: function () {
      OD.toast('ok', '本地资源校验通过',
        Object.keys(OD_CONTENT.assetSizes).length + ' 张图片尺寸记录完整，引用全部为相对路径。');
    },

    /* 订阅 */
    addSubscription: function () {
      ui().modal(Object.assign(V().manage.addSubscriptionModal(), {
        onMount: wireSubscriptionModal
      }));
    },
    editSubscription: function () {
      var sub = OD.store.currentSub();
      if (!sub) { OD.toast('warn', '请先选择一条订阅', '在侧边导航中点开订阅后再编辑。'); return; }
      ui().modal(Object.assign(V().manage.editSubscriptionModal(sub), {
        onMount: function (panel, close) {
          U.bind(panel, {
            deleteSub: function () {
              close();
              ui().confirm({
                title: '删除订阅', okLabel: '删除', danger: true,
                text: '将删除「' + sub.title + '」及其内容缓存。',
                detail: '已读与星标记录保留，重新添加同渠道订阅后可继续阅读。',
                onOk: function () {
                  A().removeSubscription(sub.id);
                  A().navigate('tab:all');
                  OD.toast('ok', '已删除订阅', sub.title);
                }
              });
            },
            saveSub: function () {
              var sw = panel.querySelector('[data-act="subEnabled"]');
              A().updateSubscription(sub.id, {
                title: panel.querySelector('#ed-title').value.trim() || sub.title,
                group: panel.querySelector('#ed-group').value || null,
                refreshIntervalSec: panel.querySelector('#ed-ttl').value
                  ? Number(panel.querySelector('#ed-ttl').value) * 60 : null,
                enabled: sw.getAttribute('aria-checked') === 'true'
              });
              close();
              OD.toast('ok', '订阅已更新', '参数变更会在下次刷新时生效。');
            },
            subEnabled: function (node) {
              node.setAttribute('aria-checked', String(node.getAttribute('aria-checked') !== 'true'));
            }
          });
        }
      }));
    },
    manageGroups: function () {
      ui().modal(Object.assign(V().manage.groupsModal(), {
        onMount: function (panel, close) {
          U.bind(panel, {
            createGroup: function () {
              var input = panel.querySelector('#new-group');
              var name = input.value.trim();
              if (!name) { input.focus(); OD.toast('warn', '请填写分组名称', ''); return; }
              A().addGroup(name);
              close();
              OD.toast('ok', '已创建分组', name);
            },
            deleteGroup: function (node) {
              var gid = node.dataset.id;
              var g = S().groups.filter(function (x) { return x.id === gid; })[0];
              close();
              ui().confirm({
                title: '删除分组', okLabel: '删除', danger: true,
                text: '删除分组「' + (g ? g.title : '') + '」。',
                detail: '分组内的订阅不会删除，会移动到未分组。',
                onOk: function () { A().removeGroup(gid); OD.toast('ok', '分组已删除', '订阅已移至未分组。'); }
              });
            }
          });
          panel.addEventListener('change', function (e) {
            var n = e.target.closest('[data-act="renameGroup"]');
            if (n) A().renameGroup(n.dataset.id, n.value.trim() || '未命名分组');
          });
        }
      }));
    },
    refreshSub: function (node) { A().refresh(node.dataset.id); },
    refreshAll: function () {
      if (S().offline) { OD.toast('warn', '当前离线', '恢复网络后再刷新。'); return; }
      A().refreshAll();
    },
    refreshHot: function () {
      OD.toast('info', '正在刷新热搜榜', '榜单为单次抓取的快照，刷新会重新拉取。');
      setTimeout(function () { OD.toast('ok', '热搜榜已更新', S().hotSearches.length + ' 个词条。'); }, 800);
    },
    markAllRead: function () {
      var res = OD.store.query(S().route);
      A().markAllRead(res.list.map(function (i) { return i.id; }));
      OD.toast('ok', '已全部标为已读', res.list.length + ' 条');
    },
    setOffline: function () { A().setOffline(!S().offline); },

    /* 内容 */
    open: function (node) {
      var item = OD.store.itemsById(node.dataset.id);
      if (!item) return;
      if (item.kind === 'article') openArticle(item.id); else openPlayer(item.id);
    },
    openArticle: function (node) { openArticle(node.dataset.id); },
    openSocial: function (node) { openSocial(node.dataset.id); },
    star: function (node, e) {
      if (e) e.stopPropagation();
      var id = node.dataset.id;
      A().toggleStar(id);
      var on = !!S().starred[id];
      OD.toast(on ? 'ok' : 'info', on ? '已加星标' : '已取消星标', OD.store.itemsById(id).title);
      render();
    },
    toggleRead: function (node, e) {
      if (e) e.stopPropagation();
      var id = node.dataset.id;
      A().markRead(id, !S().read[id]);
      render();
    },
    addQueue: function (node) {
      A().addToQueue(node.dataset.id);
      OD.toast('ok', '已加入播放队列', OD.store.itemsById(node.dataset.id).title);
    },
    clearQueue: function () { A().clearQueue(); OD.toast('info', '队列已清空', ''); },
    playId: function (node) { openPlayer(node.dataset.id); },
    copyLink: function (node) {
      var item = OD.store.itemsById(node.dataset.id);
      if (!item || !item.url) { OD.toast('warn', '该条目没有可复制的链接', ''); return; }
      var done = function () { OD.toast('ok', '链接已复制', item.url); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(item.url).then(done, done);
      else done();
    },
    openOriginal: function (node) {
      var item = OD.store.itemsById(node.dataset.id);
      if (!item || !item.url) { OD.toast('warn', '该条目没有原文地址', ''); return; }
      OD.toast('info', '已请求打开系统浏览器', item.url);
    },
    fontSmaller: function () { A().setSetting('fontSize', Math.max(15, S().settings.fontSize - 1)); },
    fontLarger: function () { A().setSetting('fontSize', Math.min(21, S().settings.fontSize + 1)); },
    loadMore: function () { A().setPage(S().route, (S().page[S().route] || 60) + 60); },

    /* 筛选与排序 */
    paneFilter: function (node) {
      var cur = S().filter[S().route] || {};
      var sort = S().sort[S().route] || 'new';
      ui().menu(node, [
        { label: '最新优先', checked: sort === 'new', onPick: function () { A().setSort(S().route, 'new'); render(); } },
        { label: '热度优先', checked: sort === 'hot', onPick: function () { A().setSort(S().route, 'hot'); render(); } },
        { sep: true },
        { label: '仅未读', checked: !!cur.unreadOnly, onPick: function () { A().setFilter(S().route, { unreadOnly: !cur.unreadOnly }); render(); } },
        { label: '清除筛选', onPick: function () { A().setFilter(S().route, { unreadOnly: false, kind: null, platform: null, subId: null }); render(); } }
      ]);
    },
    sortMenu: function (node) {
      var sort = S().sort[S().route] || 'new';
      ui().menu(node, [
        { label: '最新', checked: sort === 'new', onPick: function () { A().setSort(S().route, 'new'); render(); } },
        { label: '最热', checked: sort === 'hot', onPick: function () { A().setSort(S().route, 'hot'); render(); } }
      ]);
    },
    filterUnread: function () {
      var cur = S().filter[S().route] || {};
      A().setFilter(S().route, { unreadOnly: !cur.unreadOnly });
    },
    filterSub: function (node) {
      var cur = S().filter[S().route] || {};
      A().setFilter(S().route, { subId: cur.subId === node.dataset.id ? null : node.dataset.id });
    },
    filterLive: function () {
      var cur = S().filter[S().route] || {};
      A().setFilter(S().route, { kind: cur.kind === 'live' ? null : 'live' });
    },
    clearQuery: function () {
      A().setQuery('');
      render();
    },
    pickHot: function (node) { OD.store.set({ hotWord: node.dataset.word }, { persist: false }); },

    /* 发现 */
    discoverPlatform: function (node) {
      OD.store.set({ discoverPlatform: node.dataset.id, discoverCategory: null, discoverView: 'browse' }, { persist: false });
    },
    pickCategory: function (node) {
      OD.store.set({ discoverCategory: S().discoverCategory === node.dataset.id ? null : node.dataset.id }, { persist: false });
    },
    openSearch: function (node) {
      OD.store.set({
        discoverView: 'search',
        searchPlatform: node && node.dataset.id ? node.dataset.id : S().searchPlatform
      }, { persist: false });
    },
    searchPlatform: function (node) { OD.store.set({ searchPlatform: node.dataset.id }, { persist: false }); },
    searchTab: function (node) { OD.store.set({ searchTab: node.dataset.id }, { persist: false }); },
    subscribeBoard: function (node) {
      if (OD.store.subsById()[node.dataset.sub]) { A().navigate('sub:' + node.dataset.sub); return; }
      var base = OD_CONTENT.subscriptions.filter(function (s) { return s.id === node.dataset.sub; })[0];
      if (!base) { OD.toast('warn', '该榜单暂不能订阅', node.dataset.key); return; }
      A().addSubscription(base);
      OD.toast('ok', '已订阅', base.title);
      render();
    },
    subscribeCategory: function (node) {
      var platform = node.dataset.platform;
      var cat = node.dataset.cat;
      var key = { bilibili: 'bili:live', douyu: 'live:douyu:category', huya: 'live:huya:category' }[platform] || 'live:douyin:category';
      var id = 's-' + platform + '-cat-' + Math.abs(hash(cat));
      if (OD.store.subsById()[id]) { OD.toast('info', '该分区已订阅', cat); return; }
      A().addSubscription({
        id: id, group: 'g-live', title: platform + ' · ' + cat, channel: key, kind: 'live',
        icon: platform, anon: true, note: '由发现层按分区订阅'
      });
      OD.toast('ok', '已订阅分区', cat);
      render();
    },

    /* 凭证 */
    scanLogin: function (node) { openQr(node.dataset.platform || 'bilibili'); },
    saveCredit: function (node) {
      var p = node.dataset.platform;
      var ta = document.getElementById('ck-' + p);
      var val = ta ? ta.value.trim() : '';
      A().setCredential(p, {
        cookie: val,
        status: val ? 'logged-in' : 'anonymous',
        account: val ? '已通过 cookie 登录' : '匿名'
      });
      OD.toast('ok', '凭证已保存', '仅写入本机设置，不随订阅数据同步。');
      render();
    },
    verifyCredit: function (node) {
      var p = node.dataset.platform;
      OD.toast('info', '正在验证凭证', '向平台发起一次轻量探测请求…');
      setTimeout(function () {
        if (p === 'weibo') {
          A().setCredential(p, { status: 'expired', account: '凭证已过期' });
          OD.toast('error', '微博凭证已失效', '接口返回 403：冷 cookie 数分钟即失效，请重新粘贴完整 cookie。');
        } else {
          A().setCredential(p, { status: 'logged-in' });
          OD.toast('ok', '凭证有效', '已解锁该平台的登录态能力。');
        }
        render();
      }, 900);
    },
    clearCredit: function (node) {
      A().setCredential(node.dataset.platform, { cookie: '', status: 'anonymous', account: '匿名' });
      OD.toast('info', '已清除凭证', '该平台回落到匿名能力范围。');
      render();
    },

    /* 播放器 */
    togglePlay: function () { A().setPlaying(!S().playing); OD.views.player.tick(); syncStage(); },
    prev: function () { stepQueue(-1); },
    next: function () { stepQueue(1); },
    toggleMute: function () { A().setMuted(!S().muted); syncStage(); },
    toggleDanmaku: function () {
      A().setDanmakuOn(!S().danmakuVisible);
      OD.views.player.tick();
      var layer = document.getElementById('danmaku');
      var on = OD.store.danmakuOn();
      if (layer) {
        if (on) layer.removeAttribute('hidden');
        else { layer.setAttribute('hidden', ''); layer.innerHTML = ''; }
      }
      var btn = document.querySelector('[data-act="toggleDanmaku"]');
      if (btn) btn.setAttribute('aria-pressed', String(on));
      OD.toast('info', on ? '已开启弹幕' : '已关闭弹幕', '');
    },
    danmakuSettings: function () {
      ui().modal(Object.assign(V().manage.danmakuSettingsModal(), {
        onMount: function (panel) {
          U.bind(panel, {
            settingSwitch: function (node) {
              var key = node.dataset.key;
              A().setSetting(key, !S().settings[key]);
              node.setAttribute('aria-checked', String(!!S().settings[key]));
            },
            settingRadio: function (node) {
              A().setSetting(node.dataset.key, node.dataset.value);
              U.qa('[data-act="settingRadio"][data-key="' + node.dataset.key + '"]', panel).forEach(function (b) {
                b.setAttribute('aria-pressed', String(b.dataset.value === node.dataset.value));
              });
            }
          });
          panel.addEventListener('input', function (e) {
            var n = e.target;
            if (n.dataset.act !== 'settingRange') return;
            A().setSetting(n.dataset.key, Number(n.value));
            var out = n.parentElement.querySelector('.range-value');
            if (out) out.textContent = n.value + (n.dataset.unit || '');
          });
        },
        onClose: function () { OD.views.player.tick(); render(); }
      }));
    },
    rateMenu: function (node) {
      if (S().nowPlaying && S().nowPlaying.kind === 'live') {
        OD.toast('info', '直播不支持倍速', '直播流按实时速率播放。');
        return;
      }
      ui().menu(node, [0.5, 0.75, 1, 1.25, 1.5, 2].map(function (r) {
        return { label: r + '×', checked: S().rate === r, onPick: function () { A().setRate(r); syncStage(); } };
      }));
    },
    qualityMenu: function (node) {
      var item = S().nowPlaying;
      if (!item) return;
      var qs = item.qualities || (item.quality ? [item.quality] : []);
      ui().menu(node, qs.map(function (q, idx) {
        return {
          label: q + (idx === 0 ? '（最高）' : ''),
          checked: (S().quality || qs[0]) === q,
          onPick: function () {
            A().setQuality(q);
            var anon = (S().credentials.bilibili || {}).status !== 'logged-in';
            if (idx === 0 && item.anonLimit && anon) {
              OD.toast('warn', '已切换到 ' + q, '匿名状态下平台实测只返回超清，登录后可解锁原画。');
            } else {
              OD.toast('info', '已切换到 ' + q, '');
            }
            render();
          }
        };
      }));
    },
    liveEdge: function () { OD.views.player.seekTo(1); syncStage(); OD.toast('info', '已回到直播边缘', ''); },
    toggleFullscreen: function () {
      var stage = document.getElementById('stage');
      if (!stage) return;
      if (document.fullscreenElement) document.exitFullscreen();
      else if (stage.requestFullscreen) stage.requestFullscreen();
      else OD.toast('info', '全屏不可用', '当前环境不支持 Fullscreen API。');
    },
    mpvMenu: function (node) {
      var item = S().nowPlaying;
      ui().menu(node, [
        {
          label: S().settings.mpvEnabled ? '用 mpv 打开当前内容' : '启用 mpv 外部播放',
          onPick: function () {
            if (!S().settings.mpvEnabled) {
              A().setSetting('mpvEnabled', true);
              OD.toast('ok', '已启用外部播放器', '未检测到 mpv 时会自动降级为内嵌播放。');
              render();
              return;
            }
            OD.toast('info', '已交给 mpv', (item ? item.title : '') + ' · 按 settings.mpvPath 组装启动参数');
          }
        },
        {
          label: '编辑 mpv 路径',
          onPick: function () {
            A().navigate('page:settings');
            OD.store.set({ settingsTab: 'playback' }, { persist: false });
          }
        },
        { sep: true },
        { label: '缓存目录与用户配置隔离', hint: 'appData', onPick: function () { OD.toast('info', '缓存目录', 'appData/mpv-config/'); } }
      ]);
    },

    /* 引导与面板 */
    finishOnboarding: function () {
      A().setOnboarded();
      ui().closeTop();
      OD.toast('ok', '设置已保存', '可随时在「设置」中调整。');
    },
    openPalette: function () { openPalette(); }
  };

  function hash(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
  }

  /* ---------- 订阅表单 ---------- */
  function wireSubscriptionModal(panel, close) {
    U.bind(panel, {
      pickChannel: function (node) { pickChannelInto(panel, node.dataset.key); },
      submitSub: function () { submitSubscription(panel, close); }
    });
  }

  function pickChannelInto(panel, key) {
    var c = S().channels.channels.filter(function (x) { return x.key === key; })[0];
    if (!c) return;
    panel.dataset.channelKey = key;
    panel.querySelectorAll('[data-act="pickChannel"]').forEach(function (b) {
      b.setAttribute('data-active', String(b.dataset.key === key));
    });
    panel.querySelector('#channel-form').innerHTML = V().manage.channelForm(c);
    var hint = panel.querySelector('#sub-hint');
    if (hint) hint.textContent = c.defaultInfo ? '该渠道带默认参数，可直接订阅。' : '请填写必填参数后再订阅。';
  }

  function submitSubscription(panel, close) {
    var key = panel.dataset.channelKey;
    var c = key ? S().channels.channels.filter(function (x) { return x.key === key; })[0] : null;
    if (!c) { OD.toast('warn', '请先选择渠道', ''); return; }

    var params = {};
    var missing = 0;
    panel.querySelectorAll('[data-param]').forEach(function (input) {
      var name = input.dataset.param;
      var val = (input.value || '').trim();
      input.removeAttribute('aria-invalid');
      var err = panel.querySelector('[data-err="' + name + '"]');
      if (err) err.hidden = true;
      if (name.indexOf('__') === 0) { params[name] = val; return; }
      var tpl = (c.infoTpl || []).filter(function (f) { return f.name === name; })[0];
      if (tpl && tpl.required && !val) {
        missing += 1;
        input.setAttribute('aria-invalid', 'true');
        if (err) {
          err.hidden = false;
          err.querySelector('.err-text').textContent = '「' + tpl.label + '」为必填项，请填写后再提交。';
        }
        return;
      }
      params[name] = val;
    });

    if (missing) {
      OD.toast('error', '有 ' + missing + ' 个必填参数未填写', '已在对应字段下方标出原因。');
      var first = panel.querySelector('[aria-invalid="true"]');
      if (first) first.focus();
      return;
    }

    var title = params.__title || c.title;
    var id = 's-' + c.key.replace(/[^a-z0-9]/gi, '-') + '-' + Math.abs(hash(JSON.stringify(params)));
    A().addSubscription({
      id: id,
      group: params.__group || null,
      title: title,
      channel: c.key,
      kind: c.kind,
      icon: c.platform,
      anon: !c.requiresLogin,
      note: c.note || null,
      info: params,
      refreshIntervalSec: params.__ttl ? Number(params.__ttl) * 60 : null
    });
    close();
    OD.toast('ok', '已添加订阅', title);
    A().navigate('sub:' + id);
  }

  /* ---------- 打开内容 ---------- */
  function openArticle(id) {
    A().markRead(id, true);
    OD.store.set({ selectedArticle: id, lastList: S().route }, { persist: false });
    if (OD.store.nodeMeta(S().route).type !== 'reader') { A().navigate('tab:article'); return; }
    render();
  }

  function openPlayer(id) {
    if (!OD.store.itemsById(id)) return;
    A().setNowPlaying(id);
    OD.store.set({ lastList: S().route }, { persist: false });
    A().navigate('play:' + id);
    OD.views.player.tick();
  }

  function stepQueue(dir) {
    var st = S();
    if (!st.queue.length) { OD.toast('info', '播放队列为空', '在播放页点「加入队列」即可连播。'); return; }
    var idx = st.nowPlaying ? st.queue.indexOf(st.nowPlaying.id) : -1;
    openPlayer(st.queue[(idx + dir + st.queue.length) % st.queue.length]);
  }

  /* ---------- 扫码登录 ---------- */
  function openQr(platform) {
    ui().modal(Object.assign(V().manage.qrModal(platform, 'scanning'), {
      onMount: function (panel, close) {
        U.bind(panel, {
          simulateScan: function () {
            close();
            ui().modal(Object.assign(V().manage.qrModal(platform, 'success'), {
              onClose: function () {
                A().setCredential(platform, { status: 'logged-in', account: '已扫码登录' });
                OD.toast('ok', '登录成功', (platform === 'bilibili' ? '哔哩哔哩' : '小红书') + '凭证已写入本机。');
                render();
              }
            }));
          },
          regenQr: function () {
            close();
            openQr(platform);
            OD.toast('info', '已重新生成二维码', '旧二维码立即失效。');
          }
        });
      }
    }));
  }

  /* ---------- 社交详情 ---------- */
  function openSocial(id) {
    var item = OD.store.itemsById(id);
    if (!item) return;
    var needsResolve = item.platform === 'xiaohongshu';

    ui().modal({
      title: item.title || '动态详情',
      desc: item.source + ' · ' + U.timeAgo(item.publishedAt),
      size: 'wide',
      body: '<div id="social-detail">' + socialDetailBody(item, !needsResolve) + '</div>',
      footer:
        '<button class="btn btn-secondary btn-sm" data-act="star" data-id="' + item.id + '">' +
          (S().starred[item.id] ? icon.solid('star', { size: 14 }) : icon('star', { size: 14 })) +
          (S().starred[item.id] ? '已星标' : '加星标') + '</button>' +
        '<button class="btn btn-secondary btn-sm" data-act="copyLink" data-id="' + item.id + '">' +
          icon('copy', { size: 14 }) + '复制链接</button>' +
        '<div class="spacer"></div>' +
        (item.url
          ? '<button class="btn btn-primary btn-sm" data-act="openOriginal" data-id="' + item.id + '">' +
              icon('external', { size: 14 }) + '在源站打开</button>'
          : ''),
      onMount: function (panel) {
        U.bind(panel, { star: ACT.star, copyLink: ACT.copyLink, openOriginal: ACT.openOriginal });
        if (!needsResolve) return;
        setTimeout(function () {
          var host = document.getElementById('social-detail');
          if (host) host.innerHTML = socialDetailBody(item, true);
        }, 1100);
      }
    });
  }

  function socialDetailBody(item, ready) {
    var first = (item.images || [])[0];
    var media = first
      ? '<div class="social-detail-media">' +
          '<img src="' + U.esc(first.src) + '" alt="' + U.esc(U.clip(item.title, 40)) + '" decoding="async">' +
          (item.video
            ? '<span class="social-detail-play"><span class="stage-bigplay stage-bigplay-sm">' + icon.solid('play', { size: 22 }) + '</span></span>'
            : '') +
        '</div>'
      : '<div class="skeleton social-detail-skeleton"></div>';

    var info = ready
      ? '<div class="social-detail-info">' +
          '<div class="social-detail-head">' +
            (item.avatar
              ? '<img src="' + U.esc(item.avatar) + '" alt="" width="36" height="36" class="avatar-round">'
              : '<span class="article-avatar">' + U.esc((item.author || '?').slice(0, 1)) + '</span>') +
            '<span class="platform-title">' +
              '<span class="t-small card-strong">' + U.esc(item.author) + '</span>' +
              '<span class="t-micro t-dim">' + U.fullDate(item.publishedAt) + '</span>' +
            '</span>' +
            '<span class="spacer"></span>' +
            ui().platformMark(item.platform, 18) +
          '</div>' +
          '<p class="social-detail-text">' + U.esc(item.desc || item.title) + '</p>' +
          (item.tags && item.tags.length
            ? '<div class="social-tags">' + item.tags.map(function (t) {
                return '<span class="tag tag-accent">' + U.esc(String(t).replace(/#/g, '')) + '</span>';
              }).join('') + '</div>'
            : '') +
          '<div class="social-detail-stats">' +
            detailStat('点赞', item.likes) + detailStat('评论', item.comments) + detailStat('来源', item.source) +
          '</div>' +
          (item.token
            ? '<div class="banner">' + icon('info', { size: 16 }) +
                '<div class="banner-body">' +
                  '<span class="banner-title">详情已补全</span>' +
                  '<span>列表页只返回封面与标题，点击后按列表项的 xsec_token 拉取详情；匿名可读全文与多图。</span>' +
                '</div></div>'
            : '') +
        '</div>'
      : '<div class="social-detail-info">' +
          '<span class="skeleton sk-line" style="width:40%"></span>' +
          '<span class="skeleton sk-line" style="width:92%"></span>' +
          '<span class="skeleton sk-line" style="width:78%"></span>' +
          '<span class="skeleton sk-line" style="width:64%"></span>' +
          '<div class="banner">' + icon('checkCircle', { size: 16 }) +
            '<div class="banner-body"><span>正在向源站补全详情（列表页只带封面与标题）。</span></div>' +
          '</div>' +
        '</div>';

    return '<div class="social-detail">' + media + info + '</div>';
  }

  function detailStat(label, value) {
    return '<span class="od-stat"><span class="t-h3 num">' + U.esc(String(value)) + '</span>' +
      '<span class="t-micro t-dim">' + U.esc(label) + '</span></span>';
  }

  /* ---------- 命令面板 ---------- */
  function paletteEntries(q) {
    var st = S();
    var out = [];
    var query = (q || '').trim().toLowerCase();
    function hit(s) { return !query || String(s).toLowerCase().indexOf(query) >= 0; }

    var navs = [];
    OD.store.TABS.forEach(function (t) {
      if (hit(t.label)) navs.push({ kind: 'nav', id: 'tab:' + t.id, title: t.label, sub: '内容类型', icon: t.icon });
    });
    OD.store.SMART.forEach(function (t) {
      if (hit(t.label)) navs.push({ kind: 'nav', id: t.id, title: t.label, sub: '智能订阅', icon: t.icon });
    });
    [['发现', 'page:discover', 'compass'], ['设置', 'page:settings', 'settings'], ['账号与凭证', 'page:account', 'lock']]
      .forEach(function (r) {
        if (hit(r[0])) navs.push({ kind: 'nav', id: r[1], title: r[0], sub: '页面', icon: r[2] });
      });
    if (navs.length) { out.push({ group: '导航' }); out = out.concat(navs); }

    var subs = st.subscriptions.filter(function (s) { return hit(s.title); }).slice(0, 6);
    if (subs.length) {
      out.push({ group: '订阅' });
      subs.forEach(function (s) {
        out.push({
          kind: 'sub', id: s.id, title: s.title,
          sub: s.channel + ' · ' + OD.store.KIND_LABEL[s.kind], icon: s.icon || 'rss'
        });
      });
    }

    var items = st.items.filter(function (i) { return hit(i.title) || hit(i.author); }).slice(0, 8);
    if (items.length) {
      out.push({ group: '内容' });
      items.forEach(function (i) {
        out.push({
          kind: 'item', id: i.id, title: i.title,
          sub: i.source + ' · ' + OD.store.KIND_LABEL[i.kind], icon: OD.store.KIND_ICON[i.kind]
        });
      });
    }

    if (!query) {
      out.push({ group: '命令' });
      [
        ['刷新全部订阅', 'refreshAll', 'refresh'],
        ['添加订阅', 'addSubscription', 'plus'],
        ['管理分组', 'manageGroups', 'folder'],
        ['扫码登录', 'scanLogin', 'qr'],
        ['切换深色 / 浅色主题', 'toggleTheme', 'sun'],
        ['切换离线模拟', 'setOffline', 'wifiOff'],
        ['折叠 / 展开侧栏', 'toggleRail', 'panelLeft'],
        ['清除内容缓存', 'clearContentCache', 'trash']
      ].forEach(function (c) {
        out.push({ kind: 'cmd', id: c[1], title: c[0], sub: '命令', icon: c[2] });
      });
    }
    return out;
  }

  function openPalette() {
    var list = paletteEntries('');
    var activeKey = null;

    function flat(items) { return items.filter(function (x) { return !x.group; }); }
    function ensureActive() {
      var f = flat(list);
      if (!activeKey && f[0]) activeKey = f[0].kind + ':' + f[0].id;
      return activeKey;
    }

    function markup(items) {
      ensureActive();
      var html = '';
      items.forEach(function (it) {
        if (it.group) { html += '<div class="palette-group">' + U.esc(it.group) + '</div>'; return; }
        var key = it.kind + ':' + it.id;
        html += '<button class="palette-item" data-act="palettePick" data-id="' + U.esc(it.id) + '" data-kind="' + it.kind + '"' +
          (key === activeKey ? ' data-active="true"' : '') + '>' +
          icon(it.icon || 'layers', { size: 16 }) +
          '<span class="palette-item-body">' +
            '<span class="palette-item-title od-truncate">' + U.esc(it.title) + '</span>' +
            '<span class="palette-item-sub od-truncate">' + U.esc(it.sub) + '</span>' +
          '</span>' +
        '</button>';
      });
      return html || '<div class="palette-empty t-small t-muted">没有匹配的结果</div>';
    }

    ui().mount({
      variant: 'top',
      html: '<div class="palette" role="dialog" aria-modal="true" aria-label="命令面板">' +
        '<div class="palette-input">' + icon('search', { size: 18 }) +
          '<input id="palette-q" type="text" placeholder="搜索内容、订阅，或执行命令" aria-label="命令面板输入" autocomplete="off">' +
        '</div>' +
        '<div class="palette-list" id="palette-list">' + markup(list) + '</div>' +
        '<div class="palette-hint">' +
          '<span><kbd>↑</kbd><kbd>↓</kbd> 移动</span>' +
          '<span><kbd>Enter</kbd> 打开</span>' +
          '<span><kbd>Esc</kbd> 关闭</span>' +
          '<span class="spacer"></span>' +
          '<span class="num">' + S().items.length + ' 条内容 · ' + S().subscriptions.length + ' 条订阅</span>' +
        '</div>' +
      '</div>',
      onMount: function (panel) {
        var input = panel.querySelector('#palette-q');
        var listNode = panel.querySelector('#palette-list');

        function refresh() {
          list = paletteEntries(input.value);
          activeKey = null;
          ensureActive();
          listNode.innerHTML = markup(list);
        }
        function move(d) {
          var f = flat(list);
          if (!f.length) return;
          var idx = f.map(function (x) { return x.kind + ':' + x.id; }).indexOf(ensureActive());
          var next = f[(idx + d + f.length) % f.length];
          activeKey = next.kind + ':' + next.id;
          listNode.innerHTML = markup(list);
          var el = listNode.querySelector('[data-active="true"]');
          if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
        }
        function choose() {
          var pick = flat(list).filter(function (x) { return x.kind + ':' + x.id === ensureActive(); })[0];
          if (!pick) return;
          ui().closeTop();
          if (pick.kind === 'nav') A().navigate(pick.id);
          else if (pick.kind === 'sub') A().navigate('sub:' + pick.id);
          else if (pick.kind === 'item') {
            var item = OD.store.itemsById(pick.id);
            if (item && item.kind !== 'article') openPlayer(pick.id); else openArticle(pick.id);
          } else if (pick.kind === 'cmd') runCommand(pick.id);
        }

        input.addEventListener('input', refresh);
        listNode.addEventListener('click', function (e) {
          var b = e.target.closest('[data-act="palettePick"]');
          if (!b) return;
          activeKey = b.dataset.kind + ':' + b.dataset.id;
          choose();
        });
        input.addEventListener('keydown', function (e) {
          if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
          else if (e.key === 'Enter') { e.preventDefault(); choose(); }
        });
        input.focus();
      }
    });
  }

  function runCommand(id) {
    if (id === 'scanLogin') { openQr('bilibili'); return; }
    if (ACT[id]) ACT[id]();
  }

  /* =====================================================================
     播放进度同步（不整体重渲染）
     ===================================================================== */
  function syncStage() {
    var st = S();
    var ps = OD.views.player.stageState;
    var item = st.nowPlaying;
    var fill = document.getElementById('seek-fill');
    var knob = document.getElementById('seek-knob');
    var cur = document.getElementById('t-cur');

    if (item && item.kind !== 'live' && ps.duration) {
      var pct = Math.min(100, (ps.t / ps.duration) * 100);
      if (fill) fill.style.width = pct + '%';
      if (knob) knob.style.left = pct + '%';
      if (cur) cur.textContent = OD.views.player.fmt(ps.t);
      var slider = document.querySelector('[data-act="seek"]');
      if (slider) slider.setAttribute('aria-valuenow', String(Math.round(ps.t)));
    }

    var stage = document.getElementById('stage');
    if (!stage) return;
    var playBtn = stage.querySelector('[data-act="togglePlay"]');
    if (playBtn) {
      playBtn.innerHTML = st.playing ? icon.solid('pause', { size: 20 }) : icon.solid('play', { size: 20 });
      playBtn.setAttribute('aria-label', st.playing ? '暂停' : '播放');
    }
    var center = stage.querySelector('.stage-center');
    if (center && st.playing) center.remove();
  }

  setInterval(function () {
    if (OD.store.nodeMeta(S().route).type !== 'player') return;
    if (!S().playing) return;
    OD.views.player.advance(0.25);
    syncStage();
  }, 250);

  var idleTimer = null;
  function armIdle() {
    var stage = document.getElementById('stage');
    if (!stage) return;
    stage.setAttribute('data-idle', 'false');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      var s2 = document.getElementById('stage');
      if (s2 && S().playing) s2.setAttribute('data-idle', 'true');
    }, 2600);
  }

  /* =====================================================================
     事件绑定
     ===================================================================== */
  function resolveAct(node) {
    if (ACT[node.dataset.act]) return ACT[node.dataset.act];
    var scope = node.closest ? node.closest('.modal, .drawer') : null;
    if (scope && scope._acts && scope._acts[node.dataset.act]) return scope._acts[node.dataset.act];
    return null;
  }

  appRoot.addEventListener('click', function (e) {
    var seek = e.target.closest('[data-act="seek"]');
    if (seek) {
      OD.views.player.seekFromEvent(e, seek);
      syncStage();
      OD.views.player.tick();
      return;
    }
    var stageEl = e.target.closest('#stage');
    if (stageEl && !e.target.closest('.stage-controls')) {
      if (stageEl.dataset.idle === 'true') { armIdle(); return; }
      ACT.togglePlay();
      armIdle();
      return;
    }
    var node = e.target.closest('[data-act]');
    if (!node) return;
    var fn = resolveAct(node);
    if (!fn) return;
    if (node.tagName === 'A') e.preventDefault();
    fn(node, e);
  });

  appRoot.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var node = e.target.closest('[data-act-enter]');
    if (!node || !appRoot.contains(node)) return;
    if (e.target.closest('input, textarea, select')) return;
    var fn = resolveAct({ dataset: { act: node.dataset.actEnter }, closest: function () { return null; } });
    if (!fn) return;
    e.preventDefault();
    fn(node, e);
  });

  appRoot.addEventListener('pointerdown', function (e) {
    var seek = e.target.closest('[data-act="seek"]');
    if (!seek) return;
    e.preventDefault();
    if (seek.setPointerCapture) seek.setPointerCapture(e.pointerId);
    var move = function (ev) { OD.views.player.seekFromEvent(ev, seek); syncStage(); };
    var up = function () {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      OD.views.player.tick();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });

  appRoot.addEventListener('mousemove', function (e) {
    if (e.target.closest && e.target.closest('#stage')) armIdle();
  });

  appRoot.addEventListener('scroll', function (e) {
    var node = e.target;
    if (!node.classList || !node.classList.contains('article-scroll')) return;
    var bar = document.querySelector('#read-progress span');
    if (!bar) return;
    var max = node.scrollHeight - node.clientHeight;
    bar.style.width = (max > 0 ? Math.min(100, (node.scrollTop / max) * 100) : 0) + '%';
  }, true);

  appRoot.addEventListener('input', function (e) {
    var n = e.target;
    if (n.dataset.act === 'settingRange') {
      var v = Number(n.value);
      A().setSetting(n.dataset.key, v);
      var out = n.parentElement.querySelector('.range-value');
      if (out) out.textContent = v + (n.dataset.unit || '');
      if (n.dataset.key.indexOf('danmaku') === 0) OD.views.player.tick();
      return;
    }
    if (n.dataset.act === 'volume') { A().setVolume(Number(n.value) / 100); return; }
    if (n.dataset.act === 'settingText') { A().setSetting(n.dataset.key, n.value); return; }
    if (n.id === 'search-input') { A().setQuery(n.value); render(); return; }
    if (n.id === 'dsearch') { OD.store.set({ searchQuery: n.value }, { persist: false }); render(); return; }
  });

  appRoot.addEventListener('change', function (e) {
    var n = e.target;
    if (n.dataset.act === 'settingNumber') { A().setSetting(n.dataset.key, Number(n.value)); return; }
    if (n.dataset.act === 'settingSelect') { A().setSetting(n.dataset.key, n.value); return; }
  });

  document.addEventListener('keydown', function (e) {
    var meta = e.metaKey || e.ctrlKey;
    var overlayOpen = !!document.querySelector('.scrim');

    if (meta && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
    if (overlayOpen) return;
    if (meta && e.key === '\\') { e.preventDefault(); A().toggleRail(); return; }
    if (meta && e.key.toLowerCase() === 'r') { e.preventDefault(); ACT.refreshAll(); return; }
    if (meta && e.key.toLowerCase() === 'f') { e.preventDefault(); ACT.openSearch({ dataset: { id: S().searchPlatform } }); return; }
    if (meta && e.key === ',') { e.preventDefault(); A().navigate('page:settings'); return; }
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;

    var type = OD.store.nodeMeta(S().route).type;
    if (type === 'player') {
      var ps = OD.views.player.stageState;
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); ACT.togglePlay(); armIdle(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); OD.views.player.seekTo(Math.min(1, (ps.t + 5) / Math.max(1, ps.duration))); syncStage(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); OD.views.player.seekTo(Math.max(0, (ps.t - 5) / Math.max(1, ps.duration))); syncStage(); return; }
      if (e.key === 'f') { e.preventDefault(); ACT.toggleFullscreen(); return; }
      if (e.key === 'd') { e.preventDefault(); ACT.toggleDanmaku(); return; }
      if (e.key === 'm') { e.preventDefault(); ACT.toggleMute(); return; }
      if (e.key === 'Escape') { e.preventDefault(); A().navigate(S().lastList || 'tab:all'); return; }
    }
    if (type === 'reader') {
      var res = OD.store.query(S().route, { paged: true });
      if (!res.list.length) return;
      var cur = S().selectedArticle || res.list[0].id;
      var idx = res.list.map(function (i) { return i.id; }).indexOf(cur);
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        var n1 = res.list[Math.min(res.list.length - 1, idx + 1)];
        if (n1) openArticle(n1.id);
      }
      if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        var n2 = res.list[Math.max(0, idx - 1)];
        if (n2) openArticle(n2.id);
      }
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { A().setPlaying(false); syncStage(); }
  });

  window.addEventListener('resize', U.debounce(function () { applyMasonry(); }, 140));
  window.addEventListener('online', function () { if (S().offline) A().setOffline(false); });

  /* =====================================================================
     启动
     ===================================================================== */
  OD.store.subscribe(function () { render(); });
  OD.store.applySettings();
  render();

  // 首帧先给出加载骨架，随后落到真实内容
  setTimeout(function () {
    if (S().loadingView) OD.store.set({ loadingView: false }, { persist: false });
  }, 520);

  if (!S().onboarded) {
    setTimeout(function () {
      ui().modal(Object.assign(V().manage.onboardingModal(), {
        onMount: function (panel, close) {
          U.bind(panel, {
            finishOnboarding: function () {
              A().setOnboarded();
              close();
              OD.toast('ok', '欢迎使用', '所有设置都可在「设置」中随时调整。');
            }
          });
        }
      }));
    }, 420);
  }
})();
