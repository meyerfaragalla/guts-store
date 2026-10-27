/* Payment upload page: shows only the order code and amount, then accepts one receipt image */
(function () {
  "use strict";
  var GD = window.GD;
  var MAX_BYTES = 10 * 1024 * 1024;
  var TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
  var order = null;

  function $(id) { return document.getElementById(id); }

  function setStatus(kind, msg) {
    var el = $("pay-status");
    el.className = "status " + (kind === "ok" ? "ok" : "bad");
    el.textContent = msg;
    el.classList.toggle("hidden", !msg);
  }

  function showErr(id, msg) {
    var el = $("err-" + id);
    el.textContent = msg || "";
    el.classList.toggle("hidden", !msg);
    $(id).setAttribute("aria-invalid", msg ? "true" : "false");
  }

  function renderOrder() {
    if (!order) return;
    $("o-code").textContent = order.code;
    $("o-amount").textContent = order.amount ? GD.money(order.amount) : "—";
    $("anti-scam").textContent = order.instapayName
      ? GD.t("I only ever accept InstaPay to " + order.instapayName + ". I will never ask you to pay a different account.",
          "أنا مبقبلش غير InstaPay على اسم " + order.instapayName + "، وعمري ما هطلب منك تدفع على حساب تاني.")
      : GD.t("I only ever accept InstaPay to the name in my confirmation email. I will never ask you to pay a different account.",
          "أنا مبقبلش غير InstaPay على الاسم اللي في إيميل التأكيد، وعمري ما هطلب منك تدفع على حساب تاني.");
    var due = !!order.amount;
    $("upload-form").classList.toggle("hidden", !due);
    var none = $("nothing-due");
    none.textContent = order.waiting
      ? GD.t("I haven't confirmed this order yet. You'll get an email with the amount and payment details as soon as I do. Please don't pay anything before that.",
          "لسه ماأكدتش الطلب ده. هيوصلك إيميل فيه المبلغ وبيانات الدفع أول ما أأكد. من فضلك متدفعش أي حاجة قبل كده.")
      : GD.t("There's nothing to pay on this order right now.", "مفيش حاجة مطلوب دفعها على الطلب ده دلوقتي.");
    none.classList.toggle("hidden", due);
    $("order-box").classList.remove("hidden");
  }

  $("lookup-form").addEventListener("submit", function (e) {
    e.preventDefault();
    setStatus("", "");
    var code = $("code").value.trim().toUpperCase();
    if (!/^GD-[A-Z0-9]{4}$/.test(code)) {
      showErr("code", GD.t("Codes look like GD-X7P4.", "الكود شكله كده: GD-X7P4"));
      $("code").focus();
      return;
    }
    showErr("code", "");
    $("lookup-btn").disabled = true;
    GD.get({ action: "order", code: code }).then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || "unknown");
      order = res;
      renderOrder();
      history.replaceState(null, "", "pay.html?code=" + encodeURIComponent(code));
    }).catch(function (err) {
      $("order-box").classList.add("hidden");
      setStatus("bad", err.message === "not-found"
        ? GD.t("I couldn't find that code. Please check it and try again.", "مش لاقي الكود ده. راجعه وجرّب تاني.")
        : GD.t("Something went wrong. Please try again in a minute.", "حصلت مشكلة. جرّب تاني كمان دقيقة."));
    }).then(function () { $("lookup-btn").disabled = false; });
  });

  $("upload-form").addEventListener("submit", function (e) {
    e.preventDefault();
    setStatus("", "");
    var file = $("receipt").files[0];
    if (!file) return showErr("receipt", GD.t("Please choose a screenshot.", "من فضلك اختار صورة."));
    if (TYPES.indexOf(file.type) === -1) return showErr("receipt", GD.t("Please upload an image (JPG, PNG, WEBP or HEIC).", "من فضلك ارفع صورة (JPG أو PNG أو WEBP أو HEIC)."));
    if (file.size > MAX_BYTES) return showErr("receipt", GD.t("That image is bigger than 10 MB.", "الصورة دي أكبر من ١٠ ميجا."));
    showErr("receipt", "");
    var btn = $("upload-btn");
    btn.disabled = true;
    setStatus("ok", GD.t("Uploading…", "بنرفع الصورة…"));
    var reader = new FileReader();
    reader.onload = function () {
      var data = String(reader.result).split(",")[1] || "";
      GD.post({ action: "upload", code: order.code, mime: file.type, data: data }).then(function (res) {
        if (!res || !res.ok) throw new Error((res && res.error) || "unknown");
        $("upload-form").reset();
        setStatus("ok", GD.t("Got it, thank you! I'll check it in my InstaPay app and email you once it's confirmed.",
          "وصلت، شكرًا! هراجعها في تطبيق الـ InstaPay وهبعتلك إيميل أول ما تتأكد."));
      }).catch(function (err) {
        setStatus("bad", err.message === "limit"
          ? GD.t("This order already has the maximum number of uploads. Please message me on Instagram.", "الطلب ده وصل لأقصى عدد صور. ابعتلي على إنستجرام.")
          : GD.t("The upload didn't work. Please try again, or message me on Instagram.", "الرفع ماشتغلش. جرّب تاني، أو ابعتلي على إنستجرام."));
      }).then(function () { btn.disabled = false; });
    };
    reader.onerror = function () {
      btn.disabled = false;
      setStatus("bad", GD.t("That file couldn't be read. Please choose another one.", "الملف ده مش عارف يتقري. اختار صورة تانية."));
    };
    reader.readAsDataURL(file);
  });

  var pre = new URLSearchParams(location.search).get("code");
  if (pre) {
    $("code").value = pre.toUpperCase();
    if (GD.configured()) $("lookup-form").requestSubmit ? $("lookup-form").requestSubmit() : $("lookup-btn").click();
  }

  document.addEventListener("gd:lang", renderOrder);
})();
