/* Info pages (Part C): swords, designs, display, how, about.
   Words come from the Text tab, products and prices from the other tabs of the Website Content sheet. */
(function () {
  "use strict";
  var GD = window.GD;
  var esc = GD.esc;
  var page = document.body.getAttribute("data-page");

  function $(id) { return document.getElementById(id); }
  function pick(en, ar) { return GD.lang() === "ar" ? (ar || en || "") : (en || ar || ""); }
  function slug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function phLabel() { var t = GD.tx("ph.card"); return t ? '<span class="ph-label">' + esc(t) + "</span>" : ""; }

  // ---------- Ready design card (same look as Home) ----------
  function designCard(d, full) {
    var img = GD.driveImage(d.photo, full ? 1200 : 700);
    var isSet = d.shippingIncluded;
    var price;
    if (d.price) {
      if (isSet) price = d.badge ? GD.tx("home.designs.save", { price: GD.money(d.price), save: pick(d.badge, d.badgeAr) }) : GD.money(d.price);
      else if (d.classicPrice) price = GD.tx("home.design.from", { price: GD.money(d.classicPrice) });
      else price = GD.money(d.price);
    } else price = GD.tx("home.design.ask");
    var corner = !isSet && d.badge ? '<span class="tag">' + esc(pick(d.badge, d.badgeAr)) + "</span>" : "";
    var benefit = pick(d.benefitEn, d.benefitAr);
    return '<a class="p-card' + (full ? " full" : "") + '" href="product.html?id=d-' + esc(slug(d.name)) + '" data-track="designs-card:' + esc(d.name) + '">' + corner +
      '<span class="ph">' + (img ? '<img loading="lazy" src="' + esc(img) + '" alt="' + esc(d.name + (d.inspiredBy ? ", " + d.inspiredBy : "")) + '">' : phLabel()) + "</span>" +
      '<span class="info"><span class="name">' + esc(d.name + (d.inspiredBy && !isSet && d.inspiredBy.split(",")[0] !== d.name ? ", " + d.inspiredBy.split(",")[0] : "")) + "</span>" +
      '<span class="price">' + (d.wasPrice ? '<s class="was">' + esc(GD.money(d.wasPrice)) + "</s> " : "") + esc(price) + "</span>" +
      (benefit ? '<span class="benefit">' + esc(benefit) + "</span>" : "") + "</span></a>";
  }

  // ---------- Swords: the three levels ----------
  function renderSwords(c) {
    // Highest price first (Meyer's choice, 6 Nov).
    var tiers = (c.tiers || []).filter(function (t) { return t.price; }).sort(function (a, b) { return b.price - a.price; });
    $("tiers").innerHTML = tiers.map(function (t) {
      var ls = slug(t.name);
      var img = GD.driveImage(t.photo, 900);
      var featured = /most chosen/i.test(t.badge || "");
      var extra = "";
      if (ls === "premium") extra = '<p class="extra">' + esc(GD.tx("swords.premium.mount")) + "</p>";
      if (ls === "collector-s") extra = '<p class="extra">' + esc(GD.tx("swords.coll.includes")) + '</p><p class="extra">' + esc(GD.tx("swords.coll.upgrade")) + "</p>";
      return '<article class="tier-b' + (featured ? " featured" : "") + '">' +
        (t.badge ? '<span class="tag">' + esc(pick(t.badge, t.badgeAr)) + "</span>" : "") +
        '<a class="ph" href="level.html?l=' + esc(ls) + '" tabindex="-1" aria-hidden="true">' + (img ? '<img loading="lazy" src="' + esc(img) + '" alt="">' : phLabel()) + "</a>" +
        '<div class="body"><h3><a href="level.html?l=' + esc(ls) + '" data-track="swords-level:' + esc(ls) + '">' + esc(t.name) + '</a></h3><span class="tprice">' + esc(GD.money(t.price)) + "</span>" +
        '<p class="who">' + esc(pick(t.forEn, t.forAr)) + "</p>" +
        '<ul class="feats">' + (t.features || []).map(function (f) { return "<li>" + esc(pick(f.en, f.ar)) + "</li>"; }).join("") + "</ul>" + extra +
        '<div class="actions"><a class="btn btn-gold" href="product.html?id=t-' + esc(ls) + '" data-track="swords-choose:' + esc(ls) + '">' + esc(GD.tx("level.custom.btn")) + "</a>" +
        '<a class="link-u" href="level.html?l=' + esc(ls) + '">' + esc(GD.tx("level.swords.title")) + "</a></div></div></article>";
    }).join("");
  }

  // ---------- Ready designs: every sword, highest price first, with a button per level to show just that level ----------
  var level = new URLSearchParams(location.search).get("l") || "";
  function renderDesigns(c) {
    var tiers = (c.tiers || []).slice().sort(function (a, b) { return (b.price || 0) - (a.price || 0); });
    var withSwords = tiers.filter(function (t) {
      return (c.designs || []).some(function (d) { return GD.shop.levelsOf(d, c.tiers).indexOf(slug(t.name)) !== -1; });
    });
    if (level && !withSwords.some(function (t) { return slug(t.name) === level; })) level = "";
    $("designs-filter").innerHTML = [["", GD.tx("gallery.f.all") || "All"]].concat(withSwords.map(function (t) { return [slug(t.name), t.name]; }))
      .map(function (f) { return '<button type="button" class="filter-btn" data-level="' + esc(f[0]) + '" aria-pressed="' + (f[0] === level) + '">' + esc(f[1]) + "</button>"; }).join("");

    var list = (c.designs || []).filter(function (d) { return !level || GD.shop.levelsOf(d, c.tiers).indexOf(level) !== -1; })
      .sort(function (a, b) { return (b.price || 0) - (a.price || 0); });
    $("designs-grid").innerHTML = list.map(function (d, i) { return designCard(d, i === 0 && d.shippingIncluded); }).join("");
  }
  if (page === "designs") {
    $("designs-filter").addEventListener("click", function (e) {
      var b = e.target.closest("[data-level]");
      if (!b) return;
      level = b.getAttribute("data-level");
      history.replaceState(null, "", level ? "?l=" + level : location.pathname);
      GD.getContent().then(renderDesigns);
    });
  }

  // ---------- Display pieces: mounts, stands and plaques ----------
  function renderDisplay(c) {
    var list = (c.addons || []).filter(function (a) { return typeof a.price === "number"; }).sort(function (a, b) { return b.price - a.price; });
    $("display-grid").innerHTML = list.map(function (a) {
      var img = GD.driveImage(a.photo, 700);
      var name = pick(a.name, a.nameAr), benefit = pick(a.benefitEn, a.benefitAr), bonus = pick(a.bonusEn, a.bonusAr);
      return '<a class="p-card" href="product.html?id=a-' + esc(slug(a.name)) + '" data-track="display-card:' + esc(a.name) + '">' +
        '<span class="ph' + (img ? "" : " scene-ph") + '">' + (img ? '<img loading="lazy" src="' + esc(img) + '" alt="' + esc(name) + '">' : (GD.shop.scene(a.name) || phLabel())) + "</span>" +
        '<span class="info"><span class="name">' + esc(name) + '</span><span class="price">' + esc(GD.money(a.price)) + "</span>" +
        (bonus ? '<span class="bonus">' + esc(bonus) + "</span>" : "") +
        (benefit ? '<span class="benefit">' + esc(benefit) + "</span>" : "") + "</span></a>";
    }).join("");
  }

  // ---------- About: Meyer's photo at the top (Videos tab, spot "About photo"; until it's added, a placeholder) ----------
  function renderAbout(c) {
    var spot = (c.videos || {})["about-photo"];
    var src = spot && GD.driveImage(spot.photo, 1400);
    $("about-photo").innerHTML = src
      ? '<img src="' + esc(src) + '" alt="' + esc(GD.tx("about2.photoAlt")) + '">'
      : '<span class="about-ph" aria-hidden="true"><span class="gd-mark">GD</span></span>';
  }

  function renderSizeAll() { $("size-box").innerHTML = GD.shop.sizeDrawing("all"); }

  var renderers = { swords: function (c) { renderSwords(c); renderSizeAll(); }, designs: renderDesigns, display: renderDisplay, about: renderAbout };
  // The Swords menu link "Commissions" lands on #custom: scroll there once the options are drawn.
  if (page === "swords" && location.hash === "#custom") GD.getContent().then(function () {
    setTimeout(function () { var el = $("custom"); if (el) el.scrollIntoView(); }, 50);
  });
  if (renderers[page]) GD.onContent(renderers[page]);

  GD.getContent().catch(function () {
    var box = document.querySelector("[data-fill]");
    if (box) box.innerHTML = '<p style="padding:0 20px">This couldn’t load right now. Please refresh, or message me on Instagram @guts.decor.</p>';
  });
})();
