/* Home page: the approved design (design/home.html), filled from the Website Content sheet */
(function () {
  "use strict";
  var GD = window.GD;
  var esc = GD.esc;

  function $(id) { return document.getElementById(id); }
  function pick(en, ar) { return GD.lang() === "ar" ? (ar || en || "") : (en || ar || ""); }
  function phLabel(key) { var t = GD.tx(key); return t ? '<span class="ph-label">' + esc(t) + "</span>" : ""; }

  function renderMedia(c) {
    var v = c.videos || {};
    var hasHero = GD.renderLoop($("hero-media"), v.hero, { className: "hero-loop" });
    $("hero-ph").classList.toggle("hidden", hasHero || !GD.tx("ph.hero"));
    $("hero-deco").innerHTML = hasHero ? "" : GD.swordSvg;

    var box = $("hands-box");
    if (!GD.renderLoop(box, v.hands, { className: "hands-loop", altKey: "home.hands.alt", width: 800 })) box.innerHTML = phLabel("ph.hands");

    document.querySelectorAll(".rail-card[data-photo]").forEach(function (card) {
      var spot = v[card.getAttribute("data-photo")];
      var src = spot && GD.driveImage(spot.photo, 900);
      var old = card.querySelector("img, .ph-label");
      if (old) old.remove();
      card.insertAdjacentHTML("afterbegin", src ? '<img loading="lazy" src="' + esc(src) + '" alt="">' : phLabel("ph.card"));
    });

    var card = $("meet-card");
    if (!GD.renderTalking(card, v.meet, { titleKey: "home.story.title", altKey: "home.story.photoAlt" })) card.innerHTML = phLabel("ph.card");

    var hasReel = GD.renderLoop($("reviews-reel"), v.reviews, { altKey: "home.reviews.title", lazy: true, width: 800 });
    $("reviews").classList.toggle("hidden", !hasReel);
  }

  function renderHero(c) {
    var prices = c.tiers.map(function (t) { return t.price; }).filter(Boolean);
    $("hero-offer").textContent = prices.length ? GD.tx("home.offer", { price: GD.money(Math.min.apply(null, prices)) }) : "";

    // "150+ pieces handmade in 3 years" -> big gold "150+" and a small label.
    var proof = pick(c.settings.proofLine, c.settings.proofLineAr);
    var m = proof.match(/[\d٠-٩][\d٠-٩,٬]*\+?/);
    var plus = /\+|أكتر من|أكثر من|more than/i.test(proof);
    var n = m ? m[0].replace("+", "") + (plus ? "+" : "") : "";
    $("big-num").innerHTML = m
      ? '<span class="n" dir="ltr">' + esc(n) + '</span><span class="t">' +
        esc(proof.replace(m[0], "").replace(/(أكتر من|أكثر من|more than)\s*/i, "").replace(/^[\s+]+|\s+$/g, "")) + "</span>"
      : "";
    $("big-num").classList.toggle("hidden", !m);

    $("final-ig").href = "https://ig.me/m/" + encodeURIComponent(c.settings.instagram || "guts_san_store");
  }

  function slug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  // Every sword opens its own product page (it shows "Ask for the price" itself when there's no price yet).
  function designLink(c, d) { return "product.html?id=d-" + slug(d.name); }

  function renderPills(c) {
    var swords = (c.designs || []).map(function (d) {
      return '<a class="pill" href="' + esc(designLink(c, d)) + '">' + esc(d.name) + "</a>";
    }).join("");
    var tiers = c.tiers.slice().sort(function (a, b) { return (a.price || Infinity) - (b.price || Infinity); }).map(function (t) {
      var on = /most chosen|best seller/i.test(t.badge || "");
      var href = t.price ? "product.html?id=t-" + slug(t.name) : "order.html?tier=" + encodeURIComponent(t.name);
      return '<a class="pill' + (on ? " on" : "") + '" href="' + esc(href) + '">' + esc(t.name) + "</a>";
    }).join("");
    $("pills").innerHTML =
      '<span class="k">' + esc(GD.tx("home.pills.swords")) + '</span><div class="v">' + swords + "</div>" +
      '<span class="k">' + esc(GD.tx("home.pills.tiers")) + '</span><div class="v">' + tiers + "</div>";
  }

  function renderGrid(c) {
    // Only designs marked "Show on Home" (column P); before that column reached the site, show them all.
    var designs = (c.designs || []).filter(function (d) { return d.showOnHome !== false; }).sort(function (a, b) {
      function rank(d) { return /best seller/i.test(d.badge || "") ? 0 : d.shippingIncluded ? 2 : 1; }
      return rank(a) - rank(b);
    });
    $("design-grid").innerHTML = designs.map(function (d) {
      var img = GD.driveImage(d.photo, 700);
      var isSet = d.shippingIncluded;
      var price = "";
      if (d.price) {
        if (isSet) price = d.badge ? GD.tx("home.designs.save", { price: GD.money(d.price), save: pick(d.badge, d.badgeAr) }) : GD.money(d.price);
        else if (d.classicPrice) price = GD.tx("home.design.from", { price: GD.money(d.classicPrice) });
        else price = GD.money(d.price);
      } else {
        price = GD.tx("home.design.ask");
      }
      var corner = !isSet && d.badge ? '<span class="tag">' + esc(pick(d.badge, d.badgeAr)) + "</span>" : "";
      return '<a class="p-card" href="' + esc(designLink(c, d)) + '" data-track="card:' + esc(d.name) + '">' + corner +
        '<span class="ph">' + (img ? '<img loading="lazy" src="' + esc(img) + '" alt="' + esc(d.name + (d.inspiredBy ? ", " + d.inspiredBy : "")) + '">' : phLabel("ph.card")) + "</span>" +
        '<span class="info"><span class="name">' + esc(d.name + (d.inspiredBy && !isSet ? ", " + d.inspiredBy.split(",")[0] : "")) + "</span>" +
        '<span class="price">' + (d.wasPrice ? '<s class="was">' + esc(GD.money(d.wasPrice)) + "</s> " : "") + esc(price) + "</span>" +
        (pick(d.benefitEn, d.benefitAr) ? '<span class="benefit">' + esc(pick(d.benefitEn, d.benefitAr)) + "</span>" : "") +
        "</span></a>";
    }).join("");
  }

  // Thin bar under each swipe row shows how far it has been swiped.
  function wireRails() {
    document.querySelectorAll(".rail").forEach(function (rail) {
      var bar = rail.parentElement.querySelector(".rail-bar span");
      if (!bar) return;
      function update() {
        var max = rail.scrollWidth - rail.clientWidth;
        var ratio = max > 0 ? Math.abs(rail.scrollLeft) / max : 0;
        bar.style.insetInlineStart = (ratio * 120) + "px";
        rail.parentElement.querySelector(".rail-bar").style.visibility = max > 0 ? "visible" : "hidden";
      }
      rail.addEventListener("scroll", update, { passive: true });
      window.addEventListener("resize", update);
      update();
    });
  }

  GD.onContent(function (c) {
    renderMedia(c);
    renderHero(c);
    renderPills(c);
    renderGrid(c);
  });
  wireRails();

  GD.getContent().catch(function () {
    $("design-grid").innerHTML = '<p style="padding:0 20px">This couldn’t load right now. Please refresh, or message me on Instagram @guts_san_store.</p>';
  });
})();
