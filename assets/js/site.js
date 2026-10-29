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

  var firstContent = new Promise(function (resolve, reject) {
    var cached = readCache();
    if (cached && cached.ok) { setContent(cached); resolve(cached); }

    var snapshot = fetch(SNAPSHOT_URL, { cache: "no-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
    var live = API_URL
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

  function applyText(root) {
    if (!content) return;
    (root || document).querySelectorAll("[data-t]").forEach(function (el) { el.textContent = tx(el.getAttribute("data-t")); });
    (root || document).querySelectorAll("[data-t-alt]").forEach(function (el) { el.setAttribute("alt", tx(el.getAttribute("data-t-alt"))); });
    (root || document).querySelectorAll("[data-t-aria]").forEach(function (el) { el.setAttribute("aria-label", tx(el.getAttribute("data-t-aria"))); });
    var titleKey = document.documentElement.getAttribute("data-title-key");
    if (titleKey && tx(titleKey)) document.title = tx(titleKey);
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
  // Instagram DM button (plus WhatsApp only when Settings has a business number), with the reply promise under it.
  function dmHtml() {
    var s = (content && content.settings) || {};
    var handle = s.instagram || "guts_san_store";
    var html = '<div class="dm"><div class="dm-buttons">' +
      '<a class="btn btn-gold" href="https://ig.me/m/' + encodeURIComponent(handle) + '" target="_blank" rel="noopener">' +
      igIcon() + "<span>" + esc(tx("ig.button")) + "</span></a>";
    if (s.whatsapp) {
      html += '<a class="btn btn-ghost" href="https://wa.me/' + encodeURIComponent(s.whatsapp) + '" target="_blank" rel="noopener">' +
        esc(tx("wa.button")) + "</a>";
    }
    return html + '</div><p class="dm-note">' + esc(tx("ig.reply")) + "</p></div>";
  }

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
    else window.open("https://www.instagram.com/guts_san_store/", "_blank", "noopener");
  });

  // ---------- Header & footer ----------
  var page = document.body.getAttribute("data-page") || "";

  function navLink(href, key, textKey) {
    return '<a href="' + href + '"' + (page === key ? ' aria-current="page"' : "") + ' data-t="' + textKey + '"></a>';
  }

  var header = document.getElementById("site-header");
  if (header) {
    header.className = "site-header";
    header.innerHTML =
      '<a class="skip-link" href="#main" data-t="nav.skip"></a>' +
      '<div class="wrap">' +
      '<a class="brand" href="index.html"><img src="assets/img/mark-header.png" alt="" width="72" height="36">' +
      '<span class="brand-name">Guts Decor</span></a>' +
      '<nav class="nav" aria-label="Main">' +
      navLink("index.html", "home", "nav.home") +
      navLink("gallery.html", "gallery", "nav.gallery") +
      navLink("order.html", "order", "nav.order") +
      '<a class="nav-ig" href="https://www.instagram.com/guts_san_store/" target="_blank" rel="noopener" data-t-aria="nav.instagram">' + igIcon() + "</a>" +
      '<button type="button" class="lang-btn" id="lang-toggle" data-t="nav.lang"></button>' +
      "</nav></div>";
    document.getElementById("lang-toggle").addEventListener("click", function () {
      setLang(lang() === "ar" ? "en" : "ar");
    });
  }

  var footer = document.getElementById("site-footer");
  if (footer) {
    footer.className = "site-footer";
    footer.innerHTML =
      '<div class="wrap">' +
      '<div class="footer-grid">' +
      '<div><h3>Guts Decor</h3><p><span data-t="footer.about"></span><br><span data-t="footer.city"></span></p></div>' +
      '<div><h3 data-t="footer.contact"></h3><ul>' +
      '<li><a class="nav-ig-text" href="https://www.instagram.com/guts_san_store/" rel="noopener" target="_blank">' + igIcon() + " @guts_san_store</a></li>" +
      '<li><button type="button" class="link-btn" data-email-btn data-t="footer.email"></button></li>' +
      "</ul></div>" +
      '<div><h3 data-t="footer.policies"></h3><ul>' +
      '<li><a href="privacy.html" data-t="footer.privacy"></a></li>' +
      '<li><a href="terms.html" data-t="footer.terms"></a></li>' +
      '<li><a href="refund.html" data-t="footer.refund"></a></li>' +
      '<li><a href="pay.html" data-t="footer.pay"></a></li>' +
      "</ul></div></div>" +
      '<div class="disclaimer"><p data-t="footer.fanart"></p><p data-t="footer.adults"></p>' +
      "<p>&copy; " + new Date().getFullYear() + " Guts Decor</p></div></div>";
  }

  onContent(renderDm);

  // Turns a Google Drive share link into an image address.
  function driveImage(link, width) {
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

  window.GD = {
    lang: lang, t: t, tx: tx, num: num, money: money, esc: esc,
    getContent: getContent, onContent: onContent, applyText: applyText, dmHtml: dmHtml,
    post: post, get: get, driveImage: driveImage,
    configured: function () { return !!API_URL; }
  };

  applyLang(detectLang());
})();
