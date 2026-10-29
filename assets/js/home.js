/* Home page: the approved design (design/home.html), filled from the Website Content sheet */
(function () {
  "use strict";
  var GD = window.GD;
  var esc = GD.esc;

  function $(id) { return document.getElementById(id); }
  function pick(en, ar) { return GD.lang() === "ar" ? (ar || en || "") : (en || ar || ""); }
  function phLabel(key) { var t = GD.tx(key); return t ? '<span class="ph-label">' + esc(t) + "</span>" : ""; }

  // Headlines written in the sheet as "line|line|*italic line*".
  function renderRich() {
    document.querySelectorAll("[data-rich]").forEach(function (el) {
      var steps = (el.getAttribute("data-steps") || "").split(",").map(Number);
      el.innerHTML = GD.tx(el.getAttribute("data-rich")).split("|").map(function (line, i) {
        var html = esc(line.trim()).replace(/\*([^*]+)\*/g, "<em>$1</em>");
        var pad = steps.length > 1 ? steps[i % steps.length] : 0;
        return '<span class="ln"' + (pad ? ' style="padding-inline-start:' + pad + '%"' : "") + ">" + html + "</span>";
      }).join("");
    });
  }

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

  function designLink(c, d) {
    return d.price ? "order.html?design=" + encodeURIComponent(d.name) : "https://ig.me/m/" + encodeURIComponent(c.settings.instagram || "guts_san_store");
  }

  function renderPills(c) {
    var swords = (c.designs || []).map(function (d) {
      var ext = !d.price;
      return '<a class="pill" href="' + esc(designLink(c, d)) + '"' + (ext ? ' target="_blank" rel="noopener"' : "") + ">" + esc(d.name) + "</a>";
    }).join("");
    var tiers = c.tiers.slice().sort(function (a, b) { return (a.price || Infinity) - (b.price || Infinity); }).map(function (t) {
      var on = /most chosen|best seller/i.test(t.badge || "");
      return '<a class="pill' + (on ? " on" : "") + '" href="order.html?tier=' + encodeURIComponent(t.name) + '">' + esc(t.name) + "</a>";
    }).join("");
    $("pills").innerHTML =
      '<span class="k">' + esc(GD.tx("home.pills.swords")) + '</span><div class="v">' + swords + "</div>" +
      '<span class="k">' + esc(GD.tx("home.pills.tiers")) + '</span><div class="v">' + tiers + "</div>";
  }

  function renderGrid(c) {
    var designs = (c.designs || []).slice().sort(function (a, b) {
      function rank(d) { return /best seller/i.test(d.badge || "") ? 0 : d.shippingIncluded ? 2 : 1; }
      return rank(a) - rank(b);
    });
    $("design-grid").innerHTML = designs.map(function (d) {
      var img = GD.driveImage(d.photo, 700);
      var isSet = d.shippingIncluded;
      var price = "";
      if (d.price) {
        price = isSet && d.badge
          ? GD.tx("home.designs.save", { price: GD.money(d.price), save: pick(d.badge, d.badgeAr) })
          : (isSet ? GD.money(d.price) : GD.tx("home.design.from", { price: GD.money(d.price) }));
      } else {
        price = GD.tx("home.design.ask");
      }
      var corner = !isSet && d.badge ? '<span class="tag">' + esc(pick(d.badge, d.badgeAr)) + "</span>" : "";
      var ext = !d.price;
      return '<a class="p-card" href="' + esc(designLink(c, d)) + '"' + (ext ? ' target="_blank" rel="noopener"' : "") + ">" + corner +
        '<span class="ph">' + (img ? '<img loading="lazy" src="' + esc(img) + '" alt="' + esc(d.name + (d.inspiredBy ? ", " + d.inspiredBy : "")) + '">' : phLabel("ph.card")) + "</span>" +
        '<span class="info"><span class="name">' + esc(d.name + (d.inspiredBy && !isSet ? ", " + d.inspiredBy.split(",")[0] : "")) + "</span>" +
        '<span class="price">' + esc(price) + "</span>" +
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
    renderRich();
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
