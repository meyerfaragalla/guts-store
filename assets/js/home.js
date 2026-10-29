/* Home page: everything comes from the Website Content sheet (Text, Tiers, Ready Designs, Videos, Settings) */
(function () {
  "use strict";
  var GD = window.GD;
  var esc = GD.esc;

  function $(id) { return document.getElementById(id); }
  function pick(en, ar) { return GD.lang() === "ar" ? (ar || en || "") : (en || ar || ""); }

  function renderMedia(c) {
    var v = c.videos || {};
    GD.renderLoop($("hero-media"), v.hero, { className: "hero-media" });
    var hasHands = GD.renderLoop($("hands-video"), v.hands, { className: "hands-media", altKey: "home.hands.alt", width: 700 });
    $("hands-wrap").classList.toggle("hidden", !hasHands);
    $("hero-logo").classList.toggle("hidden", hasHands);
    var hasReel = GD.renderLoop($("reviews-reel"), v.reviews, { className: "reel-media", altKey: "home.reviews.title", lazy: true, width: 800 });
    $("reviews").classList.toggle("hidden", !hasReel);
  }

  function renderHero(c) {
    var prices = c.tiers.map(function (t) { return t.price; }).filter(Boolean);
    $("hero-offer").textContent = prices.length ? GD.tx("home.offer", { price: GD.money(Math.min.apply(null, prices)) }) : "";
    var s = c.settings;
    var spots = $("spots");
    if (typeof s.spotsLeft === "number" && s.spotsPerMonth) {
      spots.textContent = s.spotsLeft > 0
        ? GD.tx("home.spots", { left: GD.num(s.spotsLeft), total: GD.num(s.spotsPerMonth) })
        : GD.tx("home.spotsFull");
      spots.classList.toggle("hidden", !spots.textContent);
    }
    var proof = pick(s.proofLine, s.proofLineAr);
    $("trust").textContent = proof;
    $("trust").classList.toggle("hidden", !proof);
  }

  function badge(en, ar) {
    var b = pick(en, ar);
    return b ? '<span class="badge">' + esc(b) + "</span>" : "";
  }

  function renderDesigns(c) {
    var designs = (c.designs || []).slice().sort(function (a, b) {
      function rank(d) { return /best seller/i.test(d.badge || "") ? 0 : d.shippingIncluded ? 1 : 2; }
      return rank(a) - rank(b);
    });
    var dm = "https://ig.me/m/" + encodeURIComponent(c.settings.instagram || "guts_san_store");
    $("design-list").innerHTML = designs.map(function (d) {
      var img = GD.driveImage(d.photo, 800);
      var price = d.price ? (d.shippingIncluded ? GD.money(d.price) : GD.tx("home.design.from", { price: GD.money(d.price) })) : "";
      var link = d.price ? "order.html?design=" + encodeURIComponent(d.name) : dm;
      return '<article class="card product' + (/best seller/i.test(d.badge || "") ? " featured" : "") + '">' +
        badge(d.badge, d.badgeAr) +
        (img ? '<div class="product-photo"><img loading="lazy" src="' + esc(img) + '" alt="' + esc(d.name + (d.inspiredBy ? ", " + d.inspiredBy : "")) + '"></div>' : "") +
        "<h3>" + esc(d.name) + "</h3>" +
        (d.inspiredBy ? '<p class="small muted">' + esc(d.inspiredBy) + "</p>" : "") +
        '<p class="benefit">' + esc(pick(d.benefitEn, d.benefitAr)) + "</p>" +
        (d.sizes ? '<p class="small muted">' + esc(GD.tx("home.design.sizes", { sizes: d.sizes })) + "</p>" : "") +
        (price ? '<div class="price">' + esc(price) + "</div>" : "") +
        '<a class="btn ' + (d.price ? "btn-gold" : "btn-ghost") + '" href="' + esc(link) + '"' + (d.price ? "" : ' target="_blank" rel="noopener"') + ">" +
        esc(GD.tx(d.price ? "home.design.choose" : "home.design.ask")) + "</a>" +
        "</article>";
    }).join("");
  }

  function renderTiers(c) {
    var tiers = c.tiers.slice().sort(function (a, b) { return (b.price || Infinity) - (a.price || Infinity); });
    $("tier-list").innerHTML = tiers.map(function (t) {
      var featured = /most chosen|best seller/i.test(t.badge || "");
      return '<article class="card tier' + (featured ? " featured" : "") + '">' +
        badge(t.badge, t.badgeAr) +
        "<h3>" + esc(t.name) + "</h3>" +
        '<p class="benefit">' + esc(pick(t.forEn, t.forAr)) + "</p>" +
        '<div class="price">' + esc(t.price ? GD.money(t.price) : GD.tx("home.price.quote")) + "</div>" +
        '<a class="btn ' + (featured ? "btn-gold" : "btn-ghost") + '" href="order.html?tier=' + encodeURIComponent(t.name) + '">' +
        esc(t.price ? GD.tx("home.tier.choose", { name: t.name }) : GD.tx("home.tier.quote")) + "</a>" +
        "</article>";
    }).join("");
  }

  function renderFaq() {
    var html = "";
    for (var n = 1; n < 40; n++) {
      var q = GD.tx("home.faq." + n + ".q");
      if (!q) break;
      html += "<details><summary>" + esc(q) + "</summary><p>" + esc(GD.tx("home.faq." + n + ".a")) + "</p></details>";
    }
    $("faq-list").innerHTML = html;
  }

  GD.mountTalking("story-media-wrap", "meet-video", "meet", { titleKey: "home.story.title", altKey: "home.story.photoAlt" });

  GD.onContent(function (c) {
    renderMedia(c);
    renderHero(c);
    renderDesigns(c);
    renderTiers(c);
    renderFaq();
  });

  GD.getContent().catch(function () {
    $("design-list").innerHTML = '<p class="muted center">This couldn’t load right now. Please refresh, or message me on Instagram @guts_san_store.</p>';
  });
})();
