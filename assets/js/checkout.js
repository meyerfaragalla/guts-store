/* Checkout: four short steps from the cart (or one "Order now" piece) to the order system */
(function () {
  "use strict";
  var GD = window.GD;
  var S = GD.shop;
  var esc = GD.esc;
  var params = new URLSearchParams(location.search);
  var fromNow = params.get("now") === "1";
  var content = null;
  var step = 1;
  var startedAt = Date.now();
  var instapay = null;
  var cartSaved = "";

  var GOVERNORATES = [
    ["Cairo", "القاهرة"], ["Giza", "الجيزة"], ["Alexandria", "الإسكندرية"], ["Qalyubia", "القليوبية"],
    ["Sharqia", "الشرقية"], ["Dakahlia", "الدقهلية"], ["Gharbia", "الغربية"], ["Monufia", "المنوفية"],
    ["Beheira", "البحيرة"], ["Kafr El Sheikh", "كفر الشيخ"], ["Damietta", "دمياط"], ["Port Said", "بورسعيد"],
    ["Ismailia", "الإسماعيلية"], ["Suez", "السويس"], ["Faiyum", "الفيوم"], ["Beni Suef", "بني سويف"],
    ["Minya", "المنيا"], ["Asyut", "أسيوط"], ["Sohag", "سوهاج"], ["Qena", "قنا"], ["Luxor", "الأقصر"],
    ["Aswan", "أسوان"], ["Red Sea", "البحر الأحمر"], ["New Valley", "الوادي الجديد"], ["Matrouh", "مطروح"],
    ["North Sinai", "شمال سيناء"], ["South Sinai", "جنوب سيناء"]
  ];
  var FOUND = [["Instagram post", "co.found.post"], ["Instagram ad", "co.found.ad"], ["A friend", "co.found.friend"], ["Other", "co.found.other"]];
  var TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

  function $(x) { return document.getElementById(x); }
  function val(x) { return $(x).value.trim(); }

  // The pieces being ordered: the cart, or just the one "Order now" piece.
  function items() {
    if (fromNow) {
      try { return JSON.parse(sessionStorage.getItem("gd-now") || "[]"); } catch (e) { return []; }
    }
    return GD.cart.get();
  }
  function validItems() { return content ? items().filter(function (l) { return S.payNow(S.find(content, l.id)); }) : []; }

  function totals() {
    var lines = validItems();
    var total = lines.reduce(function (s, l) { return s + S.linePrice(content, l); }, 0);
    var gov = $("governorate").value;
    var allFree = lines.length && lines.every(function (l) { var p = S.find(content, l.id); return p.type === "design" && p.d.shippingIncluded; });
    var ship = allFree ? 0 : !gov ? null : (gov === "Cairo" || gov === "Giza") ? content.settings.shipping : content.settings.shippingOutsideMin;
    return { lines: lines, total: total, deposit: S.deposit(content, total), ship: ship, outside: gov && gov !== "Cairo" && gov !== "Giza", allFree: allFree };
  }

  // ---------- Showing a step ----------
  var HEADINGS = { 1: "co.s1", 2: "co.s2", 3: "co.s3", 4: "co.s4" };
  function show(n) {
    step = n;
    document.querySelectorAll(".co-step").forEach(function (f) { f.classList.toggle("hidden", Number(f.getAttribute("data-step")) !== n); });
    $("co-heading").textContent = GD.tx(HEADINGS[n]);
    $("co-step").textContent = GD.tx("co.step", { n: GD.num(n) });
    $("co-bar").style.width = (n * 25) + "%";
    $("co-back").classList.toggle("hidden", n === 1);
    $("co-next").textContent = GD.tx(n === 4 ? "co.send" : "co.next");
    $("co-status").classList.add("hidden");
    if (n === 4) loadInstapay();
  }

  function renderSummary() {
    var t = totals();
    $("co-items").innerHTML = t.lines.map(function (l) {
      var p = S.find(content, l.id);
      return "<li><span>" + esc((l.qty > 1 ? GD.num(l.qty) + " × " : "") + S.displayName(p) + (l.version && S.hasVersions(p) ? " (" + l.version + ")" : "")) +
        "</span><span>" + esc(GD.money(S.linePrice(content, l))) + "</span></li>";
    }).join("");
    $("co-total").textContent = GD.money(t.total);
    $("co-sum-total").textContent = "· " + GD.money(t.total);
    $("co-ship").textContent = t.allFree ? GD.tx("co.shipping.free") : t.ship === null ? GD.tx("co.shipping.pick")
      : t.outside ? GD.tx("co.shipping.from", { price: GD.money(t.ship) }) : GD.money(t.ship);
    $("co-bottom-text").textContent = GD.tx("pp.deposit", { amount: GD.money(t.deposit) });
    $("pay-amount").textContent = GD.money(t.deposit);
  }

  function fillSelects() {
    var gov = $("governorate"), keep = gov.value;
    gov.innerHTML = '<option value="">' + esc(GD.tx("co.choose")) + "</option>" + GOVERNORATES.map(function (g) {
      return '<option value="' + g[0] + '">' + esc(GD.lang() === "ar" ? g[1] : g[0]) + "</option>";
    }).join("");
    gov.value = keep;
    var f = $("foundVia"), keepF = f.value;
    f.innerHTML = '<option value="">' + esc(GD.tx("co.choose")) + "</option>" + FOUND.map(function (o) {
      return '<option value="' + o[0] + '">' + esc(GD.tx(o[1])) + "</option>";
    }).join("");
    f.value = keepF;
  }

  // ---------- Checks ----------
  function err(id, key) {
    var el = $("err-" + id);
    var msg = key ? GD.tx(key) : "";
    if (el) { el.textContent = msg; el.classList.toggle("hidden", !msg); }
    var input = $(id);
    if (input) input.setAttribute("aria-invalid", msg ? "true" : "false");
    return !msg;
  }

  function check(n) {
    var ok = true, first = null;
    function need(id, cond, key) { if (!err(id, cond ? "" : key)) { ok = false; first = first || id; } }
    if (n === 1) {
      need("name", val("name").length >= 2, "co.err.required");
      need("email", /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val("email")), "co.err.email");
      need("email2", val("email2").toLowerCase() === val("email").toLowerCase() && !!val("email"), "co.err.email2");
      need("phone", /^\+?\d{10,15}$/.test(val("phone").replace(/[\s\-()]/g, "")), "co.err.phone");
      need("instagram", /^@?[A-Za-z0-9._]{0,30}$/.test(val("instagram")), "co.err.ig");
    }
    if (n === 2 && isGift()) need("recipient", val("recipient").length >= 2, "co.err.required");
    if (n === 3) {
      need("governorate", !!$("governorate").value, "co.err.required");
      ["area", "street", "building", "floor", "apartment"].forEach(function (id) { need(id, !!val(id), "co.err.required"); });
    }
    if (n === 4) {
      var f = $("receipt").files[0];
      need("receipt", !f || (TYPES.indexOf(f.type) !== -1 && f.size <= 10 * 1024 * 1024), "co.err.image");
      need("terms", $("terms").checked, "co.err.terms");
    }
    if (first) $(first).focus();
    return ok;
  }

  function isGift() { return document.querySelector('input[name="who"]:checked').value === "gift"; }

  // ---------- Saving the email for the one reminder ----------
  function saveCart() {
    var key = val("email").toLowerCase() + "|" + JSON.stringify(validItems());
    if (key === cartSaved) return;
    cartSaved = key;
    GD.post({ action: "cartsave", email: val("email"), lang: GD.lang(), items: validItems() }).catch(function () {});
  }

  // ---------- InstaPay details (only fetched on the payment step) ----------
  function loadInstapay() {
    if (instapay) return renderInstapay();
    GD.get({ action: "instapay" }).then(function (r) { instapay = r && r.ok ? r : { ok: false }; renderInstapay(); })
      .catch(function () { instapay = { ok: false }; renderInstapay(); });
  }
  function renderInstapay() {
    var ok = instapay && instapay.ok;
    $("pay-to-row").classList.toggle("hidden", !ok);
    $("pay-check").classList.toggle("hidden", !ok);
    $("pay-wait").classList.toggle("hidden", ok);
    if (ok) {
      $("pay-to").textContent = instapay.address;
      $("pay-check").textContent = GD.tx("co.pay.check", { name: instapay.name });
    }
  }
  $("pay-copy").addEventListener("click", function () {
    if (!instapay || !instapay.ok || !navigator.clipboard) return;
    navigator.clipboard.writeText(instapay.address).then(function () { $("pay-copy").textContent = GD.tx("co.pay.copied"); });
  });

  // ---------- Moving through the steps ----------
  $("co-back").addEventListener("click", function () { if (step > 1) show(step - 1); window.scrollTo(0, 0); });

  $("co-form").addEventListener("submit", function (e) {
    e.preventDefault();
    if (!check(step)) return;
    if (step === 1) saveCart();
    if (step < 4) { show(step + 1); window.scrollTo(0, 0); return; }
    send();
  });

  function send() {
    var btn = $("co-next");
    btn.disabled = true;
    btn.textContent = GD.tx("co.sending");
    var payload = {
      action: "checkout", lang: GD.lang(), items: validItems(),
      name: val("name"), email: val("email"), email2: val("email2"), phone: val("phone"), instagram: val("instagram"),
      isGift: isGift(), recipient: isGift() ? val("recipient") : "", occasionDate: isGift() ? $("occasionDate").value : "",
      governorate: $("governorate").value, area: val("area"), street: val("street"), building: val("building"),
      floor: val("floor"), apartment: val("apartment"), landmark: val("landmark"), notes: val("notes"), foundVia: $("foundVia").value,
      terms: $("terms").checked, website: $("website").value, elapsed: Date.now() - startedAt
    };
    var file = $("receipt").files[0];
    var withFile = file ? new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { payload.mime = file.type; payload.data = String(r.result).split(",")[1] || ""; resolve(); };
      r.onerror = reject;
      r.readAsDataURL(file);
    }) : Promise.resolve();

    withFile.then(function () { return GD.post(payload); }).then(function (res) {
      if (!res || !res.ok || !res.code) throw new Error((res && res.error) || "send");
      if (fromNow) { try { sessionStorage.removeItem("gd-now"); } catch (e) { /* ignore */ } } else GD.cart.set([]);
      location.href = "thanks.html?code=" + encodeURIComponent(res.code) + "&s=" + (res.screenshot ? "1" : "0") +
        "&d=" + (Math.max.apply(null, payload.items.map(function (l) { return S.readyDays(content, S.find(content, l.id)); })) || 14);
    }).catch(function (e2) {
      var key = { limit: "co.err.limit", changed: "co.err.changed" }[e2.message] || "co.err.send";
      $("co-status").textContent = GD.tx(key);
      $("co-status").classList.remove("hidden");
      btn.disabled = false;
      btn.textContent = GD.tx("co.send");
    });
  }

  // Gift fields and the "date is too close" note.
  document.querySelectorAll('input[name="who"]').forEach(function (r) {
    r.addEventListener("change", function () { $("gift-fields").classList.toggle("hidden", !isGift()); });
  });
  $("occasionDate").addEventListener("input", function () {
    var d = $("occasionDate").value, note = $("date-soon");
    if (!d || !content) return note.classList.add("hidden");
    var lines = validItems();
    var days = Math.max.apply(null, lines.map(function (l) { return S.readyDays(content, S.find(content, l.id)); })) || 14;
    var left = (new Date(d + "T00:00:00") - new Date(new Date().toDateString())) / 86400000;
    note.textContent = GD.tx("co.date.soon", { days: GD.num(days) });
    note.classList.toggle("hidden", !(left >= 0 && left < days));
  });
  $("governorate").addEventListener("change", renderSummary);

  GD.mountTalking("pay-video-wrap", "pay-video", "payment", { titleKey: "pay.video.title", altKey: "pay.video.alt" });

  GD.onContent(function (c) {
    content = c;
    var empty = !validItems().length;
    $("co-empty").classList.toggle("hidden", !empty);
    $("co-form").classList.toggle("hidden", empty);
    $("co-summary").classList.toggle("hidden", empty);
    $("co-bottom").classList.toggle("hidden", empty);
    fillSelects();
    renderSummary();
    show(step);
    if (step === 4) renderInstapay();
  });
})();
