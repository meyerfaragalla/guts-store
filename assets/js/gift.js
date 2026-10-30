/* Gift page (gift.html): the date first, then every sword with its photo, fastest first, then the carved-name mount.
   Every card opens the product's own page with all its photos; nothing here goes straight to payment. */
(function () {
  "use strict";
  var GD = window.GD;
  var esc = GD.esc;
  function $(id) { return document.getElementById(id); }
  function pick(en, ar) { return GD.lang() === "ar" ? (ar || en || "") : (en || ar || ""); }
  function slug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function tx(key, fallback, vars) { return GD.tx(key, vars) || fallback.replace(/\{(\w+)\}/g, function (m, k) { return vars && vars.hasOwnProperty(k) ? vars[k] : m; }); }
  function phLabel(key) { var t = GD.tx(key); return t ? '<span class="ph-label">' + esc(t) + "</span>" : ""; }

  var content = null;
  function readyIn(d) { var n = Number(d.readyDays); return n > 0 ? n : (Number(content.settings.daysToMake) || 14); }
  function daysLeft() {
    var v = $("gf-when").value;
    if (!v) return null;
    return Math.round((new Date(v + "T00:00:00") - new Date(new Date().toDateString())) / 86400000);
  }

  function designCard(d, left) {
    var img = GD.driveImage(d.photo, 700), isSet = d.shippingIncluded, days = readyIn(d);
    var price = d.price ? (isSet && d.badge ? GD.tx("home.designs.save", { price: GD.money(d.price), save: pick(d.badge, d.badgeAr) }) || GD.money(d.price)
      : d.classicPrice ? GD.tx("home.design.from", { price: GD.money(d.classicPrice) }) || GD.money(d.classicPrice) : GD.money(d.price)) : GD.tx("home.design.ask");
    var when = left === null
      ? '<span class="when">' + esc(tx("gift.readyIn", "Ready in {days} days", { days: GD.num(days) })) + "</span>"
      : left >= days
        ? '<span class="when ok">' + esc(tx("gift.inTime", "Ready in time for your date")) + "</span>"
        : '<span class="when late">' + esc(tx("gift.tooLate", "Needs {days} days, message me to check", { days: GD.num(days) })) + "</span>";
    return '<a class="p-card" href="product.html?id=d-' + esc(slug(d.name)) + '" data-track="gift-card:' + esc(d.name) + '">' +
      '<span class="ph">' + (img ? '<img loading="lazy" src="' + esc(img) + '" alt="' + esc(d.name) + '">' : phLabel("ph.card")) + "</span>" +
      '<span class="info"><span class="name">' + esc(d.name + (d.inspiredBy && !isSet ? ", " + d.inspiredBy.split(",")[0] : "")) + "</span>" +
      '<span class="price">' + (d.wasPrice ? '<s class="was">' + esc(GD.money(d.wasPrice)) + "</s> " : "") + esc(price) + "</span>" + when +
      (pick(d.benefitEn, d.benefitAr) ? '<span class="benefit">' + esc(pick(d.benefitEn, d.benefitAr)) + "</span>" : "") +
      "</span></a>";
  }

  function mountCard(a) {
    var img = GD.driveImage(a.photo, 700);
    return '<a class="p-card" href="product.html?id=a-' + esc(slug(a.name)) + '" data-track="gift-mount:' + esc(a.name) + '">' +
      '<span class="ph">' + (img ? '<img loading="lazy" src="' + esc(img) + '" alt="' + esc(pick(a.name, a.nameAr)) + '">' : phLabel("ph.card")) + "</span>" +
      '<span class="info"><span class="name">' + esc(pick(a.name, a.nameAr)) + "</span>" +
      '<span class="price">' + esc(GD.money(a.price)) + "</span>" +
      (pick(a.bonusEn, a.bonusAr) ? '<span class="benefit">' + esc(pick(a.bonusEn, a.bonusAr)) + "</span>" : "") +
      "</span></a>";
  }

  function render() {
    if (!content) return;
    var left = daysLeft();
    var designs = (content.designs || []).slice().sort(function (a, b) {
      var fa = left === null || left >= readyIn(a) ? 0 : 1, fb = left === null || left >= readyIn(b) ? 0 : 1;
      return fa - fb || readyIn(a) - readyIn(b);
    });
    $("gf-grid").innerHTML = designs.map(function (d) { return designCard(d, left); }).join("");

    var note = $("gf-date-note");
    if (left === null) note.textContent = "";
    else if (left < 0) note.textContent = tx("gift.past", "That date has passed. Pick the next one.");
    else {
      var ok = designs.filter(function (d) { return left >= readyIn(d); }).length;
      note.textContent = ok ? tx("gift.ok", "{n} pieces can be ready in time. They're listed first.", { n: GD.num(ok) })
        : tx("gift.none", "That's very soon. Message me on Instagram and I'll tell you what I can do.");
    }
  }

  GD.onContent(function (c) {
    content = c;
    document.title = (GD.tx("gift.title") || "A gift made only for him") + " · Guts Decor";
    $("gf-eyebrow").textContent = tx("gift.label", "It's a gift");
    $("gf-title").textContent = tx("gift.title", "A gift made only for him");
    $("gf-sub").textContent = tx("gift.sub", "Handmade for one person, with his name carved by hand, and ready before the big day.");
    $("gf-when-label").textContent = tx("gift.when", "When do you need it by?");
    $("gf-grid-title").textContent = tx("gift.grid", "Pick his sword");

    var mounts = (c.addons || []).filter(function (a) { return typeof a.price === "number" && /mount|stand/i.test(a.name); }).slice(0, 4);
    $("gf-mount-sec").classList.toggle("hidden", !mounts.length);
    $("gf-mount-title").textContent = tx("gift.mount.title", "Make it personal");
    $("gf-mount-body").textContent = tx("gift.mount.body", "Add a mount with his name hand-carved for free, so it hangs on his wall and he thinks of you every time he walks past.");
    $("gf-mounts").innerHTML = mounts.map(mountCard).join("");

    $("gf-box-title").textContent = tx("gift.box.title", "What's in the box");
    var box = [1, 2, 3].map(function (n) { return GD.tx("gift.box." + n); }).filter(Boolean);
    if (!box.length) box = ["The sword, wrapped and protected for shipping", "A gift card with your message", "Photos of the finished sword before you pay the rest"];
    $("gf-box").innerHTML = box.map(function (t, i) { return '<li><span class="no">0' + (i + 1) + '</span><span class="txt"><span class="bd">' + esc(t) + "</span></span></li>"; }).join("");

    $("gf-others-title").textContent = tx("gift.others", "Or browse by level");
    $("gf-others").innerHTML = (c.tiers || []).slice().sort(function (a, b) { return (a.price || 9e9) - (b.price || 9e9); }).map(function (t) {
      return '<a class="pill" href="level.html?l=' + esc(slug(t.name)) + '">' + esc(t.name) + "</a>";
    }).join("");

    var saved = ""; try { saved = sessionStorage.getItem("gd-gift-date") || ""; } catch (e) {}
    if (saved && !$("gf-when").value) $("gf-when").value = saved;
    $("gf-when").min = new Date().toISOString().slice(0, 10);
    render();
  });

  $("gf-when").addEventListener("change", function () {
    try { sessionStorage.setItem("gd-gift-date", $("gf-when").value); } catch (e) {}
    render();
  });
})();
