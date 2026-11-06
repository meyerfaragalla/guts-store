/* Level page (level.html?l=premium): every ready sword of one level, then "your own character at this level" */
(function () {
  "use strict";
  var GD = window.GD;
  var esc = GD.esc;

  function $(id) { return document.getElementById(id); }
  function pick(en, ar) { return GD.lang() === "ar" ? (ar || en || "") : (en || ar || ""); }
  function slug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function tx(key, fallback, vars) { return GD.tx(key, vars) || fallback; }
  function phLabel(key) { var t = GD.tx(key); return t ? '<span class="ph-label">' + esc(t) + "</span>" : ""; }

  var wanted = new URLSearchParams(location.search).get("l") || "";

  var levelsOf = GD.shop.levelsOf;

  function card(d, levelSlug) {
    var img = GD.driveImage(d.photo, 700);
    var isSet = d.shippingIncluded;
    var amount = levelSlug === "classic" && d.classicPrice ? d.classicPrice : d.price;
    var price = amount
      ? (isSet && d.badge ? GD.tx("home.designs.save", { price: GD.money(amount), save: pick(d.badge, d.badgeAr) }) || GD.money(amount) : GD.money(amount))
      : GD.tx("home.design.ask");
    var corner = !isSet && d.badge && slug(d.badge) !== levelSlug ? '<span class="tag">' + esc(pick(d.badge, d.badgeAr)) + "</span>" : "";
    return '<a class="p-card" href="product.html?id=d-' + esc(slug(d.name)) + '" data-track="level-card:' + esc(d.name) + '">' + corner +
      '<span class="ph">' + (img ? '<img loading="lazy" src="' + esc(img) + '" alt="' + esc(d.name + (d.inspiredBy ? ", " + d.inspiredBy : "")) + '">' : phLabel("ph.card")) + "</span>" +
      '<span class="info"><span class="name">' + esc(d.name + (d.inspiredBy && !isSet && d.inspiredBy.split(",")[0] !== d.name ? ", " + d.inspiredBy.split(",")[0] : "")) + "</span>" +
      '<span class="price">' + (d.wasPrice ? '<s class="was">' + esc(GD.money(d.wasPrice)) + "</s> " : "") + esc(price) + "</span>" +
      (pick(d.benefitEn, d.benefitAr) ? '<span class="benefit">' + esc(pick(d.benefitEn, d.benefitAr)) + "</span>" : "") +
      "</span></a>";
  }

  GD.onContent(function (c) {
    var tiers = (c.tiers || []).slice().sort(function (a, b) { return (a.price || Infinity) - (b.price || Infinity); });
    var tier = tiers.filter(function (t) { return slug(t.name) === slug(wanted); })[0] || tiers[0];
    if (!tier) return;
    var ls = slug(tier.name);

    document.title = tier.name + " · Guts Decor";
    $("lv-eyebrow").textContent = tx("level.label", "Level");
    $("lv-name").textContent = tier.name;
    $("lv-for").textContent = pick(tier.forEn, tier.forAr);
    $("lv-desc").textContent = pick(tier.descEn, tier.descAr);

    // Highest price first (Meyer's choice, 6 Nov).
    var list = (c.designs || []).filter(function (d) { return levelsOf(d, tiers).indexOf(ls) !== -1; }).sort(function (a, b) {
      return (b.price || 0) - (a.price || 0);
    });
    $("lv-grid-title").textContent = tx("level.swords.title", "Ready to make at this level");
    $("lv-grid").innerHTML = list.map(function (d) { return card(d, ls); }).join("");
    $("lv-empty").textContent = tx("level.empty", "New designs at this level are coming soon. Meanwhile, choose your own character below.");
    $("lv-empty").classList.toggle("hidden", list.length > 0);

    // Any character at this level: opens the level's own product page, where they pick the character.
    var canOrder = !!tier.price;
    $("lv-custom").classList.toggle("hidden", !canOrder);
    if (canOrder) {
      $("lv-custom-title").textContent = tx("level.custom.title", "Have another character in mind?");
      $("lv-custom-body").textContent = tx("level.custom.body", "Pick any character and I'll make it at this level, by hand, just for you.");
      var btn = $("lv-custom-btn");
      btn.textContent = tx("level.custom.btn", "Choose your character");
      btn.href = "product.html?id=t-" + ls;
    }

    $("lv-others-title").textContent = tx("level.others", "Other levels");
    $("lv-others").innerHTML = tiers.filter(function (t) { return t !== tier; }).map(function (t) {
      return '<a class="pill" href="level.html?l=' + esc(slug(t.name)) + '">' + esc(t.name) + "</a>";
    }).join("") + '<a class="pill" href="designs.html">' + esc(GD.tx("gallery.f.all") || "All") + "</a>";
  });
})();
