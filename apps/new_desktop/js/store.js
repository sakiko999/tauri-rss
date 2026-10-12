/* 应用状态、派生查询与动作。UI 只读状态并调用动作，不直接改数据。 */
(function () {
  'use strict';

  var C = window.OD_CONTENT;
  var LS_KEY = 'od-rss:v1';

  var KINDS = ['article', 'video', 'audio', 'live', 'social'];
  var KIND_LABEL = { article: '文章', video: '视频', audio: '音频', live: '直播', social: '社交' };
  var KIND_ICON = { article: 'rss', video: 'play', audio: 'music', live: 'radio', social: 'message' };
  var SMART = [
    { id: 'today', label: '今日', icon: 'clock' },
    { id: 'unread', label: '未读', icon: 'inbox' },
    { id: 'starred', label: '已星标', icon: 'star' }
  ];
  var TABS = [{ id: 'all', label: '全部', icon: 'layers' }].concat(KINDS.map(function (k) {
    return { id: k, label: KIND_LABEL[k], icon: KIND_ICON[k] };
  }));

  function defaults() {
    var flat = {};
    ['appearance', 'reading', 'playback', 'danmaku'].forEach(function (g) {
      (C.settings[g] || []).forEach(function (f) { flat[f.key] = f.value; });
    });
    return {
      theme: flat.theme || 'dark',
      density: flat.density || 'standard',
      fontSize: flat.fontSize || 17,
      measure: flat.measure || 'comfortable',
      motion: flat.motion || 'standard',
      markReadOnOpen: flat.markReadOnOpen !== false,
      imageProxy: flat.imageProxy !== false,
      dataSaver: !!flat.dataSaver,
      refreshIntervalMin: flat.refreshIntervalMin || 30,
      cacheTtlMin: flat.cacheTtlMin || 30,
      autoplayVideo: flat.autoplayVideo !== false,
      startMuted: !!flat.startMuted,
      defaultQuality: flat.defaultQuality || 'highest',
      lockHighest: flat.lockHighest !== false,
      mpvEnabled: !!flat.mpvEnabled,
      mpvPath: flat.mpvPath || '',
      danmakuEnabled: flat.danmakuEnabled !== false,
      danmakuOpacity: flat.danmakuOpacity || 85,
      danmakuFontSize: flat.danmakuFontSize || 22,
      danmakuSpeed: flat.danmakuSpeed || 'standard',
      danmakuArea: flat.danmakuArea || 'half',
      danmakuBlock: flat.danmakuBlock !== false
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      return raw ? (JSON.parse(raw) || {}) : {};
    } catch (e) { return {}; }
  }

  var saved = load();

  var state = {
    route: 'tab:all',
    items: C.items,
    subscriptions: C.subscriptions.map(function (s) {
      return Object.assign({ enabled: true, lastError: null, lastFetched: C.generatedAt, refreshIntervalSec: null }, s);
    }),
    groups: C.groups.map(function (g) { return Object.assign({}, g); }),
    hotSearches: C.hotSearches.slice(),
    channels: C.channels,
    discovery: C.discoveries,
    queue: C.queue.slice(),
    openGroups: {},

    // 视图筛选与分页
    filter: {},
    sort: {},
    page: {},
    query: '',

    // 路由与子视图
    selectedArticle: null,
    lastList: 'tab:all',
    hotWord: null,
    hotQueries: {},
    discoverView: 'browse',
    discoverPlatform: 'bilibili',
    discoverCategory: null,
    searchPlatform: 'bilibili',
    searchTab: 'rooms',
    searchQuery: '',
    settingsTab: 'appearance',

    // 阅读状态
    read: saved.read || {},
    starred: saved.starred || {},

    // 播放器
    nowPlaying: null,
    playing: false,
    muted: false,
    volume: 0.8,
    quality: null,
    rate: 1,
    danmakuVisible: true,

    // 设置与凭证
    settings: Object.assign(defaults(), saved.settings || {}),
    credentials: saved.credentials || {},

    // 瞬时态
    busy: {},
    offline: false,
    loadingView: true,
    collapsedRail: !!saved.collapsedRail,
    onboarded: !!saved.onboarded,
    banner: null
  };

  C.groups.forEach(function (g) { state.openGroups[g.id] = !!g.expanded; });

  /* ---------- 持久化 ---------- */
  var persist = U.debounce(function () {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        read: state.read,
        starred: state.starred,
        settings: state.settings,
        credentials: state.credentials,
        collapsedRail: state.collapsedRail,
        onboarded: state.onboarded
      }));
    } catch (e) {}
  }, 220);

  /* ---------- 订阅机制 ---------- */
  var listeners = [];
  function notify() { listeners.forEach(function (fn) { fn(state); }); }

  function set(patch, opts) {
    Object.keys(patch).forEach(function (k) { state[k] = patch[k]; });
    if (!opts || opts.persist !== false) persist();
    notify();
  }

  function subscribe(fn) {
    listeners.push(fn);
    return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
  }

  /* ---------- 派生查询 ---------- */
  function subsById() {
    var m = {};
    state.subscriptions.forEach(function (s) { m[s.id] = s; });
    return m;
  }

  function baseFor(node) {
    if (!node || node === 'tab:all') return state.items.slice();
    if (node.indexOf('tab:') === 0) {
      var k = node.slice(4);
      return state.items.filter(function (i) { return i.kind === k; });
    }
    if (node === 'today') return state.items.filter(function (i) { return U.isToday(i.publishedAt); });
    if (node === 'unread') return state.items.filter(function (i) { return !state.read[i.id]; });
    if (node === 'starred') return state.items.filter(function (i) { return state.starred[i.id]; });
    if (node.indexOf('sub:') === 0) {
      var id = node.slice(4);
      return state.items.filter(function (i) { return i.subId === id; });
    }
    if (node.indexOf('group:') === 0) {
      var gid = node.slice(6);
      var ids = state.subscriptions.filter(function (s) { return s.group === gid; }).map(function (s) { return s.id; });
      return state.items.filter(function (i) { return ids.indexOf(i.subId) >= 0; });
    }
    return state.items.slice();
  }

  function heatOf(i) {
    if (i.views) return i.views;
    if (i.online) return i.online;
    if (i.likes) return Number(String(i.likes).replace(/\D/g, '')) || 0;
    return 0;
  }

  function sortItems(list, mode) {
    var cp = list.slice();
    if (mode === 'hot') cp.sort(function (a, b) { return heatOf(b) - heatOf(a); });
    else cp.sort(function (a, b) { return Date.parse(b.publishedAt) - Date.parse(a.publishedAt); });
    return cp;
  }

  function query(node, opts) {
    var n = node || state.route;
    opts = opts || {};
    var list = baseFor(n);
    var f = state.filter[n] || {};
    if (f.kind) list = list.filter(function (i) { return i.kind === f.kind; });
    if (f.platform) list = list.filter(function (i) { return i.platform === f.platform; });
    if (f.subId) list = list.filter(function (i) { return i.subId === f.subId; });
    if (f.unreadOnly) list = list.filter(function (i) { return !state.read[i.id]; });

    var q = state.query.trim().toLowerCase();
    if (q) {
      list = list.filter(function (i) {
        return (i.title || '').toLowerCase().indexOf(q) >= 0 ||
          (i.author || '').toLowerCase().indexOf(q) >= 0 ||
          (i.source || '').toLowerCase().indexOf(q) >= 0 ||
          (i.excerpt || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    list = sortItems(list, state.sort[n] || 'new');
    if (opts.paged) {
      var cap = state.page[n] || 60;
      return { list: list.slice(0, cap), total: list.length, hasMore: list.length > cap };
    }
    return { list: list, total: list.length, hasMore: false };
  }

  function unreadCount(node) {
    return baseFor(node).filter(function (i) { return !state.read[i.id]; }).length;
  }

  function kindCounts() {
    var m = { all: state.items.length };
    KINDS.forEach(function (k) { m[k] = 0; });
    state.items.forEach(function (i) { m[i.kind] = (m[i.kind] || 0) + 1; });
    return m;
  }

  function subUnread(id) {
    return state.items.filter(function (i) { return i.subId === id && !state.read[i.id]; }).length;
  }

  function healthOf(sub) {
    if (!sub) return 'ok';
    if (sub.enabled === false) return 'disabled';
    if (state.busy[sub.id]) return 'busy';
    if (sub.lastError) return sub.lastError === 'stale' ? 'stale' : 'error';
    return 'ok';
  }

  function currentSub() {
    return state.route.indexOf('sub:') === 0 ? (subsById()[state.route.slice(4)] || null) : null;
  }

  function nodeMeta(node) {
    var n = node || state.route;
    var sub = null, group = null, kind = null, title = '', icon = 'layers', type = 'list';
    if (n.indexOf('tab:') === 0) {
      var k = n.slice(4);
      kind = k === 'all' ? null : k;
      title = k === 'all' ? '全部内容' : KIND_LABEL[k];
      icon = k === 'all' ? 'layers' : KIND_ICON[k];
      type = k === 'article' ? 'reader' : 'media';
    } else if (n === 'today') { title = '今日'; icon = 'clock'; type = 'media'; }
    else if (n === 'unread') { title = '未读'; icon = 'inbox'; type = 'media'; }
    else if (n === 'starred') { title = '已星标'; icon = 'star'; type = 'media'; }
    else if (n.indexOf('sub:') === 0) {
      sub = subsById()[n.slice(4)] || null;
      if (sub) {
        title = sub.title; kind = sub.kind; icon = sub.icon || 'rss';
        type = sub.kind === 'article' ? 'reader' : 'media';
      } else { title = '订阅'; type = 'media'; }
    } else if (n.indexOf('group:') === 0) {
      group = state.groups.filter(function (g) { return g.id === n.slice(6); })[0] || null;
      title = group ? group.title : '分组';
      type = 'media';
    } else if (n === 'page:discover') { title = '发现'; type = 'page'; icon = 'compass'; }
    else if (n === 'page:settings') { title = '设置'; type = 'page'; icon = 'settings'; }
    else if (n === 'page:account') { title = '账号与凭证'; type = 'page'; icon = 'lock'; }
    else if (n.indexOf('play:') === 0) { title = '播放'; type = 'player'; icon = 'play'; }
    return { node: n, sub: sub, group: group, kind: kind, title: title, icon: icon, type: type };
  }

  function itemsById(id) {
    return state.items.filter(function (i) { return i.id === id; })[0] || null;
  }

  /* ---------- 添加订阅：由库内真实数据派生候选项 ----------
     候选值一律取自真实条目（直播房号来自条目的 url 末段、分区来自平台分区树），
     不足时返回空数组由界面降级为手填，绝不编造 uid / 房号。 */
  /* 以逗号分隔、可把候选并入已有订阅的参数（房间号列表） */
  var MULTI_PARAMS = ['roomIds'];

  /* 该渠道的首个参数是否支持并入已有订阅（只有列表型参数能「加进去」） */
  function multiParamOf(channel) {
    var f = ((channel || {}).infoTpl || [])[0];
    return !!f && MULTI_PARAMS.indexOf(f.name) >= 0;
  }

  function hostOf(url) {
    return String(url || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  }
  function roomOf(url) {
    return String(url || '').split('/').pop();
  }
  /* 缩略图按 kind 取真实字段；没有就返回 null，由界面用平台图标兜底，不编造图片 */
  function thumbOf(i) {
    if (!i) return null;
    if (i.cover) return i.cover;
    if (i.images && i.images[0]) return i.images[0].src || null;
    if (i.image) return typeof i.image === 'string' ? i.image : (i.image.file || null);
    return null;
  }
  function fmtNum(n) {
    n = Number(n) || 0;
    if (n >= 100000000) return (n / 100000000).toFixed(1).replace(/\.0$/, '') + '亿';
    if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
    return String(n);
  }

  function candidatesFor(channel) {
    if (!channel) return [];
    var tpl = channel.infoTpl || [];
    var name = tpl.length ? tpl[0].name : null;
    var items = state.items;
    var seen = {}, out = [];
    var add = function (value, label, sub, thumb, meta) {
      if (!value || seen[value]) return;
      seen[value] = 1;
      out.push({
        value: String(value), label: label, sub: sub || '',
        thumb: thumb || null, meta: (meta || []).filter(Boolean)
      });
    };
    var catOf = function (pid) {
      var p = state.discovery.platforms.filter(function (x) { return x.id === pid; })[0];
      return p ? p.categories : [];
    };

    if (channel.key === 'bili:ranking') {
      catOf('bilibili').forEach(function (c) { add(c.id, c.name, '分区 ID ' + c.id); });

    } else if (name === 'keyword') {
      var pool = items.filter(function (i) { return i.kind === 'live' && i.platform === channel.platform; });
      if (channel.key.indexOf('anchor') >= 0) {
        pool.forEach(function (i) {
          add(i.author, i.author, i.area, thumbOf(i), [fmtNum(i.online) + ' 在看']);
        });
      } else {
        // 条目上的分区名通常只有「综合」，单靠它候选太少；
        // 再并入平台真实分区树的名字，两者都是真人会搜的词。
        var areaCount = {};
        pool.forEach(function (i) { areaCount[i.area] = (areaCount[i.area] || 0) + 1; });
        pool.forEach(function (i) {
          add(i.area, i.area, '在播分区', null, [areaCount[i.area] + ' 个房间']);
        });
        catOf(channel.platform).forEach(function (c) { add(c.name, c.name, '分区名', null, []); });
      }

    } else if (name === 'roomIds') {
      items.filter(function (i) { return i.kind === 'live' && i.platform === channel.platform; })
        .forEach(function (i) {
          add(roomOf(i.url), i.title, i.author + ' · 房号 ' + roomOf(i.url), thumbOf(i),
            [i.area, fmtNum(i.online) + ' 在看']);
        });

    } else if (name === 'gameId' || name === 'areaId') {
      catOf(channel.platform).forEach(function (c) { add(c.id, c.name, '分区 ID ' + c.id); });

    } else if (name === 'url') {
      var byHost = {};
      items.filter(function (i) { return i.kind === 'article' || i.kind === 'audio'; })
        .forEach(function (i) {
          var h = hostOf(i.url);
          if (!byHost[h]) byHost[h] = { n: 0, item: i };
          byHost[h].n++;
        });
      Object.keys(byHost).forEach(function (h) {
        var g = byHost[h];
        add(h, g.item.source || g.item.author || h, h, thumbOf(g.item), [g.n + ' 条已收录']);
      });

    } else if (name === 'channelId') {
      items.filter(function (i) { return i.platform === 'youtube'; })
        .forEach(function (i) { add(i.author, i.author, i.title, thumbOf(i), [KIND_LABEL[i.kind] || i.kind]); });

    } else if (name === 'route') {
      state.channels.channels.filter(function (c) { return c.key.indexOf('rsshub:') === 0; })
        .forEach(function (c) {
          add(c.key.slice(7), c.title, c.key, null, [KIND_LABEL[c.kind] || c.kind]);
        });
    }
    return out;
  }

  function subExists(channelKey, value) {
    return subsHolding(channelKey, null, value).length > 0;
  }

  /* 某个渠道里已存在的订阅（搜索添加的「添加到」候选） */
  function subsOfChannel(channelKey) {
    return state.subscriptions.filter(function (s) { return s.channel === channelKey; });
  }

  /* 取出某条订阅某个参数的值列表。只有列表型参数按逗号切分 ——
     关键词之类的单值参数本身就可能含逗号（「英雄联盟,王者」），切了会误判成已订阅。 */
  function valueList(sub, param) {
    if (!sub || !param || !sub.info) return [];
    var raw = String(sub.info[param] || '').trim();
    if (!raw) return [];
    if (MULTI_PARAMS.indexOf(param) < 0) return [raw];
    return raw.split(',').map(function (v) { return v.trim(); }).filter(Boolean);
  }

  /* 该渠道下哪些订阅已经含有这个值 —— 可能不止一条（重复订阅） */
  function subsHolding(channelKey, param, value) {
    var first = (state.channels.channels.filter(function (c) { return c.key === channelKey; })[0] || {}).infoTpl;
    var key = param || (first && first.length ? first[0].name : null);
    if (!key) return [];
    return subsOfChannel(channelKey).filter(function (s) {
      return valueList(s, key).indexOf(String(value)) >= 0;
    });
  }

  /* ---------- 动作 ---------- */
  var actions = {
    navigate: function (node) { set({ route: node }, { persist: false }); },
    toggleGroup: function (id) {
      var m = Object.assign({}, state.openGroups);
      m[id] = !m[id];
      set({ openGroups: m }, { persist: false });
    },
    toggleRail: function () { set({ collapsedRail: !state.collapsedRail }); },

    setQuery: function (q) { set({ query: q }, { persist: false }); },
    setFilter: function (node, patch) {
      var f = Object.assign({}, state.filter);
      f[node] = Object.assign({}, f[node], patch);
      set({ filter: f }, { persist: false });
    },
    setSort: function (node, mode) {
      var s = Object.assign({}, state.sort);
      s[node] = mode;
      set({ sort: s }, { persist: false });
    },
    setPage: function (node, n) {
      var p = Object.assign({}, state.page);
      p[node] = n;
      set({ page: p }, { persist: false });
    },

    markRead: function (id, read) {
      var m = Object.assign({}, state.read);
      if (read === false) delete m[id]; else m[id] = Date.now();
      set({ read: m });
    },
    markAllRead: function (ids) {
      var m = Object.assign({}, state.read);
      ids.forEach(function (id) { m[id] = Date.now(); });
      set({ read: m });
    },
    toggleStar: function (id) {
      var m = Object.assign({}, state.starred);
      if (m[id]) delete m[id]; else m[id] = Date.now();
      set({ starred: m });
    },

    toggleSub: function (id) {
      set({
        subscriptions: state.subscriptions.map(function (s) {
          return s.id === id ? Object.assign({}, s, { enabled: s.enabled === false }) : s;
        })
      });
    },
    refresh: function (id) {
      var busy = Object.assign({}, state.busy);
      busy[id] = true;
      set({ busy: busy }, { persist: false });
      setTimeout(function () {
        var failing = id === 's-weibo-user';
        var list = state.subscriptions.map(function (s) {
          if (s.id !== id) return s;
          return Object.assign({}, s, {
            lastError: failing ? '未登录：接口返回 403，凭证已失效' : (s.id === 's-live-bili' ? null : null),
            lastFetched: failing ? s.lastFetched : new Date().toISOString()
          });
        });
        var b2 = Object.assign({}, state.busy);
        delete b2[id];
        set({ subscriptions: list, busy: b2 }, { persist: false });
        var target = list.filter(function (s) { return s.id === id; })[0];
        if (failing) {
          window.OD.toast('error', '刷新失败：' + target.title,
            '接口返回 403，登录凭证已失效。旧缓存已保留展示，不会出现内容空窗。');
        } else {
          window.OD.toast('ok', '已更新 ' + target.title, 'TTL 内命中的订阅直接复用缓存，未发起网络请求。');
        }
      }, 900);
    },
    refreshAll: function () {
      var busy = {};
      state.subscriptions.forEach(function (s) { busy[s.id] = true; });
      set({ busy: busy, offline: false }, { persist: false });
      window.OD.toast('info', '正在刷新全部订阅',
        state.subscriptions.length + ' 条订阅，受 TTL 缓存约束的直接命中缓存。');
      setTimeout(function () {
        var list = state.subscriptions.map(function (s) {
          return Object.assign({}, s, { lastFetched: new Date().toISOString(), lastError: null });
        });
        set({ busy: {}, subscriptions: list }, { persist: false });
        window.OD.toast('warn', '刷新完成，1 条失败',
          (list.length - 1) + ' 条更新成功；「微博关注人」因凭证失效跳过，其余已完成。');
      }, 1500);
    },

    setOffline: function (v) { set({ offline: !!v }); },

    addSubscription: function (sub) {
      set({
        subscriptions: state.subscriptions.concat([
          Object.assign({ enabled: true, lastError: null, lastFetched: new Date().toISOString(), refreshIntervalSec: null }, sub)
        ])
      });
      return sub.id;
    },
    updateSubscription: function (id, patch) {
      set({ subscriptions: state.subscriptions.map(function (s) { return s.id === id ? Object.assign({}, s, patch) : s; }) });
    },
    removeSubscription: function (id) {
      set({ subscriptions: state.subscriptions.filter(function (s) { return s.id !== id; }) });
    },
    addGroup: function (title) {
      var id = 'g-' + Date.now().toString(36);
      set({ groups: state.groups.concat([{ id: id, title: title, expanded: true }]) });
      return id;
    },
    renameGroup: function (id, title) {
      set({ groups: state.groups.map(function (g) { return g.id === id ? Object.assign({}, g, { title: title }) : g; }) });
    },
    removeGroup: function (id) {
      set({
        subscriptions: state.subscriptions.map(function (s) { return s.group === id ? Object.assign({}, s, { group: null }) : s; }),
        groups: state.groups.filter(function (g) { return g.id !== id; })
      });
    },

    setSetting: function (key, value) {
      var s = Object.assign({}, state.settings);
      s[key] = value;
      state.settings = s;
      applySettings();
      persist();
      notify();
    },
    setCredential: function (platform, patch) {
      var c = Object.assign({}, state.credentials);
      c[platform] = Object.assign({}, c[platform], patch);
      set({ credentials: c });
    },

    setNowPlaying: function (id) {
      var item = itemsById(id);
      set({ nowPlaying: item, playing: true, rate: 1, quality: item && item.qualities ? item.qualities[0] : null }, { persist: false });
    },
    setPlaying: function (v) { set({ playing: !!v }, { persist: false }); },
    setVolume: function (v) { set({ volume: v, muted: v === 0 }, { persist: false }); },
    setMuted: function (v) { set({ muted: !!v }, { persist: false }); },
    setQuality: function (q) { set({ quality: q }, { persist: false }); },
    setRate: function (r) { set({ rate: r }, { persist: false }); },
    setDanmakuOn: function (v) { set({ danmakuVisible: !!v }, { persist: false }); },
    addToQueue: function (id) {
      if (state.queue.indexOf(id) >= 0) return;
      set({ queue: state.queue.concat([id]) });
    },
    clearQueue: function () { set({ queue: [] }); },

    setOnboarded: function () { set({ onboarded: true }); },
    dismissBanner: function () { set({ banner: null }); }
  };

  /* 弹幕开关统一读取：设置项为总开关，播放页可临时关闭 */
  function danmakuOn() {
    return state.danmakuVisible && state.settings.danmakuEnabled;
  }

  function applySettings() {
    var s = state.settings;
    var root = document.documentElement;
    var theme = s.theme;
    if (theme === 'system') {
      theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    root.dataset.theme = theme;
    root.dataset.density = s.density;
    root.dataset.motion = s.motion;
    root.dataset.measure = s.measure;
    root.style.setProperty('--article-fs', s.fontSize + 'px');
  }

  window.OD = window.OD || {};
  window.OD.store = {
    state: state,
    set: set,
    subscribe: subscribe,
    notify: notify,
    actions: actions,
    applySettings: applySettings,
    danmakuOn: danmakuOn,
    KINDS: KINDS,
    KIND_LABEL: KIND_LABEL,
    KIND_ICON: KIND_ICON,
    TABS: TABS,
    SMART: SMART,
    query: query,
    baseFor: baseFor,
    sortItems: sortItems,
    heatOf: heatOf,
    unreadCount: unreadCount,
    kindCounts: kindCounts,
    subUnread: subUnread,
    healthOf: healthOf,
    nodeMeta: nodeMeta,
    currentSub: currentSub,
    subsById: subsById,
    itemsById: itemsById,
    candidatesFor: candidatesFor,
    subExists: subExists,
    subsHolding: subsHolding,
    subsOfChannel: subsOfChannel,
    valueList: valueList,
    multiParamOf: multiParamOf
  };
})();

