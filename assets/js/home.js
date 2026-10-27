/* Home page: tiers, spots counter, reviews and text from the sheet */
(function () {
  "use strict";
  var GD = window.GD;
  var content = null;
  var original = {
    trust: document.getElementById("trust").innerHTML,
    reply: document.getElementById("reply-promise").innerHTML
  };

  var BADGES_AR = { "best seller": "الأكثر طلبًا", "top tier": "أعلى مستوى", "by quote": "بالاتفاق" };

  function priceText(tier) {
    if (!tier.price) return GD.t("By quote", "السعر بالاتفاق");
    var from = /from/i.test(tier.display || "");
    return (from ? GD.t("From ", "من ") : "") + GD.money(tier.price);
  }

  function renderTiers() {
    var list = document.getElementById("tier-list");
    if (!content) return;
    var tiers = content.tiers.slice().sort(function (a, b) {
      // VIP (by quote) first, then highest price first
      return (b.price || Infinity) - (a.price || Infinity);
    });
    list.innerHTML = tiers.map(function (tier) {
      var badge = tier.badge ? GD.t(tier.badge, BADGES_AR[tier.badge.toLowerCase()] || tier.badge) : "";
      var featured = /best seller/i.test(tier.badge || "");
      return '<article class="card tier' + (featured ? " featured" : "") + '">' +
        (badge ? '<span class="badge">' + GD.esc(badge) + "</span>" : "") +
        "<h3>" + GD.esc(tier.name) + "</h3>" +
        '<div class="price">' + GD.esc(priceText(tier)) + "</div>" +
        "<p>" + GD.esc(GD.t(tier.descEn, tier.descAr)) + "</p>" +
        '<a class="btn ' + (featured ? "btn-gold" : "btn-ghost") + '" href="order.html?tier=' + encodeURIComponent(tier.name) + '">' +
        GD.esc(tier.price ? GD.t("Choose " + tier.name, "اختار " + tier.name) : GD.t("Ask for a quote", "اطلب سعر")) + "</a>" +
        "</article>";
    }).join("");
  }

  function renderSettings() {
    var s = content.settings;
    var spots = document.getElementById("spots");
    if (typeof s.spotsLeft === "number" && s.spotsPerMonth) {
      spots.innerHTML = s.spotsLeft > 0
        ? '<span class="dot" aria-hidden="true"></span>' + GD.t(
            "<strong>" + GD.num(s.spotsLeft) + "</strong> of " + GD.num(s.spotsPerMonth) + " spots left this month",
            "فاضل <strong>" + GD.num(s.spotsLeft) + "</strong> من " + GD.num(s.spotsPerMonth) + " أماكن الشهر ده")
        : GD.t("This month is full. Reserve a spot for next month.", "الشهر ده اتملى. احجز مكانك للشهر الجاي.");
      spots.classList.remove("hidden");
    }
    // Use the sheet's wording for the current language; keep the built-in wording when the sheet has none.
    var proof = GD.lang() === "ar" ? s.proofLineAr : s.proofLine;
    var trust = document.getElementById("trust");
    trust.innerHTML = proof ? '<span class="gold">' + GD.esc(proof) + "</span>" : original.trust;
    var promise = GD.lang() === "ar" ? s.replyPromiseAr : s.replyPromise;
    var reply = document.getElementById("reply-promise");
    if (promise) reply.textContent = promise; else reply.innerHTML = original.reply;
  }

  function renderReviews() {
    var reviews = content.reviews || [];
    if (!reviews.length) return;
    document.getElementById("review-list").innerHTML = reviews.map(function (r) {
      return '<img loading="lazy" src="' + GD.esc(GD.driveImage(r.photo, 800)) + '" alt="' +
        GD.esc(GD.t(r.altEn || "Customer review screenshot from Instagram", r.altAr || "صورة ريفيو من زبون على إنستجرام")) + '">';
    }).join("");
  }

  function renderAll() {
    if (!content) return;
    renderTiers();
    renderSettings();
    renderReviews();
  }

  GD.mountTalking("meet-wrap", "meet-video", "meet", {
    en: "Hi, I'm Meyer", ar: "أهلًا، أنا ماير",
    altEn: "Meyer, the maker behind Guts Decor, in the workshop", altAr: "ماير، صانع Guts Decor، في الورشة"
  });

  GD.getContent().then(function (c) {
    content = c;
    GD.renderHero(document.getElementById("hero-media"), (c.videos || {}).hero);
    renderAll();
  }).catch(function () {
    document.getElementById("tier-list").innerHTML =
      '<p class="muted center">' + GD.t("Prices couldn't load right now. Please refresh, or message me on Instagram.",
        "الأسعار مش عارفة تحمّل دلوقتي. جرّب تعمل ريفرش، أو ابعتلي على إنستجرام.") + "</p>";
  });

  document.addEventListener("gd:lang", renderAll);
})();
