/* Gallery page: Meyer's own photos from the sheet, with filters */
(function () {
  "use strict";
  var GD = window.GD;
  var items = [];
  var current = "all";

  var params = new URLSearchParams(location.search);
  if (["all", "swords", "decor", "ready"].indexOf(params.get("filter")) !== -1) current = params.get("filter");

  function buildItems(c) {
    var list = [];
    (c.designs || []).forEach(function (d) {
      if (!d.photo) return;
      list.push({
        photo: d.photo, kind: "swords", ready: Number(d.readyDays) === 4,
        titleEn: d.name, titleAr: d.name, inspiredBy: d.inspiredBy
      });
    });
    (c.gallery || []).forEach(function (g) {
      list.push({
        photo: g.photo, kind: /sword/i.test(g.category) ? "swords" : "decor", ready: !!g.ready,
        titleEn: g.titleEn, titleAr: g.titleAr || g.titleEn, inspiredBy: g.inspiredBy
      });
    });
    return list;
  }

  function render() {
    var shown = items.filter(function (it) {
      if (current === "all") return true;
      if (current === "ready") return it.ready;
      return it.kind === current;
    });
    document.querySelectorAll(".filter-btn").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-filter") === current));
    });
    var msg = document.getElementById("gallery-msg");
    if (!shown.length) {
      document.getElementById("gallery").innerHTML = "";
      msg.textContent = GD.t("New photos are coming soon. Meanwhile, see my latest work on Instagram.",
        "صور جديدة جاية قريب. لحد ما تنزل، شوف آخر شغلي على إنستجرام.");
      msg.classList.remove("hidden");
      return;
    }
    msg.classList.add("hidden");
    document.getElementById("gallery").innerHTML = shown.map(function (it) {
      var title = GD.t(it.titleEn, it.titleAr);
      var inspired = it.inspiredBy ? GD.t("Inspired by " + it.inspiredBy, "مستوحى من " + it.inspiredBy) : "";
      var alt = title + (inspired ? ", " + inspired.toLowerCase() : "") + GD.t(", handmade by Guts Decor", "، شغل يدوي من Guts Decor");
      return '<figure class="g-item"><div class="g-photo"><img loading="lazy" src="' + GD.esc(GD.driveImage(it.photo, 900)) +
        '" alt="' + GD.esc(alt) + '"></div><figcaption><strong>' + GD.esc(title) + "</strong>" +
        (inspired ? '<br><span class="muted small">' + GD.esc(inspired) + "</span>" : "") +
        (it.ready ? '<br><span class="tag">' + GD.t("Ready in 4 days", "جاهز في ٤ أيام") + "</span>" : "") +
        "</figcaption></figure>";
    }).join("");
  }

  document.querySelectorAll(".filter-btn").forEach(function (b) {
    b.addEventListener("click", function () {
      current = b.getAttribute("data-filter");
      render();
    });
  });

  GD.getContent().then(function (c) {
    items = buildItems(c);
    render();
  }).catch(function () {
    items = [];
    render();
  });

  document.addEventListener("gd:lang", render);
})();
