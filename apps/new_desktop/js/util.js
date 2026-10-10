/* 通用工具：DOM、文本、时间、数字格式化、事件委托、分片渲染 */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* 文本裁剪：按语义边界收尾，不产生 1–2 字孤行 */
  function clip(s, n) {
    s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    if (s.length <= n) return s;
    return s.slice(0, n - 1).replace(/[，。、；：,.;:\s]+$/, '') + '…';
  }

  var NOW = Date.parse(window.OD_CONTENT && window.OD_CONTENT.generatedAt) || Date.now();

  function timeAgo(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return '';
    var d = Math.max(0, NOW - t) / 1000;
    if (d < 60) return '刚刚';
    if (d < 3600) return Math.floor(d / 60) + ' 分钟前';
    if (d < 86400) return Math.floor(d / 3600) + ' 小时前';
    var days = Math.floor(d / 86400);
    if (days === 1) return '昨天';
    if (days < 7) return days + ' 天前';
    var dt = new Date(t);
    return (dt.getMonth() + 1) + ' 月 ' + dt.getDate() + ' 日';
  }

  function fullDate(iso) {
    var dt = new Date(Date.parse(iso));
    if (isNaN(dt.getTime())) return '';
    return dt.getFullYear() + ' 年 ' + (dt.getMonth() + 1) + ' 月 ' + dt.getDate() + ' 日 ' +
      String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0');
  }

  function isToday(iso) {
    var d = new Date(Date.parse(iso));
    var today = new Date(NOW);
    return d.toDateString() === today.toDateString();
  }

  /* 大数：≥1 万折为「万」，≥1 亿折为「亿」 */
  function count(n) {
    n = Number(n) || 0;
    if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + ' 亿';
    if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + ' 万';
    return String(n);
  }

  function bytes(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + ' GB';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + ' KB';
    return n + ' B';
  }

  function dur(sec) {
    if (!sec) return '';
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* 事件委托：data-act 派发 */
  function bind(root, handlers) {
    root._acts = Object.assign(root._acts || {}, handlers);
    root.addEventListener('click', function (e) {
      var node = e.target.closest('[data-act]');
      if (!node || !root.contains(node)) return;
      var fn = root._acts[node.dataset.act];
      if (!fn) return;
      if (node.tagName === 'A') e.preventDefault();
      fn(node, e);
    });
    root.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var node = e.target.closest('[data-act-enter]');
      if (!node || !root.contains(node)) return;
      var fn = root._acts[node.dataset.actEnter];
      if (!fn) return;
      e.preventDefault();
      fn(node, e);
    });
  }

  /* 焦点陷阱：供弹窗 / 抽屉使用，返回释放函数 */
  function trapFocus(container, onEscape) {
    var prev = document.activeElement;
    var SEL = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (onEscape) onEscape();
        return;
      }
      if (e.key !== 'Tab') return;
      var items = qa(SEL, container).filter(function (n) { return n.offsetParent !== null; });
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    container.addEventListener('keydown', onKey);
    var target = qa(SEL, container)[0];
    if (target && target.focus) target.focus();
    return function release() {
      container.removeEventListener('keydown', onKey);
      if (prev && prev.focus) prev.focus();
    };
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var a = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, a); }, ms);
    };
  }

  function imgTag(src, w, h, alt, extra) {
    if (!src) return '';
    var dims = (w && h) ? ' width="' + w + '" height="' + h + '"' : '';
    return '<img src="' + esc(src) + '"' + dims + ' alt="' + esc(alt || '') + '" loading="lazy" decoding="async"' +
      (extra ? ' ' + extra : '') + '>';
  }

  window.U = {
    esc: esc, clip: clip, timeAgo: timeAgo, fullDate: fullDate, isToday: isToday,
    count: count, bytes: bytes, dur: dur, el: el, q: q, qa: qa, bind: bind,
    trapFocus: trapFocus, debounce: debounce, imgTag: imgTag, NOW: NOW
  };
})();
