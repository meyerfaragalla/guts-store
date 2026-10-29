/* Shop: products, prices and cart lines, built from the Website Content sheet.
 * The order system recalculates every price from the sheet with the same rules; these numbers are only for display.
 */
(function () {
  "use strict";
  var GD = window.GD;

  function slug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function pick(en, ar) { return GD.lang() === "ar" ? (ar || en || "") : (en || ar || ""); }

  // Every piece that has its own product page.
  function products(c) {
    var list = [];
    (c.designs || []).forEach(function (d) { list.push({ id: "d-" + slug(d.name), type: "design", name: d.name, d: d }); });
    (c.tiers || []).forEach(function (t) { if (t.price) list.push({ id: "t-" + slug(t.name), type: "tier", name: t.name, d: t }); });
    (c.addons || []).forEach(function (a) { if (typeof a.price === "number") list.push({ id: "a-" + slug(a.name), type: "addon", name: a.name, d: a }); });
    return list;
  }
  function find(c, id) { return products(c).filter(function (p) { return p.id === id; })[0] || null; }
  function url(p) { return "product.html?id=" + encodeURIComponent(p.id); }

  function tier(c, name) { return (c.tiers || []).filter(function (t) { return t.name === name; })[0] || null; }
  function addon(c, name) { return (c.addons || []).filter(function (a) { return a.name === name && typeof a.price === "number"; })[0] || null; }

  function displayName(p) { return p.type === "addon" ? pick(p.d.name, p.d.nameAr) : p.d.name; }

  // A cell may hold several Drive links (separated by commas, spaces or new lines).
  function photos(p, width) {
    return String(p.d.photo || "").split(/[\s,]+/).filter(Boolean).map(function (l) { return GD.driveImage(l, width || 1200); }).filter(Boolean);
  }

  // Can this piece be paid for straight away (and so go in the cart)?
  function payNow(p) {
    if (!p) return false;
    if (p.type === "addon") return typeof p.d.price === "number";
    return !!(p.d.payNow && p.d.price);
  }

  function hasVersions(p) { return p.type === "design" && !!p.d.classicPrice; }

  function basePrice(p, version) {
    if (p.type === "design" && version === "Classic" && p.d.classicPrice) return p.d.classicPrice;
    return p.d.price;
  }

  function readyDays(c, p) {
    var own = p.type === "design" ? Number(p.d.readyDays) : 0;
    return own > 0 ? own : (Number(c.settings.daysToMake) || 14);
  }

  function readyDate(days) {
    var d = new Date();
    d.setDate(d.getDate() + days);
    return d.toLocaleDateString(GD.lang() === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "long" });
  }

  function plaqueUpgrade(c) { return Number(c.settings.plaqueUpgrade) || 1200; }

  // One cart line: { id, version, height, sword, blade, plaque, mount: { name, carve }, qty }
  function linePrice(c, line) {
    var p = find(c, line.id);
    if (!p) return 0;
    var each = basePrice(p, line.version) || 0;
    if (line.plaque) each += plaqueUpgrade(c);
    if (line.mount) { var m = addon(c, line.mount.name); if (m) each += m.price; }
    return each * Math.max(1, Number(line.qty) || 1);
  }

  function deposit(c, total) { return Math.round(total * (Number(c.settings.depositPct) || 50) / 100); }

  function sameLine(a, b) {
    var strip = function (l) { var o = {}; Object.keys(l).forEach(function (k) { if (k !== "qty") o[k] = l[k]; }); return JSON.stringify(o); };
    return strip(a) === strip(b);
  }

  function addToCart(line) {
    var lines = GD.cart.get();
    var same = lines.filter(function (l) { return sameLine(l, line); })[0];
    if (same) same.qty = Math.min(10, (Number(same.qty) || 1) + (line.qty || 1));
    else lines.push(line);
    GD.cart.set(lines);
  }

  // Keeps only lines that can still be paid for now (prices or pieces may change in the sheet).
  function cleanCart(c) {
    var lines = GD.cart.get();
    var kept = lines.filter(function (l) { return payNow(find(c, l.id)); });
    if (kept.length !== lines.length) GD.cart.set(kept);
    return { lines: kept, removed: lines.length - kept.length };
  }

  GD.shop = {
    slug: slug, pick: pick, products: products, find: find, url: url, tier: tier, addon: addon, displayName: displayName,
    photos: photos, payNow: payNow, hasVersions: hasVersions, basePrice: basePrice, readyDays: readyDays, readyDate: readyDate,
    plaqueUpgrade: plaqueUpgrade, linePrice: linePrice, deposit: deposit, addToCart: addToCart, cleanCart: cleanCart
  };
})();
