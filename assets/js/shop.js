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

  // Label under a figure: name wrapped to short lines (at commas or spaces), then the length, small enough not to touch its neighbours.
  function sizeLabel(x, y0, name, sub, ink, soft) {
    var words = String(name).replace(/([,،])\s*/g, "$1 ").split(" "), lines = [], cur = "";
    words.forEach(function (w) { var t = cur ? cur + " " + w : w; if (t.length > 13 && cur) { lines.push(cur); cur = w; } else cur = t; });
    if (cur) lines.push(cur);
    var out = "";
    lines.forEach(function (l, i) { out += '<text x="' + x + '" y="' + (y0 + i * 13) + '" text-anchor="middle" font-size="11" fill="' + ink + '">' + esc(l) + "</text>"; });
    return out + '<text x="' + x + '" y="' + (y0 + lines.length * 13 + 2) + '" text-anchor="middle" font-size="10" fill="' + soft + '">' + esc(sub) + "</text>";
  }

  // focus: "all" (Swords page), "sword" (a 120 cm piece) or "ds" (Dragon Slayer, with the chosen height if any)
  function sizeDrawing(focus, chosen) {
    var floor = 420, k = 2; // 2 px per cm
    var y = function (cm) { return floor - cm * k; };
    var ink = "#1E0B2E", soft = "#5E5466", gold = "#C9A44C";
    var showSword = focus !== "ds", showDs = focus !== "sword";
    var px = 80, sx = showDs ? 188 : 210, dx = showSword ? 292 : 210;
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
    s += sizeLabel(c, floor + 20, GD.tx("size.person") || "Average person", GD.tx("pp.cm", { n: GD.num(PERSON_CM) }) || PERSON_CM + " cm", ink, soft);
    // 120 cm sword, standing tip up
    if (showSword) {
      var x = sx, hilt = y(30), tip = y(SWORD_CM);
      s += '<rect x="' + (x - 3.5) + '" y="' + hilt + '" width="7" height="' + (floor - hilt) + '" rx="2" fill="' + ink + '"/>' +
        '<ellipse cx="' + x + '" cy="' + hilt + '" rx="11" ry="3" fill="' + gold + '"/>' +
        '<path d="M' + (x - 5) + " " + (hilt - 2) + " Q" + (x - 2) + " " + ((hilt + tip) / 2) + " " + (x + 2) + " " + tip + " Q" + (x + 6) + " " + (tip + 30) + " " + (x + 5) + " " + (hilt - 2) +
        ' Z" fill="#fff" stroke="' + ink + '"/>' +
        '<line x1="' + (x + 16) + '" y1="' + tip + '" x2="' + (x + 16) + '" y2="' + floor + '" stroke="' + gold + '" stroke-dasharray="3 3"/>';
      s += sizeLabel(x, floor + 20, GD.tx("size.sword") || "Katana", GD.tx("pp.cm", { n: GD.num(SWORD_CM) }) || SWORD_CM + " cm", ink, soft);
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
      s += sizeLabel(X, floor + 20, "Dragon Slayer", GD.tx("pp.cm", { n: DS_HEIGHTS.map(GD.num).join(" / ") }) || DS_HEIGHTS.join(" / ") + " cm", ink, soft);
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
  // ---------- Room scenes for display pieces (to scale, like the size drawing) ----------
  // The piece being sold is drawn in gold; the sword, furniture and a 175 cm person in ink, so it's clear what you get.
  var SC = { k: 1.5, floor: 384, ink: "#1E0B2E", soft: "#5E5466", gold: "#C9A44C", fill: "#E6DFD2" };
  function sy(cm) { return SC.floor - cm * SC.k; }
  function scPerson(c) {
    var f = SC.k / 2, top = sy(PERSON_CM), hr = 11 * f, n = top + 2 * hr, F = SC.floor;
    var o = function (v) { return v * f; };
    return '<circle cx="' + c + '" cy="' + (top + hr) + '" r="' + hr + '" fill="' + SC.fill + '" stroke="' + SC.ink + '"/>' +
      '<path fill="' + SC.fill + '" stroke="' + SC.ink + '" stroke-linejoin="round" d="M' + (c - o(6)) + " " + n + " L" + (c + o(6)) + " " + n + " L" + (c + o(6)) + " " + (n + o(6)) +
      " Q" + (c + o(24)) + " " + (n + o(8)) + " " + (c + o(26)) + " " + (n + o(20)) + " L" + (c + o(30)) + " " + (n + o(148)) + " L" + (c + o(22)) + " " + (n + o(150)) +
      " L" + (c + o(18)) + " " + (n + o(48)) + " L" + (c + o(16)) + " " + (n + o(150)) + " L" + (c + o(14)) + " " + F + " L" + (c + o(3)) + " " + F +
      " L" + (c + o(1)) + " " + (n + o(170)) + " L" + (c - o(1)) + " " + (n + o(170)) + " L" + (c - o(3)) + " " + F + " L" + (c - o(14)) + " " + F +
      " L" + (c - o(16)) + " " + (n + o(150)) + " L" + (c - o(18)) + " " + (n + o(48)) + " L" + (c - o(22)) + " " + (n + o(150)) + " L" + (c - o(30)) + " " + (n + o(148)) +
      " L" + (c - o(26)) + " " + (n + o(20)) + " Q" + (c - o(24)) + " " + (n + o(8)) + " " + (c - o(6)) + " " + (n + o(6)) + ' Z"/>';
  }
  // A 120 cm katana lying flat, centred on (cx, cy), handle on the left.
  function scKatanaH(cx, cy) {
    var L = SWORD_CM * SC.k, x0 = cx - L / 2, g = x0 + 30 * SC.k, tip = cx + L / 2;
    return '<rect x="' + x0 + '" y="' + (cy - 3) + '" width="' + (g - x0) + '" height="6" rx="2" fill="' + SC.ink + '"/>' +
      '<path d="M' + g + " " + (cy - 3) + " Q" + ((g + tip) / 2) + " " + (cy - 5) + " " + tip + " " + (cy - 9) + " Q" + (tip - 25) + " " + (cy + 1) + " " + g + " " + (cy + 3) +
      ' Z" fill="#fff" stroke="' + SC.ink + '"/>' +
      '<ellipse cx="' + g + '" cy="' + cy + '" rx="2.5" ry="8" fill="' + SC.ink + '"/>';
  }
  // A sword standing tip up, its bottom at (x, bottom): a 120 cm katana, or Dragon Slayer at 190 cm.
  function dsCm(h) { return DS_HEIGHTS.indexOf(Number(h)) !== -1 ? Number(h) : DS_HEIGHTS[DS_HEIGHTS.length - 1]; }
  function scSwordV(x, bottom, ds, h) {
    var k = SC.k, len = (ds ? dsCm(h) : SWORD_CM) * k, top = bottom - len, grip = bottom - (ds ? 40 : 30) * k;
    if (ds) return '<rect x="' + (x - 3) + '" y="' + grip + '" width="6" height="' + (bottom - grip) + '" rx="2" fill="' + SC.ink + '"/>' +
      '<rect x="' + (x - 12) + '" y="' + (grip - 3) + '" width="24" height="4" fill="' + SC.ink + '"/>' +
      '<path d="M' + (x - 10) + " " + (grip - 3) + " L" + (x - 10) + " " + (top + 6) + " L" + (x - 5) + " " + top + " L" + (x + 10) + " " + top + " L" + (x + 10) + " " + (grip - 3) +
      ' Z" fill="#fff" stroke="' + SC.ink + '"/>';
    return '<rect x="' + (x - 3) + '" y="' + grip + '" width="6" height="' + (bottom - grip) + '" rx="2" fill="' + SC.ink + '"/>' +
      '<ellipse cx="' + x + '" cy="' + grip + '" rx="8" ry="2.5" fill="' + SC.ink + '"/>' +
      '<path d="M' + (x - 3) + " " + grip + " Q" + (x - 5) + " " + ((grip + top) / 2) + " " + (x - 9) + " " + top + " Q" + (x + 1) + " " + (top + 25) + " " + (x + 3) + " " + grip +
      ' Z" fill="#fff" stroke="' + SC.ink + '"/>';
  }
  function scSofa(x0, x1) {
    var seat = sy(45), back = sy(85), arm = sy(62), F = SC.floor;
    return '<path d="M' + x0 + " " + F + " L" + x0 + " " + arm + " L" + (x0 + 14) + " " + arm + " L" + (x0 + 14) + " " + back + " L" + (x1 - 14) + " " + back + " L" + (x1 - 14) + " " + arm +
      " L" + x1 + " " + arm + " L" + x1 + " " + F + ' Z" fill="' + SC.fill + '" stroke="' + SC.ink + '" stroke-linejoin="round"/>' +
      '<line x1="' + (x0 + 14) + '" y1="' + seat + '" x2="' + (x1 - 14) + '" y2="' + seat + '" stroke="' + SC.ink + '"/>';
  }
  function sceneKind(name) {
    var n = String(name || "").toLowerCase(), m = n.match(/\((\d)\s*swords?\)/);
    if (/dragon slayer/.test(n) && /stand/.test(n)) return { kind: "ds" };
    if (/vertical/.test(n)) return { kind: "upright" };
    if (/desk|table/.test(n)) return { kind: "desk" };
    if (/oval/.test(n)) return { kind: "oval" };
    if (/plaque/.test(n)) return { kind: "plaque" };
    if (/mount|stand/.test(n)) return { kind: "wall", count: m ? Number(m[1]) : 1 };
    return null;
  }
  // ---------- Room illustrations: ROOMS (furniture) x PIECES (what is sold), drawn to scale ----------
  // To add a room: add an entry to ROOMS (its furniture for wall pieces, for a surface piece and for a floor piece),
  // add its id to ROOM_ORDER and add a "room.<id>" row (EN/AR) in the Text tab.
  // To add a display piece: teach sceneKind() its name and add a drawing to PIECES.
  // Brand colours only: purple ink, ivory tints, gold for the piece being sold.
  var ROOM_ORDER = ["living", "bedroom", "office"];
  var WALL_BG = "#F8F4EC", LIGHT = "#FBF8F2";
  function ln(x1, y1, x2, y2, w, op) {
    return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + SC.ink + '"' + (w ? ' stroke-width="' + w + '"' : "") + (op ? ' stroke-opacity="' + op + '"' : "") + "/>";
  }
  function bx(x, y, w, h, fill, extra) {
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + (fill || SC.fill) + '" stroke="' + SC.ink + '"' + (extra || "") + "/>";
  }
  function shade(x, topCm) { // lamp shade
    var t = sy(topCm);
    return '<path d="M' + (x - 13) + " " + (t + 22) + " L" + (x - 7) + " " + t + " L" + (x + 7) + " " + t + " L" + (x + 13) + " " + (t + 22) + ' Z" fill="' + SC.fill + '" stroke="' + SC.ink + '"/>';
  }
  function floorLamp(x) { return shade(x, 150) + ln(x, sy(150) + 22, x, SC.floor, 2) + ln(x - 12, SC.floor, x + 12, SC.floor, 3); }
  function windowFrame() { return bx(14, sy(205), 70, 60, LIGHT, ' stroke-opacity=".4"') + ln(49, sy(205), 49, sy(205) + 60, 0, ".4"); }

  var ROOMS = {
    living: {
      wall: function () { return scSofa(126, 330) + floorLamp(351); },
      surface: { top: 80, draw: function () { // sideboard
        var t = sy(80), F = SC.floor;
        return bx(122, t, 220, F - t - 8) + ln(195, t, 195, F - 8, 0, ".5") + ln(268, t, 268, F - 8, 0, ".5") + ln(130, F - 8, 130, F, 3) + ln(334, F - 8, 334, F, 3);
      } },
      floor: function () { return floorLamp(318); }
    },
    bedroom: {
      wall: function () { // bed seen from the front: headboard, mattress, two pillows
        var head = sy(110), mat = sy(55), F = SC.floor;
        return windowFrame() + bx(126, head, 204, F - head) + bx(120, mat, 216, F - mat - 10, LIGHT) +
          '<rect x="140" y="' + (mat - 14) + '" width="70" height="16" rx="8" fill="' + LIGHT + '" stroke="' + SC.ink + '"/>' +
          '<rect x="246" y="' + (mat - 14) + '" width="70" height="16" rx="8" fill="' + LIGHT + '" stroke="' + SC.ink + '"/>' +
          ln(124, F - 10, 124, F, 3) + ln(332, F - 10, 332, F, 3);
      },
      surface: { top: 85, draw: function () { // dresser with drawers
        var t = sy(85), F = SC.floor, h = F - t - 6;
        return windowFrame() + bx(130, t, 200, h) + ln(130, t + h / 3, 330, t + h / 3, 0, ".5") + ln(130, t + 2 * h / 3, 330, t + 2 * h / 3, 0, ".5");
      } },
      floor: function () { // nightstand with a lamp
        var t = sy(55);
        return windowFrame() + bx(296, t, 50, SC.floor - t) + shade(321, 85) + ln(321, sy(85) + 22, 321, t, 2);
      }
    },
    office: {
      wall: function () { // desk with a screen, and a chair
        var t = sy(75), F = SC.floor;
        return bx(126, t, 210, 6) + ln(136, t + 6, 136, F, 3) + ln(326, t + 6, 326, F, 3) +
          bx(262, sy(118), 58, 34, LIGHT) + ln(291, sy(118) + 34, 291, t, 3) +
          '<path d="M150 ' + sy(95) + " L190 " + sy(95) + " L186 " + sy(50) + " L154 " + sy(50) + ' Z" fill="' + SC.fill + '" stroke="' + SC.ink + '"/>' +
          ln(170, sy(50), 170, F - 4, 3) + ln(154, F - 2, 186, F - 2, 3);
      },
      surface: { top: 75, draw: function () { // desk with a desk lamp
        var t = sy(75), F = SC.floor;
        return bx(120, t, 216, 6) + ln(130, t + 6, 130, F, 3) + ln(326, t + 6, 326, F, 3) + shade(330, 120) + ln(330, sy(120) + 22, 330, t, 2);
      } },
      floor: function () { // bookshelf
        var t = sy(180), F = SC.floor, out = bx(286, t, 60, F - t);
        for (var i = 1; i < 4; i++) out += ln(286, t + i * (F - t) / 4, 346, t + i * (F - t) / 4);
        return out;
      }
    }
  };
  function roomId(room) { return ROOMS[room] ? room : "living"; }

  var PIECES = {
    // On the wall: n katanas on a gold rack, or one katana on a gold oval or shaped plaque.
    wall: function (s, cx) {
      var k = SC.k, g = SC.gold, ink = SC.ink, out = "", count = s.kind === "wall" ? s.count : 1, gap = 24, top = sy(150) - (count - 1) * gap / 2;
      if (s.kind === "oval") out += '<ellipse cx="' + cx + '" cy="' + sy(150) + '" rx="' + (70 * k) + '" ry="' + (26 * k) + '" fill="' + g + '" stroke="' + ink + '" stroke-opacity=".5"/>';
      if (s.kind === "plaque") out += '<path d="M' + (cx - 74 * k) + " " + sy(176) + " L" + (cx + 64 * k) + " " + sy(176) + " L" + (cx + 74 * k) + " " + sy(166) + " L" + (cx + 74 * k) + " " + sy(124) +
        " L" + (cx - 64 * k) + " " + sy(124) + " L" + (cx - 74 * k) + " " + sy(134) + ' Z" fill="' + g + '" stroke="' + ink + '" stroke-opacity=".5"/>';
      if (s.kind === "wall") {
        var t = top - 12, b = top + (count - 1) * gap + 14;
        [cx - 62, cx + 40].forEach(function (x) { out += '<rect x="' + x + '" y="' + t + '" width="9" height="' + (b - t) + '" rx="2" fill="' + g + '"/>'; });
      }
      for (var i = 0; i < count; i++) out += scKatanaH(cx, top + i * gap);
      if (s.kind === "wall") [cx - 62, cx + 40].forEach(function (x) {
        for (var j = 0; j < count; j++) out += '<rect x="' + (x - 1) + '" y="' + (top + j * gap + 3) + '" width="11" height="4" fill="' + g + '"/>';
      });
      return out;
    },
    // A katana lying on a gold desk stand, on the room's surface (desk, sideboard, dresser).
    desk: function (s, cx, topCm) {
      var top2 = sy(topCm), rest = top2 - 16, g = SC.gold, out = "";
      [cx - 58, cx + 42].forEach(function (x) {
        out += '<path d="M' + (x - 8) + " " + top2 + " L" + (x - 4) + " " + (rest - 4) + " L" + (x + 4) + " " + (rest - 4) + " L" + (x + 8) + " " + top2 + ' Z" fill="' + g + '"/>';
      });
      return out + '<rect x="' + (cx - 68) + '" y="' + (top2 - 3) + '" width="120" height="3" fill="' + g + '"/>' + scKatanaH(cx, rest - 6);
    },
    // A sword standing upside down on the floor: handle up, tip in a cup on the base, leaning on the post (Meyer, 6 Nov).
    upright: function (s, cx, h) {
      var k = SC.k, F = SC.floor, g = SC.gold, ds = s.kind === "ds", baseW = (ds ? 60 : 36) * k, baseH = 8 * k, rest = F - baseH;
      var len = (ds ? dsCm(h) : SWORD_CM) * k, lean = 6, tan = Math.tan(lean * Math.PI / 180);
      var px = cx - 14, postH = len * 0.62, postX = px + postH * tan + (ds ? 15 : 5);
      return '<rect x="' + (cx - baseW / 2 - 14) + '" y="' + rest + '" width="' + baseW + '" height="' + baseH + '" fill="' + g + '"/>' +
        '<path d="M' + (px - 7) + " " + rest + " L" + (px - 5) + " " + (rest - 7) + " L" + (px + 5) + " " + (rest - 7) + " L" + (px + 7) + " " + rest + ' Z" fill="' + g + '"/>' +
        '<rect x="' + postX + '" y="' + (rest - postH) + '" width="6" height="' + postH + '" fill="' + g + '"/>' +
        '<rect x="' + (postX - 4) + '" y="' + (rest - postH) + '" width="10" height="5" fill="' + g + '"/>' +
        '<g transform="rotate(' + lean + " " + px + " " + (rest - 4) + ") rotate(180 " + px + " " + (rest - 4 - len / 2) + ')">' + scSwordV(px, rest - 4, ds, h) + "</g>";
    }
  };

  // name: the add-on's name (e.g. "Mount / stand (3 swords)"); h: Dragon Slayer height (165/190); room: living | bedroom | office.
  function scene(name, h, room) {
    var s = sceneKind(name);
    if (!s) return "";
    var r = ROOMS[roomId(room)], cx = 228, body = '<rect x="0" y="0" width="360" height="' + SC.floor + '" fill="' + WALL_BG + '"/>';
    if (s.kind === "desk") body += r.surface.draw() + PIECES.desk(s, cx, r.surface.top);
    else if (s.kind === "upright" || s.kind === "ds") body += r.floor() + PIECES.upright(s, cx - 20, h);
    else body += r.wall() + PIECES.wall(s, cx);
    body += ln(0, SC.floor, 360, SC.floor, 1.2) + scPerson(52);
    return '<svg class="scene-svg" viewBox="0 0 360 400" role="img" aria-label="' + esc(GD.tx("scene.alt") || "Drawing of the piece in a room, to scale, next to a 175 cm person") + '">' + body + "</svg>";
  }

  // Room tabs (Living room / Bedroom / Office) above the illustration, with a small "Illustration" caption.
  // getHeight: optional function giving the Dragon Slayer height to draw. The last room picked is remembered on the page.
  var lastRoom = "living";
  function roomViewer(el, name, getHeight) {
    if (!el) return;
    if (!sceneKind(name)) { el.innerHTML = ""; return; }
    var room = lastRoom;
    function draw() {
      el.innerHTML = '<div class="room-tabs" role="tablist">' + ROOM_ORDER.map(function (id) {
        return '<button type="button" role="tab" class="room-tab" data-room="' + id + '" aria-selected="' + (id === room) + '">' + esc(GD.tx("room." + id) || id) + "</button>";
      }).join("") + '</div><div class="room-pic" role="tabpanel">' + scene(name, getHeight ? getHeight() : "", room) + "</div>" +
        '<p class="room-cap">' + esc(GD.tx("room.caption") || "Illustration") + "</p>";
    }
    el.onclick = function (e) {
      var b = e.target.closest && e.target.closest("[data-room]");
      if (!b) return;
      e.preventDefault();
      room = lastRoom = b.getAttribute("data-room");
      draw();
      var t = el.querySelector('[data-room="' + room + '"]');
      if (t) t.focus({ preventScroll: true });
    };
    el.refresh = draw;
    draw();
  }

  function esc(s) { return GD.esc(s); }

  GD.shop = {
    levelsOf: levelsOf, sizeDrawing: sizeDrawing, heightMini: heightMini, scene: scene, roomViewer: roomViewer, sceneKind: sceneKind, isDragonSlayer: isDragonSlayer, dsHeights: DS_HEIGHTS,
    slug: slug, pick: pick, products: products, find: find, url: url, tier: tier, addon: addon, displayName: displayName,
    photos: photos, payNow: payNow, hasVersions: hasVersions, basePrice: basePrice, readyDays: readyDays, readyDate: readyDate,
    plaqueUpgrade: plaqueUpgrade, linePrice: linePrice, deposit: deposit, addToCart: addToCart, cleanCart: cleanCart
  };
})();
