/* Guts Decor — shared site code: language, header/footer, content from the sheet */
(function () {
  "use strict";

  // The public address of the order system (Google Apps Script web app).
  // This is not a secret: it only ever hands out the safe, public parts of the sheet.
  var API_URL = "";

  var LANG_KEY = "gd-lang";

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

  function applyLang(lang) {
    var html = document.documentElement;
    html.setAttribute("data-lang", lang);
    html.setAttribute("lang", lang);
    html.setAttribute("dir", lang === "ar" ? "rtl" : "ltr");
    var title = html.getAttribute("data-title-" + lang);
    if (title) document.title = title;
    document.dispatchEvent(new CustomEvent("gd:lang", { detail: lang }));
  }

  function setLang(lang) {
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) { /* ignore */ }
    applyLang(lang);
  }

  function lang() { return document.documentElement.getAttribute("data-lang") || "en"; }
  function t(en, ar) { return lang() === "ar" && ar ? ar : en; }

  function num(n) {
    return Number(n).toLocaleString(lang() === "ar" ? "ar-EG" : "en-US");
  }
  function money(n) {
    return lang() === "ar" ? num(n) + " جنيه" : num(n) + " LE";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  applyLang(detectLang());

  // ---------- Header & footer ----------
  var page = document.body.getAttribute("data-page") || "";

  function navLink(href, key, en, ar) {
    var cur = page === key ? ' aria-current="page"' : "";
    return '<a href="' + href + '"' + cur + '><span data-l="en">' + en + '</span><span data-l="ar">' + ar + "</span></a>";
  }

  var header = document.getElementById("site-header");
  if (header) {
    header.className = "site-header";
    header.innerHTML =
      '<a class="skip-link" href="#main"><span data-l="en">Skip to content</span><span data-l="ar">تخطَّ إلى المحتوى</span></a>' +
      '<div class="wrap">' +
      '<a class="brand" href="index.html"><img src="assets/GD-Mark.svg" alt="" width="40" height="40" onerror="this.outerHTML=\'<span class=&quot;brand-mark&quot; aria-hidden=&quot;true&quot;>GD</span>\'">' +
      '<span class="brand-name">Guts Decor</span></a>' +
      '<nav class="nav" aria-label="Main">' +
      navLink("index.html", "home", "Home", "الرئيسية") +
      navLink("gallery.html", "gallery", "Gallery", "المعرض") +
      navLink("order.html", "order", "Order", "اطلب") +
      '<button type="button" class="lang-btn" id="lang-toggle">' +
      '<span data-l="en" lang="ar">عربي</span><span data-l="ar" lang="en" class="to-en">English</span></button>' +
      "</nav></div>";
    document.getElementById("lang-toggle").addEventListener("click", function () {
      setLang(lang() === "ar" ? "en" : "ar");
    });
  }

  var footer = document.getElementById("site-footer");
  if (footer) {
    footer.className = "site-footer";
    var year = new Date().getFullYear();
    footer.innerHTML =
      '<div class="wrap">' +
      '<div class="footer-grid">' +
      "<div><h3>Guts Decor</h3>" +
      '<p><span data-l="en">Handmade wooden swords and decor.<br>Cairo, Egypt</span><span data-l="ar">سيوف وديكورات خشب معمولة بإيدي.<br>القاهرة، مصر</span></p></div>' +
      '<div><h3><span data-l="en">Contact</span><span data-l="ar">تواصل معايا</span></h3><ul>' +
      '<li><a href="https://www.instagram.com/guts_san_store/" rel="noopener" target="_blank">Instagram @guts_san_store</a></li>' +
      '<li><button type="button" class="link-btn" data-email-btn><span data-l="en">Email us</span><span data-l="ar">راسلنا</span></button></li>' +
      "</ul></div>" +
      '<div><h3><span data-l="en">Policies</span><span data-l="ar">السياسات</span></h3><ul>' +
      '<li><a href="privacy.html"><span data-l="en">Privacy policy</span><span data-l="ar">سياسة الخصوصية</span></a></li>' +
      '<li><a href="terms.html"><span data-l="en">Terms</span><span data-l="ar">الشروط والأحكام</span></a></li>' +
      '<li><a href="refund.html"><span data-l="en">Refund policy</span><span data-l="ar">سياسة الاسترجاع</span></a></li>' +
      '<li><a href="pay.html"><span data-l="en">Upload a payment</span><span data-l="ar">ارفع إيصال الدفع</span></a></li>' +
      "</ul></div></div>" +
      '<div class="disclaimer">' +
      '<p><span data-l="en">Fan art: every character-inspired piece is an original handmade work “inspired by” its series. Character names and artwork belong to their owners. Guts Decor is not affiliated with or endorsed by them.</span>' +
      '<span data-l="ar">فان آرت: كل قطعة مستوحاة من شخصية هي شغل يدوي أصلي “مستوحى من” السلسلة بتاعتها. أسماء الشخصيات والرسومات ملك أصحابها، وGuts Decor مش تابع ليهم ولا معتمد منهم.</span></p>' +
      '<p><span data-l="en">For adults (18+). Decorative pieces, built to be held and swung, never to strike anything.</span>' +
      '<span data-l="ar">للكبار (+18). قطع ديكور، معمولة عشان تتمسك وتتلوّح، مش عشان تضرب بيها أي حاجة.</span></p>' +
      "<p>&copy; " + year + " Guts Decor</p></div></div>";
  }

  // ---------- Content from the Website Content sheet ----------
  var CACHE_KEY = "gd-content-v1";
  var contentPromise = null;

  function getContent() {
    if (contentPromise) return contentPromise;
    contentPromise = new Promise(function (resolve, reject) {
      try {
        var cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
        if (cached && Date.now() - cached.at < 60 * 1000) return resolve(cached.data);
      } catch (e) { /* ignore */ }
      if (!API_URL) return reject(new Error("not-configured"));
      fetch(API_URL + "?action=content")
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data || !data.ok) throw new Error("bad-response");
          try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data: data })); } catch (e) { /* ignore */ }
          resolve(data);
        })
        .catch(reject);
    });
    return contentPromise;
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

  // The email address is never written in the page. It arrives from the sheet and only opens on click.
  document.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest("[data-email-btn]");
    if (!btn) return;
    getContent().then(function (c) {
      if (c.settings.contactEmail) window.location.href = "mailto:" + c.settings.contactEmail + "?subject=Guts%20Decor";
    }).catch(function () {
      window.open("https://www.instagram.com/guts_san_store/", "_blank", "noopener");
    });
  });

  // Turns a Google Drive share link into an image address.
  function driveImage(link, width) {
    if (!link) return "";
    var m = String(link).match(/\/d\/([\w-]{20,})/) || String(link).match(/[?&]id=([\w-]{20,})/);
    if (!m) return /^https:\/\//.test(link) ? link : "";
    return "https://drive.google.com/thumbnail?id=" + m[1] + "&sz=w" + (width || 1000);
  }

  window.GD = {
    lang: lang, t: t, num: num, money: money, esc: esc,
    getContent: getContent, post: post, get: get, driveImage: driveImage,
    configured: function () { return !!API_URL; }
  };
})();
