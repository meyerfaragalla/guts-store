/* Guts Decor — shared site code: language, words from the Text tab, header/footer, content from the sheet */
(function () {
  "use strict";

  // The public address of the order system (Google Apps Script web app).
  // This is not a secret: it only ever hands out the safe, public parts of the sheet.
  var API_URL = "https://script.google.com/macros/s/AKfycbxv8S5aSy0oY1L0XW3k7H8yIAo9inJjTwJZP8yNT1u89kX58q9LVh8IDtetbmSP/exec";
  // A copy of the same public data, refreshed by GitHub every 15 minutes, so pages appear instantly.
  var SNAPSHOT_URL = "assets/content.json";

  var LANG_KEY = "gd-lang";
  var CACHE_KEY = "gd-content-v2";

  // ---------- Language ----------
  function detectLang() {
    try {
      var saved = localStorage.getItem(LANG_KEY);
      if (saved === "en" || saved === "ar") return saved;
    } catch (e) { /* storage blocked: fall back to device language */ }
    var langs = navigator.languages || [navigator.language || "en"];
    for (var i = 0; i < langs.length; i++) {
      if (/^ar\b/i.test(langs[i])) return "ar";
      if (/^en\b/i.test(langs[i])) return "en";
    }
    return "en";
  }

  function lang() { return document.documentElement.getAttribute("data-lang") || "en"; }

  // Old-style helper kept for pages not yet moved to the Text tab.
  function t(en, ar) { return lang() === "ar" && ar ? ar : en; }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------- Content: saved copy first, then the live sheet ----------
  var content = null;
  var listeners = [];

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch (e) { return null; }
  }
  function writeCache(data) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
  }

  function setContent(data) {
    if (!data || !data.ok) return;
    var changed = !content || JSON.stringify(content) !== JSON.stringify(data);
    content = data;
    if (!changed) return;
    applyText();
    listeners.forEach(function (fn) { fn(content); });
  }

  // ---------- Preview (from the admin page): unpublished changes, only in this tab ----------
  var PREVIEW_KEY = "gd-preview-token";
  (function () {
    var m = location.hash.match(/preview=([A-Za-z0-9]{20,64})/);
    try {
      if (m) { sessionStorage.setItem(PREVIEW_KEY, m[1]); history.replaceState(null, "", location.pathname + location.search); }
    } catch (e) { /* storage blocked: no preview */ }
  })();
  function previewToken() { try { return sessionStorage.getItem(PREVIEW_KEY) || ""; } catch (e) { return ""; } }
  var previewing = !!previewToken();

  var firstContent = previewing ? new Promise(function (resolve, reject) {
    fetch(API_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "adminDraft", token: previewToken() }) })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.ok) { setContent(data); resolve(data); return; }
        try { sessionStorage.removeItem(PREVIEW_KEY); } catch (e) { /* ignore */ }
        location.reload();
      }).catch(reject);
  }) : new Promise(function (resolve, reject) {
    var cached = readCache();
    if (cached && cached.ok) { setContent(cached); resolve(cached); }

    var snapshot = fetch(SNAPSHOT_URL, { cache: "no-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
    // On this computer (localhost) the saved test copy is used as is, so new sheet columns can be tried before going live.
    var testing = /^(localhost|127\.)/.test(location.hostname);
    var live = API_URL && !testing
      ? fetch(API_URL + "?action=content").then(function (r) { return r.json(); }).catch(function () { return null; })
      : Promise.resolve(null);

    snapshot.then(function (data) {
      // The saved copy is only used until the live sheet answers.
      if (data && data.ok && !liveArrived) { setContent(data); resolve(data); }
    });
    var liveArrived = false;
    live.then(function (data) {
      if (data && data.ok) {
        liveArrived = true;
        writeCache(data);
        setContent(data);
        resolve(data);
      }
      return snapshot;
    }).then(function () {
      if (!content) reject(new Error("unavailable"));
    });
  });

  function getContent() { return firstContent; }

  // Runs fn now (if content is here), whenever newer content arrives, and on every language switch.
  function onContent(fn) {
    listeners.push(fn);
    if (content) fn(content);
  }

  // ---------- Words from the Text tab ----------
  function tx(key, vars) {
    var row = content && content.text && content.text[key];
    var s = row ? (row[lang()] || row.en || row.ar || "") : "";
    if (vars) s = s.replace(/\{(\w+)\}/g, function (m, k) { return vars.hasOwnProperty(k) ? vars[k] : m; });
    return s;
  }

  function num(n) {
    return Number(n).toLocaleString(lang() === "ar" ? "ar-EG" : "en-US");
  }
  function money(n) {
    return tx("gen.money", { n: num(n) }) || (lang() === "ar" ? num(n) + " جنيه" : num(n) + " LE");
  }

  // Text-tab words with simple marks: **bold** and [link words](page.html or https://...). Everything else stays plain text.
  function mdHtml(s) {
    return esc(s)
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, label, href) {
        var h = href.replace(/&amp;/g, "&");
        if (!/^(https:\/\/|[\w-]+\.html(#[\w-]*)?$)/.test(h)) return m;
        return '<a href="' + esc(h) + '"' + (/^https:/.test(h) ? ' target="_blank" rel="noopener"' : "") + ">" + label + "</a>";
      })
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  }

  function applyText(root) {
    if (!content) return;
    (root || document).querySelectorAll("[data-t]").forEach(function (el) { el.textContent = tx(el.getAttribute("data-t")); });
    // Long pages (Privacy, Terms, Refund): if a row is missing, the words already in the page stay.
    (root || document).querySelectorAll("[data-t-md]").forEach(function (el) {
      var s = tx(el.getAttribute("data-t-md"));
      if (s) el.innerHTML = mdHtml(s);
    });
    (root || document).querySelectorAll("[data-t-alt]").forEach(function (el) { el.setAttribute("alt", tx(el.getAttribute("data-t-alt"))); });
    (root || document).querySelectorAll("[data-t-aria]").forEach(function (el) { el.setAttribute("aria-label", tx(el.getAttribute("data-t-aria"))); });
    // Headlines written in the sheet as "line|line|*italic line*", optionally stepped (data-steps="0,22,6").
    (root || document).querySelectorAll("[data-rich]").forEach(function (el) {
      var steps = (el.getAttribute("data-steps") || "").split(",").map(Number);
      el.innerHTML = tx(el.getAttribute("data-rich")).split("|").map(function (line, i) {
        var html = esc(line.trim()).replace(/\*([^*]+)\*/g, "<em>$1</em>");
        var pad = steps.length > 1 ? steps[i % steps.length] : 0;
        return '<span class="ln"' + (pad ? ' style="padding-inline-start:' + pad + '%"' : "") + ">" + html + "</span>";
      }).join("");
    });
    var titleKey = document.documentElement.getAttribute("data-title-key");
    if (titleKey && tx(titleKey)) document.title = tx(titleKey);
    // The Google description, in the visitor's language, from the Text tab.
    var descKey = document.documentElement.getAttribute("data-desc-key");
    var descTag = document.querySelector('meta[name="description"]');
    if (descKey && descTag && tx(descKey)) descTag.setAttribute("content", tx(descKey));
  }

  function applyLang(l) {
    var html = document.documentElement;
    html.setAttribute("data-lang", l);
    html.setAttribute("lang", l);
    html.setAttribute("dir", l === "ar" ? "rtl" : "ltr");
    var title = html.getAttribute("data-title-" + l);
    if (title) document.title = title;
    applyText();
    if (content) listeners.forEach(function (fn) { fn(content); });
    document.dispatchEvent(new CustomEvent("gd:lang", { detail: l }));
  }

  function setLang(l) {
    try { localStorage.setItem(LANG_KEY, l); } catch (e) { /* ignore */ }
    applyLang(l);
  }

  // ---------- Contact buttons ----------
  // The Instagram username lives in the sheet's Settings tab (admin page > Settings), never in the code.
  function igHandle() {
    var s = (content && content.settings) || {};
    return String(s.instagram || "guts.decor").replace(/^@/, "");
  }
  function igDm() { return "https://ig.me/m/" + encodeURIComponent(igHandle()); }
  function igProfile() { return "https://www.instagram.com/" + encodeURIComponent(igHandle()) + "/"; }
  // WhatsApp shows only when Settings has a store number AND its switch is on.
  function waNumber() {
    var s = (content && content.settings) || {};
    return s.whatsapp && s.whatsappOn !== false ? s.whatsapp : "";
  }

  // Instagram DM button (plus WhatsApp when switched on), with the reply promise under it.
  function dmHtml() {
    var html = '<div class="dm"><div class="dm-buttons">' +
      '<a class="btn btn-gold" href="' + igDm() + '" target="_blank" rel="noopener">' +
      igIcon() + "<span>" + esc(tx("ig.button")) + "</span></a>";
    if (waNumber()) {
      html += '<a class="btn btn-ghost" href="https://wa.me/' + encodeURIComponent(waNumber()) + '" target="_blank" rel="noopener">' +
        esc(tx("wa.button")) + "</a>";
    }
    return html + '</div><p class="dm-note">' + esc(tx("ig.reply")) + "</p></div>";
  }

  // Every Instagram link written in a page follows the username in Settings.
  function fixIgLinks() {
    document.querySelectorAll('a[href*="ig.me/m/"]').forEach(function (a) { a.href = igDm(); });
    document.querySelectorAll('a[href*="instagram.com/"]').forEach(function (a) { a.href = igProfile(); });
    document.querySelectorAll("[data-ig-name]").forEach(function (el) { el.textContent = "@" + igHandle(); });
  }

  // ---------- Copy a message, then open the Instagram chat ----------
  function copyText(text) {
    var done = false;
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
      done = document.execCommand("copy");
      document.body.removeChild(ta);
    } catch (e) { /* fall through */ }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return done; });
    }
    return Promise.resolve(done);
  }
  function toast(msg) {
    var el = document.getElementById("gd-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "gd-toast"; el.className = "toast"; el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("on");
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove("on"); }, 3200);
  }
  // Copies the message, says "Copied! Paste it in the chat", then opens the Instagram chat.
  function dm(text, trackName) {
    if (trackName) track(trackName);
    sendQueue();
    return copyText(text).then(function (ok) {
      toast(ok ? tx("dm.copied") || "Copied! Paste it in the chat" : tx("dm.copyFail") || "Opening Instagram…");
      setTimeout(function () { window.location.href = igDm(); }, ok ? 1300 : 600);
      return ok;
    });
  }
  // ---------- The two ways besides a level: Build your own katana, Custom commission ----------
  // The 3D builder link is used only once it's switched on in Settings; until then the button opens a DM.
  function builderHref() {
    var s = (content && content.settings) || {};
    return s.builderOn && /^https?:\/\/|^[\w\-\/]+\.html/.test(s.builderUrl || "") ? s.builderUrl : "";
  }
  function builderBtn(cls, label) {
    var href = builderHref();
    return href ? '<a class="' + cls + '" href="' + esc(href) + '" data-track="tap:builder">' + label + "</a>"
      : '<button type="button" class="' + cls + '" data-dm-msg="dm.builder" data-track="tap:builder">' + label + "</button>";
  }
  function commissionBtn(cls, label) {
    return '<button type="button" class="' + cls + '" data-dm-msg="dm.commission" data-track="tap:commission">' + label + "</button>";
  }
  function customPills() {
    return builderBtn("pill pill-btn", esc(tx("custom.build.t"))) + commissionBtn("pill pill-btn", esc(tx("custom.comm.short")));
  }
  function customCards() {
    return '<div class="custom-opts">' +
      '<div class="custom-opt"><h3>' + esc(tx("custom.build.t")) + "</h3><p>" + esc(tx("custom.build.d")) + "</p>" +
      builderBtn("btn btn-gold", esc(tx("custom.build.btn"))) + "</div>" +
      '<div class="custom-opt"><h3>' + esc(tx("custom.comm.t")) + "</h3><p>" + esc(tx("custom.comm.d")) + "</p>" +
      commissionBtn("btn btn-ghost", igIcon() + "<span>" + esc(tx("custom.comm.btn")) + "</span>") + "</div></div>";
  }
  function renderCustom() {
    document.querySelectorAll("[data-custom-opts]").forEach(function (el) { el.innerHTML = customCards(); });
  }

  // A button written as <button data-dm-msg="text key"> copies that Text-tab message and opens the chat.
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-dm-msg]");
    if (!b) return;
    e.preventDefault();
    dm(tx(b.getAttribute("data-dm-msg")));
  });

  function igIcon() {
    return '<svg class="ig-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">' +
      '<rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.5" cy="6.5" r="1.3" fill="currentColor"/></svg>';
  }

  function renderDm() {
    document.querySelectorAll("[data-dm]").forEach(function (el) { el.innerHTML = dmHtml(); });
  }

  // The email address is never written in the page. It arrives encoded and only opens on click.
  function contactEmail() {
    var s = (content && content.settings) || {};
    if (s.contactEmailEnc) {
      try { return atob(s.contactEmailEnc).split("").reverse().join(""); } catch (e) { /* fall through */ }
    }
    return s.contactEmail || "";
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest("[data-email-btn]");
    if (!btn) return;
    var email = contactEmail();
    if (email) window.location.href = "mailto:" + email + "?subject=Guts%20Decor";
    else window.open(igProfile(), "_blank", "noopener");
  });

  // ---------- Header & footer ----------
  var page = document.body.getAttribute("data-page") || "";

  var brandHtml = '<a class="brand" href="index.html" aria-label="Guts Decor"><span class="gd-mark" aria-hidden="true">GD</span>' +
    '<span class="wordmark" aria-hidden="true">GUTS DECOR</span></a>';

  // Menu links. Commissions opens the "Build your own katana / Custom commission" choices on the Swords page.
  var MENU = [
    ["menu.1", "swords.html"], ["menu.2", "designs.html"], ["menu.3", "display.html"],
    ["menu.4", "gift.html", "gold"], ["menu.5", "swords.html#custom"], ["menu.6", "gallery.html"],
    ["menu.7", "how.html"], ["menu.8", "about.html"]
  ];
  var SWORD_SVG = '<svg viewBox="0 0 40 400" fill="none" stroke="currentColor" stroke-width="0.7" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M19 6 L23.5 16 Q26.5 140 22.5 262 L17.5 262 Q20.5 140 19 6 Z"/><path d="M19.6 18 Q22.6 140 20 260"/><rect x="16.5" y="262" width="7" height="6" rx="1"/>' +
    '<ellipse cx="20" cy="272" rx="15" ry="4"/><rect x="16" y="277" width="8" height="104" rx="3"/>' +
    '<path d="M16 285 L24 295 L16 305 L24 315 L16 325 L24 335 L16 345 L24 355 L16 365 L24 375"/>' +
    '<path d="M24 285 L16 295 L24 305 L16 315 L24 325 L16 335 L24 345 L16 355 L24 365 L16 375"/><rect x="15" y="381" width="10" height="7" rx="2"/></svg>';

  var header = document.getElementById("site-header");
  if (header) {
    header.className = "site-header";
    header.innerHTML =
      '<a class="skip-link" href="#main" data-t="nav.skip"></a>' +
      '<div class="bar">' + brandHtml + '<div class="bar-end">' +
      '<a class="cart-link" href="cart.html" id="cart-link"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">' +
      '<path d="M5 7h14l-1.2 12.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8L5 7Z"/><path d="M9 7V5.5a3 3 0 0 1 6 0V7"/></svg>' +
      '<span class="cart-count" id="cart-count" aria-hidden="true"></span></a>' +
      '<button type="button" class="menu-btn" id="menu-open" aria-controls="site-menu" aria-expanded="false">' +
      '<span data-t="nav.menu"></span><span class="bars" aria-hidden="true"><span></span><span></span></span></button>' +
      "</div></div>";

    var menu = document.createElement("div");
    menu.className = "menu";
    menu.id = "site-menu";
    menu.hidden = true;
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-modal", "true");
    menu.innerHTML =
      '<span class="deco" aria-hidden="true">' + SWORD_SVG + "</span>" +
      '<div class="bar" style="display:flex;align-items:center;justify-content:space-between;padding:18px 20px">' + brandHtml +
      '<button type="button" class="close-btn" id="menu-close"><span data-t="nav.close"></span><span class="x" aria-hidden="true"><span></span><span></span></span></button></div>' +
      '<nav aria-label="Main"><ul>' + MENU.map(function (m, i) {
        return '<li' + (m[2] ? ' class="' + m[2] + '"' : "") + '><a href="' + m[1] + '"><span class="num">0' + (i + 1) + '</span><span class="name" data-t="' + m[0] + '"></span></a></li>';
      }).join("") + "</ul></nav>" +
      '<div class="menu-foot"><a class="btn btn-gold" href="order.html" data-t="home.start"></a>' +
      '<div class="row"><div class="lang-switch"><button type="button" data-set-lang="en" lang="en">EN</button><span class="sep" aria-hidden="true">/</span>' +
      '<button type="button" data-set-lang="ar" lang="ar" class="ar">عربي</button></div>' +
      '<div class="menu-links" id="menu-links"></div></div></div>';
    document.body.appendChild(menu);

    var opener = document.getElementById("menu-open");
    function openMenu() {
      menu.hidden = false;
      document.body.classList.add("menu-open");
      opener.setAttribute("aria-expanded", "true");
      document.getElementById("menu-close").focus();
    }
    function closeMenu(returnFocus) {
      menu.hidden = true;
      document.body.classList.remove("menu-open");
      opener.setAttribute("aria-expanded", "false");
      if (returnFocus) opener.focus();
    }
    opener.addEventListener("click", openMenu);
    document.getElementById("menu-close").addEventListener("click", function () { closeMenu(true); });
    menu.addEventListener("click", function (e) { if (e.target.closest("a")) closeMenu(false); });
    document.addEventListener("keydown", function (e) {
      if (menu.hidden) return;
      if (e.key === "Escape") closeMenu(true);
      if (e.key === "Tab") { // keep keyboard focus inside the open menu
        var f = menu.querySelectorAll("a, button");
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    });
    menu.querySelectorAll("[data-set-lang]").forEach(function (b) {
      b.addEventListener("click", function () { setLang(b.getAttribute("data-set-lang")); });
    });

    // Transparent over the Home page's first screen, purple everywhere else.
    if (page === "home") {
      var onScroll = function () {
        var hero = document.querySelector(".h-hero");
        header.classList.toggle("is-over", !!hero && window.scrollY < hero.offsetHeight - 80);
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    }
  }

  function renderMenuExtras() {
    var s = (content && content.settings) || {};
    var links = document.getElementById("menu-links");
    if (links) {
      links.innerHTML = '<a href="' + igProfile() + '" target="_blank" rel="noopener">' + esc(tx("footer.instagram")) + "</a>" +
        (waNumber() ? '<a href="https://wa.me/' + encodeURIComponent(waNumber()) + '" target="_blank" rel="noopener">WhatsApp</a>' : "");
    }
    fixIgLinks();
    document.querySelectorAll("[data-set-lang]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-set-lang") === lang()));
    });
  }

  var footer = document.getElementById("site-footer");
  if (footer) {
    footer.className = "site-footer";
    footer.innerHTML =
      '<div class="inner">' + brandHtml.replace('class="brand"', 'class="brand" style="pointer-events:auto"') +
      '<div class="links"><a href="https://www.instagram.com/guts.decor/" target="_blank" rel="noopener" data-t="footer.instagram"></a>' +
      '<button type="button" class="link-btn" data-email-btn data-t="footer.email"></button>' +
      '<a href="about.html" data-t="footer.aboutUs"></a><a href="shipping.html" data-t="footer.shipping"></a>' +
      '<a href="privacy.html" data-t="footer.privacy"></a><a href="terms.html" data-t="footer.terms"></a>' +
      '<a href="refund.html" data-t="footer.refunds"></a></div>' +
      '<p class="made" data-t="footer.made"></p>' +
      '<p class="fine" data-t="footer.fanart"></p><p class="fine" data-t="footer.adults"></p>' +
      '<p class="fine">&copy; ' + new Date().getFullYear() + " Guts Decor</p></div>";
  }

  // ---------- Cart (kept in this browser only: free, no login) ----------
  var CART_KEY = "gd-cart-v1";
  function cartGet() {
    try { var c = JSON.parse(localStorage.getItem(CART_KEY) || "[]"); return Array.isArray(c) ? c : []; } catch (e) { return []; }
  }
  function cartSet(lines) {
    try { localStorage.setItem(CART_KEY, JSON.stringify(lines)); } catch (e) { /* ignore */ }
    renderCartCount();
  }
  function cartCount() { return cartGet().reduce(function (n, l) { return n + (Number(l.qty) || 1); }, 0); }
  function renderCartCount() {
    var n = cartCount();
    var badge = document.getElementById("cart-count");
    var link = document.getElementById("cart-link");
    if (badge) { badge.textContent = n ? String(n) : ""; badge.classList.toggle("hidden", !n); }
    if (link) link.setAttribute("aria-label", tx("nav.cart", { n: num(n) }) || "Cart");
  }
  window.addEventListener("storage", function (e) { if (e.key === CART_KEY) renderCartCount(); });
  renderCartCount();

  // ---------- Page sections: on/off and order, set on the admin page (Sections tab) ----------
  function applySections(c) {
    var rows = (c.sections || []).filter(function (r) { return r.page === page; });
    if (!rows.length) return;
    var by = {};
    rows.forEach(function (r) { by[r.id] = r; });
    var els = Array.prototype.slice.call(document.querySelectorAll("[data-sec]"));
    els.forEach(function (el) {
      var r = by[el.getAttribute("data-sec")];
      el.classList.toggle("sec-off", !!r && r.show === false);
    });
    // Reorder sections that share a parent, keeping their places on the page.
    var groups = [];
    els.forEach(function (el) {
      var g = groups.filter(function (x) { return x.parent === el.parentNode; })[0];
      if (!g) groups.push(g = { parent: el.parentNode, els: [] });
      g.els.push(el);
    });
    groups.forEach(function (g) {
      var order = function (el) { var r = by[el.getAttribute("data-sec")]; return r && r.order != null ? Number(r.order) : 999; };
      var sorted = g.els.slice().sort(function (a, b) { return order(a) - order(b) || g.els.indexOf(a) - g.els.indexOf(b); });
      if (sorted.every(function (el, i) { return el === g.els[i]; })) return;
      var marks = g.els.map(function (el) { var m = document.createComment("sec"); el.parentNode.insertBefore(m, el); return m; });
      marks.forEach(function (m, i) { m.parentNode.replaceChild(sorted[i], m); });
    });
  }

  // The plain copy written into the page for Google (data-static) goes once the real page is drawn.
  function dropStatic() {
    document.querySelectorAll("[data-static]").forEach(function (el) { el.parentNode.removeChild(el); });
  }

  function previewBanner() {
    if (!previewing || document.getElementById("gd-preview")) return;
    var b = document.createElement("div");
    b.id = "gd-preview"; b.className = "preview-bar";
    b.innerHTML = "<span>" + esc(tx("admin.preview.bar") || "Preview: these changes are not live yet.") + '</span><button type="button">' +
      esc(tx("admin.preview.exit") || "Exit preview") + "</button>";
    b.querySelector("button").addEventListener("click", function () {
      try { sessionStorage.removeItem(PREVIEW_KEY); } catch (e) { /* ignore */ }
      location.reload();
    });
    document.body.appendChild(b);
  }

  onContent(applySections);
  onContent(function () { setTimeout(dropStatic, 0); });
  onContent(previewBanner);
  onContent(renderDm);
  onContent(renderCustom);
  onContent(renderMenuExtras);
  onContent(renderCartCount);

  // Turns a Google Drive share link into an image address.
  function driveImage(link, width) {
    if (!link) return "";
    // A cell can hold several photos separated by commas: a single image uses the first one.
    link = String(link).split(/[\s,]+/).filter(Boolean)[0] || "";
    if (!link) return "";
    var m = String(link).match(/\/d\/([\w-]{20,})/) || String(link).match(/[?&]id=([\w-]{20,})/);
    if (!m) return /^https:\/\//.test(link) ? link : "";
    return "https://drive.google.com/thumbnail?id=" + m[1] + "&sz=w" + (width || 1000);
  }

  function post(payload) {
    if (!API_URL) return Promise.reject(new Error("not-configured"));
    // text/plain keeps this a "simple" request, which Apps Script accepts from any site.
    return fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); });
  }

  function get(params) {
    if (!API_URL) return Promise.reject(new Error("not-configured"));
    var q = Object.keys(params).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]); }).join("&");
    return fetch(API_URL + "?" + q).then(function (r) { return r.json(); });
  }

  // ---------- Anonymous counting ----------
  // Only "+1" for things like "visit:gifts" or "cta:swords". No cookies, nothing about the visitor.
  var queue = [];
  var timer = null;
  function sendQueue() {
    timer = null;
    if (!queue.length || !API_URL) return;
    var body = JSON.stringify({ action: "track", e: queue.splice(0, 10) });
    if (!(navigator.sendBeacon && navigator.sendBeacon(API_URL, body))) {
      fetch(API_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: body, keepalive: true }).catch(function () {});
    }
    if (queue.length) timer = setTimeout(sendQueue, 200);
  }
  function track(name) {
    var e = String(name).toLowerCase().replace(/[^a-z0-9:._'\-]+/g, "-").slice(0, 60);
    if (!e || previewing || /^(localhost|127\.)/.test(location.hostname)) return; // don't count tests on this computer or previews
    queue.push(e);
    if (!timer) timer = setTimeout(sendQueue, 1000);
  }
  window.addEventListener("pagehide", sendQueue);
  document.addEventListener("click", function (ev) {
    var el = ev.target.closest && ev.target.closest("[data-track]");
    if (el) { track(el.getAttribute("data-track")); sendQueue(); }
  });
  if (page) track("visit:" + page);

  // ---------- Where a visitor came from (Kennedy: measure which marketing sells) ----------
  // A tagged link like gutsdecor.com/?src=ig-bio or ?src=friend-gd-ab12 is counted once (Stats tab)
  // and remembered in this browser for 30 days, so the order can say which link it came from. Nothing about the person.
  var SRC_KEY = "gd_src";
  (function rememberSource() {
    try {
      var q = new URLSearchParams(location.search);
      var v = String(q.get("src") || q.get("utm_source") || "").toLowerCase().replace(/[^a-z0-9._\-]+/g, "-").slice(0, 40);
      if (!v) return;
      localStorage.setItem(SRC_KEY, JSON.stringify({ v: v, t: Date.now() }));
      track("src:" + v);
    } catch (e) { /* private window or storage blocked: fine */ }
  })();
  function source() {
    try {
      var s = JSON.parse(localStorage.getItem(SRC_KEY) || "null");
      return s && s.v && Date.now() - s.t < 30 * 86400000 ? s.v : "";
    } catch (e) { return ""; }
  }

  window.GD = {
    track: track, source: source, cart: { get: cartGet, set: cartSet, count: cartCount },
    lang: lang, t: t, tx: tx, num: num, money: money, esc: esc, mdHtml: mdHtml,
    getContent: getContent, onContent: onContent, applyText: applyText, dmHtml: dmHtml,
    ig: igHandle, igDm: igDm, dm: dm, customPills: customPills, customCards: customCards, copy: copyText, toast: toast, previewing: function () { return previewing; },
    post: post, get: get, driveImage: driveImage, swordSvg: SWORD_SVG,
    configured: function () { return !!API_URL; }
  };

  applyLang(detectLang());
})();
