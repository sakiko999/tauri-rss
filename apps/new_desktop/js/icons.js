/* 图标族：单一 24×24 网格，stroke 1.6，round cap/join，继承 currentColor。
   全部为线性描边，同一层级不混用填充式图标。 */
(function () {
  'use strict';

  var P = {
    /* 导航与库 */
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 16 9 5 9-5"/>',
    rss: '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1.6"/>',
    play: '<path d="M7 4.5 19 12 7 19.5Z"/>',
    music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
    radio: '<circle cx="12" cy="12" r="2.5"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4"/><path d="M16.2 16.2a6 6 0 0 0 0-8.4"/><path d="M4.9 4.9a10 10 0 0 0 0 14.2"/><path d="M19.1 19.1a10 10 0 0 0 0-14.2"/>',
    message: '<path d="M20 15a3 3 0 0 1-3 3H8l-4 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3Z"/><path d="M8.5 10.5h7"/><path d="M8.5 13.5h4"/>',
    star: '<path d="m12 4 2.5 5.2 5.5.8-4 3.9 1 5.6L12 16.8 7 19.5l1-5.6-4-3.9 5.5-.8Z"/>',
    heart: '<path d="M12 19.5S4 15 4 9.8A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 8 2.2c0 5.2-8 9.7-8 9.7Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>',
    inbox: '<path d="M4 13h4l1.5 3h5L16 13h4"/><path d="M4 13 6.5 5h11L20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/>',
    compass: '<circle cx="12" cy="12" r="8.5"/><path d="m15 9-2 4.6L9 15l2-4.6Z"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/>',
    bookmark: '<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1Z"/>',
    folder: '<path d="M4 7a2 2 0 0 1 2-2h3.2l1.8 2H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/>',
    tag: '<path d="M11.5 4H19a1 1 0 0 1 1 1v7.5L12 20.5 3.5 12 11.5 4Z"/><circle cx="15.5" cy="8.5" r="1.4"/>',

    /* 操作 */
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    more: '<circle cx="5.5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.5" cy="12" r="1.4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5 13.4 6l2.8-.6 1 2.7 2.6 1-.6 2.8 1.8 2.2-1.8 2.2.6 2.8-2.6 1-1 2.7-2.8-.6L12 20.5 10.6 18l-2.8.6-1-2.7-2.6-1 .6-2.8L2.9 12l1.8-2.2-.6-2.8 2.6-1 1-2.7L10.6 6Z"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4.5V11h-6.5"/>',
    download: '<path d="M12 4v10"/><path d="m8 10.5 4 4 4-4"/><path d="M5 19h14"/>',
    upload: '<path d="M12 20V10"/><path d="m8 13.5 4-4 4 4"/><path d="M5 5h14"/>',
    trash: '<path d="M5 7h14"/><path d="M9 7V5h6v2"/><path d="M6.5 7 7.5 20h9L17.5 7"/><path d="M10.5 11v5M13.5 11v5"/>',
    edit: '<path d="M5 19h3l10-10-3-3L5 16Z"/><path d="m13.5 6.5 3 3"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 6.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h.5"/>',
    link: '<path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.5 1.5"/><path d="M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5L12 17"/>',
    external: '<path d="M14 5h5v5"/><path d="M19 5 11 13"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',

    /* 播放器 */
    pause: '<path d="M9 5v14M15 5v14"/>',
    skip: '<path d="M6 5.5 15 12 6 18.5Z"/><path d="M18 5v14"/>',
    volume: '<path d="M4 9.5h3L11 6v12l-4-3.5H4Z"/><path d="M15 9.5a3.5 3.5 0 0 1 0 5"/><path d="M17.5 7a7 7 0 0 1 0 10"/>',
    mute: '<path d="M4 9.5h3L11 6v12l-4-3.5H4Z"/><path d="m15 10 4 4M19 10l-4 4"/>',
    fullscreen: '<path d="M4 9V5h4"/><path d="M20 9V5h-4"/><path d="M4 15v4h4"/><path d="M20 15v4h-4"/>',
    exitfs: '<path d="M9 4v5H4"/><path d="M15 4v5h5"/><path d="M9 20v-5H4"/><path d="M15 20v-5h5"/>',
    live: '<path d="M5 10a7 7 0 0 1 14 0v6a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1Z"/><path d="M9 7 12 3l3 4"/>',
    captions: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M9.5 11a2 2 0 1 0 0 2"/><path d="M15.5 11a2 2 0 1 0 0 2"/>',
    speed: '<path d="M12 19a7 7 0 1 1 7-7"/><path d="m12 12 4-2.5"/><path d="M19 12h2"/>',
    queue: '<path d="M4 7h11M4 12h11M4 17h7"/><path d="m17 14 4 3-4 3Z"/>',
    mpv: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5 15 12l-5 2.5Z"/>',
    danmaku: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10.5h4M13.5 10.5H17M7 14h6"/>',

    /* 状态与提示 */
    alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V13"/><circle cx="12" cy="16.2" r="1"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="8" r="1"/>',
    checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.2 2.4 2.4 4.6-5"/>',
    alertTriangle: '<path d="M12 4.5 20.5 19h-17Z"/><path d="M12 10v4"/><circle cx="12" cy="16.5" r=".9"/>',
    wifiOff: '<path d="M4 4l16 16"/><path d="M8.5 13.5a5 5 0 0 1 3-1.4"/><path d="M5.5 10.5a10 10 0 0 1 3-2"/><path d="M12 17.5h.01"/>',
    lock: '<rect x="5" y="10.5" width="14" height="9" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    sparkle: '<path d="m12 4 1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6Z"/><path d="M18.5 16.5 19 18l1.5.5-1.5.5-.5 1.5-.5-1.5L16.5 18l1.5-.5Z"/>',
    shield: '<path d="M12 3.5 19 6v6c0 4.2-3 7-7 8.5-4-1.5-7-4.3-7-8.5V6Z"/><path d="m9 12 2 2 4-4"/>',
    qr: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2"/><path d="M13.5 13.5h3v3h-3zM19 13.5h1.5M13.5 20H15M17.5 17.5h3v3"/>',

    /* 内容类型 */
    image: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.5"/><path d="m5 17 4.5-4.5 3.5 3.5 3-3L20 17"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.6"/>',
    columns: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M10 4v16"/>',
    eye: '<path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.6"/>',
    eyeOff: '<path d="M4 4l16 16"/><path d="M9.5 9.6A2.6 2.6 0 0 0 12 14.6"/><path d="M6.4 7.1C4 8.7 2.5 12 2.5 12s3.5 5.5 9.5 5.5c1.6 0 3-.4 4.2-1"/><path d="M10 6.8c.6-.15 1.3-.2 2-.2 6 0 9.5 5.4 9.5 5.4s-.7 1.1-2 2.5"/>',

    /* 平台标识 */
    bilibili: '<rect x="3.5" y="6.5" width="17" height="12" rx="3"/><path d="M8 4.5 10 6.5M16 4.5 14 6.5"/><path d="M9.5 11v3M14.5 11v3"/>',
    youtube: '<rect x="2.5" y="6" width="19" height="12" rx="3.5"/><path d="M10.5 9.8 15 12l-4.5 2.2Z"/>',
    weibo: '<circle cx="12" cy="12" r="8.5"/><path d="M9 12.5c0 1.4 1.4 2.5 3 2.5s3-1.1 3-2.5"/><circle cx="9.5" cy="10" r="1"/><circle cx="14.5" cy="10" r="1"/>',
    xiaohongshu: '<rect x="3.5" y="5" width="17" height="14" rx="3"/><path d="M8 9.5v5M12 9.5v5M16 9.5v5"/>',
    douyu: '<path d="M4 9a8 8 0 0 1 16 0v5.5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3Z"/><path d="M9 10.5v3M15 10.5v3"/>',
    huya: '<path d="M6 5 12 9l6-4v7l-6 7-6-7Z"/><path d="M12 9v10"/>',
    podcast: '<circle cx="12" cy="10" r="2.5"/><path d="M10 12.5 8.5 20h7L14 12.5"/><path d="M6.5 8a7 7 0 0 1 11 0"/>',
    rsshub: '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5.5" cy="18.5" r="1.5"/><path d="M15 4.5h6v6"/>',

    /* 侧栏与键盘 */
    panelLeft: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M10 4.5v15"/>',
    text: '<path d="M5 6h14M5 12h14M5 18h9"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="18" r="1.2"/>',
    database: '<ellipse cx="12" cy="6.5" rx="7" ry="2.8"/><path d="M5 6.5v11c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8v-11"/><path d="M5 12c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8"/>'
  };

  function icon(name, opts) {
    opts = opts || {};
    var size = opts.size || 18;
    var body = P[name] || P.info;
    var cls = opts.class ? ' class="' + opts.class + '"' : '';
    var sw = opts.stroke || 1.6;
    return (
      '<svg' + cls + ' width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true" focusable="false">' + body + '</svg>'
    );
  }

  /* 实心变体：仅用于状态区分（已星标、播放 / 暂停），保持同族几何 */
  icon.solid = function (name, opts) {
    opts = opts || {};
    var size = opts.size || 18;
    var cls = opts.class ? ' class="' + opts.class + '"' : '';
    var head = '<svg' + cls + ' width="' + size + '" height="' + size + '" viewBox="0 0 24 24" ';
    if (name === 'star') {
      return head + 'fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="m12 4 2.5 5.2 5.5.8-4 3.9 1 5.6L12 16.8 7 19.5l1-5.6-4-3.9 5.5-.8Z"/></svg>';
    }
    if (name === 'play') {
      return head + 'fill="currentColor" stroke="none" aria-hidden="true"><path d="M7 4.5 19 12 7 19.5Z"/></svg>';
    }
    if (name === 'pause') {
      return head + 'fill="currentColor" stroke="none" aria-hidden="true">' +
        '<rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>';
    }
    if (name === 'dot') {
      return head + 'fill="currentColor" stroke="none" aria-hidden="true"><circle cx="12" cy="12" r="4"/></svg>';
    }
    return icon(name, opts);
  };

  icon.names = Object.keys(P);
  window.icon = icon;
})();
