/* Cart page: each piece with its photo, version, add-ons, quantity and remove; total and the 50% deposit */
(function () {
  "use strict";
  var GD = window.GD;
  var S = GD.shop;
  var esc = GD.esc;
  var content = null;

  function $(x) { return document.getElementById(x); }

  // The reminder email links here with the cart attached (?c=...), so it opens even on another phone.
  (function restoreFromLink() {
    var c = new URLSearchParams(location.search).get("c");
    if (!c) return;
    try {
      var b64 = c.replace(/-/g, "+").replace(/_/g, "/");
      var bytes = Uint8Array.from(atob(b64), function (ch) { return ch.charCodeAt(0); });
      var lines = JSON.parse(new TextDecoder().decode(bytes));
      if (Array.isArray(lines) && lines.length && !GD.cart.get().length) GD.cart.set(lines.slice(0, 20));
    } catch (e) { /* a broken link just opens the cart as it is */ }
    history.replaceState(null, "", "cart.html");
  })();

  function lineDetails(c, l) {
    var out = [];
    if (l.version && S.hasVersions(S.find(c, l.id))) out.push(GD.tx("cart.version", { v: l.version }));
    if (l.height) out.push(GD.tx("cart.height", { h: GD.tx("pp.cm", { n: GD.num(l.height) }) }));
    if (l.sword) out.push(GD.tx("cart.sword", { s: l.sword }));
    if (l.blade) out.push(GD.tx("cart.blade", { n: l.blade }));
    if (l.plaque) out.push(GD.tx("cart.plaque", { price: GD.money(S.plaqueUpgrade(c)) }));
    if (l.mount) {
      var m = S.addon(c, l.mount.name);
      if (m) out.push(GD.tx("cart.mount", { name: S.pick(m.name, m.nameAr), price: GD.money(m.price), carve: l.mount.carve || "" }));
    }
    return out;
  }

  function render() {
    if (!content) return;
    var res = S.cleanCart(content);
    $("cart-changed").classList.toggle("hidden", !res.removed);
    var lines = res.lines;
    var total = 0;
    $("cart-list").innerHTML = lines.map(function (l, i) {
      var p = S.find(content, l.id);
      var price = S.linePrice(content, l);
      total += price;
      var img = S.photos(p, 400)[0];
      return '<li class="cart-item">' +
        '<a class="ci-photo" href="' + esc(S.url(p)) + '">' + (img ? '<img src="' + esc(img) + '" alt="">' : "") + "</a>" +
        '<div class="ci-body"><a class="ci-name" href="' + esc(S.url(p)) + '">' + esc(S.displayName(p)) + "</a>" +
        lineDetails(content, l).map(function (d) { return '<span class="ci-detail">' + esc(d) + "</span>"; }).join("") +
        '<div class="ci-row"><div class="stepper">' +
        '<button type="button" data-i="' + i + '" data-d="-1" aria-label="' + esc(GD.tx("cart.minus")) + '">−</button>' +
        '<output aria-label="' + esc(GD.tx("pp.qty")) + '">' + esc(GD.num(l.qty || 1)) + "</output>" +
        '<button type="button" data-i="' + i + '" data-d="1" aria-label="' + esc(GD.tx("cart.plus")) + '">+</button></div>' +
        '<button type="button" class="link-u ci-remove" data-remove="' + i + '">' + esc(GD.tx("cart.remove")) + "</button></div></div>" +
        '<span class="ci-price">' + esc(GD.money(price)) + "</span></li>";
    }).join("");

    var empty = !lines.length;
    $("cart-empty").classList.toggle("hidden", !empty);
    $("cart-sum").classList.toggle("hidden", empty);
    $("cart-total").textContent = GD.money(total);
    $("cart-deposit-label").textContent = GD.tx("pp.deposit", { amount: GD.money(S.deposit(content, total)) });
  }

  $("cart-list").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    var lines = GD.cart.get();
    if (b.hasAttribute("data-remove")) {
      lines.splice(Number(b.getAttribute("data-remove")), 1);
    } else {
      var l = lines[Number(b.getAttribute("data-i"))];
      if (!l) return;
      l.qty = Math.min(10, Math.max(1, (Number(l.qty) || 1) + Number(b.getAttribute("data-d"))));
    }
    GD.cart.set(lines);
    render();
  });

  window.addEventListener("storage", function (e) { if (e.key === "gd-cart-v1") render(); });
  GD.onContent(function (c) { content = c; render(); });
})();
