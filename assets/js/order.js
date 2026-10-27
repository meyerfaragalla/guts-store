/* Order form: options from the sheet, live estimate, checks, and sending */
(function () {
  "use strict";
  var GD = window.GD;
  var content = null;
  var startedAt = Date.now();
  var form = document.getElementById("order-form");
  var params = new URLSearchParams(location.search);

  var GOVERNORATES = [
    ["Cairo", "القاهرة"], ["Giza", "الجيزة"], ["Alexandria", "الإسكندرية"], ["Qalyubia", "القليوبية"],
    ["Sharqia", "الشرقية"], ["Dakahlia", "الدقهلية"], ["Gharbia", "الغربية"], ["Monufia", "المنوفية"],
    ["Beheira", "البحيرة"], ["Kafr El Sheikh", "كفر الشيخ"], ["Damietta", "دمياط"], ["Port Said", "بورسعيد"],
    ["Ismailia", "الإسماعيلية"], ["Suez", "السويس"], ["Faiyum", "الفيوم"], ["Beni Suef", "بني سويف"],
    ["Minya", "المنيا"], ["Asyut", "أسيوط"], ["Sohag", "سوهاج"], ["Qena", "قنا"], ["Luxor", "الأقصر"],
    ["Aswan", "أسوان"], ["Red Sea", "البحر الأحمر"], ["New Valley", "الوادي الجديد"], ["Matrouh", "مطروح"],
    ["North Sinai", "شمال سيناء"], ["South Sinai", "جنوب سيناء"]
  ];
  var FOUND_VIA = [["Instagram", "إنستجرام"], ["A friend", "من صاحب"], ["The quiz", "الكويز"], ["Google", "جوجل"], ["Other", "حاجة تانية"]];
  var PREMIUM_GIFTS = [["Desk stand", "ستاند مكتب"], ["Wall mount", "حامل حيطة"]];

  function $(id) { return document.getElementById(id); }

  function fillSelect(sel, options, placeholder) {
    var keep = sel.value;
    sel.innerHTML = (placeholder ? '<option value="">' + GD.esc(placeholder) + "</option>" : "") +
      options.map(function (o) { return '<option value="' + GD.esc(o[0]) + '">' + GD.esc(GD.t(o[0], o[1])) + "</option>"; }).join("");
    if (keep) sel.value = keep;
  }

  function selectedTier() {
    var r = form.querySelector('input[name="tier"]:checked');
    if (!r || !content) return null;
    return content.tiers.filter(function (t) { return t.name === r.value; })[0] || null;
  }

  // ---------- Building the form from the sheet ----------
  function renderOptions() {
    if (!content) return;
    var pre = params.get("tier");
    var checked = (form.querySelector('input[name="tier"]:checked') || {}).value || pre;
    var tiers = content.tiers.slice().sort(function (a, b) { return (b.price || Infinity) - (a.price || Infinity); });
    $("tier-pick").innerHTML = tiers.map(function (t) {
      var price = t.price ? (/from/i.test(t.display || "") ? GD.t("From ", "من ") : "") + GD.money(t.price) : GD.t("By quote", "السعر بالاتفاق");
      return '<label><input type="radio" name="tier" value="' + GD.esc(t.name) + '"' + (t.name === checked ? " checked" : "") + ">" +
        "<strong>" + GD.esc(t.name) + '</strong><span class="tp-price">' + GD.esc(price) + "</span></label>";
    }).join("");

    var designs = (content.designs || []).map(function (d) {
      var label = d.name + (d.inspiredBy ? " — " + GD.t("inspired by ", "مستوحى من ") + d.inspiredBy : "") +
        (Number(d.readyDays) === 4 ? GD.t(" (ready in 4 days)", " (جاهز في ٤ أيام)") : "");
      return [d.name, label];
    }).map(function (o) { return [o[0], o[1]]; });
    var designSel = $("design");
    var keepDesign = designSel.value;
    designSel.innerHTML = '<option value="">' + GD.esc(GD.t("A custom design (I'll describe it in the notes)", "تصميم مخصوص (هوصفه في الملاحظات)")) + "</option>" +
      designs.map(function (o) { return '<option value="' + GD.esc(o[0]) + '">' + GD.esc(o[1]) + "</option>"; }).join("");
    designSel.value = keepDesign;

    var chosen = {};
    form.querySelectorAll('input[name="addons"]:checked').forEach(function (c) { chosen[c.value] = true; });
    var addons = (content.addons || []).filter(function (a) { return typeof a.price === "number"; });
    $("addons").innerHTML = addons.map(function (a, i) {
      return '<label class="check" for="addon-' + i + '"><input type="checkbox" id="addon-' + i + '" name="addons" value="' + GD.esc(a.name) + '"' +
        (chosen[a.name] ? " checked" : "") + "><span>" + GD.esc(a.name) + " <span class=\"muted\">+" + GD.esc(GD.money(a.price)) + "</span></span></label>";
    }).join("");
    $("addons-field").classList.toggle("hidden", !addons.length);

    fillSelect($("governorate"), GOVERNORATES, GD.t("Choose…", "اختار…"));
    fillSelect($("foundVia"), FOUND_VIA, GD.t("Choose…", "اختار…"));
    fillSelect($("premiumGift"), PREMIUM_GIFTS, GD.t("Choose…", "اختار…"));

    var s = content.settings;
    var full = $("full-notice");
    if (typeof s.spotsLeft === "number" && s.spotsLeft <= 0) {
      full.textContent = GD.t("This month is full. Send your request anyway and I'll reserve you a spot for next month.",
        "الشهر ده اتملى. ابعت طلبك عادي وأنا هحجزلك مكان في الشهر الجاي.");
      full.classList.remove("hidden");
    }
    update();
  }

  // ---------- Live estimate ----------
  function estimate() {
    var tier = selectedTier();
    if (!tier) return null;
    var s = content.settings;
    var lines = [];
    var gov = $("governorate").value;
    var shipping = (gov === "Cairo" || gov === "Giza") ? Number(s.shipping) : Number(s.shippingOutsideMin);
    lines.push([GD.t(tier.name + " level", "مستوى " + tier.name), tier.price ? GD.money(tier.price) : GD.t("By quote", "بالاتفاق")]);
    var addonsTotal = 0;
    form.querySelectorAll('input[name="addons"]:checked').forEach(function (c) {
      var a = content.addons.filter(function (x) { return x.name === c.value; })[0];
      if (a) { addonsTotal += a.price; lines.push([a.name, GD.money(a.price)]); }
    });
    if (tier.name === "Premium") lines.push([GD.t("Free stand or mount", "ستاند أو حامل هدية"), GD.t("Free", "مجاني")]);
    if (gov) {
      var outside = !(gov === "Cairo" || gov === "Giza");
      lines.push([GD.t("Shipping", "الشحن"), (outside ? GD.t("from ", "من ") : "") + GD.money(shipping)]);
    } else {
      lines.push([GD.t("Shipping", "الشحن"), GD.t("choose your governorate", "اختار المحافظة")]);
    }
    if (!tier.price) return { lines: lines, total: null };
    var total = tier.price + addonsTotal + (gov ? shipping : 0);
    var deposit = Math.round(total * Number(s.depositPct || 50) / 100);
    return { lines: lines, total: total, deposit: deposit, from: /from/i.test(tier.display || "") || (gov && gov !== "Cairo" && gov !== "Giza") };
  }

  function update() {
    if (!content) return;
    var tier = selectedTier();
    $("premium-gift-field").classList.toggle("hidden", !(tier && tier.name === "Premium"));
    $("recipient-field").classList.toggle("hidden", !$("isGift").checked);

    var note = $("date-note");
    var d = $("occasionDate").value;
    var soon = false;
    if (d) {
      var days = (new Date(d + "T00:00:00") - new Date(new Date().toDateString())) / 86400000;
      soon = days >= 0 && days < 14;
    }
    note.classList.toggle("hidden", !soon);

    var est = estimate();
    var box = $("summary");
    if (!est) {
      box.innerHTML = '<p class="muted">' + GD.t("Choose a level to see the estimate.", "اختار المستوى عشان تشوف السعر التقريبي.") + "</p>";
      return;
    }
    var pct = Number(content.settings.depositPct || 50);
    var html = "<dl>" + est.lines.map(function (l) { return "<dt>" + GD.esc(l[0]) + "</dt><dd>" + GD.esc(l[1]) + "</dd>"; }).join("");
    if (est.total === null) {
      html += '<div class="total" style="display:contents"><dt>' + GD.t("Total", "الإجمالي") + "</dt><dd>" + GD.t("By quote", "بالاتفاق") + "</dd></div>";
    } else {
      var prefix = est.from ? GD.t("from ", "من ") : "";
      html += '<div class="total" style="display:contents"><dt>' + GD.t("Estimated total", "الإجمالي التقريبي") + "</dt><dd>" + prefix + GD.money(est.total) + "</dd></div>";
      html += "<dt>" + GD.t("Deposit (" + pct + "%) after I confirm", "العربون (" + GD.num(pct) + "٪) بعد ما أأكد") + "</dt><dd>" + prefix + GD.money(est.deposit) + "</dd>";
    }
    box.innerHTML = html + "</dl>";
  }

  // ---------- Checks ----------
  function showErr(id, msg) {
    var el = $("err-" + id);
    var input = $(id);
    if (el) { el.textContent = msg || ""; el.classList.toggle("hidden", !msg); }
    if (input) {
      input.setAttribute("aria-invalid", msg ? "true" : "false");
      if (msg && el) input.setAttribute("aria-describedby", "err-" + id); else if (input.id !== "phone" && input.id !== "engraving") input.removeAttribute("aria-describedby");
    }
    return !msg;
  }

  function validate() {
    var ok = true;
    var first = null;
    function check(id, cond, en, ar) {
      var good = showErr(id, cond ? "" : GD.t(en, ar));
      if (!good) { ok = false; if (!first) first = id === "tier" ? form.querySelector('input[name="tier"]') : $(id); }
    }
    var tier = selectedTier();
    check("tier", !!tier, "Please choose a level.", "من فضلك اختار المستوى.");
    if (tier && tier.name === "Premium") check("premiumGift", !!$("premiumGift").value, "Please choose your free gift.", "من فضلك اختار هديتك.");
    if ($("isGift").checked) check("recipient", $("recipient").value.trim().length >= 2, "Please write the recipient's name.", "من فضلك اكتب اسم الشخص.");
    check("name", $("name").value.trim().length >= 2, "Please write your full name.", "من فضلك اكتب اسمك بالكامل.");
    var email = $("email").value.trim();
    check("email", /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email), "Please write a valid email.", "من فضلك اكتب إيميل صحيح.");
    check("email2", $("email2").value.trim().toLowerCase() === email.toLowerCase() && email, "The two emails don't match.", "الإيميلين مش زي بعض.");
    var phone = $("phone").value.replace(/[\s\-()]/g, "");
    check("phone", /^\+?\d{10,15}$/.test(phone), "Please write a valid phone number.", "من فضلك اكتب رقم صحيح.");
    check("governorate", !!$("governorate").value, "Please choose your governorate.", "من فضلك اختار المحافظة.");
    ["area", "street", "building", "floor", "apartment"].forEach(function (id) {
      check(id, !!$(id).value.trim(), "This field is required.", "الخانة دي لازم تتملي.");
    });
    check("terms", $("terms").checked, "Please tick the box to agree.", "من فضلك علّم على المربع للموافقة.");
    if (first) first.focus();
    return ok;
  }

  // ---------- Sending ----------
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var status = $("form-status");
    status.classList.add("hidden");
    if (!content || !validate()) return;
    var btn = $("submit-btn");
    btn.disabled = true;
    var addons = [];
    form.querySelectorAll('input[name="addons"]:checked').forEach(function (c) { addons.push(c.value); });
    var payload = {
      action: "order",
      lang: GD.lang(),
      tier: selectedTier().name,
      premiumGift: $("premiumGift").value,
      design: $("design").value,
      addons: addons,
      engraving: $("engraving").value.trim(),
      isGift: $("isGift").checked,
      recipient: $("isGift").checked ? $("recipient").value.trim() : "",
      occasionDate: $("occasionDate").value,
      name: $("name").value.trim(),
      email: $("email").value.trim(),
      email2: $("email2").value.trim(),
      phone: $("phone").value.trim(),
      governorate: $("governorate").value,
      area: $("area").value.trim(),
      street: $("street").value.trim(),
      building: $("building").value.trim(),
      floor: $("floor").value.trim(),
      apartment: $("apartment").value.trim(),
      landmark: $("landmark").value.trim(),
      notes: $("notes").value.trim(),
      friendCode: $("friendCode").value.trim(),
      foundVia: $("foundVia").value,
      terms: $("terms").checked,
      website: $("website").value,
      elapsed: Date.now() - startedAt
    };
    GD.post(payload).then(function (res) {
      if (res && res.ok && res.code) {
        location.href = "thanks.html?code=" + encodeURIComponent(res.code);
        return;
      }
      throw new Error((res && res.error) || "unknown");
    }).catch(function (err) {
      var msg = {
        limit: GD.t("You've already sent 3 requests today. Please wait until tomorrow, or message me on Instagram.",
          "إنت بعت ٣ طلبات النهارده. استنى لبكرة، أو ابعتلي على إنستجرام."),
        invalid: GD.t("Something in the form isn't right. Please check your details and try again.",
          "فيه حاجة مش مظبوطة في البيانات. راجعها وجرّب تاني.")
      }[err.message] || GD.t("Your request couldn't be sent. Please try again in a minute, or message me on Instagram.",
        "الطلب ماتبعتش. جرّب تاني كمان دقيقة، أو ابعتلي على إنستجرام.");
      status.textContent = msg;
      status.classList.remove("hidden");
      btn.disabled = false;
    });
  });

  form.addEventListener("change", update);
  form.addEventListener("input", function (e) { if (e.target.id === "occasionDate") update(); });

  if (params.get("gift") === "1") $("isGift").checked = true;

  GD.getContent().then(function (c) {
    content = c;
    renderOptions();
  }).catch(function () {
    var el = $("load-error");
    el.textContent = GD.t("The order form couldn't load right now. Please refresh the page, or message me on Instagram @guts_san_store.",
      "فورم الطلب مش عارف يحمّل دلوقتي. اعمل ريفرش للصفحة، أو ابعتلي على إنستجرام @guts_san_store.");
    el.classList.remove("hidden");
    $("submit-btn").disabled = true;
  });

  document.addEventListener("gd:lang", renderOptions);
})();
