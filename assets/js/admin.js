/* Guts Decor admin page.
 * Everything here edits the Website Content sheet through the order system (apps-script/Code.gs, handleAdmin_).
 * Saving writes a DRAFT into the sheet. Preview shows the site with the draft. Publish makes it live and saves a version.
 * Content only: the order system checks every value, and layout/code can't be changed from here. */
(function () {
  "use strict";
  var GD = window.GD;
  var esc = GD.esc;
  // The admin page is always in English, left to right.
  document.documentElement.setAttribute("lang", "en");
  document.documentElement.setAttribute("dir", "ltr");

  var TOKEN_KEY = "gd-admin-token";
  var token = "";
  try { token = sessionStorage.getItem(TOKEN_KEY) || ""; } catch (e) { /* ignore */ }
  var data = null;          // what adminLoad returned
  var pending = {};         // unsaved changes, by id
  var current = "home";     // open tab
  var openRow = null;       // "tab:row" of the product/row being edited
  var adding = null;        // table name when the "add new" form is open
  var textFilter = "";

  function $(id) { return document.getElementById(id); }

  // ---------- Talking to the order system ----------
  function call(action, extra) {
    var body = { action: action, token: token };
    Object.keys(extra || {}).forEach(function (k) { body[k] = extra[k]; });
    return GD.post(body).then(function (res) {
      if (res && res.error === "login") { logout("Your login ran out. Please log in again."); throw new Error("login"); }
      return res;
    });
  }
  function showMsg(text, good) {
    var m = $("msg");
    m.innerHTML = Array.isArray(text) ? "<ul>" + text.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>" : esc(text);
    m.className = "adm-msg " + (good ? "good" : "bad");
    if (good) setTimeout(function () { if (m.textContent === (Array.isArray(text) ? text.join("") : text)) m.classList.add("hidden"); }, 5000);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function hideMsg() { $("msg").classList.add("hidden"); }
  // Yes/No questions inside the page (the browser's own pop-up boxes can be switched off by the browser, and then buttons seem dead).
  function ask(question, yes, no) {
    return new Promise(function (resolve) {
      var box = $("ask");
      box.querySelector(".adm-ask-q").textContent = question;
      var ok = $("ask-yes"), cancel = $("ask-no");
      ok.textContent = yes || "Yes"; cancel.textContent = no || "Cancel";
      box.classList.remove("hidden");
      ok.focus();
      function done(v) {
        box.classList.add("hidden");
        ok.onclick = cancel.onclick = box.onkeydown = null;
        resolve(v);
      }
      ok.onclick = function () { done(true); };
      cancel.onclick = function () { done(false); };
      box.onkeydown = function (e) { if (e.key === "Escape") done(false); };
    });
  }
  function problem(res) {
    if (res && res.messages) return showMsg(res.messages);
    showMsg("That didn't work. Check your internet and try again.");
  }
  function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || "Working…"; btn.disabled = true; }
    else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
  }

  // ---------- Log in / out ----------
  $("login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = $("login-btn");
    busy(btn, true, "Checking…");
    $("login-err").classList.add("hidden");
    GD.post({ action: "adminLogin", password: $("pw").value }).then(function (res) {
      busy(btn, false);
      if (res && res.ok) {
        token = res.token;
        try { sessionStorage.setItem(TOKEN_KEY, token); } catch (e2) { /* ignore */ }
        $("pw").value = "";
        start();
        return;
      }
      var msg = {
        wrong: "That password isn't right.",
        locked: "Too many wrong tries. Wait 15 minutes and try again.",
        nopassword: "No password is set yet. Type one (8 letters or more) in the sheet's Settings tab, next to “Admin password (first time only)”."
      }[res && res.error] || "The admin page can't reach the order system. Was the new Code.gs deployed?";
      $("login-err").textContent = msg;
      $("login-err").classList.remove("hidden");
    }).catch(function () {
      busy(btn, false);
      $("login-err").textContent = "No connection. Check your internet and try again.";
      $("login-err").classList.remove("hidden");
    });
  });
  function logout(why) {
    token = "";
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
    $("app").classList.add("hidden");
    $("login").classList.remove("hidden");
    if (why) { $("login-err").textContent = why; $("login-err").classList.remove("hidden"); }
  }

  function start() {
    $("login").classList.add("hidden");
    $("app").classList.remove("hidden");
    $("main").innerHTML = '<p class="adm-loading">Loading your site…</p>';
    load();
  }
  function load() {
    return call("adminLoad").then(function (res) {
      if (!res || !res.ok) return problem(res);
      data = res;
      renderState();
      render();
    });
  }

  // ---------- Pages of the admin ----------
  // Which Text-tab words appear on which admin page (first match wins), and which sections each page has.
  var TABS = [
    { id: "home", name: "Home", page: "home", text: [/^home\./, /^hero\./, /^ph\./], photos: function (spot) { return spot !== "About photo"; } },
    { id: "catalog", name: "Catalog", page: "swords", tables: ["Ready Designs", "Tiers", "Add-ons", "Gallery"],
      text: [/^swords\./, /^designs\./, /^display\./, /^level\./, /^gallery\./, /^custom\./, /^dm\.commission$/] },
    { id: "product", name: "Product pages", page: "product", text: [/^pp\./, /^size\./, /^scene\./, /^room\./, /^wall\./, /^ship\.short\./, /^ship\.more$/] },
    { id: "about", name: "About", page: "about", text: [/^about2\./, /^about\./], photos: function (spot) { return spot === "About photo"; } },
    { id: "shipping", name: "Shipping & Returns", page: "shipping", text: [/^ship\./] },
    { id: "privacy", name: "Privacy", text: [/^privacy\./], legal: true },
    { id: "terms", name: "Terms", text: [/^terms\./], legal: true },
    { id: "refund", name: "Refund", text: [/^refund\./], legal: true },
    { id: "builder", name: "Builder", tables: ["Builder Options"], settings: ["3D builder on", "3D builder link"], text: [/^builder\./, /^dm\.builder$/] },
    { id: "checkout", name: "Checkout", text: [/^co\./, /^cart\./, /^th\./, /^email\./, /^dm\.(?!order\.)/] },
    { id: "other", name: "Other pages", text: [/./] },
    { id: "settings", name: "Settings", tables: ["Shipping areas"], text: [/^dm\.order\./], settingsAll: true },
    { id: "orders", name: "Orders" },
    { id: "versions", name: "Versions" }
  ];
  var TABLE_NAMES = { "Ready Designs": "Swords (Ready designs)", "Tiers": "Levels", "Add-ons": "Display pieces (mounts, stands, plaques)",
    "Gallery": "Gallery & review photos", "Builder Options": "3D builder parts", "Shipping areas": "Shipping estimate per area",
    "Videos": "Photos & videos" };

  function tabOfText(key) {
    for (var i = 0; i < TABS.length; i++) {
      var t = TABS[i];
      if (t.id === "other") continue; // "Other pages" gets whatever no other page claims
      if ((t.text || []).some(function (re) { return re.test(key); })) return t.id;
    }
    return "other";
  }

  function renderTabs() {
    $("tabs").innerHTML = TABS.map(function (t) {
      return '<button type="button" data-tab="' + t.id + '" aria-current="' + (t.id === current) + '">' + esc(t.name) + "</button>";
    }).join("");
  }
  $("tabs").addEventListener("click", function (e) {
    var b = e.target.closest("[data-tab]");
    if (!b) return;
    current = b.getAttribute("data-tab");
    openRow = null; adding = null; textFilter = "";
    hideMsg();
    render();
    window.scrollTo(0, 0);
  });

  function render() {
    renderTabs();
    var tab = TABS.filter(function (t) { return t.id === current; })[0];
    var out = "";
    if (tab.id === "orders") return renderOrders();
    if (tab.id === "versions") return renderVersions();
    if (tab.page) out += sectionsCard(tab.page);
    if (tab.settingsAll) out += settingsCard(null) + passwordCard();
    else if (tab.settings) out += settingsCard(tab.settings);
    if (tab.photos) out += photosCard(tab.photos);
    (tab.tables || []).forEach(function (n) { out += tableCard(n); });
    out += textCard(tab);
    $("main").innerHTML = out;
    renderSaveBar();
  }

  // ---------- Pending changes ----------
  function setPending(id, change) { pending[id] = change; renderSaveBar(); }
  function pendingCell(tab, row, key, header, value) {
    var id = "cell:" + tab + ":" + row;
    var ch = pending[id] || { type: "cell", tab: tab, row: row, key: key, values: {} };
    ch.values[header] = value;
    setPending(id, ch);
  }
  function count() { return Object.keys(pending).length; }
  function renderSaveBar() {
    var n = count();
    $("savebar").classList.toggle("hidden", !n);
    $("save-count").textContent = n === 1 ? "1 unsaved change" : n + " unsaved changes";
    renderState();
  }
  function renderState() {
    var n = count();
    $("state").textContent = n ? "Unsaved changes" : data && data.published ? "Last published " + data.published : "Not published from here yet";
  }
  window.addEventListener("beforeunload", function (e) { if (count()) { e.preventDefault(); e.returnValue = ""; } });

  function save() {
    if (!count()) return Promise.resolve(true);
    var btn = $("save-btn");
    busy(btn, true, "Saving…");
    var changes = Object.keys(pending).map(function (k) { return pending[k]; });
    return call("adminSave", { changes: changes }).then(function (res) {
      busy(btn, false);
      if (!res || !res.ok) { problem(res); return false; }
      pending = {};
      renderSaveBar();
      showMsg("Saved as a draft. Press Preview to see it, or Publish to make it live.", true);
      return load().then(function () { return true; });
    }).catch(function () { busy(btn, false); showMsg("Not saved: no connection. Try again."); return false; });
  }
  $("save-btn").addEventListener("click", save);
  $("discard-btn").addEventListener("click", function () {
    ask("Undo all unsaved changes?", "Undo them", "Keep them").then(function (yes) {
      if (!yes) return;
      pending = {};
      render();
    });
  });

  $("preview-btn").addEventListener("click", function () {
    // Open the tab now (phones block tabs opened later), then point it at the site once the draft is saved.
    var win = window.open("", "_blank");
    save().then(function (ok) {
      if (!ok) { if (win) win.close(); return; }
      var page = { home: "index.html", catalog: "swords.html", product: "designs.html", about: "about.html", shipping: "shipping.html", privacy: "privacy.html", terms: "terms.html", refund: "refund.html", checkout: "cart.html" }[current] || "index.html";
      var url = page + "#preview=" + token;
      if (win) win.location.href = url; else location.href = url;
    });
  });

  $("publish-btn").addEventListener("click", function () {
    save().then(function (ok) {
      if (!ok) return;
      return ask("Publish now? Your saved draft becomes the live website. A copy of this version is kept, so you can go back to it.", "Publish", "Not now");
    }).then(function (yes) {
      if (!yes) return;
      var btn = $("publish-btn");
      busy(btn, true, "Publishing…");
      call("adminPublish").then(function (res) {
        busy(btn, false);
        if (!res || !res.ok) return problem(res);
        data.published = res.when;
        renderState();
        showMsg("Published! Visitors see it within a minute. Google's copy updates within 15 minutes.", true);
      }).catch(function () { busy(btn, false); showMsg("Not published: no connection. Try again."); });
    });
  });

  // ---------- Inputs ----------
  function field(label, html, help) {
    return '<div class="adm-field"><label>' + esc(label) + "</label>" + html + (help ? '<p class="adm-help">' + esc(help) + "</p>" : "") + "</div>";
  }
  function yesno(attrs, value) {
    var on = /^yes$/i.test(value);
    return '<label class="adm-switch"><input type="checkbox" ' + attrs + (on ? " checked" : "") + '><span class="track"></span><span class="lbl">' + (on ? "Yes" : "No") + "</span></label>";
  }
  function thumbs(value) {
    var links = String(value || "").split(/[\s,]+/).filter(Boolean);
    return '<div class="adm-thumbs">' + links.map(function (l) {
      var src = GD.driveImage(l, 240);
      return src ? '<img src="' + esc(src) + '" alt="" loading="lazy">' : "";
    }).join("") + "</div>";
  }
  function input(kind, attrs, value) {
    value = value == null ? "" : String(value);
    if (kind === "yesno") return yesno(attrs, value);
    if (kind === "long") return "<textarea " + attrs + ' rows="3">' + esc(value) + "</textarea>";
    if (kind === "level" || kind === "category") {
      var list = kind === "level" ? data.levels : data.categories;
      return "<select " + attrs + '><option value="">(none)</option>' + list.map(function (o) {
        return '<option value="' + esc(o) + '"' + (o === value ? " selected" : "") + ">" + esc(o) + "</option>";
      }).join("") + "</select>";
    }
    if (kind === "photo") {
      return '<div class="adm-photo">' + thumbs(value) + "<textarea " + attrs + ' rows="2" placeholder="Paste a Google Drive link, or upload">' + esc(value) + "</textarea>" +
        '<label class="adm-btn small">Upload photo<input type="file" accept="image/jpeg,image/png,image/webp" data-upload hidden></label></div>';
    }
    if (kind === "number") return '<input type="text" inputmode="decimal" ' + attrs + ' value="' + esc(value) + '">';
    return '<input type="text" ' + attrs + ' value="' + esc(value) + '">';
  }
  function readInput(el) {
    if (el.type === "checkbox") return el.checked ? "Yes" : "No";
    return el.value;
  }

  // ---------- Sections (on/off and order) ----------
  function sectionRows(page) {
    var t = data.tabs["Sections"];
    if (!t) return [];
    var h = t.headers;
    return t.rows.map(function (r) {
      var o = {}; h.forEach(function (x, i) { o[x] = r.values[i]; });
      var p = pending["cell:Sections:" + r.row];
      if (p) Object.keys(p.values).forEach(function (k) { o[k] = p.values[k]; });
      o._row = r.row; return o;
    }).filter(function (o) { return o["Page"] === page; }).sort(function (a, b) { return (Number(a["Order"]) || 0) - (Number(b["Order"]) || 0); });
  }
  function sectionsCard(page) {
    var rows = sectionRows(page);
    if (!rows.length) return "";
    return '<section class="adm-card"><h2>Sections on this page</h2><p class="adm-help">Switch a section off to hide it, or move it up or down. The final “Start your order” part always stays.</p>' +
      '<ul class="adm-secs">' + rows.map(function (o, i) {
        return '<li data-sec-row="' + o._row + '" data-sec-key="' + esc(o["Section"]) + '"><span class="name">' + esc(o["What it is"] || o["Section"]) + "</span>" +
          yesno('data-sec-show aria-label="Show ' + esc(o["What it is"] || o["Section"]) + '"', o["Show (Yes/No)"] || "Yes") +
          '<button type="button" class="adm-icon" data-sec-move="up"' + (i === 0 ? " disabled" : "") + ' aria-label="Move up">↑</button>' +
          '<button type="button" class="adm-icon" data-sec-move="down"' + (i === rows.length - 1 ? " disabled" : "") + ' aria-label="Move down">↓</button></li>';
      }).join("") + "</ul></section>";
  }

  // ---------- Settings ----------
  function settingsCard(only) {
    var list = data.settings.filter(function (s) { return !only || only.indexOf(s.name) !== -1; });
    if (!list.length) return "";
    return '<section class="adm-card"><h2>' + (only ? "Settings" : "Site settings") + "</h2>" + list.map(function (s) {
      var p = pending["set:" + s.name];
      var v = p ? p.value : s.value;
      if (s.name === "Instagram handle") v = String(v).replace(/^@/, "");
      var kind = s.kind === "phone" ? "text" : s.kind;
      return field(s.name, input(kind, 'data-setting="' + esc(s.name) + '"', v), s.help);
    }).join("") + "</section>";
  }
  function passwordCard() {
    return '<section class="adm-card"><h2>Admin password</h2>' +
      field("Current password", '<input type="password" id="pw-old" autocomplete="current-password">') +
      field("New password", '<input type="password" id="pw-new" autocomplete="new-password">', "8 letters or more.") +
      '<button type="button" class="adm-btn" id="pw-save">Change password</button></section>';
  }

  // ---------- Photos & videos (Videos tab) ----------
  function photosCard(filter) {
    var t = data.tabs["Videos"];
    if (!t) return "";
    var rows = t.rows.filter(function (r) { return filter(r.values[t.keyCol]); });
    if (!rows.length) return "";
    return '<section class="adm-card"><h2>Photos &amp; videos</h2>' + rows.map(function (r) {
      return '<div class="adm-sub"><h3>' + esc(r.values[t.keyCol]) + "</h3>" + t.headers.map(function (h, i) {
        if (i === t.keyCol || !/link|shape/i.test(h)) return "";
        return field(h, input(t.kinds[i], cellAttrs("Videos", r.row, r.values[t.keyCol], h), cellValue("Videos", r, h, i)));
      }).join("") + "</div>";
    }).join("") + "</section>";
  }

  function cellAttrs(tab, row, key, header) {
    return 'data-cell-tab="' + esc(tab) + '" data-cell-row="' + row + '" data-cell-key="' + esc(key) + '" data-cell-h="' + esc(header) + '"';
  }
  function cellValue(tab, r, h, i) {
    var p = pending["cell:" + tab + ":" + r.row];
    return p && p.values.hasOwnProperty(h) ? p.values[h] : r.values[i];
  }

  // ---------- Tables: products, levels, display pieces, gallery, builder parts, shipping areas ----------
  function shortInfo(name, t, r) {
    var v = function (h) { var i = t.headers.indexOf(h); return i === -1 ? "" : cellValue(name, r, h, i); };
    var startsWith = function (s) { var h = t.headers.filter(function (x) { return x.indexOf(s) === 0; })[0]; return h ? v(h) : ""; };
    var bits = [];
    if (name === "Ready Designs") { if (v("Price (LE)")) bits.push(v("Price (LE)") + " LE"); if (startsWith("Level")) bits.push(startsWith("Level")); if (/^yes$/i.test(startsWith("Show on Home"))) bits.push("on Home"); }
    if (name === "Tiers" && v("Price (LE)")) bits.push(v("Price (LE)") + " LE");
    if (name === "Add-ons" && v("Price (LE)")) bits.push(v("Price (LE)") + " LE");
    if (name === "Gallery") bits.push(v("Category"));
    var shown = t.headers.indexOf("Show on site") === -1 || /^yes$/i.test(v("Show on site"));
    return { text: bits.filter(Boolean).join(" · "), shown: shown };
  }

  function tableCard(name) {
    var t = data.tabs[name];
    if (!t) return "";
    if (name === "Shipping areas") return shippingCard(t);
    var out = '<section class="adm-card"><div class="adm-card-head"><h2>' + esc(TABLE_NAMES[name] || name) + "</h2>" +
      '<button type="button" class="adm-btn small gold" data-add="' + esc(name) + '">+ Add new</button></div>';
    if (adding === name) out += rowForm(name, t, null);
    out += '<ul class="adm-rows">' + t.rows.map(function (r, i) {
      var key = t.keyCol >= 0 ? r.values[t.keyCol] : r.values[0];
      var info = shortInfo(name, t, r);
      var id = name + ":" + r.row;
      var hasShow = t.headers.indexOf("Show on site") !== -1;
      var photoCol = t.kinds.indexOf("photo");
      var img = photoCol !== -1 ? GD.driveImage(cellValue(name, r, t.headers[photoCol], photoCol), 160) : "";
      return '<li class="' + (info.shown ? "" : "is-hidden") + '" data-row-tab="' + esc(name) + '" data-row="' + r.row + '" data-key="' + esc(key) + '">' +
        '<div class="adm-row-top">' + (img ? '<img src="' + esc(img) + '" alt="" loading="lazy">' : '<span class="noimg"></span>') +
        '<div class="adm-row-txt"><strong>' + esc(name === "Gallery" ? (r.values[t.headers.indexOf("Title (EN)")] || "Photo " + (i + 1)) : key) + "</strong>" +
        "<span>" + esc(info.text) + (info.shown ? "" : " · hidden") + "</span></div></div>" +
        '<div class="adm-row-btns"><button type="button" class="adm-btn small" data-edit>' + (openRow === id ? "Close" : "Edit") + "</button>" +
        (hasShow ? '<button type="button" class="adm-btn small" data-toggle-show>' + (info.shown ? "Hide" : "Show") + "</button>" : "") +
        '<button type="button" class="adm-icon" data-move="up"' + (i === 0 ? " disabled" : "") + ' aria-label="Move up">↑</button>' +
        '<button type="button" class="adm-icon" data-move="down"' + (i === t.rows.length - 1 ? " disabled" : "") + ' aria-label="Move down">↓</button>' +
        '<button type="button" class="adm-icon danger" data-delete aria-label="Delete">✕</button></div>' +
        (openRow === id ? rowForm(name, t, r) : "") + "</li>";
    }).join("") + "</ul></section>";
    return out;
  }

  function rowForm(name, t, r) {
    var key = r ? (t.keyCol >= 0 ? r.values[t.keyCol] : r.values[0]) : "";
    return '<div class="adm-form"' + (r ? "" : ' data-new="' + esc(name) + '"') + ">" + t.headers.map(function (h, i) {
      if (!h) return "";
      var attrs = r ? cellAttrs(name, r.row, key, h) : 'data-new-h="' + esc(h) + '"';
      var v = r ? cellValue(name, r, h, i) : "";
      return field(h + (i === t.keyCol ? " *" : ""), input(t.kinds[i], attrs, v));
    }).join("") + (r ? "" : '<div class="adm-form-btns"><button type="button" class="adm-btn" data-add-cancel>Cancel</button><button type="button" class="adm-btn gold" data-add-save>Add</button></div>') + "</div>";
  }

  function shippingCard(t) {
    var gi = t.headers.indexOf("Governorate"), pi = t.headers.indexOf("Estimate (LE)");
    return '<section class="adm-card"><h2>Shipping estimate per area</h2><p class="adm-help">What customers see at checkout. If the real cost comes in slightly higher, you cover the difference.</p>' +
      '<div class="adm-ship">' + t.rows.map(function (r) {
        return '<label><span>' + esc(r.values[gi]) + "</span>" + input("number", cellAttrs("Shipping areas", r.row, r.values[gi], "Estimate (LE)"), cellValue("Shipping areas", r, "Estimate (LE)", pi)) + "</label>";
      }).join("") + "</div></section>";
  }

  // ---------- Words (Text tab) ----------
  function textCard(tab) {
    var rows = data.text.filter(function (r) { return tabOfText(r.key) === tab.id; });
    if (!rows.length) return "";
    var f = textFilter.toLowerCase();
    var shown = rows.filter(function (r) { return !f || (r.key + " " + r.where + " " + r.en + " " + r.ar).toLowerCase().indexOf(f) !== -1; });
    return '<section class="adm-card"><h2>Words on ' + (tab.id === "settings" ? "the order message" : "these pages") + "</h2>" +
      (tab.id === "settings" ? '<p class="adm-help">The message customers copy and send you on Instagram after ordering. Keep {code} where it is.</p>' : "") +
      (tab.legal ? '<p class="adm-help">Every heading, paragraph and point of this page, in page order. To make words bold, put two stars on each side: **like this**. ' +
        'A link is written [the words](privacy.html) or [@guts.decor](https://www.instagram.com/guts.decor/). Remember to change the “Last updated” date when you change the policy.</p>' : "") +
      '<input type="search" class="adm-search" id="text-search" placeholder="Search the words…" value="' + esc(textFilter) + '">' +
      '<div class="adm-texts">' + shown.slice(0, 120).map(function (r) {
        var p = pending["text:" + r.key];
        var en = p ? p.en : r.en, ar = p ? p.ar : r.ar;
        return '<div class="adm-text" data-text-row="' + r.row + '" data-text-key="' + esc(r.key) + '">' +
          '<p class="where">' + esc(r.where || r.key) + ' <span class="key">' + esc(r.key) + "</span></p>" +
          '<label>English<textarea data-lang="en" rows="' + Math.min(6, Math.max(1, Math.ceil(String(en).length / 60))) + '">' + esc(en) + "</textarea></label>" +
          '<label>Arabic<textarea data-lang="ar" dir="rtl" lang="ar" rows="' + Math.min(6, Math.max(1, Math.ceil(String(ar).length / 60))) + '">' + esc(ar) + "</textarea></label></div>";
      }).join("") + (shown.length > 120 ? '<p class="adm-help">Showing 120 of ' + shown.length + ". Search to find the rest.</p>" : "") + "</div></section>";
  }

  // ---------- Reacting to edits ----------
  $("main").addEventListener("input", function (e) {
    var el = e.target;
    if (el.id === "text-search") {
      textFilter = el.value;
      var pos = el.selectionStart;
      render();
      var s = $("text-search"); s.focus(); s.setSelectionRange(pos, pos);
      return;
    }
    var tr = el.closest("[data-text-key]");
    if (tr && el.tagName === "TEXTAREA") {
      var en = tr.querySelector('[data-lang="en"]').value, ar = tr.querySelector('[data-lang="ar"]').value;
      setPending("text:" + tr.getAttribute("data-text-key"), { type: "text", row: Number(tr.getAttribute("data-text-row")), key: tr.getAttribute("data-text-key"), en: en, ar: ar });
      return;
    }
    if (el.hasAttribute("data-setting") && el.type !== "checkbox") {
      setPending("set:" + el.getAttribute("data-setting"), { type: "setting", name: el.getAttribute("data-setting"), value: el.value });
      return;
    }
    if (el.hasAttribute("data-cell-h") && el.type !== "checkbox") {
      pendingCell(el.getAttribute("data-cell-tab"), Number(el.getAttribute("data-cell-row")), el.getAttribute("data-cell-key"), el.getAttribute("data-cell-h"), el.value);
    }
  });

  $("main").addEventListener("change", function (e) {
    var el = e.target;
    if (el.type === "checkbox") {
      var lbl = el.parentNode.querySelector(".lbl");
      if (lbl) lbl.textContent = el.checked ? "Yes" : "No";
      if (el.hasAttribute("data-setting")) setPending("set:" + el.getAttribute("data-setting"), { type: "setting", name: el.getAttribute("data-setting"), value: readInput(el) });
      if (el.hasAttribute("data-cell-h")) pendingCell(el.getAttribute("data-cell-tab"), Number(el.getAttribute("data-cell-row")), el.getAttribute("data-cell-key"), el.getAttribute("data-cell-h"), readInput(el));
      if (el.hasAttribute("data-sec-show")) {
        var li = el.closest("[data-sec-row]");
        pendingCell("Sections", Number(li.getAttribute("data-sec-row")), li.getAttribute("data-sec-key"), "Show (Yes/No)", readInput(el));
      }
    }
    if (el.tagName === "SELECT" && el.hasAttribute("data-cell-h")) {
      pendingCell(el.getAttribute("data-cell-tab"), Number(el.getAttribute("data-cell-row")), el.getAttribute("data-cell-key"), el.getAttribute("data-cell-h"), el.value);
    }
    if (el.hasAttribute("data-upload") && el.files[0]) upload(el);
  });

  function upload(fileInput) {
    var f = fileInput.files[0];
    var box = fileInput.closest(".adm-photo");
    var area = box.querySelector("textarea");
    if (f.size > 10 * 1024 * 1024) return showMsg("That photo is bigger than 10 MB. Make it smaller first.");
    var label = fileInput.parentNode;
    label.firstChild.textContent = "Uploading…";
    var r = new FileReader();
    r.onload = function () {
      call("adminUpload", { mime: f.type, name: f.name, data: String(r.result).split(",")[1] || "" }).then(function (res) {
        label.firstChild.textContent = "Upload photo";
        if (!res || !res.ok) return problem(res);
        var links = area.value.split(/[\s,]+/).filter(Boolean);
        // A cell with several photos keeps them (the new one is added); otherwise it is replaced.
        (links.length === 1 ? ask("Keep the photo already there and add this one?", "Add it", "Replace it") : Promise.resolve(links.length > 1)).then(function (add) {
          area.value = add ? links.concat(res.link).join(", ") : res.link;
          area.dispatchEvent(new Event("input", { bubbles: true }));
          box.querySelector(".adm-thumbs").outerHTML = thumbs(area.value);
        });
      }).catch(function () { label.firstChild.textContent = "Upload photo"; showMsg("Upload failed: no connection."); });
    };
    r.readAsDataURL(f);
  }

  $("main").addEventListener("click", function (e) {
    var el = e.target;
    // sections up/down: swap their Order numbers
    var mv = el.closest("[data-sec-move]");
    if (mv) {
      var li = mv.closest("[data-sec-row]");
      var page = TABS.filter(function (t) { return t.id === current; })[0].page;
      var rows = sectionRows(page);
      var i = rows.map(function (o) { return String(o._row); }).indexOf(li.getAttribute("data-sec-row"));
      var j = mv.getAttribute("data-sec-move") === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= rows.length) return;
      rows.forEach(function (o, k) { o.__o = (k + 1) * 10; });
      var tmp = rows[i].__o; rows[i].__o = rows[j].__o; rows[j].__o = tmp;
      rows.forEach(function (o) { if (String(o["Order"]) !== String(o.__o)) pendingCell("Sections", o._row, o["Section"], "Order", String(o.__o)); });
      render();
      return;
    }
    var rowEl = el.closest("[data-row-tab]");
    if (rowEl && !el.closest(".adm-form")) {
      var tab = rowEl.getAttribute("data-row-tab"), row = Number(rowEl.getAttribute("data-row")), key = rowEl.getAttribute("data-key");
      if (el.closest("[data-edit]")) { openRow = openRow === tab + ":" + row ? null : tab + ":" + row; render(); return; }
      if (el.closest("[data-toggle-show]")) {
        var t = data.tabs[tab], r = t.rows.filter(function (x) { return x.row === row; })[0];
        var shown = /^yes$/i.test(cellValue(tab, r, "Show on site", t.headers.indexOf("Show on site")));
        pendingCell(tab, row, key, "Show on site", shown ? "No" : "Yes");
        render();
        return;
      }
      var move = el.closest("[data-move]");
      if (move || el.closest("[data-delete]")) {
        if (count()) return showMsg("Save or undo your changes first, then try again.");
        (move ? Promise.resolve(true) : ask("Delete “" + key + "” for good? Tip: “Hide” keeps it in the sheet. A deleted row comes back only by restoring an older version.", "Delete", "Keep it")).then(function (yes) {
          if (!yes) return;
          call("adminRow", { tab: tab, row: row, key: key, op: move ? move.getAttribute("data-move") : "delete" }).then(function (res) {
            if (!res || !res.ok) return problem(res);
            load();
          });
        });
        return;
      }
    }
    var add = el.closest("[data-add]");
    if (add) { adding = add.getAttribute("data-add"); openRow = null; render(); return; }
    if (el.closest("[data-add-cancel]")) { adding = null; render(); return; }
    if (el.closest("[data-add-save]")) {
      var form = el.closest("[data-new]");
      var values = {};
      form.querySelectorAll("[data-new-h]").forEach(function (x) { values[x.getAttribute("data-new-h")] = readInput(x); });
      var btn = el.closest("[data-add-save]");
      busy(btn, true, "Adding…");
      call("adminRow", { tab: form.getAttribute("data-new"), op: "add", values: values }).then(function (res) {
        busy(btn, false);
        if (!res || !res.ok) return problem(res);
        adding = null;
        showMsg("Added. It's in the draft: Publish when you're ready.", true);
        load();
      });
      return;
    }
    if (el.id === "pw-save") {
      call("adminPassword", { old: $("pw-old").value, password: $("pw-new").value }).then(function (res) {
        if (res && res.ok) { $("pw-old").value = ""; $("pw-new").value = ""; return showMsg("Password changed.", true); }
        showMsg(res && res.error === "short" ? "The new password needs 8 letters or more." : res && res.error === "wrong" ? "The current password isn't right." : "That didn't work. Try again.");
      });
    }
  });

  // ---------- Orders ----------
  var orderFilter = "";
  function renderOrders() {
    renderSaveBar();
    $("main").innerHTML = '<p class="adm-loading">Loading orders…</p>';
    call("adminOrders").then(function (res) {
      if (!res || !res.ok) return problem(res);
      var statuses = res.statuses;
      var list = res.orders.filter(function (o) { return !orderFilter || o.status === orderFilter; });
      $("main").innerHTML = '<section class="adm-card"><h2>Orders</h2><p class="adm-help">“Started (waiting for DM)” = they filled the order form but you haven\'t got their Instagram message yet. ' +
        "Changing a status here does the same as in the Orders sheet (some send the customer an email).</p>" +
        '<select id="order-filter"><option value="">All orders (' + res.orders.length + ")</option>" + statuses.map(function (s) {
          var n = res.orders.filter(function (o) { return o.status === s; }).length;
          return '<option value="' + esc(s) + '"' + (s === orderFilter ? " selected" : "") + ">" + esc(s) + " (" + n + ")</option>";
        }).join("") + "</select>" +
        '<ul class="adm-orders">' + (list.length ? list.map(function (o) {
          var opts = statuses.indexOf(o.status) === -1 ? [o.status].concat(statuses) : statuses;
          return '<li><div class="adm-order-head"><strong>' + esc(o.code) + "</strong><span>" + esc(o.received) + "</span></div>" +
            "<p>" + esc(o.name) + " · " + esc(o.phone) + (o.instagram ? " · @" + esc(o.instagram) : "") + "<br>" + esc(o.city) + "</p>" +
            '<p class="items">' + esc(String(o.items)).replace(/\n/g, "<br>") + "</p>" +
            (o.total ? "<p>Total " + esc(Number(o.total).toLocaleString("en-US")) + " LE" + (o.deposit ? " · deposit " + esc(Number(o.deposit).toLocaleString("en-US")) + " LE" : "") + "</p>" : "") +
            '<label class="adm-status">Status <select data-order="' + esc(o.code) + '" data-was="' + esc(o.status) + '">' + opts.map(function (s) {
              return '<option value="' + esc(s) + '"' + (s === o.status ? " selected" : "") + ">" + esc(s) + "</option>";
            }).join("") + "</select></label></li>";
        }).join("") : "<li>No orders here yet.</li>") + "</ul></section>";
    });
  }
  document.addEventListener("change", function (e) {
    if (e.target.id === "order-filter") { orderFilter = e.target.value; renderOrders(); return; }
    var sel = e.target.closest && e.target.closest("[data-order]");
    if (!sel) return;
    var code = sel.getAttribute("data-order"), status = sel.value;
    ask("Set " + code + " to “" + status + "”?", "Yes, set it", "Cancel").then(function (yes) {
      if (!yes) { sel.value = sel.getAttribute("data-was"); return; }
      sel.disabled = true;
      call("adminStatus", { code: code, status: status }).then(function (res) {
        sel.disabled = false;
        if (!res || !res.ok) { sel.value = sel.getAttribute("data-was"); return problem(res); }
        sel.setAttribute("data-was", status);
        showMsg(code + " is now “" + status + "”.", true);
      });
    });
  });

  // ---------- Versions ----------
  function renderVersions() {
    renderSaveBar();
    $("main").innerHTML = '<p class="adm-loading">Loading versions…</p>';
    call("adminVersions").then(function (res) {
      if (!res || !res.ok) return problem(res);
      $("main").innerHTML = '<section class="adm-card"><h2>Versions</h2><p class="adm-help">Every Publish saves a version. Restore puts that version back on the website and in the sheet. ' +
        "What you have now is saved first, so a restore can be undone too.</p>" +
        '<ul class="adm-versions">' + (res.versions.length ? res.versions.map(function (v) {
          return '<li><span>' + esc(v.name) + '</span><button type="button" class="adm-btn small" data-restore="' + esc(v.id) + '" data-name="' + esc(v.name) + '">Restore</button></li>';
        }).join("") : "<li>No versions yet. Your first Publish makes one.</li>") + "</ul></section>";
    });
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-restore]");
    if (!b) return;
    if (count()) return showMsg("Save or undo your changes first.");
    ask("Restore the version from " + b.getAttribute("data-name") + "? The website and the sheet go back to how they were then.", "Restore", "Cancel").then(function (yes) {
      if (!yes) return;
      busy(b, true, "Restoring…");
      call("adminRestore", { id: b.getAttribute("data-restore") }).then(function (res) {
        busy(b, false);
        if (!res || !res.ok) return problem(res);
        showMsg("Restored the version from " + res.when + ". It's live now.", true);
        load().then(renderVersions);
      });
    });
  });

  if (token) start();
})();
