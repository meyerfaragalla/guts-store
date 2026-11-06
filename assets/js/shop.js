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

  // Which level(s) a ready design belongs to. Uses the sheet's Level column; until that reaches the site,
  // it matches the design's price to a level's price, and treats sets by their name.
  function levelsOf(d, tiers) {
    var out = [];
    if (d.level) out.push(slug(d.level));
    else {
      var byPrice = (tiers || []).filter(function (t) { return t.price && t.price === d.price; })[0];
      if (byPrice) out.push(slug(byPrice.name));
      else out.push(/classic/i.test(d.name) ? "classic" : "premium");
    }
    if (d.classicPrice && out.indexOf("classic") === -1) out.push("classic"); // also sold as a Classic
    return out;
  }

  // ---------- Size drawing ----------
  // Real lengths from Meyer (6 Nov): katanas, two-handed swords and Frostmourne are 120 cm;
  // Dragon Slayer is made at 165 or 190 cm (same price). Shown next to an average 175 cm person.
  var SWORD_CM = 120;
  var DS_HEIGHTS = [165, 190];
  var PERSON_CM = 175;
  function isDragonSlayer(p) { return !!(p && p.d && p.d.askHeight); }

  // focus: "all" (Swords page), "sword" (a 120 cm piece) or "ds" (Dragon Slayer, with the chosen height if any)
  function sizeDrawing(focus, chosen) {
    var floor = 420, k = 2; // 2 px per cm
    var y = function (cm) { return floor - cm * k; };
    var ink = "#1E0B2E", soft = "#5E5466", gold = "#C9A44C";
    var showSword = focus !== "ds", showDs = focus !== "sword";
    var px = 92, sx = showDs ? 190 : 210, dx = showSword ? 284 : 210;
    var s = '<svg class="size-svg" viewBox="0 0 360 486" role="img" aria-labelledby="size-svg-t"><title id="size-svg-t">' +
      esc(GD.tx("size.alt") || "A 175 cm person next to the swords, drawn to scale") + "</title>";
    // Ruler every 50 cm
    s += '<line x1="22" y1="' + floor + '" x2="22" y2="' + y(200) + '" stroke="' + soft + '" stroke-width="1"/>';
    for (var cm = 0; cm <= 200; cm += 50) {
      s += '<line x1="18" y1="' + y(cm) + '" x2="26" y2="' + y(cm) + '" stroke="' + soft + '"/>' +
        '<line x1="26" y1="' + y(cm) + '" x2="340" y2="' + y(cm) + '" stroke="' + soft + '" stroke-opacity=".14" stroke-dasharray="2 4"/>' +
        (cm ? '<text x="30" y="' + (y(cm) - 4) + '" font-size="10" fill="' + soft + '" font-family="Montserrat, sans-serif">' + cm + "</text>" : "");
    }
    s += '<line x1="18" y1="' + floor + '" x2="346" y2="' + floor + '" stroke="' + ink + '" stroke-width="1.2"/>';
    // Person, 175 cm
    var c = px, top = y(PERSON_CM), hr = 11, n = top + 2 * hr;
    s += '<circle cx="' + c + '" cy="' + (top + hr) + '" r="' + hr + '" fill="#E6DFD2" stroke="' + ink + '"/>' +
      '<path fill="#E6DFD2" stroke="' + ink + '" stroke-linejoin="round" d="M' + (c - 6) + " " + n + " L" + (c + 6) + " " + n + " L" + (c + 6) + " " + (n + 6) +
      " Q" + (c + 24) + " " + (n + 8) + " " + (c + 26) + " " + (n + 20) + " L" + (c + 30) + " " + (n + 148) + " L" + (c + 22) + " " + (n + 150) +
      " L" + (c + 18) + " " + (n + 48) + " L" + (c + 16) + " " + (n + 150) + " L" + (c + 14) + " " + floor + " L" + (c + 3) + " " + floor +
      " L" + (c + 1) + " " + (n + 170) + " L" + (c - 1) + " " + (n + 170) + " L" + (c - 3) + " " + floor + " L" + (c - 14) + " " + floor +
      " L" + (c - 16) + " " + (n + 150) + " L" + (c - 18) + " " + (n + 48) + " L" + (c - 22) + " " + (n + 150) + " L" + (c - 30) + " " + (n + 148) +
      " L" + (c - 26) + " " + (n + 20) + " Q" + (c - 24) + " " + (n + 8) + " " + (c - 6) + " " + (n + 6) + ' Z"/>';
    s += '<text x="' + c + '" y="' + (floor + 22) + '" text-anchor="middle" font-size="13" fill="' + ink + '">' + esc(GD.tx("size.person") || "Average person") + "</text>" +
      '<text x="' + c + '" y="' + (floor + 40) + '" text-anchor="middle" font-size="12" fill="' + soft + '">' + esc(GD.tx("pp.cm", { n: GD.num(PERSON_CM) }) || PERSON_CM + " cm") + "</text>";
    // 120 cm sword, standing tip up
    if (showSword) {
      var x = sx, hilt = y(30), tip = y(SWORD_CM);
      s += '<rect x="' + (x - 3.5) + '" y="' + hilt + '" width="7" height="' + (floor - hilt) + '" rx="2" fill="' + ink + '"/>' +
        '<ellipse cx="' + x + '" cy="' + hilt + '" rx="11" ry="3" fill="' + gold + '"/>' +
        '<path d="M' + (x - 5) + " " + (hilt - 2) + " Q" + (x - 2) + " " + ((hilt + tip) / 2) + " " + (x + 2) + " " + tip + " Q" + (x + 6) + " " + (tip + 30) + " " + (x + 5) + " " + (hilt - 2) +
        ' Z" fill="#fff" stroke="' + ink + '"/>' +
        '<line x1="' + (x + 16) + '" y1="' + tip + '" x2="' + (x + 16) + '" y2="' + floor + '" stroke="' + gold + '" stroke-dasharray="3 3"/>';
      s += '<text x="' + x + '" y="' + (floor + 22) + '" text-anchor="middle" font-size="13" fill="' + ink + '">' + esc(GD.tx("size.sword") || "Katana") + "</text>" +
        '<text x="' + x + '" y="' + (floor + 40) + '" text-anchor="middle" font-size="12" fill="' + soft + '">' + esc(GD.tx("pp.cm", { n: GD.num(SWORD_CM) }) || SWORD_CM + " cm") + "</text>";
    }
    // Dragon Slayer at its three heights (the chosen one, or the tallest, drawn solid)
    if (showDs) {
      var h = DS_HEIGHTS.indexOf(Number(chosen)) !== -1 ? Number(chosen) : DS_HEIGHTS[DS_HEIGHTS.length - 1];
      var X = dx, top2 = y(h), grip = y(40);
      s += '<rect x="' + (X - 4) + '" y="' + grip + '" width="8" height="' + (floor - grip) + '" rx="2" fill="' + ink + '"/>' +
        '<rect x="' + (X - 16) + '" y="' + (grip - 4) + '" width="32" height="5" fill="' + gold + '"/>' +
        '<path d="M' + (X - 13) + " " + (grip - 4) + " L" + (X - 13) + " " + (top2 + 8) + " L" + (X - 6) + " " + top2 + " L" + (X + 13) + " " + top2 + " L" + (X + 13) + " " + (grip - 4) +
        ' Z" fill="#fff" stroke="' + ink + '"/>';
      DS_HEIGHTS.forEach(function (v) {
        var on = v === h;
        s += '<line x1="' + (X + 20) + '" y1="' + y(v) + '" x2="' + (X + 30) + '" y2="' + y(v) + '" stroke="' + (on ? gold : soft) + '" stroke-width="' + (on ? 2 : 1) + '"/>' +
          '<text x="' + (X + 34) + '" y="' + (y(v) + 4) + '" font-size="11" fill="' + (on ? ink : soft) + '" font-weight="' + (on ? 600 : 400) + '" font-family="Montserrat, sans-serif">' + v + "</text>";
      });
      s += '<text x="' + X + '" y="' + (floor + 22) + '" text-anchor="middle" font-size="13" fill="' + ink + '">Dragon Slayer</text>' +
        '<text x="' + X + '" y="' + (floor + 40) + '" text-anchor="middle" font-size="12" fill="' + soft + '">' +
        esc(GD.tx("pp.cm", { n: DS_HEIGHTS.map(GD.num).join(" / ") }) || DS_HEIGHTS.join(" / ") + " cm") + "</text>";
    }
    return s + "</svg>";
  }
  // Small to-scale picture for the height choice: a 175 cm person next to Dragon Slayer at h cm.
  function heightMini(h) {
    var floor = 196, k = 0.95, y = function (cm) { return floor - cm * k; };
    var ink = "#1E0B2E", c = 34, top = y(PERSON_CM), hr = 7, n = top + 2 * hr;
    var X = 82, tip = y(h), grip = y(40);
    return '<svg class="ht-svg" viewBox="0 0 120 204" aria-hidden="true" focusable="false">' +
      '<line x1="6" y1="' + y(PERSON_CM) + '" x2="114" y2="' + y(PERSON_CM) + '" stroke="#5E5466" stroke-opacity=".35" stroke-dasharray="2 3"/>' +
      '<circle cx="' + c + '" cy="' + (top + hr) + '" r="' + hr + '" fill="#E6DFD2" stroke="' + ink + '"/>' +
      '<path fill="#E6DFD2" stroke="' + ink + '" stroke-linejoin="round" d="M' + (c - 4) + " " + n + " L" + (c + 4) + " " + n + " Q" + (c + 14) + " " + (n + 4) + " " + (c + 15) + " " + (n + 12) +
      " L" + (c + 17) + " " + (n + 72) + " L" + (c + 12) + " " + (n + 73) + " L" + (c + 10) + " " + (n + 26) + " L" + (c + 9) + " " + (n + 74) + " L" + (c + 8) + " " + floor +
      " L" + (c + 1) + " " + floor + " L" + c + " " + (n + 84) + " L" + (c - 1) + " " + floor + " L" + (c - 8) + " " + floor + " L" + (c - 9) + " " + (n + 74) +
      " L" + (c - 10) + " " + (n + 26) + " L" + (c - 12) + " " + (n + 73) + " L" + (c - 17) + " " + (n + 72) + " L" + (c - 15) + " " + (n + 12) +
      " Q" + (c - 14) + " " + (n + 4) + " " + (c - 4) + " " + n + ' Z"/>' +
      '<rect x="' + (X - 2.5) + '" y="' + grip + '" width="5" height="' + (floor - grip) + '" rx="1.5" fill="' + ink + '"/>' +
      '<rect x="' + (X - 10) + '" y="' + (grip - 3) + '" width="20" height="3.5" fill="#C9A44C"/>' +
      '<path d="M' + (X - 8) + " " + (grip - 3) + " L" + (X - 8) + " " + (tip + 5) + " L" + (X - 4) + " " + tip + " L" + (X + 8) + " " + tip + " L" + (X + 8) + " " + (grip - 3) +
      ' Z" fill="#fff" stroke="' + ink + '"/>' +
      '<line x1="4" y1="' + floor + '" x2="116" y2="' + floor + '" stroke="' + ink + '"/></svg>';
  }
  function esc(s) { return GD.esc(s); }

  GD.shop = {
    levelsOf: levelsOf, sizeDrawing: sizeDrawing, heightMini: heightMini, isDragonSlayer: isDragonSlayer, dsHeights: DS_HEIGHTS,
    slug: slug, pick: pick, products: products, find: find, url: url, tier: tier, addon: addon, displayName: displayName,
    photos: photos, payNow: payNow, hasVersions: hasVersions, basePrice: basePrice, readyDays: readyDays, readyDate: readyDate,
    plaqueUpgrade: plaqueUpgrade, linePrice: linePrice, deposit: deposit, addToCart: addToCart, cleanCart: cleanCart
  };
})();
