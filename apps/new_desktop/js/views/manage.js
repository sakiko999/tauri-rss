/* 管理视图族：设置、账号与凭证、扫码登录、添加与编辑订阅、分组管理、弹幕设置、首启动引导 */
(function () {
  'use strict';

  var OD = window.OD;
  var S = function () { return OD.store.state; };
  var ui = function () { return OD.ui; };

  var PLATFORM_LABEL = { bilibili: '哔哩哔哩', weibo: '微博', xiaohongshu: '小红书' };

  var SETTING_TABS = [
    { id: 'appearance', label: '外观', icon: 'sun' },
    { id: 'reading', label: '阅读与缓存', icon: 'text' },
    { id: 'playback', label: '播放', icon: 'play' },
    { id: 'danmaku', label: '弹幕', icon: 'danmaku' },
    { id: 'diagnostics', label: '存储与诊断', icon: 'database' }
  ];

  /* =====================================================================
     设置
     ===================================================================== */
  function settingsPage() {
    var tab = S().settingsTab || 'appearance';
    return '<div class="page"><div class="scroll-area page-scroll">' +
      '<div class="page-wrap">' +
        '<h1 class="page-title">设置</h1>' +
        '<p class="page-lead">所有选项即时生效并写入本地存储。深色与浅色两套主题各自独立取色，未以其中一侧推断另一侧。</p>' +
        '<div class="segmented segmented-wrap">' +
          SETTING_TABS.map(function (t) {
            return '<button data-act="settingsTab" data-id="' + t.id + '" aria-pressed="' + (tab === t.id) + '">' +
              (tab === t.id ? icon(t.icon, { size: 13 }) : '') + U.esc(t.label) + '</button>';
          }).join('') +
        '</div>' +
        (tab === 'diagnostics' ? diagnosticsPanel() : settingGroup(tab)) +
      '</div>' +
    '</div></div>';
  }

  function settingGroup(tab) {
    var fields = (OD_CONTENT.settings[tab] || []);
    return '<div class="side-card"><div class="side-card-body pad">' +
      fields.map(settingRow).join('') +
    '</div></div>';
  }

  function settingRow(f) {
    var st = S();
    var cur = st.settings[f.key] != null ? st.settings[f.key] : f.value;
    var control = '';

    if (f.type === 'switch') {
      control = '<button class="switch" role="switch" aria-checked="' + !!cur + '" aria-labelledby="lbl-' + f.key +
        '" data-act="settingSwitch" data-key="' + f.key + '"></button>';
    } else if (f.type === 'radio') {
      control = '<div class="segmented">' + f.options.map(function (o) {
        return '<button data-act="settingRadio" data-key="' + f.key + '" data-value="' + o.value + '" aria-pressed="' +
          (cur === o.value) + '">' + U.esc(o.label) + '</button>';
      }).join('') + '</div>';
    } else if (f.type === 'range') {
      control = '<div class="range">' +
        '<input type="range" min="' + f.min + '" max="' + f.max + '" step="' + f.step + '" value="' + cur +
          '" data-act="settingRange" data-key="' + f.key + '" data-unit="' + U.esc(f.unit || '') +
          '" aria-labelledby="lbl-' + f.key + '">' +
        '<span class="range-value num">' + cur + U.esc(f.unit || '') + '</span>' +
      '</div>';
    } else if (f.type === 'number') {
      control = '<span class="number-row">' +
        '<input class="input input-number" type="number" min="' + f.min + '" max="' + f.max + '" value="' + cur +
          '" data-act="settingNumber" data-key="' + f.key + '" aria-labelledby="lbl-' + f.key + '">' +
        '<span class="t-small t-dim">' + U.esc(f.unit || '') + '</span>' +
      '</span>';
    } else if (f.type === 'select') {
      control = '<select class="select select-fixed" data-act="settingSelect" data-key="' + f.key +
        '" aria-labelledby="lbl-' + f.key + '">' + f.options.map(function (o) {
          return '<option value="' + o.value + '"' + (cur === o.value ? ' selected' : '') + '>' + U.esc(o.label) + '</option>';
        }).join('') + '</select>';
    } else {
      control = '<input class="input input-wide" value="' + U.esc(cur) + '" data-act="settingText" data-key="' + f.key +
        '" aria-labelledby="lbl-' + f.key + '">';
    }
    return ui().settingRow(f.key, f.label, f.help, control);
  }

  function diagnosticsPanel() {
    var storage = OD_CONTENT.settings.storage;
    var logDomains = OD_CONTENT.settings.logDomains;
    var assetCount = Object.keys(OD_CONTENT.assetSizes).length;

    return '<div class="stack">' +
      '<div class="side-card">' +
        '<div class="side-card-head">' + icon('database', { size: 16 }) +
          '<span class="side-card-title">存储占用</span></div>' +
        '<div class="side-card-body pad">' +
          storage.map(function (r) {
            return '<div class="info-row">' +
              '<span class="info-key">' + U.esc(r.label) + '</span>' +
              '<span class="info-val">' +
                '<span class="t-small">' + U.esc(r.value) + '</span>' +
                '<span class="t-micro t-dim">' + U.esc(r.detail) + '</span>' +
              '</span>' +
            '</div>';
          }).join('') +
          '<div class="meter-block">' +
            '<div class="meter-head"><span class="t-micro t-dim">内容缓存用量</span>' +
              '<span class="t-micro num">1.9 GB / 4 GB</span></div>' +
            '<div class="meter"><span style="width:48%"></span></div>' +
          '</div>' +
          '<div class="chip-row">' +
            '<button class="btn btn-secondary btn-sm" data-act="clearContentCache">' + icon('trash', { size: 14 }) + '清除内容缓存</button>' +
            '<button class="btn btn-secondary btn-sm" data-act="exportData">' + icon('download', { size: 14 }) + '导出 OPML</button>' +
            '<button class="btn btn-secondary btn-sm" data-act="verifyAssets">' + icon('shield', { size: 14 }) + '校验本地资源</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="side-card">' +
        '<div class="side-card-head">' + icon('list', { size: 16 }) +
          '<span class="side-card-title">日志域开关</span>' +
          '<span class="spacer"></span>' +
          '<span class="t-micro t-dim">warn / error 始终保留</span></div>' +
        '<div class="side-card-body pad">' +
          logDomains.map(function (d) {
            return '<div class="setting-row">' +
              '<div class="setting-text">' +
                '<span class="setting-label mono">log:' + U.esc(d.key) + '</span>' +
                '<span class="setting-help">' + U.esc(d.label) + '</span>' +
              '</div>' +
              '<div class="setting-control">' +
                '<button class="switch" role="switch" aria-checked="' + !!d.on + '" aria-label="' + U.esc(d.label + ' 日志') +
                  '" data-act="logSwitch" data-key="' + U.esc(d.key) + '"></button>' +
              '</div>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</div>' +

      '<div class="side-card">' +
        '<div class="side-card-head">' + icon('shield', { size: 16 }) +
          '<span class="side-card-title">本次原型的本地资源</span></div>' +
        '<div class="side-card-body pad">' +
          '<p class="t-small t-muted">共 ' + assetCount + ' 张本地化图片，全部以相对路径引用，没有任何外部 CDN 依赖，离线状态下可完整浏览。</p>' +
          '<div class="chip-row">' +
            '<button class="btn btn-secondary btn-sm" data-act="verifyAssets">' + icon('checkCircle', { size: 14 }) + '重新校验</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* =====================================================================
     账号与凭证
     ===================================================================== */
  function accountPage() {
    var creds = OD_CONTENT.settings.credentials;
    return '<div class="page"><div class="scroll-area page-scroll">' +
      '<div class="page-wrap">' +
        '<h1 class="page-title">账号与凭证</h1>' +
        '<p class="page-lead">平台凭证决定可获取的档位与内容范围。凭证仅保存在本机，不随订阅数据同步，也不会发送给第三方实例。</p>' +
        '<div class="section">' +
          '<div class="section-head"><span class="section-title">平台登录状态</span></div>' +
          '<div class="stack">' + creds.map(credCard).join('') + '</div>' +
        '</div>' +
        '<div class="section">' +
          '<div class="section-head"><span class="section-title">匿名能力与限制</span>' +
            '<span class="section-desc">实测结论</span></div>' +
          '<div class="side-card"><div class="side-card-body pad">' +
            '<ul class="platform-notes">' +
              ['哔哩哔哩：访客请求原画档实测只返回超清，登录后解锁原画；直播弹幕匿名可用。',
               '微博：热搜列表匿名可用，但热搜词下内容流与关注人主页需要完整 cookie，且冷 cookie 数分钟即失效。',
               '小红书：发现页匿名可用，用户笔记流必须登录态，匿名时页面会抹空 noteId 导致无法构造链接。',
               '抖音：列房与搜索三路接口中有两路需要登录，匿名仅第三路可用且只认游戏名级关键词。',
               'RSSHub：外挂源不注入平台 cookie，避免把本机凭证带向第三方实例。'].map(function (t) {
                return '<li>' + U.esc(t) + '</li>';
              }).join('') +
            '</ul>' +
          '</div></div>' +
        '</div>' +
      '</div>' +
    '</div></div>';
  }

  function credCard(c) {
    var saved = S().credentials[c.platform] || {};
    var status = saved.status || c.status;
    var account = saved.account || c.account;
    var tone = status === 'logged-in' ? 'ok' : status === 'expired' ? 'error' : '';
    var toneLabel = { 'logged-in': '已登录', expired: '凭证失效', anonymous: '匿名可用', error: '连接失败' }[status] || '未知';
    var toneIcon = tone === 'ok' ? 'checkCircle' : tone === 'error' ? 'alert' : 'info';

    return '<div class="side-card">' +
      '<div class="side-card-head">' +
        '<span class="platform-mark platform-mark-sm">' + ui().platformMark(c.platform, 16) + '</span>' +
        '<span class="platform-title">' +
          '<span class="side-card-title">' + U.esc(c.label) + '</span>' +
          '<span class="t-micro t-dim od-truncate">' + U.esc(account) + '</span>' +
        '</span>' +
        '<span class="tag ' + (tone === 'ok' ? 'tag-ok' : tone === 'error' ? 'tag-danger' : '') + '">' +
          icon(toneIcon, { size: 12 }) + toneLabel + '</span>' +
      '</div>' +
      '<div class="side-card-body pad">' +
        '<div class="info-row">' +
          '<span class="info-key">设置项</span>' +
          '<span class="info-val"><span class="t-small mono">' + U.esc(c.field) + '</span></span>' +
        '</div>' +
        '<div class="info-row">' +
          '<span class="info-key">有效期</span>' +
          '<span class="info-val"><span class="t-small t-muted">' + U.esc(c.expires) + '</span></span>' +
        '</div>' +
        '<div class="field">' +
          '<label class="field-label" for="ck-' + c.platform + '">Cookie 内容</label>' +
          '<textarea class="textarea mono" id="ck-' + c.platform + '" data-act="credCookie" data-platform="' + c.platform +
            '" placeholder="粘贴完整 cookie 串，例如 SESSDATA=...; bili_jct=...">' + U.esc(saved.cookie || '') + '</textarea>' +
          '<span class="field-help">' + U.esc(c.note) + '</span>' +
        '</div>' +
        '<div class="chip-row">' +
          (c.mode === 'qr'
            ? '<button class="btn btn-primary btn-sm" data-act="scanLogin" data-platform="' + c.platform + '">' +
                icon('qr', { size: 14 }) + '扫码登录</button>'
            : '') +
          '<button class="btn btn-secondary btn-sm" data-act="saveCredit" data-platform="' + c.platform + '">' +
            icon('check', { size: 14 }) + '保存凭证</button>' +
          '<button class="btn btn-secondary btn-sm" data-act="verifyCredit" data-platform="' + c.platform + '">' +
            icon('shield', { size: 14 }) + '验证有效性</button>' +
          '<button class="btn btn-quiet btn-sm" data-act="clearCredit" data-platform="' + c.platform + '">' +
            icon('trash', { size: 14 }) + '清除</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* =====================================================================
     扫码登录
     ===================================================================== */
  function qrModal(platform, phase) {
    var cfg = {
      bilibili: {
        title: '扫码登录哔哩哔哩',
        steps: ['用哔哩哔哩手机客户端扫一扫', '在手机上确认登录', '凭证写入本机，解锁原画档位'],
        note: '协议为纯 HTTP 轮询，不依赖浏览器模拟；二维码状态含未扫 / 已扫待确认 / 成功 / 过期四种。'
      },
      xiaohongshu: {
        title: '扫码登录小红书',
        steps: ['用小红书 App 扫一扫', '在 App 内确认登录', '凭证写入本机，解锁用户笔记流'],
        note: '小红书通过浏览器容器读取登录态；未登录时发现页仍可用，但用户笔记流不可用。'
      }
    }[platform] || { title: '扫码登录', steps: ['扫码确认'], note: '' };

    var qr = phase === 'expired'
      ? '<div class="qr-frame"><div class="qr-grid">' + qrCells(11, false) + '</div>' +
          '<span class="qr-expired">二维码已过期</span></div>'
      : '<div class="qr-frame"><div class="qr-grid">' + qrCells(platform.length * 7 + 3, true) + '</div>' +
          '<span class="qr-mark">' + ui().platformMark(platform, 22) + '</span></div>';

    var body = phase === 'success'
      ? '<div class="qr-success">' +
          '<span class="state-glyph state-glyph-ok">' + icon('checkCircle', { size: 28 }) + '</span>' +
          '<span class="t-h3">登录成功</span>' +
          '<p class="t-small t-muted">凭证已写入本机设置项，解锁该平台的完整档位与登录态专属内容。</p>' +
          '<div class="banner" data-tone="ok">' + icon('shield', { size: 18 }) +
            '<div class="banner-body">' +
              '<span class="banner-title">续期建议</span>' +
              '<span>哔哩哔哩可通过 refresh_token 自动续期，180 天窗口续一次即可长期有效；微博与小红书需到期后重新登录或粘贴 cookie。</span>' +
            '</div>' +
          '</div>' +
        '</div>'
      : '<div class="qr-wrap">' + qr +
          '<div class="qr-steps">' + cfg.steps.map(function (s, i) {
            var state = phase === 'scanned' && i <= 1 ? 'done' : (phase === 'scanned' && i === 2) || (phase === 'scanning' && i === 0) ? 'active' : '';
            return '<div class="qr-step" data-state="' + state + '">' +
              '<span class="qr-step-num">' + (state === 'done' ? icon('check', { size: 11 }) : (i + 1)) + '</span>' +
              '<span>' + U.esc(s) + '</span>' +
            '</div>';
          }).join('') + '</div>' +
          '<p class="t-small ' + (phase === 'expired' ? '' : 't-muted') + ' qr-status">' +
            (phase === 'scanning' ? '等待扫码…' : phase === 'scanned' ? '已扫码，请在手机上确认…' : '二维码已过期，请重新生成') +
          '</p>' +
          '<div class="banner">' + icon('info', { size: 18 }) +
            '<div class="banner-body"><span>' + U.esc(cfg.note) + '</span></div></div>' +
        '</div>';

    return {
      title: cfg.title,
      desc: '凭证仅保存在本机，不随订阅数据同步',
      body: body,
      footer: phase === 'success'
        ? '<div class="spacer"></div><button class="btn btn-primary" data-act="close">完成</button>'
        : '<button class="btn btn-quiet" data-act="regenQr">' + icon('refresh', { size: 14 }) + '刷新二维码</button>' +
          '<div class="spacer"></div>' +
          '<button class="btn btn-secondary" data-act="close">取消</button>' +
          '<button class="btn btn-primary" data-act="simulateScan">模拟扫码成功</button>'
    };
  }

  /* 二维码矩阵：确定性伪随机 + 三个定位角，仅为界面示意 */
  function qrCells(seed, fill) {
    var out = [];
    var x = seed || 1;
    for (var i = 0; i < 625; i++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      var v = (x / 0x7fffffff) > 0.52;
      var row = Math.floor(i / 25), col = i % 25;
      var corner = (row < 7 && col < 7) || (row < 7 && col > 17) || (row > 17 && col < 7);
      out.push('<i data-on="' + ((fill && v) || corner) + '"></i>');
    }
    return out.join('');
  }

  /* =====================================================================
     添加订阅
     ===================================================================== */
  function addSubscriptionModal(preKey) {
    var cat = S().channels;
    var picked = preKey ? cat.channels.filter(function (c) { return c.key === preKey; })[0] : null;
    if (!picked) picked = cat.channels.filter(function (c) { return c.defaultInfo; })[0] || cat.channels[0];

    return {
      title: '添加订阅',
      desc: '搜索并选择目标后订阅，或直接按渠道参数手工配置',
      size: 'wide',
      body:
        '<div class="add-mode">' +
          '<span class="segmented" role="tablist" aria-label="添加方式">' +
            '<button role="tab" data-act="addMode" data-id="search" aria-pressed="true">' + icon('search', { size: 14 }) + '搜索添加</button>' +
            '<button role="tab" data-act="addMode" data-id="manual" aria-pressed="false">' + icon('filter', { size: 14 }) + '按渠道配置</button>' +
          '</span>' +
        '</div>' +
        '<div id="manual-pane" hidden>' + channelPicker(cat, picked) + '<div id="channel-form">' + channelForm(picked) + '</div></div>' +
        '<div id="search-pane">' + searchPane(cat) + '</div>',
      onMount: function (panel) {
        /* 手工面板用 data-channel-key，搜索面板用 data-search-key，互不串位 */
        panel.dataset.channelKey = picked.key;
        panel.dataset.searchKey = pickableChannels(cat)[0].key;
      },
      footer:
        '<span class="t-micro t-dim" id="sub-hint">先搜索并选中一个目标，再添加到订阅。</span>' +
        '<div class="spacer"></div>' +
        '<button class="btn btn-secondary" data-act="close">取消</button>' +
        '<button class="btn btn-primary" data-act="submitSub" disabled>' + icon('plus', { size: 14 }) + '添加订阅</button>'
    };
  }

  /* 搜索添加：选渠道 → 筛关键词 → 选中一项 → 加入已有订阅或新建 */
  function searchPane(cat) {
    var picked = pickableChannels(cat)[0];
    return '<div class="field">' +
        '<span class="field-label" id="lbl-search-channel">搜索哪个渠道</span>' +
        '<div class="chip-row chip-row-wrap" role="group" aria-labelledby="lbl-search-channel">' +
          pickableChannels(cat).map(function (c) {
            return '<button class="chip" data-act="searchChannelPick" data-key="' + U.esc(c.key) + '" data-active="' +
              (picked.key === c.key) + '">' + ui().platformMark(c.platform, 14) + U.esc(c.title) + '</button>';
          }).join('') +
        '</div>' +
      '</div>' +
      /* 候选整体放一个容器里，切渠道时连同筛选框一起重建，监听改为面板级委托 */
      '<div id="cand-pane">' + candidatePane(picked) + '</div>';
  }

  /* 可搜索的渠道：只有一个 infoTpl 字段、且能从库内真实数据派生候选 */
  function pickableChannels(cat) {
    return cat.channels.filter(function (c) {
      return (c.infoTpl || []).length === 1 && !c.defaultInfo;
    });
  }

  function searchQueryField(c) {
    var f = (c.infoTpl || [])[0];
    if (!f) return '';
    return '<label class="field-label" for="add-search">按名称筛选</label>' +
      '<div class="input-group">' + icon('search', { size: 16 }) +
        '<input class="input" id="add-search" type="search" data-cand-filter placeholder="' +
          U.esc(f.placeholder || '') + '" aria-describedby="add-search-help">' +
      '</div>' +
      '<span class="field-help" id="add-search-help">候选来自本机订阅库中该平台的真实条目；</span>';
  }

  /*
     候选面板 = 筛选框 + 添加到 + 候选列表。切渠道时整块重建，
     因此筛选框的监听必须挂在面板上（委托），不能挂在输入框本体。
  */
  function candidatePane(channel) {
    var all = OD.store.candidatesFor(channel);
    /* 库里没有该渠道可用的真实条目时降级为手填，不留空白、不编造数据 */
    if (!all.length) {
      var f = (channel.infoTpl || [])[0] || {};
      return '<div class="field">' +
          '<label class="field-label" for="fi-' + U.esc(f.name) + '">' + U.esc(f.label || '参数') +
            (f.required ? '<span class="field-req" aria-hidden="true">*</span>' : '') + '</label>' +
          '<input class="input" id="fi-' + U.esc(f.name) + '" data-param="' + U.esc(f.name) + '" placeholder="' +
            U.esc(f.placeholder || '') + '">' +
          '<span class="field-help">本机订阅库中没有可用于该渠道的条目，请按格式手填。</span>' +
        '</div>';
    }
    var targets = OD.store.subsOfChannel(channel.key);
    return '<div class="field">' + searchQueryField(channel) + '</div>' +
      (targets.length ? targetPicker(channel, targets) : '') +
      '<div class="field">' +
        '<span class="field-label" id="lbl-cand">匹配 <span class="num">' + all.length + '</span> / ' + all.length + ' 项</span>' +
        '<div class="cand-list" role="listbox" aria-labelledby="lbl-cand" data-cand-list>' +
          all.map(function (c) { return candidateRow(channel, c); }).join('') +
        '</div>' +
      '</div>' +
      '<input type="hidden" data-param="' + U.esc((channel.infoTpl || [])[0].name) + '" data-cand-value value="">';
  }

  /* 添加到：新建一条订阅，或并入该渠道下已有的某条订阅 */
  function targetPicker(channel, targets) {
    var multi = OD.store.multiParamOf(channel);
    return '<div class="field">' +
        '<span class="field-label" id="lbl-target">添加到</span>' +
        '<div class="chip-row chip-row-wrap" role="radiogroup" aria-labelledby="lbl-target">' +
          '<button class="chip" role="radio" aria-checked="true" data-act="pickTarget" data-target="new">' +
            icon('plus', { size: 13 }) + '新建订阅</button>' +
          targets.map(function (s) {
            var n = OD.store.valueList(s, (channel.infoTpl || [])[0].name).length;
            return '<button class="chip" role="radio" aria-checked="false" data-act="pickTarget" data-target="' +
              U.esc(s.id) + '">' + U.esc(s.title) +
              '<span class="cand-chip">' + n + (multi ? ' 项' : '') + '</span></button>';
          }).join('') +
        '</div>' +
        (multi
          ? '<span class="field-help">选中候选后会按逗号并入该订阅，原有序号保留。</span>'
          : '<span class="field-help">该渠道的参数是单值，选中后会覆盖已有订阅里的原值。</span>') +
      '</div>' +
      '<input type="hidden" data-sub-target value="new">';
  }

  function candidateRow(channel, c) {
    var dup = OD.store.subExists(channel.key, c.value);
    // 缩略图：条目有真实封面就用它，没有则回落到平台标识（不编造图片）
    var art = c.thumb
      ? '<img class="cand-thumb" src="' + U.esc(c.thumb) + '" alt="" loading="lazy" decoding="async">'
      : '<span class="cand-thumb cand-thumb-plain">' + ui().platformMark(channel.platform, 18) + '</span>';
    return '<button class="cand" role="option" aria-selected="false" data-act="pickCandidate" data-value="' +
        U.esc(c.value) + '" data-label="' + U.esc(c.label) + '"' +
        ' data-hay="' + U.esc([c.label, c.value, c.sub].concat(c.meta || []).join(' ')) + '"' +
        (dup ? ' data-dup="true"' : '') + '>' +
      art +
      '<span class="cand-main">' +
        '<span class="cand-label od-truncate">' + U.esc(c.label) + '</span>' +
        (c.sub ? '<span class="cand-sub od-truncate">' + U.esc(c.sub) + '</span>' : '') +
        ((c.meta && c.meta.length)
          ? '<span class="cand-meta">' + c.meta.map(function (m) {
              return '<span class="cand-chip">' + U.esc(m) + '</span>';
            }).join('') + '</span>'
          : '') +
      '</span>' +
      (dup ? '<span class="tag tag-warn chip-tag">已订阅</span>' : '') +
      '<span class="cand-check">' + icon('check', { size: 15 }) + '</span>' +
    '</button>';
  }

  function channelPicker(cat, picked) {
    return '<div class="field">' +
      '<span class="field-label" id="lbl-channel">渠道</span>' +
      '<div class="channel-groups" role="group" aria-labelledby="lbl-channel">' +
        cat.groups.map(function (g) {
          return '<div class="channel-group">' +
            '<div class="eyebrow">' + U.esc(g.title) + '</div>' +
            '<div class="chip-row chip-row-wrap">' +
              cat.channels.filter(function (c) { return c.group === g.id; }).map(function (c) {
                return '<button class="chip" data-act="pickChannel" data-key="' + U.esc(c.key) + '" data-active="' +
                  (picked.key === c.key) + '">' +
                  ui().platformMark(c.platform, 14) + U.esc(c.title) +
                  (c.requiresLogin ? '<span class="tag tag-warn chip-tag">需登录</span>' : '') +
                '</button>';
              }).join('') +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</div>';
  }

  function channelForm(c) {
    if (!c) return '';
    var rows = (c.infoTpl || []).map(function (f) {
      return '<div class="field">' +
        '<label class="field-label" for="fi-' + U.esc(f.name) + '">' + U.esc(f.label) +
          (f.required
            ? '<span class="field-req" aria-hidden="true">*</span>'
            : '<span class="t-micro t-dim">选填</span>') +
        '</label>' +
        '<input class="input" id="fi-' + U.esc(f.name) + '" data-param="' + U.esc(f.name) + '" placeholder="' +
          U.esc(f.placeholder || '') + '"' + (f.required ? ' aria-required="true"' : '') + '>' +
        '<span class="field-error" hidden data-err="' + U.esc(f.name) + '">' +
          icon('alert', { size: 12 }) + '<span class="err-text"></span>' +
        '</span>' +
      '</div>';
    }).join('');

    return '<div class="channel-form">' +
      '<div class="channel-summary">' +
        '<span class="platform-mark">' + ui().platformMark(c.platform, 18) + '</span>' +
        '<span class="platform-title">' +
          '<span class="t-h3">' + U.esc(c.title) + '</span>' +
          '<span class="t-micro t-dim mono">' + U.esc(c.key) + '</span>' +
        '</span>' +
        '<span class="tag">' + U.esc(OD.store.KIND_LABEL[c.kind] || c.kind) + '</span>' +
        (c.requiresLogin
          ? '<span class="tag tag-warn">需登录 cookie</span>'
          : '<span class="tag tag-ok">匿名可用</span>') +
      '</div>' +
      (c.defaultInfo
        ? '<div class="banner" data-tone="ok">' + icon('checkCircle', { size: 18 }) +
            '<div class="banner-body">' +
              '<span class="banner-title">自带默认参数</span>' +
              '<span>该渠道无需填写参数，添加后会立即抓取一次最新内容。</span>' +
            '</div></div>'
        : '') +
      (c.note
        ? '<div class="banner">' + icon('info', { size: 18 }) +
            '<div class="banner-body"><span>' + U.esc(c.note) + '</span></div></div>'
        : '') +
      (rows || '<p class="t-small t-muted">该渠道不需要额外参数。</p>') +
      '<div class="field">' +
        '<label class="field-label" for="fi-title">订阅标题</label>' +
        '<input class="input" id="fi-title" data-param="__title" value="' + U.esc(c.title) + '">' +
        '<span class="field-help">显示在侧边导航与列表顶部，可随时在编辑订阅中修改。</span>' +
      '</div>' +
      '<div class="field">' +
        '<label class="field-label" for="fi-group">归入分组</label>' +
        '<select class="select" id="fi-group" data-param="__group">' +
          '<option value="">不归入分组</option>' +
          S().groups.map(function (g) { return '<option value="' + g.id + '">' + U.esc(g.title) + '</option>'; }).join('') +
        '</select>' +
      '</div>' +
      '<div class="field">' +
        '<label class="field-label" for="fi-ttl">单独刷新间隔</label>' +
        '<span class="number-row">' +
          '<input class="input input-number" id="fi-ttl" type="number" min="5" max="1440" data-param="__ttl" placeholder="' +
            S().settings.refreshIntervalMin + '">' +
          '<span class="t-small t-dim">分钟，留空跟随全局</span>' +
        '</span>' +
        '<span class="field-help">该订阅的 TTL 优先于全局设置，用于降低反爬源被请求的频率。</span>' +
      '</div>' +
    '</div>';
  }

  /* =====================================================================
     编辑订阅
     ===================================================================== */
  function editSubscriptionModal(sub) {
    var groupOpts = '<option value="">不归入分组</option>' + S().groups.map(function (g) {
      return '<option value="' + g.id + '"' + (sub.group === g.id ? ' selected' : '') + '>' + U.esc(g.title) + '</option>';
    }).join('');

    return {
      title: '编辑订阅',
      desc: sub.channel,
      body:
        '<div class="field">' +
          '<label class="field-label" for="ed-title">订阅标题</label>' +
          '<input class="input" id="ed-title" value="' + U.esc(sub.title) + '">' +
        '</div>' +
        '<div class="field">' +
          '<label class="field-label" for="ed-group">分组</label>' +
          '<select class="select" id="ed-group">' + groupOpts + '</select>' +
        '</div>' +
        '<div class="field">' +
          '<label class="field-label" for="ed-ttl">单独刷新间隔</label>' +
          '<span class="number-row">' +
            '<input class="input input-number" id="ed-ttl" type="number" min="5" max="1440" value="' +
              (sub.refreshIntervalSec ? Math.round(sub.refreshIntervalSec / 60) : '') + '" placeholder="' +
              S().settings.refreshIntervalMin + '">' +
            '<span class="t-small t-dim">分钟，留空跟随全局</span>' +
          '</span>' +
          '<span class="field-help">该订阅的 TTL 优先于全局设置，用于降低反爬源被请求的频率。</span>' +
        '</div>' +
        '<div class="setting-row">' +
          '<div class="setting-text">' +
            '<span class="setting-label">启用该订阅</span>' +
            '<span class="setting-help">停用后不再参与刷新，已缓存内容保留可读。</span>' +
          '</div>' +
          '<div class="setting-control">' +
            '<button class="switch" role="switch" aria-checked="' + (sub.enabled !== false) +
              '" aria-label="启用订阅" data-act="subEnabled"></button>' +
          '</div>' +
        '</div>' +
        '<div class="banner">' + icon('info', { size: 18 }) +
          '<div class="banner-body"><span>修改参数后建议手动刷新一次；内容缓存会在 TTL 到期后自动重建。</span></div></div>',
      footer:
        '<button class="btn btn-danger btn-sm" data-act="deleteSub">' + icon('trash', { size: 14 }) + '删除订阅</button>' +
        '<div class="spacer"></div>' +
        '<button class="btn btn-secondary" data-act="close">取消</button>' +
        '<button class="btn btn-primary" data-act="saveSub">保存</button>'
    };
  }

  /* =====================================================================
     分组管理
     ===================================================================== */
  function groupsModal() {
    var st = S();
    return {
      title: '管理分组',
      desc: '分组用于收纳订阅；删除分组不会删除其中的订阅',
      body:
        '<table class="table">' +
          '<thead><tr><th>分组名称</th><th>订阅数</th><th></th></tr></thead>' +
          '<tbody>' +
            (st.groups.length
              ? st.groups.map(function (g) {
                  var n = st.subscriptions.filter(function (s) { return s.group === g.id; }).length;
                  return '<tr>' +
                    '<td><input class="input" value="' + U.esc(g.title) + '" data-act="renameGroup" data-id="' + g.id +
                      '" aria-label="分组名称"></td>' +
                    '<td class="num">' + n + '</td>' +
                    '<td><div class="cell-actions">' +
                      '<button class="icon-btn sm" data-act="deleteGroup" data-id="' + g.id + '" aria-label="删除分组 ' +
                        U.esc(g.title) + '">' + icon('trash', { size: 14 }) + '</button>' +
                    '</div></td>' +
                  '</tr>';
                }).join('')
              : '<tr><td colspan="3"><p class="t-small t-muted">还没有分组。用下方输入框创建第一个。</p></td></tr>') +
          '</tbody>' +
        '</table>' +
        '<div class="field">' +
          '<label class="field-label" for="new-group">新建分组</label>' +
          '<div class="inline-row">' +
            '<input class="input" id="new-group" placeholder="分组名称，例如「设计」">' +
            '<button class="btn btn-primary" data-act="createGroup">' + icon('plus', { size: 14 }) + '创建</button>' +
          '</div>' +
        '</div>',
      footer: '<div class="spacer"></div><button class="btn btn-primary" data-act="close">完成</button>'
    };
  }

  /* =====================================================================
     弹幕设置
     ===================================================================== */
  function danmakuSettingsModal() {
    var s = S().settings;
    return {
      title: '弹幕设置',
      desc: '设置即时作用于播放区',
      body:
        ui().settingRow('danmakuEnabled', '开启弹幕', '关闭后播放区不再显示弹幕。',
          '<button class="switch" role="switch" aria-checked="' + !!s.danmakuEnabled +
            '" data-act="settingSwitch" data-key="danmakuEnabled" aria-label="开启弹幕"></button>') +
        ui().settingRow('danmakuOpacity', '不透明度', '越高越醒目，也会更遮挡画面。',
          '<div class="range"><input type="range" min="20" max="100" step="5" value="' + s.danmakuOpacity +
            '" data-act="settingRange" data-key="danmakuOpacity" data-unit="%" aria-label="弹幕不透明度">' +
            '<span class="range-value num">' + s.danmakuOpacity + '%</span></div>') +
        ui().settingRow('danmakuFontSize', '字号', '按播放区高度自适应行数。',
          '<div class="range"><input type="range" min="14" max="32" step="1" value="' + s.danmakuFontSize +
            '" data-act="settingRange" data-key="danmakuFontSize" data-unit="px" aria-label="弹幕字号">' +
            '<span class="range-value num">' + s.danmakuFontSize + 'px</span></div>') +
        ui().settingRow('danmakuSpeed', '滚动速度', '',
          '<div class="segmented">' + [['slow', '慢'], ['standard', '标准'], ['fast', '快']].map(function (o) {
            return '<button data-act="settingRadio" data-key="danmakuSpeed" data-value="' + o[0] + '" aria-pressed="' +
              (s.danmakuSpeed === o[0]) + '">' + o[1] + '</button>';
          }).join('') + '</div>') +
        ui().settingRow('danmakuArea', '显示区域', '限制弹幕占用的画面高度。',
          '<div class="segmented">' + [['quarter', '1/4 屏'], ['half', '半屏'], ['full', '全屏']].map(function (o) {
            return '<button data-act="settingRadio" data-key="danmakuArea" data-value="' + o[0] + '" aria-pressed="' +
              (s.danmakuArea === o[0]) + '">' + o[1] + '</button>';
          }).join('') + '</div>') +
        ui().settingRow('danmakuBlock', '防挡字幕与控件', '开启后弹幕避开控制条与字幕区域。',
          '<button class="switch" role="switch" aria-checked="' + !!s.danmakuBlock +
            '" data-act="settingSwitch" data-key="danmakuBlock" aria-label="防挡字幕与控件"></button>') +
        '<div class="banner">' + icon('info', { size: 18 }) +
          '<div class="banner-body">' +
            '<span class="banner-title">弹幕来源</span>' +
            '<span>哔哩哔哩视频走分段接口，四平台直播弹幕经统一 WebSocket 通道。本原型中的滚动内容为演示语料。</span>' +
          '</div>' +
        '</div>',
      footer: '<div class="spacer"></div><button class="btn btn-primary" data-act="close">完成</button>'
    };
  }

  /* =====================================================================
     首启动引导
     ===================================================================== */
  function onboardingModal() {
    var st = S();
    return {
      title: '欢迎使用订阅工作台',
      desc: '三步完成初始设置',
      body:
        '<ol class="steps-list">' +
          '<li><span>添加订阅：从内置渠道或 RSS 直链中选择，带默认参数的渠道可一键订阅。</span></li>' +
          '<li><span>按需登录：扫码或粘贴 cookie，解锁原画档位与登录态专属内容。</span></li>' +
          '<li><span>调整阅读：在设置中改字号、行宽、信息密度与弹幕样式，所有取值即时生效。</span></li>' +
        '</ol>' +
        '<div class="side-card"><div class="side-card-body pad">' +
          '<div class="t-small card-strong">当前库</div>' +
          '<div class="stat-strip">' +
            [['订阅', st.subscriptions.length], ['分组', st.groups.length], ['条目', st.items.length]].map(function (x) {
              return '<span class="od-stat"><span class="t-h2 num">' + x[1] + '</span>' +
                '<span class="t-micro t-dim">' + x[0] + '</span></span>';
            }).join('') +
          '</div>' +
        '</div></div>' +
        '<div class="banner" data-tone="warn">' + icon('alertTriangle', { size: 18 }) +
          '<div class="banner-body">' +
            '<span class="banner-title">关于本原型的示例数据</span>' +
            '<span>内容与图片来自公开源的真实抓取结果（少数派、阮一峰周刊、爱范儿、哔哩哔哩热门与直播、斗鱼与虎牙在播房间、小红书发现页、微博热搜），用于演示界面；播放区为界面演示，不实际拉流。</span>' +
          '</div>' +
        '</div>',
      footer:
        '<div class="spacer"></div>' +
        '<button class="btn btn-secondary" data-act="close">稍后</button>' +
        '<button class="btn btn-primary" data-act="finishOnboarding">开始使用</button>'
    };
  }

  OD.views = OD.views || {};
  OD.views.manage = {
    settingsPage: settingsPage,
    accountPage: accountPage,
    qrModal: qrModal,
    addSubscriptionModal: addSubscriptionModal,
    channelForm: channelForm,
    candidatePane: candidatePane,
    editSubscriptionModal: editSubscriptionModal,
    groupsModal: groupsModal,
    danmakuSettingsModal: danmakuSettingsModal,
    onboardingModal: onboardingModal
  };
})();
