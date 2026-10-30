/* Product page: one sword, set, level or display piece, with its options, Add to cart and Order now */
(function () {
  "use strict";
  var GD = window.GD;
  var S = GD.shop;
  var esc = GD.esc;
  var id = new URLSearchParams(location.search).get("id") || "";
  var content = null;
  var product = null;
  var viewed = false;
  var state = { version: "Premium", qty: 1, height: "", sword: "", blade: "", plaque: false, mount: false, carve: "" };

  function $(x) { return document.getElementById(x); }
  function money(n) { return GD.money(n); }

  function isCollectors(p) { return p.type === "tier" && /^collector/i.test(p.name); }
  function mountFor(p) { return p.type === "addon" ? null : S.addon(content, p.d.matchingMount); }

  function currentLine() {
    var line = { id: product.id, qty: state.qty };
    if (S.hasVersions(product)) line.version = state.version;
    else if (product.type === "design") line.version = "Premium";
    if (product.d.askHeight) line.height = state.height;
    if (product.type === "tier") line.sword = state.sword.trim();
    if (isCollectors(product)) { if (state.blade.trim()) line.blade = state.blade.trim(); if (state.plaque) line.plaque = true; }
    var m = mountFor(product);
    if (m && state.mount) line.mount = { name: m.name, carve: state.carve.trim() };
    return line;
  }

  // ---------- Photos ----------
  function renderPhotos() {
    var list = S.photos(product, 1400);
    var alt = S.displayName(product);
    $("pp-photos").innerHTML = list.length
      ? list.map(function (src, i) { return '<div class="pp-photo"><img src="' + esc(src) + '" alt="' + esc(alt + (list.length > 1 ? " (" + (i + 1) + ")" : "")) + '"' + (i ? ' loading="lazy"' : "") + "></div>"; }).join("")
      : '<div class="pp-photo empty">' + (GD.tx("ph.card") ? '<span class="ph-label">' + esc(GD.tx("ph.card")) + "</span>" : "") + "</div>";
    var dots = $("pp-dots");
    dots.innerHTML = list.length > 1 ? list.map(function (_, i) {
      return '<button type="button" aria-label="' + esc(GD.tx("pp.photo", { n: GD.num(i + 1), total: GD.num(list.length) })) + '"' + (i ? "" : ' aria-current="true"') + "></button>";
    }).join("") : "";
    dots.querySelectorAll("button").forEach(function (b, i) {
      b.addEventListener("click", function () { var el = $("pp-photos").children[i]; if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" }); });
    });
  }

  // ---------- Full-screen photo viewer: tap a photo to see the whole piece, swipe between photos, tap again to zoom ----------
  function openViewer(start) {
    var list = S.photos(product, 2000);
    if (!list.length) return;
    var box = document.createElement("div");
    box.className = "pv";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.innerHTML = '<button type="button" class="pv-close" aria-label="' + esc(GD.tx("pp.close") || "Close") + '">&times;</button>' +
      '<div class="pv-rail">' + list.map(function (src) { return '<div class="pv-slide"><img src="' + esc(src) + '" alt=""></div>'; }).join("") + "</div>" +
      (list.length > 1 ? '<div class="pv-count" aria-live="polite"></div>' : "");
    document.body.appendChild(box);
    document.body.style.overflow = "hidden";
    var rail = box.querySelector(".pv-rail"), count = box.querySelector(".pv-count");
    function idx() { return Math.round(Math.abs(rail.scrollLeft) / Math.max(1, rail.clientWidth)); }
    function showCount() { if (count) count.textContent = GD.num(idx() + 1) + " / " + GD.num(list.length); }
    rail.children[start] && rail.children[start].scrollIntoView({ block: "nearest", inline: "center" });
    showCount();
    rail.addEventListener("scroll", showCount, { passive: true });
    box.querySelectorAll(".pv-slide").forEach(function (sl) {
      sl.addEventListener("click", function (e) {
        var zoomed = sl.classList.toggle("zoomed");
        rail.classList.toggle("locked", zoomed);
        if (zoomed) {
          var img = sl.querySelector("img"), r = img.getBoundingClientRect();
          var fx = (e.clientX - r.left) / Math.max(1, r.width), fy = (e.clientY - r.top) / Math.max(1, r.height);
          requestAnimationFrame(function () { sl.scrollLeft = fx * sl.scrollWidth - sl.clientWidth / 2; sl.scrollTop = fy * sl.scrollHeight - sl.clientHeight / 2; });
        }
      });
    });
    function close() { document.removeEventListener("keydown", onKey); box.remove(); document.body.style.overflow = ""; }
    function onKey(e) {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") rail.scrollBy({ left: (e.key === "ArrowRight" ? 1 : -1) * rail.clientWidth * (document.dir === "rtl" ? -1 : 1), behavior: "smooth" });
    }
    box.querySelector(".pv-close").addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    box.querySelector(".pv-close").focus();
  }

  function wirePhotoDots() {
    $("pp-photos").addEventListener("click", function (e) {
      var img = e.target.closest && e.target.closest(".pp-photo img");
      if (!img) return;
      openViewer(Array.prototype.indexOf.call($("pp-photos").children, img.parentNode));
    });
    var rail = $("pp-photos");
    rail.addEventListener("scroll", function () {
      var i = Math.round(Math.abs(rail.scrollLeft) / Math.max(1, rail.clientWidth));
      $("pp-dots").querySelectorAll("button").forEach(function (b, k) { if (k === i) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current"); });
    }, { passive: true });
  }

  // ---------- Text, versions, price ----------
  function renderTop() {
    var p = product, d = p.d;
    document.title = GD.tx("pp.title", { name: S.displayName(p) }) || S.displayName(p);
    $("pp-eyebrow").textContent = p.type === "design" ? (d.inspiredBy || GD.tx("designs.label")) : p.type === "tier" ? GD.tx("swords.label") : GD.tx("display.label");
    $("pp-name").textContent = S.displayName(p);
    $("pp-benefit").textContent = p.type === "tier" ? S.pick(d.forEn, d.forAr) : S.pick(d.benefitEn, d.benefitAr);

    var v = $("pp-versions");
    if (S.hasVersions(p)) {
      var prem = S.tier(content, "Premium");
      var badge = prem ? S.pick(prem.badge, prem.badgeAr) : "";
      var opt = function (name, price, tag) {
        return '<label class="ver"><input type="radio" name="version" value="' + name + '"' + (state.version === name ? " checked" : "") + ">" +
          "<span>" + esc(name) + '</span><span class="vp">' + esc(money(price)) + "</span>" + (tag ? '<span class="vt">' + esc(tag) + "</span>" : "") + "</label>";
      };
      v.innerHTML = '<fieldset class="versions"><legend>' + esc(GD.tx("pp.version")) + "</legend>" +
        opt("Classic", d.classicPrice, "") + opt("Premium", d.price, badge) + "</fieldset>" +
        '<p class="ver-note" id="ver-note"></p>';
      v.querySelectorAll('input[name="version"]').forEach(function (r) {
        r.addEventListener("change", function () { state.version = r.value; renderPrice(); renderDetails(); });
      });
    } else v.innerHTML = "";

    var days = S.readyDays(content, p);
    $("pp-ready").innerHTML = '<span class="r1">' + esc(GD.tx("pp.ready", { days: GD.num(days) })) + "</span> " +
      '<span class="r2">' + esc(GD.tx("pp.readyBy", { date: S.readyDate(days) })) + "</span>";
  }

  function renderPrice() {
    var p = product;
    var line = currentLine();
    var total = S.linePrice(content, line);
    var was = p.type === "design" && p.d.shippingIncluded && p.d.wasPrice ? p.d.wasPrice * state.qty : 0;
    $("pp-price").innerHTML = (was ? '<s class="was">' + esc(money(was)) + "</s> " : "") + "<span>" + esc(money(total)) + "</span>" +
      (p.type === "design" && p.d.shippingIncluded && p.d.badge ? ' <span class="save">' + esc(S.pick(p.d.badge, p.d.badgeAr)) + "</span>" : "");
    $("pp-deposit").textContent = GD.tx("pp.deposit", { amount: money(S.deposit(content, total)) });
    var note = $("ver-note");
    if (note) {
      var diff = (p.d.price || 0) - (p.d.classicPrice || 0);
      note.textContent = state.version === "Premium" ? GD.tx("design.upgrade", { diff: money(diff) }) : GD.tx("design.classic");
    }
    $("sb-name").textContent = S.displayName(p);
    $("sb-price").textContent = money(total);
  }

  // ---------- Options ----------
  function field(idName, label, hint, input) {
    return '<div class="field pp-field"><label for="' + idName + '">' + esc(label) + "</label>" + input +
      (hint ? '<p class="hint" id="' + idName + '-hint">' + esc(hint) + "</p>" : "") + "</div>";
  }

  function renderOptions() {
    var p = product, html = "";
    if (p.d.askHeight) {
      var opts = ['<option value="">' + esc(GD.tx("pp.height.choose")) + "</option>"];
      for (var h = 160; h <= 190; h += 5) opts.push('<option value="' + h + '"' + (String(h) === state.height ? " selected" : "") + ">" + esc(GD.tx("pp.cm", { n: GD.num(h) })) + "</option>");
      html += field("opt-height", GD.tx("pp.height"), GD.tx("pp.height.hint"), '<select id="opt-height" aria-describedby="opt-height-hint">' + opts.join("") + "</select>");
    }
    if (p.type === "tier") {
      html += field("opt-sword", GD.tx("pp.sword"), GD.tx("pp.sword.hint"),
        '<input type="text" id="opt-sword" maxlength="80" autocomplete="off" aria-describedby="opt-sword-hint" value="' + esc(state.sword) + '">');
    }
    if (isCollectors(p)) {
      html += field("opt-blade", GD.tx("pp.blade"), GD.tx("pp.blade.hint"),
        '<input type="text" id="opt-blade" maxlength="20" autocomplete="off" aria-describedby="opt-blade-hint" value="' + esc(state.blade) + '">');
      html += '<label class="check pp-check" for="opt-plaque"><input type="checkbox" id="opt-plaque"' + (state.plaque ? " checked" : "") + "><span>" +
        esc(GD.tx("pp.plaque", { price: money(S.plaqueUpgrade(content)) })) + "</span></label>";
    }
    $("pp-options").innerHTML = html;

    var m = mountFor(p);
    var disp = $("pp-display");
    if (m) {
      var label = GD.tx(m.bonusEn ? "pp.mount" : "pp.mount.plain", { name: S.pick(m.name, m.nameAr) });
      disp.innerHTML = '<div class="pp-complete"><p class="eyebrow">' + esc(GD.tx("pp.display")) + "</p>" +
        '<label class="check pp-check" for="opt-mount"><input type="checkbox" id="opt-mount"' + (state.mount ? " checked" : "") + "><span>" + esc(label) +
        ' <span class="plus">+' + esc(money(m.price)) + "</span></span></label>" +
        '<div class="' + (state.mount ? "" : "hidden") + '" id="carve-wrap">' +
        field("opt-carve", GD.tx("pp.carve"), GD.tx("pp.carve.hint"), '<input type="text" id="opt-carve" maxlength="10" autocomplete="off" aria-describedby="opt-carve-hint" value="' + esc(state.carve) + '">') +
        "</div></div>";
    } else disp.innerHTML = "";

    [["opt-height", "height"], ["opt-sword", "sword"], ["opt-blade", "blade"], ["opt-carve", "carve"]].forEach(function (pair) {
      var el = $(pair[0]);
      if (el) el.addEventListener("input", function () { state[pair[1]] = el.value; });
      if (el && el.tagName === "SELECT") el.addEventListener("change", function () { state[pair[1]] = el.value; });
    });
    var plaque = $("opt-plaque");
    if (plaque) plaque.addEventListener("change", function () { state.plaque = plaque.checked; renderPrice(); });
    var mount = $("opt-mount");
    if (mount) mount.addEventListener("change", function () {
      state.mount = mount.checked;
      $("carve-wrap").classList.toggle("hidden", !mount.checked);
      if (mount.checked) $("opt-carve").focus();
      renderPrice();
    });
  }

  // ---------- Details and reviews ----------
  function renderDetails() {
    var p = product, items = [];
    if (p.type === "addon") {
      items.push(S.pick(p.d.benefitEn, p.d.benefitAr));
      if (p.d.bonusEn) items.push(S.pick(p.d.bonusEn, p.d.bonusAr));
    } else {
      var t = p.type === "tier" ? p.d : S.tier(content, S.hasVersions(p) ? state.version : "Premium");
      (t && t.features || []).forEach(function (f) { items.push(S.pick(f.en, f.ar)); });
    }
    items = items.filter(Boolean);
    $("pp-details").innerHTML = items.map(function (txt, i) {
      return '<li><span class="no">0' + (i + 1) + '</span><span class="txt"><span class="bd">' + esc(txt) + "</span></span></li>";
    }).join("");
    $("pp-details-sec").classList.toggle("hidden", !items.length);
  }

  function renderReviews() {
    var name = product.name;
    var list = (content.reviews || []).filter(function (r) { return !r.product || r.product === name; });
    $("pp-reviews").innerHTML = list.map(function (r) {
      return '<img loading="lazy" src="' + esc(GD.driveImage(r.photo, 800)) + '" alt="' + esc(S.pick(r.altEn, r.altAr) || GD.tx("pp.reviews")) + '">';
    }).join("");
    $("pp-reviews-sec").classList.toggle("hidden", !list.length);
  }

  // ---------- Buttons ----------
  function validate() {
    var p = product, msg = "", focus = null;
    if (p.d.askHeight && !state.height) { msg = GD.tx("pp.err.height"); focus = "opt-height"; }
    else if (p.type === "tier" && state.sword.trim().length < 2) { msg = GD.tx("pp.err.sword"); focus = "opt-sword"; }
    else if (state.mount && !state.carve.trim()) { msg = GD.tx("pp.err.carve"); focus = "opt-carve"; }
    var err = $("pp-err");
    err.textContent = msg;
    err.classList.toggle("hidden", !msg);
    if (focus) $(focus).focus();
    return !msg;
  }

  function renderButtons() {
    var can = S.payNow(product);
    $("pp-buttons").classList.toggle("hidden", !can);
    document.querySelector(".pp-qty").classList.toggle("hidden", !can);
    $("pp-deposit").classList.toggle("hidden", !can);
    var q = $("pp-quote");
    q.classList.toggle("hidden", can);
    if (!can) q.innerHTML = "<p>" + esc(GD.tx("pp.quote")) + "</p>" + GD.dmHtml();
  }

  $("pp-form").addEventListener("submit", function (e) {
    e.preventDefault();
    if (!product || !validate()) return;
    S.addToCart(currentLine());
    GD.track("add:" + product.id);
    $("pp-added").classList.remove("hidden");
  });

  $("pp-now").addEventListener("click", function () {
    if (!product || !validate()) return;
    try { sessionStorage.setItem("gd-now", JSON.stringify([currentLine()])); } catch (e) { /* ignore */ }
    GD.track("now:" + product.id);
    location.href = "checkout.html?now=1";
  });

  $("qty-minus").addEventListener("click", function () { state.qty = Math.max(1, state.qty - 1); $("qty").textContent = GD.num(state.qty); renderPrice(); });
  $("qty-plus").addEventListener("click", function () { state.qty = Math.min(10, state.qty + 1); $("qty").textContent = GD.num(state.qty); renderPrice(); });

  // Phones: show the sticky Add to cart bar while the real buttons are off screen.
  $("sb-add").addEventListener("click", function () {
    if (validate()) $("pp-add").click();
    else $("pp-form").scrollIntoView({ behavior: "smooth", block: "center" });
  });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      var show = !entries[0].isIntersecting && product && S.payNow(product) && entries[0].boundingClientRect.top < 0;
      $("sticky-buy").classList.toggle("hidden", !show);
    }).observe($("pp-buttons"));
  }

  wirePhotoDots();

  GD.onContent(function (c) {
    content = c;
    product = S.find(c, id);
    if (!product) {
      $("pp-name").textContent = "";
      $("pp-benefit").innerHTML = esc(GD.tx("pp.notfound")) + ' <a class="link-u" href="index.html#designs">' + esc(GD.tx("cart.browse")) + "</a>";
      ["pp-buttons", "pp-details-sec"].forEach(function (x) { $(x).classList.add("hidden"); });
      document.querySelector(".pp-qty").classList.add("hidden");
      return;
    }
    if (!viewed) { viewed = true; GD.track("view:" + product.id); }
    renderPhotos();
    renderTop();
    renderOptions();
    renderPrice();
    renderButtons();
    renderDetails();
    renderReviews();
  });
})();
