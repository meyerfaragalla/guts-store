/**
 * Guts Decor — order system.
 * Lives inside the "Guts Decor — Website Content" sheet (Extensions → Apps Script).
 *
 * What it does:
 *  - Hands the website ONLY the public parts of Website Content (never InstaPay details, costs or customers).
 *  - Receives order requests, re-checks everything and recalculates the price itself.
 *  - Saves orders to the separate private sheet "Guts Decor — Orders".
 *  - Saves payment screenshots to a private Drive folder.
 *  - Emails Meyer about new orders, and customers when their order status changes.
 *
 * No passwords or secrets live in this file. Private details are read from the sheets at run time.
 */

var SITE_URL = 'https://gutsdecor.com/';
var ORDERS_NAME = 'Guts Decor — Orders';
var RECEIPTS_FOLDER_NAME = 'Guts Decor — Payment receipts';
var CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L, to avoid mix-ups
var MAX_ORDERS_PER_DAY = 3;
var MAX_UPLOADS_PER_ORDER = 5;
var MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
var CONTENT_CACHE_SECONDS = 60;

// "Started (waiting for DM)": the order form was sent, the customer still has to send it on Instagram (Nov 2026).
// The admin page offers the short list ADMIN_STATUSES; the older ones stay valid for old rows.
var STATUSES = ['Started (waiting for DM)', 'New', 'Waitlist', 'Deposit uploaded', 'Deposit screenshot missing', 'Confirmed', 'Deposit paid',
  'In progress', 'Photos sent', 'Balance due', 'Balance paid', 'Paid in full', 'Shipped', 'Delivered', 'Cancelled'];
var ADMIN_STATUSES = ['Started (waiting for DM)', 'Deposit paid', 'Photos sent', 'Paid in full', 'Shipped', 'Delivered', 'Cancelled'];
var STARTED = 'Started (waiting for DM)';
// Extra columns for shop orders (added to the Orders sheet automatically if missing).
var SHOP_COLUMNS = ['Type', 'Items', 'Instagram', 'Items total', 'Shipping estimate', 'Reminder', 'Source link', 'Delivered on', 'Review asked'];
var ORDER_COLUMNS = [
  'Order code', 'Received', 'Status', 'Name', 'Email', 'Phone', 'Governorate', 'Area', 'Street', 'Building', 'Floor',
  'Apartment', 'Landmark', 'Gift', 'Recipient', 'Occasion date', 'Tier', 'Premium gift', 'Design', 'Add-ons',
  'Engraving', 'Notes', 'Friend code', 'Found us via', 'Language', 'Estimated total', 'Final price (you fill)',
  'Deposit', 'Deposit confirmed on', 'Balance', 'Payment receipts', 'Emails sent', 'Progress notes'
];
var GOVERNORATES = ['Cairo', 'Giza', 'Alexandria', 'Qalyubia', 'Sharqia', 'Dakahlia', 'Gharbia', 'Monufia', 'Beheira',
  'Kafr El Sheikh', 'Damietta', 'Port Said', 'Ismailia', 'Suez', 'Faiyum', 'Beni Suef', 'Minya', 'Asyut', 'Sohag', 'Qena',
  'Luxor', 'Aswan', 'Red Sea', 'New Valley', 'Matrouh', 'North Sinai', 'South Sinai'];
var FOUND_VIA = ['Instagram', 'A friend', 'The quiz', 'Google', 'Other'];
// Answers to "How did you find me?" on the shop checkout (Kennedy: know which marketing brings orders).
var FOUND_SHOP = ['Instagram Reel', 'Instagram Story', 'Instagram post', 'Instagram ad', 'TikTok', 'Google', 'A friend', 'Other'];
var PREMIUM_GIFTS = ['Desk stand', 'Wall mount'];
var IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' };

// =====================================================================
// One-time setup: run this once from the editor (select "setup", press Run).
// =====================================================================
function setup() {
  var props = PropertiesService.getScriptProperties();

  var ordersId = props.getProperty('ORDERS_ID');
  var orders;
  if (ordersId) {
    orders = SpreadsheetApp.openById(ordersId);
  } else {
    orders = SpreadsheetApp.create(ORDERS_NAME);
    props.setProperty('ORDERS_ID', orders.getId());
  }
  var sh = orders.getSheets()[0];
  sh.setName('Orders');
  sh.getRange(1, 1, 1, ORDER_COLUMNS.length).setValues([ORDER_COLUMNS]).setFontWeight('bold');
  sh.setFrozenRows(1);
  var statusCol = ORDER_COLUMNS.indexOf('Status') + 1;
  sh.getRange(2, statusCol, sh.getMaxRows() - 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(false).build());
  sh.getRange(2, ORDER_COLUMNS.indexOf('Final price (you fill)') + 1, sh.getMaxRows() - 1, 1).setBackground('#FFF4D6');

  if (!props.getProperty('RECEIPTS_FOLDER_ID')) {
    var folder = DriveApp.createFolder(RECEIPTS_FOLDER_NAME);
    props.setProperty('RECEIPTS_FOLDER_ID', folder.getId());
  }

  ensureGalleryTab_();

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onOrdersEdit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onOrdersEdit').forSpreadsheet(orders).onEdit().create();

  Logger.log('Done. Orders sheet: ' + orders.getUrl());
}

function ensureGalleryTab_() {
  var ss = SpreadsheetApp.getActive();
  if (ss.getSheetByName('Gallery')) return;
  var g = ss.insertSheet('Gallery');
  g.getRange(1, 1, 1, 7).setValues([['Photo (Drive link)', 'Title (EN)', 'Title (AR)', 'Category', 'Inspired by', 'Ready in 4 days', 'Show on site']])
    .setFontWeight('bold');
  g.setFrozenRows(1);
  g.getRange(2, 4, 999, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['Swords', 'Mounts & stands', 'Plaques', 'Pedestals', 'Bookshelf', 'Review'], true).build());
  g.getRange(2, 6, 999, 2).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Yes', 'No'], true).build());
}

// =====================================================================
// Web entry points
// =====================================================================
function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.action === 'content') return json_(publicContent_());
    if (p.action === 'order') return json_(lookupOrder_(String(p.code || '')));
    if (p.action === 'instapay') return json_(instapayDetails_());
    return json_({ ok: false, error: 'unknown-action' });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'server' });
  }
}

function doPost(e) {
  var d;
  try {
    d = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'invalid' });
  }
  try {
    if (d.action === 'order') return json_(handleOrder_(d));
    if (d.action === 'upload') return json_(handleUpload_(d));
    if (d.action === 'track') return json_(handleTrack_(d));
    if (d.action === 'checkout') return json_(handleCheckout_(d));
    if (d.action === 'cartsave') return json_(handleCartSave_(d));
    if (String(d.action || '').indexOf('admin') === 0) return json_(handleAdmin_(d));
    return json_({ ok: false, error: 'unknown-action' });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'server' });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// =====================================================================
// Reading Website Content
// =====================================================================
function readTable_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) return [];
  var values = sh.getDataRange().getDisplayValues();
  var head = values.shift().map(function (h) { return String(h).trim(); });
  return values
    .filter(function (r) { return r.join('').trim() !== ''; })
    .map(function (r) {
      var o = {};
      head.forEach(function (h, i) { o[h] = String(r[i] == null ? '' : r[i]).trim(); });
      return o;
    });
}

function settings_() {
  var sh = SpreadsheetApp.getActive().getSheetByName('Settings');
  var s = {};
  sh.getDataRange().getDisplayValues().slice(1).forEach(function (r) {
    if (r[0]) s[String(r[0]).trim()] = String(r[1] || '').trim();
  });
  return s;
}

function toNum_(v) {
  var m = String(v).replace(/,/g, '').match(/^\s*(\d+(?:\.\d+)?)\s*(?:LE)?\s*$/i);
  return m ? Number(m[1]) : null;
}

function firstNum_(v, fallback) {
  var m = String(v).replace(/,/g, '').match(/\d+/);
  return m ? Number(m[0]) : fallback;
}

// Reads a column whose header starts with the given words (headers can carry notes, like "Classic price (LE) - empty = ...").
function columnStarting_(row, start) {
  var key = Object.keys(row).filter(function (k) { return k.indexOf(start) === 0; })[0];
  return key ? row[key] : '';
}

function isYes_(v) { return /^yes$/i.test(String(v).trim()); }

function filled_(v) { return v && !/^to fill$/i.test(String(v).trim()); }

function catalog_() {
  var s = settings_();
  var tiers = readTable_('Tiers').filter(function (r) { return isYes_(r['Show on site']) && r['Tier']; }).map(function (r) {
    return {
      name: r['Tier'], price: toNum_(r['Price (LE)']), badge: r['Badge'], badgeAr: r['Badge (AR)'],
      descEn: r["What's included (EN)"], descAr: r["What's included (AR)"], display: r['Price display'],
      payNow: isYes_(r['Pay now']), forEn: r["Who it's for (EN)"], forAr: r["Who it's for (AR)"], photo: r['Photo (Drive link)'],
      matchingMount: columnStarting_(r, 'Matching mount'),
      features: [1, 2, 3].map(function (n) { return { en: r['Feature ' + n + ' (EN)'], ar: r['Feature ' + n + ' (AR)'] }; })
        .filter(function (f) { return f.en || f.ar; })
    };
  });
  var designs = readTable_('Ready Designs').filter(function (r) { return isYes_(r['Show on site']) && r['Design']; }).map(function (r) {
    return {
      name: r['Design'], inspiredBy: r['Character / series'], readyDays: toNum_(r['Ready in (days)']), photo: r['Photo (Drive link)'],
      payNow: isYes_(r['Pay now']), price: toNum_(r['Price (LE)']), sizes: filled_(r['Sizes']) ? r['Sizes'] : '',
      benefitEn: r['Benefit line (EN)'], benefitAr: r['Benefit line (AR)'], badge: r['Badge (EN)'], badgeAr: r['Badge (AR)'],
      shippingIncluded: isYes_(r['Shipping included']),
      // Column O: a Classic price means the design comes in Classic and Premium; empty means Premium only.
      classicPrice: toNum_(columnStarting_(r, 'Classic price')),
      // Column P: Yes = also shown in the Home page grid. Column Q: real value of the parts, shown crossed out (sets only).
      showOnHome: isYes_(columnStarting_(r, 'Show on Home')),
      wasPrice: toNum_(columnStarting_(r, 'Crossed-out price')),
      matchingMount: columnStarting_(r, 'Matching mount'),
      askHeight: isYes_(columnStarting_(r, 'Ask height')),
      // Column T: which level page shows it (Classic / Premium / Collector's).
      level: columnStarting_(r, 'Level')
    };
  });
  var addons = readTable_('Add-ons').filter(function (r) { return isYes_(r['Show on site']) && r['Add-on']; }).map(function (r) {
    return {
      name: r['Add-on'], nameAr: r['Name (AR)'], price: toNum_(r['Price (LE)']), priceText: r['Price (LE)'], photo: r['Photo (Drive link)'],
      benefitEn: r['Benefit line (EN)'], benefitAr: r['Benefit line (AR)'], bonusEn: r['Bonus / note'], bonusAr: r['Bonus / note (AR)']
    };
  });
  // Shipping estimate per governorate (tab "Shipping areas"). Empty tab = the two old Settings rows.
  var areas = {};
  readTable_('Shipping areas').forEach(function (r) {
    var n = toNum_(r['Estimate (LE)']);
    if (r['Governorate'] && n !== null) areas[r['Governorate']] = n;
  });
  return {
    s: s, tiers: tiers, designs: designs, addons: addons, areas: areas,
    depositPct: firstNum_(s['Deposit %'], 50),
    shipping: firstNum_(s['Shipping (LE)'], 200),
    shippingOutsideMin: firstNum_(s['Shipping outside Cairo & Giza'], 300)
  };
}

function shippingFor_(c, gov) {
  if (typeof c.areas[gov] === 'number') return c.areas[gov];
  return gov === 'Cairo' || gov === 'Giza' ? c.shipping : c.shippingOutsideMin;
}

// What the website shows. Once Meyer has pressed Publish on the admin page, this is the published copy
// (saved in Drive), so changes in the sheet stay a draft until the next Publish. Before the first Publish,
// it is read straight from the sheet, as before.
function publicContent_() {
  var hit = cacheGetBig_('content');
  if (hit) return JSON.parse(hit);
  var out = readPublished_() || buildContent_();
  var spotsPerMonth = firstNum_(settings_()['Spots per month'], 0);
  out.settings.spotsLeft = spotsPerMonth ? Math.max(0, spotsPerMonth - confirmedThisMonth_()) : null;
  cachePutBig_('content', JSON.stringify(out), CONTENT_CACHE_SECONDS);
  return out;
}

function clearContentCache_() { cacheRemoveBig_('content'); }

// Google's cache holds at most 100 KB per entry, so bigger texts are split into pieces.
function cachePutBig_(key, str, seconds) {
  try {
    var parts = {}, n = 0;
    for (var i = 0; i < str.length; i += 30000) parts[key + '_' + (n++)] = str.slice(i, i + 30000); // Arabic letters take up to 3 bytes
    parts[key + '_n'] = String(n);
    CacheService.getScriptCache().putAll(parts, seconds);
  } catch (err) { /* caching is only a speed-up */ }
}
function cacheGetBig_(key) {
  var cache = CacheService.getScriptCache();
  var n = Number(cache.get(key + '_n'));
  if (!n) return null;
  var keys = [];
  for (var i = 0; i < n; i++) keys.push(key + '_' + i);
  var got = cache.getAll(keys), out = '';
  for (var j = 0; j < n; j++) { if (got[keys[j]] == null) return null; out += got[keys[j]]; }
  return out;
}
function cacheRemoveBig_(key) {
  var cache = CacheService.getScriptCache();
  var keys = [key, key + '_n'];
  for (var i = 0; i < 80; i++) keys.push(key + '_' + i);
  cache.removeAll(keys);
}

// Everything the website needs, read fresh from the sheet (the draft). Only safe, public fields.
function buildContent_() {
  var c = catalog_();
  var s = c.s;
  var cats = String(s['Show gallery categories'] || '').split(',').map(function (x) { return x.trim().toLowerCase(); }).filter(String);
  var rows = readTable_('Gallery').filter(function (r) { return isYes_(r['Show on site']) && r['Photo (Drive link)']; });
  var gallery = rows.filter(function (r) { return cats.indexOf(String(r['Category']).toLowerCase()) !== -1; }).map(function (r) {
    return { photo: r['Photo (Drive link)'], titleEn: r['Title (EN)'], titleAr: r['Title (AR)'], category: r['Category'],
      inspiredBy: r['Inspired by'], ready: isYes_(r['Ready in 4 days']), captionEn: r['Caption (EN)'], captionAr: r['Caption (AR)'] };
  });
  var reviews = rows.filter(function (r) { return /^review$/i.test(r['Category']); }).map(function (r) {
    return { photo: r['Photo (Drive link)'], altEn: r['Title (EN)'], altAr: r['Title (AR)'], product: columnStarting_(r, 'Product') };
  });
  // Every customer-facing word, in English and Arabic, from the Text tab.
  var text = {};
  readTable_('Text').forEach(function (r) {
    var key = r["Key (don't change)"];
    if (key) text[key] = { en: r['English'], ar: r['Arabic'] };
  });

  var VIDEO_SPOTS = { 'home background loop': 'hero', "hi, i'm meyer": 'meet', 'payment explainer': 'payment', 'thank you': 'thanks',
    'hands wrapping a handle': 'hands', 'reviews reel': 'reviews' };
  var videos = {};
  readTable_('Videos').forEach(function (r) {
    var spot = String(r['Spot']).trim().toLowerCase();
    if (!spot) return;
    // Known spots keep their short names; any new row is passed on too, named from its Spot text ("Card: It's a gift" -> "card-its-a-gift").
    var key = VIDEO_SPOTS[spot] || spot.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    videos[key] = {
      video: r['Video link'], photo: r['Photo link (shown if no video)'], tall: /^tall$/i.test(r['Shape (Wide / Tall)']),
      captionsEn: r['Captions EN (file)'], captionsAr: r['Captions AR (file)']
    };
  });

  // Only safe, public fields. InstaPay details are never included here.
  var out = {
    ok: true,
    settings: {
      proofLine: s['Proof line'] || '',
      proofLineAr: s['Proof line (AR)'] || '',
      replyPromise: s['Reply promise'] || '',
      replyPromiseAr: s['Reply promise (AR)'] || '',
      depositPct: c.depositPct,
      shipping: c.shipping,
      shippingOutsideMin: c.shippingOutsideMin,
      deliveryDays: firstNum_(s['Standard delivery (days)'], 14),
      // The business email, reversed and encoded, so it is never readable as plain text in this public data.
      contactEmailEnc: Utilities.base64Encode((contactEmail_(s) || s['Order email'] || '').split('').reverse().join('')),
      instagram: String(s['Instagram handle'] || '').replace(/^@/, '').trim(),
      whatsapp: String(s['WhatsApp number'] || '').replace(/[^\d]/g, ''),
      // Empty switch = on (as before this switch existed); "No" hides the WhatsApp button even with a number.
      whatsappOn: !/^no$/i.test(String(s['WhatsApp button on'] || '').trim()),
      builderOn: isYes_(s['3D builder on']),
      builderUrl: String(s['3D builder link'] || '').trim(),
      searchConsole: String(s['Search Console code'] || '').replace(/[^A-Za-z0-9_\-]/g, ''),
      express: isYes_(s['Express delivery on']),
      daysToMake: firstNum_(s['Days to make'], 14),
      plaqueUpgrade: firstNum_(s["Collector's plaque upgrade (LE)"], 1200),
      spotsPerMonth: firstNum_(s['Spots per month'], 0),
      spotsLeft: null
    },
    shippingAreas: c.areas,
    sections: readTable_('Sections').filter(function (r) { return r['Page'] && r['Section']; }).map(function (r) {
      return { page: r['Page'], id: r['Section'], show: !/^no$/i.test(r['Show (Yes/No)']), order: toNum_(r['Order']) };
    }),
    text: text,
    tiers: c.tiers,
    designs: c.designs,
    addons: c.addons.map(function (a) {
      return { name: a.name, nameAr: a.nameAr, price: a.price, priceText: a.priceText, photo: a.photo,
        benefitEn: a.benefitEn, benefitAr: a.benefitAr, bonusEn: a.bonusEn, bonusAr: a.bonusAr };
    }),
    gallery: gallery,
    reviews: reviews,
    videos: videos
  };
  return out;
}

// =====================================================================
// Orders sheet helpers
// =====================================================================
function ordersSheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('ORDERS_ID');
  if (!id) throw new Error('Run setup() first.');
  return SpreadsheetApp.openById(id).getSheetByName('Orders');
}

function colMap_(sh) {
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var m = {};
  head.forEach(function (h, i) { m[String(h).trim()] = i; });
  return m;
}

// Counts only — never reads names or details.
function confirmedThisMonth_() {
  var sh = ordersSheet_();
  if (sh.getLastRow() < 2) return 0;
  var col = colMap_(sh)['Deposit confirmed on'] + 1;
  var tz = Session.getScriptTimeZone();
  var now = Utilities.formatDate(new Date(), tz, 'yyyy-MM');
  return sh.getRange(2, col, sh.getLastRow() - 1, 1).getValues().filter(function (r) {
    return r[0] instanceof Date && Utilities.formatDate(r[0], tz, 'yyyy-MM') === now;
  }).length;
}

function findOrderRow_(sh, code) {
  if (sh.getLastRow() < 2) return -1;
  var codes = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < codes.length; i++) if (codes[i][0] === code) return i + 2;
  return -1;
}

function newCode_(sh) {
  var existing = {};
  if (sh.getLastRow() >= 2) sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { existing[r[0]] = true; });
  for (var tries = 0; tries < 50; tries++) {
    var code = randomCode_();
    if (!existing[code]) return code;
  }
  throw new Error('Could not make a unique code');
}

function randomCode_() {
  var c = 'GD-';
  for (var i = 0; i < 4; i++) c += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
  return c;
}

// Stops spreadsheet formulas from being smuggled in through the form.
function clean_(v, max) {
  var s = String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max || 200);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// =====================================================================
// New order
// =====================================================================
function handleOrder_(d) {
  // Spam trap: real people never fill "website". Pretend it worked so bots learn nothing.
  if (d.website) return { ok: true, code: randomCode_() };
  if (!(Number(d.elapsed) > 3000)) return { ok: false, error: 'invalid' };

  var c = catalog_();
  var tier = c.tiers.filter(function (t) { return t.name === d.tier; })[0];
  var email = String(d.email || '').trim().toLowerCase();
  var phoneDigits = String(d.phone || '').replace(/[\s\-()]/g, '');
  var addonNames = Array.isArray(d.addons) ? d.addons.map(String) : [];
  var addons = c.addons.filter(function (a) { return typeof a.price === 'number' && addonNames.indexOf(a.name) !== -1; });

  var checks = [
    !!tier,
    tier && tier.name === 'Premium' ? PREMIUM_GIFTS.indexOf(d.premiumGift) !== -1 : !d.premiumGift,
    !d.design || c.designs.some(function (x) { return x.name === d.design; }),
    addons.length === addonNames.length && addonNames.length <= 10,
    String(d.engraving || '').length <= 40,
    String(d.notes || '').length <= 500,
    d.isGift ? String(d.recipient || '').trim().length >= 2 && String(d.recipient).length <= 80 : true,
    !d.occasionDate || /^\d{4}-\d{2}-\d{2}$/.test(d.occasionDate),
    String(d.name || '').trim().length >= 2 && String(d.name).length <= 80,
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 120,
    email === String(d.email2 || '').trim().toLowerCase(),
    /^\+?\d{10,15}$/.test(phoneDigits),
    GOVERNORATES.indexOf(d.governorate) !== -1,
    ['area', 'street', 'building', 'floor', 'apartment'].every(function (k) { return String(d[k] || '').trim() && String(d[k]).length <= 120; }),
    String(d.landmark || '').length <= 120,
    /^[A-Za-z0-9\-]{0,20}$/.test(String(d.friendCode || '')),
    !d.foundVia || FOUND_VIA.indexOf(d.foundVia) !== -1,
    d.terms === true
  ];
  if (checks.indexOf(false) !== -1) return { ok: false, error: 'invalid' };

  // The price is always worked out here from the sheet, never taken from the browser.
  var inCairoGiza = d.governorate === 'Cairo' || d.governorate === 'Giza';
  var shipping = shippingFor_(c, d.governorate);
  var addonsTotal = addons.reduce(function (sum, a) { return sum + a.price; }, 0);
  var estimate = tier.price ? tier.price + addonsTotal + shipping : '';

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = ordersSheet_();
    var m = colMap_(sh);

    // Max 3 orders per email or phone per day.
    if (sh.getLastRow() >= 2) {
      var data = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
      var since = Date.now() - 24 * 3600 * 1000;
      var recent = data.filter(function (r) {
        var when = r[m['Received']];
        if (!(when instanceof Date) || when.getTime() < since) return false;
        return String(r[m['Email']]).toLowerCase() === email ||
          String(r[m['Phone']]).replace(/[^\d+]/g, '') === phoneDigits;
      });
      if (recent.length >= MAX_ORDERS_PER_DAY) return { ok: false, error: 'limit' };
    }

    var spotsPerMonth = firstNum_(c.s['Spots per month'], 0);
    var full = spotsPerMonth && confirmedThisMonth_() >= spotsPerMonth;
    var code = newCode_(sh);
    var row = {
      'Order code': code,
      'Received': new Date(),
      'Status': full ? 'Waitlist' : STARTED,
      'Name': clean_(d.name, 80),
      'Email': clean_(email, 120),
      'Phone': "'" + phoneDigits,
      'Governorate': d.governorate,
      'Area': clean_(d.area, 120),
      'Street': clean_(d.street, 120),
      'Building': clean_(d.building, 30),
      'Floor': clean_(d.floor, 20),
      'Apartment': clean_(d.apartment, 20),
      'Landmark': clean_(d.landmark, 120),
      'Gift': d.isGift ? 'Yes' : 'No',
      'Recipient': d.isGift ? clean_(d.recipient, 80) : '',
      'Occasion date': d.occasionDate || '',
      'Tier': tier.name,
      'Premium gift': tier.name === 'Premium' ? d.premiumGift : '',
      'Design': d.design || 'Custom',
      'Add-ons': addons.map(function (a) { return a.name; }).join(', '),
      'Engraving': clean_(d.engraving, 40),
      'Notes': clean_(d.notes, 500),
      'Friend code': clean_(String(d.friendCode || '').toUpperCase(), 20),
      'Found us via': d.foundVia || '',
      'Language': d.lang === 'ar' ? 'ar' : 'en',
      'Estimated total': estimate
    };
    var values = new Array(sh.getLastColumn());
    Object.keys(m).forEach(function (h) { values[m[h]] = row.hasOwnProperty(h) ? row[h] : ''; });
    sh.appendRow(values);
  } finally {
    lock.releaseLock();
  }

  var message = orderMessage_(row['Language'], code, {
    name: row['Name'], phone: phoneDigits, city: d.governorate + ', ' + row['Area'],
    gift: d.isGift ? row['Recipient'] + (row['Occasion date'] ? ' (' + row['Occasion date'] + ')' : '') : '',
    lines: [{ qty: 1, name: row['Design'], total: tier.price || 0, details: [['dm.order.level', tier.name]]
      .concat(row['Premium gift'] ? [['dm.order.mount', row['Premium gift']]] : [])
      .concat(addons.map(function (a) { return ['', '+ ' + a.name]; }))
      .concat(row['Engraving'] ? [['dm.order.blade', row['Engraving']]] : []) }],
    total: estimate ? tier.price + addonsTotal : '', shipping: shipping,
    deposit: estimate ? Math.round((tier.price + addonsTotal) * c.depositPct / 100) : 0, notes: row['Notes']
  });
  countEvent_('order:sent');
  notifyMeyerNewOrder_(c.s, row, inCairoGiza);
  sendCustomer_(c.s, row['Email'].replace(/^'/, ''), row['Language'], 'received', {
    code: code, tier: tier.name, design: row['Design'], estimate: estimate, outside: !inCairoGiza, waitlist: full, message: message
  });
  return { ok: true, code: code, message: message };
}

// =====================================================================
// Payment page
// =====================================================================
function lookupOrder_(code) {
  code = code.trim().toUpperCase();
  if (!/^GD-[A-Z0-9]{4}$/.test(code)) return { ok: false, error: 'not-found' };
  var sh = ordersSheet_();
  var r = findOrderRow_(sh, code);
  if (r < 0) return { ok: false, error: 'not-found' };
  var m = colMap_(sh);
  var row = sh.getRange(r, 1, 1, sh.getLastColumn()).getValues()[0];
  var status = row[m['Status']];
  var amount = null;
  if (status === 'Confirmed' || status === 'Deposit screenshot missing') amount = Number(row[m['Deposit']]) || null;
  if (status === 'Balance due') amount = Number(row[m['Balance']]) || null;
  var s = settings_();
  // Only the code and the amount. Never a name, address or phone.
  return {
    ok: true,
    code: code,
    amount: amount,
    waiting: status === 'New' || status === 'Waitlist',
    instapayName: amount && filled_(s['InstaPay name to check']) ? s['InstaPay name to check'] : ''
  };
}

function handleUpload_(d) {
  var code = String(d.code || '').trim().toUpperCase();
  var ext = IMAGE_TYPES[d.mime];
  if (!/^GD-[A-Z0-9]{4}$/.test(code) || !ext || typeof d.data !== 'string') return { ok: false, error: 'invalid' };
  if (d.data.length > Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 + 8) return { ok: false, error: 'invalid' };

  var bytes = Utilities.base64Decode(d.data);
  if (bytes.length === 0 || bytes.length > MAX_UPLOAD_BYTES || !looksLikeImage_(bytes, d.mime)) return { ok: false, error: 'invalid' };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var sh, r, m, link;
  try {
    sh = ordersSheet_();
    r = findOrderRow_(sh, code);
    if (r < 0) return { ok: false, error: 'not-found' };
    m = colMap_(sh);
    var statusCell = sh.getRange(r, m['Status'] + 1);
    var status = statusCell.getValue();
    if (status !== 'Confirmed' && status !== 'Balance due' && status !== 'Deposit screenshot missing') return { ok: false, error: 'invalid' };
    if (status === 'Deposit screenshot missing') statusCell.setValue('Deposit uploaded');
    var cell = sh.getRange(r, m['Payment receipts'] + 1);
    var existing = String(cell.getValue() || '').split('\n').filter(String);
    if (existing.length >= MAX_UPLOADS_PER_ORDER) return { ok: false, error: 'limit' };

    var folder = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('RECEIPTS_FOLDER_ID'));
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HHmm');
    var file = folder.createFile(Utilities.newBlob(bytes, d.mime, code + '_' + stamp + '.' + ext));
    link = file.getUrl();
    existing.push(link);
    cell.setValue(existing.join('\n'));
  } finally {
    lock.releaseLock();
  }

  countEvent_('deposit:uploaded');
  var s = settings_();
  ownerMail_(s, 'Payment screenshot uploaded: ' + code,
    'A payment screenshot was uploaded for ' + code + '.\n\nCheck it in your InstaPay app before changing the status.\n\n' +
      'Screenshot: ' + link + '\nOrders sheet: ' + sh.getParent().getUrl());
  return { ok: true };
}

function looksLikeImage_(b, mime) {
  function at(i) { return (b[i] + 256) % 256; }
  if (mime === 'image/jpeg') return at(0) === 0xFF && at(1) === 0xD8 && at(2) === 0xFF;
  if (mime === 'image/png') return at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4E && at(3) === 0x47;
  if (mime === 'image/webp') return at(0) === 0x52 && at(1) === 0x49 && at(8) === 0x57 && at(9) === 0x45;
  // HEIC/HEIF: "ftyp" at byte 4
  return at(4) === 0x66 && at(5) === 0x74 && at(6) === 0x79 && at(7) === 0x70;
}

// =====================================================================
// When Meyer changes an order's Status in the Orders sheet
// =====================================================================
function onOrdersEdit(e) {
  var sh = e.range.getSheet();
  if (sh.getName() !== 'Orders' || e.range.getRow() < 2) return;
  var m = colMap_(sh);
  if (e.range.getColumn() !== m['Status'] + 1 || e.range.getNumRows() !== 1) return;
  applyStatus_(sh, e.range.getRow());
}

// What happens when an order's Status changes (in the sheet, or on the admin page's Orders tab).
function applyStatus_(sh, r) {
  var m = colMap_(sh);
  var row = sh.getRange(r, 1, 1, sh.getLastColumn()).getValues()[0];
  var status = row[m['Status']];
  var s = settings_();
  var pct = firstNum_(s['Deposit %'], 50);
  var price = Number(row[m['Final price (you fill)']]) || Number(row[m['Estimated total']]) || 0;
  var info = { code: row[m['Order code']], lang: row[m['Language']] || 'en' };
  var to = String(row[m['Email']]).replace(/^'/, '');

  function logEmail(what) {
    var cell = sh.getRange(r, m['Emails sent'] + 1);
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    cell.setValue([cell.getValue(), stamp + ' ' + what].filter(String).join('\n'));
  }

  if (status === 'Confirmed') {
    if (!price) return warnMeyer_(s, info.code, 'Add the price in "Final price (you fill)" first, then set Status to Confirmed again.');
    if (!filled_(s['InstaPay address']) || !filled_(s['InstaPay name to check'])) {
      return warnMeyer_(s, info.code, 'Fill "InstaPay address" and "InstaPay name to check" in the Settings tab, then set Status to Confirmed again.');
    }
    var deposit = Math.round(price * pct / 100);
    sh.getRange(r, m['Deposit'] + 1).setValue(deposit);
    info.amount = deposit; info.price = price;
    if (sendCustomer_(s, to, info.lang, 'confirmed', info)) logEmail('Confirmed + payment details');
  } else if (status === 'Deposit paid') {
    var when = sh.getRange(r, m['Deposit confirmed on'] + 1);
    if (!when.getValue()) when.setValue(new Date());
    clearContentCache_(); // refresh the spots counter
    if (sendCustomer_(s, to, info.lang, 'deposit', info)) logEmail('Deposit received');
  } else if (status === 'Balance due') {
    var paid = Number(row[m['Deposit']]) || 0;
    var balance = Math.max(0, price - paid);
    sh.getRange(r, m['Balance'] + 1).setValue(balance);
    info.amount = balance;
    if (sendCustomer_(s, to, info.lang, 'balance', info)) logEmail('Balance due');
  } else if (status === 'Delivered') {
    // The review + referral email goes out by itself a few days later (see askForReviews_).
    if (m['Delivered on'] !== undefined) {
      var dcell = sh.getRange(r, m['Delivered on'] + 1);
      if (!dcell.getValue()) dcell.setValue(new Date());
    }
  } else if (status === 'Cancelled') {
    clearContentCache_();
  }
}

/**
 * Sends one sample "order received" email, exactly as a customer would get it,
 * to the business address in Settings. Run it from the editor to check the sender.
 */
function sendTestEmail() {
  var s = settings_();
  // "Test email to" in Settings: an address outside Guts Decor (e.g. your personal Gmail) to see what a customer sees.
  var to = filled_(s['Test email to']) ? s['Test email to'] : s['Order email'];
  var ok = sendCustomer_(s, to, 'en', 'received', {
    code: 'GD-TEST', tier: 'Premium', design: 'Dragon Slayer', estimate: 4500, outside: false, waitlist: false
  });
  Logger.log(ok ? 'Test email sent to ' + to + ' from ' + (senderEmail_(s) || 'the Guts Decor Gmail') + ', Reply-to ' + (contactEmail_(s) || 'none') + '.' :
    'Not sent: connect the mailer first (MAILER_URL and MAILER_SECRET in Project Settings → Script Properties). Nothing was sent to the customer.');
}

// The Instagram username from Settings (admin page > Settings), without the @.
function igHandle_(s) { return String(s['Instagram handle'] || 'guts.decor').replace(/^@/, '').trim() || 'guts.decor'; }

// The address customers write to (Email us button, Reply-to) and the one automatic emails come from.
function contactEmail_(s) { return filled_(s['Contact email']) ? String(s['Contact email']).trim() : ''; }
function senderEmail_(s) { return filled_(s['Sender email']) ? String(s['Sender email']).trim() : ''; }

function warnMeyer_(s, code, msg) {
  ownerMail_(s, 'Action needed on ' + code, msg);
}

// Emails to Meyer himself also go out from the business sender; if the mailer is down they still arrive (sent directly).
function ownerMail_(s, subject, body) {
  if (mailerSend_(s, s['Order email'], subject, body)) return;
  MailApp.sendEmail({ to: s['Order email'], subject: subject, body: body });
}

// =====================================================================
// Emails
// =====================================================================
function notifyMeyerNewOrder_(s, row, inCairoGiza) {
  var lines = ORDER_COLUMNS.filter(function (h) { return row.hasOwnProperty(h) && row[h] !== ''; }).map(function (h) {
    var v = row[h] instanceof Date ? Utilities.formatDate(row[h], Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') : String(row[h]).replace(/^'/, '');
    return h + ': ' + v;
  });
  ownerMail_(s, (row['Status'] === 'Waitlist' ? '[Waitlist] ' : '') + 'New order request ' + row['Order code'] + ' (' + row['Tier'] + ')',
    lines.join('\n') + (inCairoGiza ? '' : '\n\nOutside Cairo & Giza: shipping estimate is the minimum, check the real cost.') +
      '\n\nOrders sheet: ' + ordersSheet_().getParent().getUrl() +
      '\n\nTo confirm: fill "Final price (you fill)" if needed, then set Status to "Confirmed". The customer gets your InstaPay details automatically.');
}

/**
 * Customer emails are sent BY the Guts Decor account itself, through the mailer (Mailer.gs) that lives there.
 * "Send mail as" is never used: it leaks the personal address in the email's hidden details.
 * If the mailer isn't connected or fails, nothing goes to the customer and Meyer is told instead.
 */
function sendCustomer_(s, to, lang, kind, info) {
  return deliver_(s, to, customerMessage_(s, lang, kind, info), info.code);
}

// Hands one email to the Guts Decor mailer: From the Sender email (orders@), Reply-to the Contact email (meyer@).
function mailerSend_(s, to, subject, body) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('MAILER_URL');
  var secret = props.getProperty('MAILER_SECRET');
  if (!url || !secret) return false;
  try {
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'text/plain',
      payload: JSON.stringify({ secret: secret, to: to, subject: subject, body: body, from: senderEmail_(s), replyTo: contactEmail_(s) }),
      muteHttpExceptions: true
    });
    return !!JSON.parse(res.getContentText()).ok;
  } catch (err) {
    console.error(err);
    return false;
  }
}

// Sends one customer email through the Guts Decor mailer (never from the personal account).
function deliver_(s, to, msg, code) {
  if (mailerSend_(s, to, msg.subject, msg.body)) return true;
  warnMeyer_(s, code, 'The customer email "' + msg.subject + '" was NOT sent (the Guts Decor mailer is not connected or failed). ' +
    'Please send it yourself from ' + s['Order email'] + ':\n\nTo: ' + to + '\n\n' + msg.body);
  return false;
}

function money_(n, lang) {
  var s = Number(n).toLocaleString('en-US');
  return lang === 'ar' ? s + ' جنيه' : s + ' LE';
}

function customerMessage_(s, lang, kind, info) {
  var ar = lang === 'ar';
  var payLink = SITE_URL + 'pay.html?code=' + encodeURIComponent(info.code);
  var name = s['InstaPay name to check'];
  var scam = ar
    ? 'تنبيه: أنا مبقبلش غير InstaPay على اسم ' + name + '، وعمري ما هطلب منك تدفع على حساب تاني.'
    : 'Please note: I only ever accept InstaPay to ' + name + '. I will never ask you to pay a different account.';
  var scamGeneric = ar
    ? 'تنبيه: أنا مبقبلش غير InstaPay على الاسم اللي هبعتهولك في إيميل التأكيد، وعمري ما هطلب منك تدفع على حساب تاني.'
    : 'Please note: I only ever accept InstaPay to the name I send in my confirmation email. I will never ask you to pay a different account.';
  var igUrl = 'https://www.instagram.com/' + igHandle_(s) + '/';
  var sign = ar ? '\n\nماير\nGuts Decor\n' + igUrl : '\n\nMeyer\nGuts Decor\n' + igUrl;
  var dmStep = info.message ? '\n\n' + tx_('email.dm.send', lang, { link: 'https://ig.me/m/' + igHandle_(s), ig: '@' + igHandle_(s) }) +
    '\n\n' + info.message : '';

  if (kind === 'received') {
    var est = info.estimate ? (info.outside ? (ar ? 'من ' : 'from ') : '') + money_(info.estimate, lang) : (ar ? 'بالاتفاق' : 'by quote');
    return ar ? {
      subject: 'طلبك وصلني: ' + info.code,
      body: 'أهلًا،\n\nشكرًا على طلبك! كود طلبك: ' + info.code + '\n\nالمستوى: ' + info.tier + '\nالتصميم: ' + info.design +
        '\nالسعر التقريبي: ' + est + '\n\n' +
        (info.waitlist ? 'الشهر ده اتملى، فهحجزلك مكان في الشهر الجاي.\n\n' : '') +
        'هرد عليك خلال ٢٤ ساعة وأأكدلك الميعاد والسعر النهائي. مفيش أي دفع قبل ما أأكد.' + dmStep + '\n\n' + scamGeneric + sign
    } : {
      subject: 'I got your order request: ' + info.code,
      body: 'Hi,\n\nThank you for your request! Your order code is ' + info.code + '.\n\nLevel: ' + info.tier + '\nDesign: ' + info.design +
        '\nEstimated price: ' + est + '\n\n' +
        (info.waitlist ? "This month is full, so I'll reserve you a spot for next month.\n\n" : '') +
        "I'll reply within 24 hours to confirm your date and final price. Nothing is due before I confirm." + dmStep + '\n\n' + scamGeneric + sign
    };
  }
  if (kind === 'confirmed') {
    return ar ? {
      subject: 'طلبك اتأكد: ' + info.code,
      body: 'أهلًا،\n\nطلبك ' + info.code + ' اتأكد! السعر النهائي ' + money_(info.price, lang) + '، وثابت لمدة ٧ أيام.\n\n' +
        'العربون (' + firstNum_(s['Deposit %'], 50) + '٪): ' + money_(info.amount, lang) + '\n' +
        'ادفع بالـ InstaPay على: ' + s['InstaPay address'] + '\nالاسم اللي هيظهرلك: ' + name + '\n\n' +
        'بعد الدفع، ارفع صورة الإيصال هنا:\n' + payLink + '\n\n' + scam + sign
    } : {
      subject: 'Your order is confirmed: ' + info.code,
      body: 'Hi,\n\nYour order ' + info.code + ' is confirmed! The final price is ' + money_(info.price, lang) + ", and it's held for 7 days.\n\n" +
        'Deposit (' + firstNum_(s['Deposit %'], 50) + '%): ' + money_(info.amount, lang) + '\n' +
        'Pay by InstaPay to: ' + s['InstaPay address'] + '\nThe name you should see: ' + name + '\n\n' +
        'After paying, upload a screenshot of the receipt here:\n' + payLink + '\n\n' + scam + sign
    };
  }
  if (kind === 'deposit') {
    return ar ? {
      subject: 'العربون وصل: ' + info.code,
      body: 'أهلًا،\n\nالعربون وصلني ومكانك اتحجز. هبدأ أشتغل على قطعتك، وهتشوفها خلصانة قبل ما تدفع الباقي.' + sign
    } : {
      subject: 'Deposit received: ' + info.code,
      body: "Hi,\n\nYour deposit arrived and your spot is reserved. I'm starting on your piece, and you'll see it finished before the rest is due." + sign
    };
  }
  // balance
  return ar ? {
    subject: 'قطعتك خلصت: ' + info.code,
    body: 'أهلًا،\n\nقطعتك خلصت! الباقي: ' + money_(info.amount, lang) + '، مطلوب خلال ٧ أيام.\n\n' +
      'ادفع بالـ InstaPay على: ' + s['InstaPay address'] + '\nالاسم اللي هيظهرلك: ' + name + '\n\n' +
      'بعد الدفع، ارفع صورة الإيصال هنا:\n' + payLink + '\n\n' + scam + sign
  } : {
    subject: 'Your piece is ready: ' + info.code,
    body: 'Hi,\n\nYour piece is finished! The balance is ' + money_(info.amount, lang) + ', due within 7 days.\n\n' +
      'Pay by InstaPay to: ' + s['InstaPay address'] + '\nThe name you should see: ' + name + '\n\n' +
      'After paying, upload a screenshot of the receipt here:\n' + payLink + '\n\n' + scam + sign
  };
}

// =====================================================================
// Anonymous counting (Stats tab): visits and taps, no cookies, nothing about who.
// The website sends small "+1"s; they're added up here and written to the Stats tab every hour.
// =====================================================================
var STATS_FIRST_ROW = 28; // daily counts start here; the summaries sit above

function handleTrack_(d) {
  var events = Array.isArray(d.e) ? d.e.slice(0, 10) : [];
  events = events.filter(function (e) { return /^[a-z0-9:._'\-]{1,60}$/i.test(String(e)); });
  if (events.length) countEvents_(events);
  return { ok: true };
}

function countEvents_(events) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var props = PropertiesService.getScriptProperties();
    var key = 'stats_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var day = JSON.parse(props.getProperty(key) || '{}');
    events.forEach(function (e) { day[e] = (day[e] || 0) + 1; });
    props.setProperty(key, JSON.stringify(day));
  } finally {
    lock.releaseLock();
  }
}

function countEvent_(name) {
  try { countEvents_([name]); } catch (err) { console.error(err); }
}

// Run once from the editor: lays out the Stats tab and starts the hourly update.
function setupStats() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('Stats') || ss.insertSheet('Stats');
  sh.getRange('A1').setValue('Weekly summary: where people drop off').setFontWeight('bold').setFontSize(13);
  sh.getRange('A2').setValue('Filled in automatically every hour. Anonymous counts only: no cookies, no names, nothing about who tapped.');
  sh.getRange('A3:F3').setValues([['Week starting', 'Visits', 'Order forms started', 'Orders sent', 'Deposits uploaded', 'Visits that became orders']]).setFontWeight('bold');
  var data = 'Stats!$A$' + STATS_FIRST_ROW + ':$A';
  var ev = 'Stats!$B$' + STATS_FIRST_ROW + ':$B';
  var cnt = 'Stats!$C$' + STATS_FIRST_ROW + ':$C';
  for (var i = 0; i < 8; i++) {
    var r = 4 + i;
    var sum = function (pattern) {
      return '=SUMIFS(' + cnt + ',' + data + ',">="&$A' + r + ',' + data + ',"<"&($A' + r + '+7),' + ev + ',"' + pattern + '")';
    };
    sh.getRange(r, 1, 1, 6).setFormulas([[
      '=TODAY()-WEEKDAY(TODAY(),3)-' + (7 * i), sum('visit:*'), sum('form:start'), sum('order:sent'), sum('deposit:uploaded'),
      '=IF(B' + r + '=0,"",D' + r + '/B' + r + ')'
    ]]);
  }
  sh.getRange('A4:A11').setNumberFormat('yyyy-mm-dd');
  sh.getRange('F4:F11').setNumberFormat('0.0%');

  sh.getRange('A13').setValue('Pages, last 30 days: which pages bring orders').setFontWeight('bold').setFontSize(13);
  sh.getRange('A14:D14').setValues([['Page', 'Visits', 'Main-button taps', 'Taps per visit']]).setFontWeight('bold');
  var pages = ['home', 'swords', 'designs', 'display', 'gifts', 'how', 'about', 'gallery', 'order', 'commissions'];
  pages.forEach(function (p, i) {
    var r = 15 + i;
    var since = ',' + data + ',">="&(TODAY()-30)';
    sh.getRange(r, 1, 1, 4).setValues([[p, '', '', '']]);
    sh.getRange(r, 2, 1, 3).setFormulas([[
      '=SUMIFS(' + cnt + since + ',' + ev + ',"visit:"&$A' + r + ')',
      '=SUMIFS(' + cnt + since + ',' + ev + ',"cta:"&$A' + r + ')',
      '=IF(B' + r + '=0,"",C' + r + '/B' + r + ')'
    ]]);
  });
  sh.getRange('D15:D24').setNumberFormat('0.0%');

  sh.getRange('F13').setValue('Shop, last 30 days').setFontWeight('bold').setFontSize(13);
  sh.getRange('F14:G14').setValues([['What', 'Count']]).setFontWeight('bold');
  [['Product page views', 'view:*'], ['Add to cart', 'add:*'], ['Order now', 'now:*'], ['Cart opened', 'visit:cart'],
    ['Checkout started', 'visit:checkout'], ['Orders sent', 'order:sent'], ['Reminder emails sent', 'reminder:sent'],
    ['Reminders that led to an order', 'reminder:won'], ["Collector's big-plaque upgrades", 'upgrade:plaque']].forEach(function (row, i) {
    var r = 15 + i;
    sh.getRange(r, 6).setValue(row[0]);
    sh.getRange(r, 7).setFormula('=SUMIFS(' + cnt + ',' + data + ',">="&(TODAY()-30),' + ev + ',"' + row[1] + '")');
  });

  sh.getRange('A' + (STATS_FIRST_ROW - 1) + ':C' + (STATS_FIRST_ROW - 1)).setValues([['Date', 'What was counted', 'Count']]).setFontWeight('bold');

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'flushStats') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('flushStats').timeBased().everyHours(1).create();
  flushStats();
  Logger.log('Stats tab ready. Counts are written every hour.');
}

// Every hour: copies the day totals into the Stats tab (one row per day and thing counted).
function flushStats() {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var props = PropertiesService.getScriptProperties();
    var tz = Session.getScriptTimeZone();
    var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    var sh = SpreadsheetApp.getActive().getSheetByName('Stats');
    var last = Math.max(sh.getLastRow(), STATS_FIRST_ROW - 1);
    var rows = last >= STATS_FIRST_ROW ? sh.getRange(STATS_FIRST_ROW, 1, last - STATS_FIRST_ROW + 1, 3).getValues() : [];
    var index = {};
    rows.forEach(function (r, i) {
      if (r[0] instanceof Date) index[Utilities.formatDate(r[0], tz, 'yyyy-MM-dd') + '|' + r[1]] = i;
    });
    var all = props.getProperties();
    Object.keys(all).filter(function (k) { return k.indexOf('stats_') === 0; }).forEach(function (k) {
      var date = k.slice(6);
      var parts = date.split('-').map(Number);
      var counts = JSON.parse(all[k] || '{}');
      Object.keys(counts).forEach(function (e) {
        var id = date + '|' + e;
        if (index.hasOwnProperty(id)) {
          rows[index[id]][2] = counts[e];
        } else {
          index[id] = rows.length;
          rows.push([new Date(parts[0], parts[1] - 1, parts[2]), e, counts[e]]);
        }
      });
      if (date < today) props.deleteProperty(k); // finished days are kept in the sheet only
    });
    if (rows.length) {
      sh.getRange(STATS_FIRST_ROW, 1, rows.length, 3).setValues(rows);
      sh.getRange(STATS_FIRST_ROW, 1, rows.length, 1).setNumberFormat('yyyy-mm-dd');
    }
  } finally {
    lock.releaseLock();
  }
}

// =====================================================================
// Shop: checkout with a cart (pay-now pieces only)
// Prices are always recalculated here from the sheet, with the same rules as the website's cart.
// =====================================================================
var CARTS_TAB = 'Carts';
var REMINDER_AFTER_HOURS = 24;
var CART_KEEP_DAYS = 7;

// Run once from the editor: adds the shop columns and statuses, the Carts tab, the counting and the hourly reminder check.
function setupShop() {
  var sh = ordersSheet_();
  ensureShopColumns_(sh);
  cartsSheet_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendReminders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendReminders').timeBased().everyHours(1).create();
  setupStats();
  Logger.log('Shop ready: checkout, counting and the one-time cart reminder are switched on.');
}

function ensureShopColumns_(sh) {
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  var missing = SHOP_COLUMNS.filter(function (c) { return head.indexOf(c) === -1; });
  if (missing.length) sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
  var statusCol = colMap_(sh)['Status'] + 1;
  sh.getRange(2, statusCol, sh.getMaxRows() - 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(false).build());
}

function slug_(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

function findProduct_(c, id) {
  var hit = null;
  c.designs.forEach(function (d) { if ('d-' + slug_(d.name) === id) hit = { type: 'design', d: d }; });
  c.tiers.forEach(function (t) { if (t.price && 't-' + slug_(t.name) === id) hit = { type: 'tier', d: t }; });
  c.addons.forEach(function (a) { if (typeof a.price === 'number' && 'a-' + slug_(a.name) === id) hit = { type: 'addon', d: a }; });
  return hit;
}

// Checks one cart line and works out its price. Returns null when anything is not allowed.
function priceLine_(c, line) {
  if (!line || typeof line !== 'object') return null;
  var p = findProduct_(c, String(line.id || ''));
  if (!p) return null;
  var payNow = p.type === 'addon' ? typeof p.d.price === 'number' : !!(p.d.payNow && p.d.price);
  if (!payNow) return null;
  var qty = Number(line.qty) || 1;
  if (qty < 1 || qty > 10 || qty !== Math.floor(qty)) return null;

  // details: [Text-tab key, value] pairs for the order message the customer sends on Instagram.
  var name = p.d.name, parts = [], details = [], each = p.d.price;
  if (p.type === 'tier') details.push(['dm.order.level', p.d.name]);
  else if (p.type === 'design' && !p.d.classicPrice && p.d.level) details.push(['dm.order.level', p.d.level]);
  if (p.type === 'design' && p.d.classicPrice) {
    if (line.version !== 'Classic' && line.version !== 'Premium') return null;
    if (line.version === 'Classic') each = p.d.classicPrice;
    parts.push(line.version);
    details.push(['dm.order.level', line.version]);
  }
  if (p.type === 'design' && p.d.askHeight) {
    var h = Number(line.height);
    if (!(h >= 160 && h <= 190)) return null;
    parts.push('height ' + h + ' cm');
    details.push(['dm.order.height', h + ' cm']);
  }
  if (p.type === 'tier') {
    var sword = String(line.sword || '').trim();
    if (sword.length < 2 || sword.length > 80) return null;
    parts.push('sword: ' + sword);
    details.push(['dm.order.sword', sword]);
  }
  var collectors = p.type === 'tier' && /^collector/i.test(p.d.name);
  if (line.blade) {
    if (!collectors || String(line.blade).length > 20) return null;
    parts.push('name on blade: ' + String(line.blade).trim());
    details.push(['dm.order.blade', String(line.blade).trim()]);
  }
  if (line.plaque) {
    if (!collectors) return null;
    each += firstNum_(c.s["Collector's plaque upgrade (LE)"], 1200);
    parts.push('BIG PLAQUE UPGRADE');
    details.push(['dm.order.plaque', 'Yes']);
  }
  if (line.mount) {
    var mName = String(line.mount.name || '');
    var carve = String(line.mount.carve || '').trim();
    if (p.type === 'addon' || mName !== p.d.matchingMount || !carve || carve.length > 10) return null;
    var m = c.addons.filter(function (a) { return a.name === mName && typeof a.price === 'number'; })[0];
    if (!m) return null;
    each += m.price;
    parts.push('+ ' + mName + ', carved name: ' + carve);
    details.push(['dm.order.mount', mName + ' (' + carve + ')']);
  }
  // Every part chosen in the 3D builder (blade, habaki, guard, handle, wrap, pommel, scabbard...), sent with the line.
  if (line.parts !== undefined) {
    if (!Array.isArray(line.parts) || line.parts.length > 30) return null;
    for (var i = 0; i < line.parts.length; i++) {
      var pt = line.parts[i] || {};
      var part = clean_(pt.part, 40), opt = clean_(pt.option, 80);
      if (!part || !opt) return null;
      parts.push(part + ': ' + opt);
      details.push(['', part + ': ' + opt]);
    }
  }
  var total = each * qty;
  return {
    total: total, plaque: !!line.plaque, shippingIncluded: p.type === 'design' && !!p.d.shippingIncluded,
    name: name, qty: qty, details: details,
    label: qty + ' x ' + name + (parts.length ? ' (' + parts.join('; ') + ')' : '') + ' = ' + total.toLocaleString('en-US') + ' LE'
  };
}

// The order message the customer copies and sends on Instagram, in their language. Wording: Text tab rows dm.order.*
// (admin page > Settings > Order message). Lists everything, so Meyer never has to ask again.
function orderMessage_(lang, code, info) {
  var L = function (k, v) { return (tx_(k, lang) || k) + ' ' + v; };
  var out = [tx_('dm.order.title', lang, { code: code }) || ('Order ' + code), ''];
  out.push(L('dm.order.name', info.name));
  out.push(L('dm.order.phone', info.phone));
  out.push(L('dm.order.city', info.city));
  if (info.instagram) out.push(L('dm.order.ig', '@' + info.instagram));
  if (info.gift) out.push(L('dm.order.gift', info.gift));
  out.push('');
  info.lines.forEach(function (p) {
    out.push((p.qty > 1 ? p.qty + ' x ' : '') + p.name + (p.total ? ' = ' + money_(p.total, lang) : ''));
    (p.details || []).forEach(function (d) { out.push('   ' + (d[0] ? L(d[0], d[1]) : d[1])); });
  });
  if (info.extra) info.extra.forEach(function (x) { out.push(x); });
  out.push('');
  if (info.total !== '' && info.total != null) out.push(L('dm.order.total', money_(info.total, lang)));
  if (info.shipping !== null && info.shipping !== undefined) out.push(L('dm.order.shipping', info.shipping ? money_(info.shipping, lang) : tx_('dm.order.free', lang)));
  if (info.deposit) out.push(L('dm.order.deposit', money_(info.deposit, lang)));
  if (info.notes) out.push(L('dm.order.notes', info.notes));
  var end = tx_('dm.order.end', lang);
  if (end) out.push('', end);
  return out.join('\n');
}

function instapayDetails_() {
  var s = settings_();
  if (!filled_(s['InstaPay address']) || !filled_(s['InstaPay name to check'])) return { ok: false, error: 'not-ready' };
  return { ok: true, address: s['InstaPay address'], name: s['InstaPay name to check'] };
}

// Words for customer emails come from the Text tab, like every other customer-facing word.
var TEXT_CACHE_ = null;
function tx_(key, lang, vars) {
  if (!TEXT_CACHE_) {
    TEXT_CACHE_ = {};
    readTable_('Text').forEach(function (r) { var k = r["Key (don't change)"]; if (k) TEXT_CACHE_[k] = { en: r['English'], ar: r['Arabic'] }; });
  }
  var row = TEXT_CACHE_[key];
  var s = row ? (row[lang === 'ar' ? 'ar' : 'en'] || row.en || '') : '';
  return s.replace(/\{(\w+)\}/g, function (m, k) { return vars && vars.hasOwnProperty(k) ? vars[k] : m; });
}

function saveReceipt_(code, mime, data) {
  var ext = IMAGE_TYPES[mime];
  if (!ext || typeof data !== 'string' || data.length > Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 + 8) return null;
  var bytes = Utilities.base64Decode(data);
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES || !looksLikeImage_(bytes, mime)) return null;
  var folder = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('RECEIPTS_FOLDER_ID'));
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HHmm');
  return folder.createFile(Utilities.newBlob(bytes, mime, code + '_' + stamp + '.' + ext)).getUrl();
}

function handleCheckout_(d) {
  if (d.website) return { ok: true, code: randomCode_() }; // spam trap
  if (!(Number(d.elapsed) > 4000)) return { ok: false, error: 'invalid' };
  var c = catalog_();
  var lines = Array.isArray(d.items) ? d.items.slice(0, 20) : [];
  if (!lines.length) return { ok: false, error: 'invalid' };
  var priced = lines.map(function (l) { return priceLine_(c, l); });
  if (priced.indexOf(null) !== -1) return { ok: false, error: 'changed' };

  var email = String(d.email || '').trim().toLowerCase();
  var phoneDigits = String(d.phone || '').replace(/[\s\-()]/g, '');
  var checks = [
    String(d.name || '').trim().length >= 2 && String(d.name).length <= 80,
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 120,
    email === String(d.email2 || '').trim().toLowerCase(),
    /^\+?\d{10,15}$/.test(phoneDigits),
    /^@?[A-Za-z0-9._]{0,30}$/.test(String(d.instagram || '').trim()),
    d.isGift ? String(d.recipient || '').trim().length >= 2 && String(d.recipient).length <= 80 : true,
    !d.occasionDate || /^\d{4}-\d{2}-\d{2}$/.test(d.occasionDate),
    GOVERNORATES.indexOf(d.governorate) !== -1,
    ['area', 'street', 'building', 'floor', 'apartment'].every(function (k) { return String(d[k] || '').trim() && String(d[k]).length <= 120; }),
    String(d.landmark || '').length <= 120,
    String(d.notes || '').length <= 500,
    !d.foundVia || FOUND_SHOP.indexOf(d.foundVia) !== -1,
    !d.src || /^[a-z0-9._\-]{1,40}$/i.test(String(d.src)),
    d.terms === true
  ];
  if (checks.indexOf(false) !== -1) return { ok: false, error: 'invalid' };

  var itemsTotal = priced.reduce(function (s, p) { return s + p.total; }, 0);
  var allShipFree = priced.every(function (p) { return p.shippingIncluded; });
  var inCairoGiza = d.governorate === 'Cairo' || d.governorate === 'Giza';
  var shipping = allShipFree ? 0 : shippingFor_(c, d.governorate);
  var deposit = Math.round(itemsTotal * c.depositPct / 100);

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var code, row, receipt = null, sh;
  try {
    sh = ordersSheet_();
    ensureShopColumns_(sh);
    var m = colMap_(sh);
    if (sh.getLastRow() >= 2) {
      var since = Date.now() - 24 * 3600 * 1000;
      var recent = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues().filter(function (r) {
        var when = r[m['Received']];
        return when instanceof Date && when.getTime() >= since &&
          (String(r[m['Email']]).toLowerCase() === email || String(r[m['Phone']]).replace(/[^\d+]/g, '') === phoneDigits);
      });
      if (recent.length >= MAX_ORDERS_PER_DAY) return { ok: false, error: 'limit' };
    }
    code = newCode_(sh);
    if (d.mime && d.data) receipt = saveReceipt_(code, d.mime, d.data);
    row = {
      'Order code': code, 'Received': new Date(),
      'Status': STARTED,
      'Type': 'Shop', 'Items': priced.map(function (p) { return p.label; }).join('\n'),
      'Name': clean_(d.name, 80), 'Email': clean_(email, 120), 'Phone': "'" + phoneDigits,
      'Instagram': clean_(String(d.instagram || '').replace(/^@/, ''), 30),
      'Governorate': d.governorate, 'Area': clean_(d.area, 120), 'Street': clean_(d.street, 120),
      'Building': clean_(d.building, 30), 'Floor': clean_(d.floor, 20), 'Apartment': clean_(d.apartment, 20),
      'Landmark': clean_(d.landmark, 120), 'Gift': d.isGift ? 'Yes' : 'No', 'Recipient': d.isGift ? clean_(d.recipient, 80) : '',
      'Occasion date': d.occasionDate || '', 'Notes': clean_(d.notes, 500), 'Found us via': d.foundVia || '', 'Source link': d.src ? clean_(String(d.src).toLowerCase(), 40) : '',
      'Language': d.lang === 'ar' ? 'ar' : 'en',
      'Items total': itemsTotal, 'Shipping estimate': shipping, 'Estimated total': itemsTotal + shipping,
      'Deposit': deposit, 'Payment receipts': receipt || ''
    };
    var values = new Array(sh.getLastColumn());
    Object.keys(m).forEach(function (h) { values[m[h]] = row.hasOwnProperty(h) ? row[h] : ''; });
    sh.appendRow(values);
  } finally {
    lock.releaseLock();
  }

  var won = forgetCart_(email);
  var events = ['order:sent'];
  if (receipt) events.push('deposit:uploaded');
  if (won) events.push('reminder:won');
  priced.forEach(function (p) { if (p.plaque) events.push('upgrade:plaque'); });
  try { countEvents_(events); } catch (err) { console.error(err); }

  var s = c.s;
  var lang = d.lang === 'ar' ? 'ar' : 'en';
  var message = orderMessage_(lang, code, {
    name: row['Name'], phone: phoneDigits, city: d.governorate + ', ' + row['Area'], instagram: row['Instagram'],
    gift: d.isGift ? row['Recipient'] + (row['Occasion date'] ? ' (' + row['Occasion date'] + ')' : '') : '',
    lines: priced, total: itemsTotal, shipping: shipping, deposit: deposit, notes: row['Notes']
  });
  ownerMail_(s, 'Order started ' + code + ' (' + itemsTotal.toLocaleString('en-US') + ' LE), waiting for their Instagram message',
    'They were asked to send this message on Instagram:\n\n' + message + '\n\n----------\n' +
    'Items:\n' + row['Items'] + '\n\nItems total: ' + itemsTotal + ' LE\nDeposit (' + c.depositPct + '%): ' + deposit + ' LE\n' +
      'Shipping estimate: ' + shipping + ' LE\n\n' +
      ['Name', 'Email', 'Phone', 'Instagram', 'Governorate', 'Area', 'Street', 'Building', 'Floor', 'Apartment', 'Landmark',
        'Gift', 'Recipient', 'Occasion date', 'Notes', 'Found us via', 'Source link'].filter(function (h) { return row[h]; })
        .map(function (h) { return h + ': ' + String(row[h]).replace(/^'/, ''); }).join('\n') +
      '\n\nWhen the deposit arrives by InstaPay, set Status to "Deposit paid" (admin page > Orders, or the Orders sheet).' +
      '\nOrders sheet: ' + sh.getParent().getUrl());
  deliver_(s, email, shopEmail_(s, lang, code, priced, itemsTotal, deposit, shipping, message), code);
  return { ok: true, code: code, deposit: deposit, message: message };
}

// "Your order is started": asks them to send the order message on Instagram, where the deposit is arranged.
function shopEmail_(s, lang, code, priced, itemsTotal, deposit, shipping, message) {
  var ig = igHandle_(s);
  var name = s['InstaPay name to check'];
  var body = [
    tx_('email.hi', lang),
    tx_('email.dm.intro', lang, { code: code }),
    tx_('email.dm.send', lang, { link: 'https://ig.me/m/' + ig, ig: '@' + ig }),
    message,
    tx_('email.shop.next', lang),
    filled_(name) ? tx_('email.scam', lang, { name: name }) : '',
    tx_('email.sign', lang)
  ].filter(String).join('\n\n');
  return { subject: tx_('email.shop.subject', lang, { code: code }), body: body };
}

// ---------- Lost carts: one reminder only ----------
function cartsSheet_() {
  var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('ORDERS_ID'));
  var sh = ss.getSheetByName(CARTS_TAB);
  if (!sh) {
    sh = ss.insertSheet(CARTS_TAB);
    sh.getRange(1, 1, 1, 5).setValues([['Email', 'Saved', 'Language', 'Cart', 'Reminder sent']]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('G1').setValue('Filled in automatically: people who typed their email at checkout but have not ordered yet. ' +
      'Each gets ONE reminder after 24 hours; the row is deleted after 7 days or as soon as they order.');
  }
  return sh;
}

function handleCartSave_(d) {
  var email = String(d.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) return { ok: false };
  var c = catalog_();
  var lines = Array.isArray(d.items) ? d.items.slice(0, 20) : [];
  var valid = lines.filter(function (l) { return priceLine_(c, l); });
  if (!valid.length) return { ok: false };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = cartsSheet_();
    var data = sh.getLastRow() >= 2 ? sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues() : [];
    var cartJson = JSON.stringify(valid).slice(0, 4000);
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]).toLowerCase() === email) {
        // Same person again: keep the first time and never reset a reminder already sent.
        sh.getRange(i + 2, 3, 1, 2).setValues([[d.lang === 'ar' ? 'ar' : 'en', cartJson]]);
        return { ok: true };
      }
    }
    sh.appendRow([clean_(email, 120), new Date(), d.lang === 'ar' ? 'ar' : 'en', cartJson, '']);
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

// Called when an order arrives: removes the saved cart. Returns true when a reminder had been sent (it "won" the order).
function forgetCart_(email) {
  try {
    var sh = cartsSheet_();
    if (sh.getLastRow() < 2) return false;
    var data = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
    for (var i = data.length - 1; i >= 0; i--) {
      if (String(data[i][0]).toLowerCase() === email) {
        var won = !!data[i][4];
        sh.deleteRow(i + 2);
        return won;
      }
    }
  } catch (err) { console.error(err); }
  return false;
}

// Every hour: one reminder to carts older than 24 hours; carts older than 7 days are deleted.
function sendReminders() {
  try { askForReviews_(); } catch (err) { console.error(err); }
  var sh = cartsSheet_();
  if (sh.getLastRow() < 2) return;
  var s = settings_();
  var c = catalog_();
  var now = Date.now();
  var data = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
  for (var i = data.length - 1; i >= 0; i--) {
    var saved = data[i][1] instanceof Date ? data[i][1].getTime() : 0;
    if (!saved || now - saved > CART_KEEP_DAYS * 86400000) { sh.deleteRow(i + 2); continue; }
    if (data[i][4] || now - saved < REMINDER_AFTER_HOURS * 3600000) continue;
    var lang = data[i][2] === 'ar' ? 'ar' : 'en';
    var lines = [];
    try { lines = JSON.parse(data[i][3] || '[]'); } catch (err) { lines = []; }
    var priced = lines.map(function (l) { return priceLine_(c, l); }).filter(Boolean);
    sh.getRange(i + 2, 5).setValue(new Date()); // marked first, so a second reminder can never go out
    if (!priced.length) continue;
    var link = SITE_URL + 'cart.html?c=' + encodeURIComponent(Utilities.base64EncodeWebSafe(Utilities.newBlob(JSON.stringify(lines)).getBytes()));
    var body = [
      tx_('email.hi', lang),
      tx_('email.reminder.body', lang) + '\n' + priced.map(function (p) { return '- ' + p.label; }).join('\n'),
      tx_('email.reminder.link', lang, { link: link }),
      tx_('email.reminder.note', lang),
      tx_('email.sign', lang)
    ].filter(String).join('\n\n');
    if (deliver_(s, String(data[i][0]), { subject: tx_('email.reminder.subject', lang), body: body }, 'cart reminder')) countEvent_('reminder:sent');
  }
}


// =====================================================================
// Growth: reviews, referrals, leads and the monthly report (added 7 Nov 2026)
// Advisors: Hormozi + Schwartz (proof), Blount (follow-up, referrals), Kennedy (measure), Drucker (monthly review).
// Run setupGrowth() once from the editor after pasting this code.
// =====================================================================
var REVIEW_AFTER_DAYS = 3;
var LEADS_TAB = 'Leads';
var LEAD_COLUMNS = ['Added', 'Name / Instagram', 'Wants', 'For (me / gift)', 'Occasion date', 'Stage', 'Next step', 'Next step date', 'Source', 'Notes'];
var LEAD_STAGES = ['New', 'Talking', 'Sent link', 'Waiting on them', 'Ordered', 'Not now', 'Lost'];

function setupGrowth() {
  var sh = ordersSheet_();
  ensureShopColumns_(sh);
  leadsSheet_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'leadsDigest' || f === 'monthlyReport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('leadsDigest').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).create();
  ScriptApp.newTrigger('leadsDigest').timeBased().onWeekDay(ScriptApp.WeekDay.THURSDAY).atHour(9).create();
  ScriptApp.newTrigger('monthlyReport').timeBased().onMonthDay(1).atHour(9).create();
  Logger.log('Growth ready: review emails after delivery, Leads tab, follow-up list (Mon + Thu) and the monthly report (1st of the month).');
}

function leadsSheet_() {
  var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('ORDERS_ID'));
  var sh = ss.getSheetByName(LEADS_TAB);
  if (!sh) {
    sh = ss.insertSheet(LEADS_TAB);
    sh.getRange(1, 1, 1, LEAD_COLUMNS.length).setValues([LEAD_COLUMNS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(2, 6, sh.getMaxRows() - 1, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(LEAD_STAGES, true).build());
    sh.getRange(2, 1, sh.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd');
    sh.getRange(2, 8, sh.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd');
  }
  return sh;
}

// A few days after an order is marked Delivered: one email asking for a photo review and who else would love one.
function askForReviews_() {
  var sh = ordersSheet_();
  if (sh.getLastRow() < 2) return;
  var m = colMap_(sh);
  if (m['Delivered on'] === undefined || m['Review asked'] === undefined) return;
  var s = settings_();
  var data = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var now = Date.now();
  data.forEach(function (row, i) {
    var when = row[m['Delivered on']];
    if (!(when instanceof Date) || row[m['Review asked']] || row[m['Status']] !== 'Delivered') return;
    if (now - when.getTime() < REVIEW_AFTER_DAYS * 86400000) return;
    var to = String(row[m['Email']]).replace(/^'/, '').trim();
    if (!to) return;
    sh.getRange(i + 2, m['Review asked'] + 1).setValue(new Date()); // marked first: never twice
    var code = row[m['Order code']];
    var lang = row[m['Language']] === 'ar' ? 'ar' : 'en';
    var link = SITE_URL + '?src=friend-' + String(code).toLowerCase();
    if (deliver_(s, to, reviewMessage_(lang, row[m['Gift']] === 'Yes', link), code)) countEvent_('review:asked');
  });
}

// Words come from the Text tab (email.review.*); the built-in wording is only a fallback.
function reviewMessage_(lang, gift, link) {
  var t = function (key, en, ar, vars) {
    var v = tx_(key, lang, vars);
    if (v) return v;
    v = lang === 'ar' ? ar : en;
    return v.replace(/\{(\w+)\}/g, function (mm, k) { return vars && vars.hasOwnProperty(k) ? vars[k] : mm; });
  };
  var body = [
    t('email.hi', 'Hi,', 'أهلًا،'),
    gift ? t('email.review.gift', 'I hope he loved his gift. Could you send me a photo of it in its new home, and a line about what he thought? Just reply to this email or message me on Instagram.',
                                  'أتمنى الهدية تكون عجبته. ممكن تبعتلي صورة ليها في مكانها الجديد وكلمتين عن رأيه؟ رد على الإيميل ده أو ابعتلي على إنستجرام.')
         : t('email.review.body', 'I hope you love your piece. Could you send me a photo of it on your wall, and a line about what you think? Just reply to this email or message me on Instagram. It helps other fans trust a small workshop like mine.',
                                  'أتمنى القطعة تكون عجبتك. ممكن تبعتلي صورة ليها على الحيطة وكلمتين عن رأيك؟ رد على الإيميل ده أو ابعتلي على إنستجرام. ده بيساعد فانز تانيين يثقوا في ورشة صغيرة زي ورشتي.'),
    t('email.review.friend', 'Do you know someone who would love one too? Send them this link: {link}',
                             'تعرف حد هيحب واحد زيه؟ ابعتله اللينك ده: {link}', { link: link }),
    t('email.sign', '\nMeyer\nGuts Decor', '\nماير\nGuts Decor')
  ].join('\n\n');
  return { subject: t('email.review.subject', 'How does it look on the wall?', 'شكلها إيه على الحيطة؟'), body: body };
}

// Mondays and Thursdays: Meyer gets the list of people to follow up with (Blount: follow up, technique 11).
function leadsDigest() {
  var sh = leadsSheet_();
  if (sh.getLastRow() < 2) return;
  var tz = Session.getScriptTimeZone();
  var today = new Date(); today.setHours(23, 59, 59, 0);
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, LEAD_COLUMNS.length).getValues().filter(function (r) {
    var stage = String(r[5]);
    if (!r[1] || stage === 'Ordered' || stage === 'Lost') return false;
    var due = r[7] instanceof Date ? r[7] : null;
    return !due || due <= today;
  });
  if (!rows.length) return;
  var lines = rows.map(function (r) {
    return '- ' + r[1] + ' | wants: ' + (r[2] || '?') + ' | ' + (r[3] || '') +
      (r[4] ? ' | date: ' + (r[4] instanceof Date ? Utilities.formatDate(r[4], tz, 'yyyy-MM-dd') : r[4]) : '') +
      ' | stage: ' + (r[5] || 'New') + ' | next: ' + (r[6] || 'decide the next step');
  });
  ownerMail_(settings_(), 'Follow up today: ' + rows.length + ' people',
    'These people are waiting for your next message:\n\n' + lines.join('\n') +
    '\n\nTips (from the business doc): start with "What\'s your experience with...?", give value before price, and always end with a next step ("When would be a good time...?"). ' +
    'Silent for a while? Try "I guess you haven\'t had the chance to..."\n\nDM templates: Drive > Guts Decor > Marketing Department > "DM reply templates".\nLeads tab: ' + sh.getParent().getUrl());
}

// 1st of each month: last month in numbers, for the monthly review (Drucker, Kennedy). Counts only, no customer names.
function monthlyReport() {
  var sh = ordersSheet_();
  var s = settings_();
  var tz = Session.getScriptTimeZone();
  var now = new Date();
  var last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  var key = Utilities.formatDate(last, tz, 'yyyy-MM');
  var m = colMap_(sh);
  var data = sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var month = data.filter(function (r) { var d = r[m['Received']]; return d instanceof Date && Utilities.formatDate(d, tz, 'yyyy-MM') === key; });
  var paidStatuses = ['Deposit paid', 'In progress', 'Balance due', 'Balance paid', 'Shipped', 'Delivered'];
  var count = function (list, col) {
    var o = {};
    list.forEach(function (r) { var v = m[col] === undefined ? '' : String(r[m[col]] || '').trim() || '(blank)'; o[v] = (o[v] || 0) + 1; });
    return Object.keys(o).sort(function (a, b) { return o[b] - o[a]; }).map(function (k) { return '  ' + k + ': ' + o[k]; }).join('\n') || '  (none)';
  };
  var paid = month.filter(function (r) { return paidStatuses.indexOf(r[m['Status']]) !== -1; });
  var revenue = paid.reduce(function (sum, r) { return sum + (Number(r[m['Final price (you fill)']]) || Number(r[m['Estimated total']]) || 0); }, 0);
  var items = {};
  paid.forEach(function (r) {
    var txt = (m['Items'] !== undefined && r[m['Items']]) || r[m['Design']] || r[m['Tier']] || '';
    String(txt).split('\n').forEach(function (it) { it = it.trim(); if (it) items[it] = (items[it] || 0) + 1; });
  });
  var itemLines = Object.keys(items).sort(function (a, b) { return items[b] - items[a]; }).slice(0, 10)
    .map(function (k) { return '  ' + k + ': ' + items[k]; }).join('\n') || '  (none)';
  var leads = leadsSheet_();
  var leadRows = leads.getLastRow() < 2 ? [] : leads.getRange(2, 1, leads.getLastRow() - 1, LEAD_COLUMNS.length).getValues()
    .filter(function (r) { return r[0] instanceof Date && Utilities.formatDate(r[0], tz, 'yyyy-MM') === key; });
  var won = leadRows.filter(function (r) { return r[5] === 'Ordered'; }).length;
  ownerMail_(s, 'Guts Decor: ' + key + ' in numbers',
    'Orders received: ' + month.length + '\nPaid orders (deposit or more): ' + paid.length +
    '\nValue of paid orders: ' + revenue.toLocaleString('en-US') + ' LE (before costs)\n\n' +
    'By status:\n' + count(month, 'Status') + '\n\nGift or for themselves:\n' + count(month, 'Gift') +
    '\n\nHow they found us (checkout answer):\n' + count(month, 'Found us via') + '\n\nTagged link they came from:\n' + count(month, 'Source link') +
    '\n\nMost ordered (paid):\n' + itemLines +
    '\n\nInstagram DMs (Leads tab): ' + leadRows.length + ' new, ' + won + ' ordered' +
    (leadRows.length ? ' (' + Math.round(won * 100 / leadRows.length) + '%)' : '') +
    '\n\nProfit is not in this email: costs live in Product Pricing, which this system never reads.' +
    '\nNext: Claude uses these numbers in the monthly review of "Guts Decor — How We Run the Business".');
}


// =====================================================================
// Admin page (gutsdecor.com/admin.html): Meyer runs the site without code.
// Built on THIS sheet (no second system). Edits go into the sheet = the draft.
// Publish freezes a copy that the website shows, and saves a version (date + time) that can be restored.
// Content only: the page can't change layout or code. Every value is checked here before it is saved.
// =====================================================================
var ADMIN_SESSION_SECONDS = 6 * 3600;
var ADMIN_MAX_FAILS = 8;               // wrong passwords allowed per 15 minutes (for everyone together)
var VERSIONS_FOLDER_NAME = 'Guts Decor — Website versions';
var PHOTOS_FOLDER_NAME = 'Guts Decor — Website photos';
var FIRST_PASSWORD_SETTING = 'Admin password (first time only)';
// The sheet tabs the admin page can edit, and that every version keeps a copy of.
var CONTENT_TABS = ['Settings', 'Text', 'Gallery', 'Tiers', 'Ready Designs', 'Add-ons', 'Builder Options', 'Videos', 'Sections', 'Shipping areas'];
// Table tabs: which column names a row.
var TABLE_KEYS = { 'Ready Designs': 'Design', 'Tiers': 'Tier', 'Add-ons': 'Add-on', 'Gallery': 'Photo (Drive link)', 'Videos': 'Spot',
  'Sections': 'Section', 'Shipping areas': 'Governorate', 'Builder Options': '' };
var LEVELS = ['Classic', 'Premium', "Collector's"];
// Settings shown on the admin page: [Settings row name, kind, plain-words help]. Other rows stay in the sheet only.
var ADMIN_SETTINGS = [
  ['Instagram handle', 'text', 'Your Instagram username. Every Instagram button on the site uses it.'],
  ['WhatsApp number', 'phone', 'Store WhatsApp number only (never your personal number). Empty = no WhatsApp button.'],
  ['WhatsApp button on', 'yesno', 'Yes = show the WhatsApp button (needs a number above).'],
  ['3D builder on', 'yesno', 'Yes = "Build your own katana" opens the 3D builder. No = it opens an Instagram message.'],
  ['3D builder link', 'text', 'The 3D builder page, for example builder.html. Used only when the builder is on.'],
  ['Search Console code', 'text', 'The code from Google Search Console (only the part inside content="...").'],
  ['Deposit %', 'number', 'How much the customer pays to start, in percent.'],
  ['Days to make', 'number', 'Used for "Ready in X days" on product pages.'],
  ['Spots per month', 'number', 'Orders you take per month.'],
  ["Collector's plaque upgrade (LE)", 'number', "Extra price for the big plaque on Collector's."],
  ['Express delivery on', 'yesno', 'Yes = show the express option.'],
  ['Proof line', 'text', 'The big number line, in English (only true numbers).'],
  ['Proof line (AR)', 'text', 'The same line in Arabic.'],
  ['Reply promise', 'text', 'Your reply promise, in English.'],
  ['Reply promise (AR)', 'text', 'The same promise in Arabic.'],
  ['Show gallery categories', 'text', 'Gallery categories shown on the site, separated by commas.']
];

function handleAdmin_(d) {
  if (d.action === 'adminLogin') return adminLogin_(d);
  if (!adminCheck_(d.token)) return { ok: false, error: 'login' };
  var lock;
  try {
    switch (d.action) {
      case 'adminLoad': return adminLoad_();
      case 'adminDraft': return buildDraft_();
      case 'adminOrders': return adminOrders_();
      case 'adminVersions': return adminVersions_();
      case 'adminUpload': return adminUpload_(d);
    }
    lock = LockService.getScriptLock();
    lock.waitLock(20000);
    switch (d.action) {
      case 'adminSave': return adminSave_(d.changes);
      case 'adminRow': return adminRow_(d);
      case 'adminPublish': return adminPublish_(d.label);
      case 'adminRestore': return adminRestore_(String(d.id || ''));
      case 'adminStatus': return adminStatus_(String(d.code || ''), String(d.status || ''));
      case 'adminPassword': return adminPassword_(d);
    }
    return { ok: false, error: 'unknown-action' };
  } finally {
    if (lock) lock.releaseLock();
  }
}

// ---------- Password and sessions ----------
function hash_(salt, pw) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + pw, Utilities.Charset.UTF_8));
}

function adminLogin_(d) {
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('adm-fails') || 0);
  if (fails >= ADMIN_MAX_FAILS) return { ok: false, error: 'locked' };
  var props = PropertiesService.getScriptProperties();
  var pw = String(d.password || '');
  if (!props.getProperty('ADMIN_HASH')) {
    // First time: the password Meyer typed in the Settings tab becomes the admin password, then that cell is emptied.
    var first = settings_()[FIRST_PASSWORD_SETTING] || '';
    if (first.length < 8) return { ok: false, error: 'nopassword' };
    var salt0 = Utilities.getUuid();
    props.setProperties({ ADMIN_SALT: salt0, ADMIN_HASH: hash_(salt0, first) });
    setSetting_(FIRST_PASSWORD_SETTING, '');
  }
  if (hash_(props.getProperty('ADMIN_SALT'), pw) !== props.getProperty('ADMIN_HASH')) {
    cache.put('adm-fails', String(fails + 1), 900);
    return { ok: false, error: 'wrong' };
  }
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  cache.put('admt:' + token, '1', ADMIN_SESSION_SECONDS);
  return { ok: true, token: token };
}

function adminCheck_(token) {
  token = String(token || '');
  if (!/^[a-f0-9]{40,64}$/.test(token)) return false;
  var cache = CacheService.getScriptCache();
  if (!cache.get('admt:' + token)) return false;
  cache.put('admt:' + token, '1', ADMIN_SESSION_SECONDS);
  return true;
}

function adminPassword_(d) {
  var props = PropertiesService.getScriptProperties();
  if (hash_(props.getProperty('ADMIN_SALT'), String(d.old || '')) !== props.getProperty('ADMIN_HASH')) return { ok: false, error: 'wrong' };
  var pw = String(d.password || '');
  if (pw.length < 8 || pw.length > 100) return { ok: false, error: 'short' };
  var salt = Utilities.getUuid();
  props.setProperties({ ADMIN_SALT: salt, ADMIN_HASH: hash_(salt, pw) });
  return { ok: true };
}

// ---------- Reading everything the admin page edits ----------
function buildDraft_() {
  var out = buildContent_();
  var spotsPerMonth = out.settings.spotsPerMonth;
  out.settings.spotsLeft = spotsPerMonth ? Math.max(0, spotsPerMonth - confirmedThisMonth_()) : null;
  out.draft = true;
  return out;
}

function columnKind_(tab, h) {
  if (/^Show|^Pay now$|^Shipping included$|^Ask height|^Customizable|^Ready in 4 days$/i.test(h)) return 'yesno';
  if (/^Level \(/i.test(h)) return 'level';
  if (tab === 'Gallery' && h === 'Category') return 'category';
  if (/photo|video link|captions .* \(file\)|image/i.test(h)) return 'photo';
  if (/^Order$|\(LE\)|\(days\)|^Price$/i.test(h) && !(tab === 'Add-ons' && /^Price/i.test(h))) return 'number';
  if (/\((EN|AR)\)|what's included|^Arabic$|^English$|note/i.test(h)) return 'long';
  return 'text';
}

function readTab_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh || sh.getLastRow() < 1) return null;
  var values = sh.getDataRange().getDisplayValues();
  var headers = values.shift().map(function (h) { return String(h).trim(); });
  var key = TABLE_KEYS[name] || headers[0];
  var keyCol = headers.indexOf(key);
  var rows = [];
  values.forEach(function (r, i) {
    if (r.join('').trim() === '') return;
    rows.push({ row: i + 2, values: r });
  });
  return { name: name, headers: headers, key: key, keyCol: keyCol,
    kinds: headers.map(function (h) { return columnKind_(name, h); }), rows: rows };
}

function adminLoad_() {
  var s = settings_();
  var tabs = {};
  ['Ready Designs', 'Tiers', 'Add-ons', 'Gallery', 'Videos', 'Sections', 'Shipping areas', 'Builder Options'].forEach(function (n) {
    var t = readTab_(n);
    if (t) tabs[n] = t;
  });
  var text = [];
  var tsh = SpreadsheetApp.getActive().getSheetByName('Text');
  tsh.getDataRange().getDisplayValues().slice(1).forEach(function (r, i) {
    if (r[0]) text.push({ row: i + 2, key: String(r[0]).trim(), where: r[1], en: r[2], ar: r[3], note: r[4] || '' });
  });
  return {
    ok: true,
    settings: ADMIN_SETTINGS.map(function (x) { return { name: x[0], kind: x[1], help: x[2], value: s[x[0]] || '' }; }),
    text: text,
    tabs: tabs,
    statuses: ADMIN_STATUSES,
    levels: LEVELS,
    categories: ['Swords', 'Mounts & stands', 'Plaques', 'Pedestals', 'Bookshelf', 'Review'],
    published: PropertiesService.getScriptProperties().getProperty('PUBLISHED_AT') || ''
  };
}

// ---------- Checking and saving ----------
function safeCell_(v, max) {
  var s = String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ').slice(0, max || 3000);
  return /^[=+@]|^-[\d(=]/.test(s) ? "'" + s : s;
}

// Returns an error in plain words, or '' when the value is fine.
function checkValue_(kind, v, header, isKey) {
  v = String(v == null ? '' : v).trim();
  if (isKey && !v) return '"' + header + '" can\'t be empty.';
  if (kind === 'number' && v !== '' && !/^\d+(\.\d+)?$/.test(v.replace(/,/g, '')) && !/^to fill$/i.test(v)) return '"' + header + '" must be a number (like 3200), or empty.';
  if (kind === 'yesno' && v !== '' && !/^(yes|no)$/i.test(v)) return '"' + header + '" must be Yes or No.';
  if (kind === 'level' && v !== '' && LEVELS.indexOf(v) === -1) return '"' + header + '" must be Classic, Premium or Collector\'s.';
  if (kind === 'phone' && v !== '' && !/^\+?\d{10,15}$/.test(v.replace(/[\s\-()]/g, ''))) return 'The WhatsApp number must be 10 to 15 digits.';
  return '';
}

function setSetting_(name, value) {
  var sh = SpreadsheetApp.getActive().getSheetByName('Settings');
  var names = sh.getRange(1, 1, Math.max(1, sh.getLastRow()), 1).getValues().map(function (r) { return String(r[0]).trim(); });
  var r = names.indexOf(name);
  if (r === -1) sh.appendRow([name, value]);
  else sh.getRange(r + 1, 2).setValue(value);
}

// changes: [{ type: 'text', row, key, en, ar }, { type: 'setting', name, value }, { type: 'cell', tab, row, key, values: { header: value } }]
function adminSave_(changes) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 400) return { ok: false, error: 'invalid' };
  var ss = SpreadsheetApp.getActive();
  var errors = [];
  var plan = [];
  changes.forEach(function (ch, i) {
    if (!ch || typeof ch !== 'object') { errors.push('Change ' + (i + 1) + ' is not valid.'); return; }
    if (ch.type === 'text') {
      var tsh = ss.getSheetByName('Text');
      var row = Number(ch.row);
      if (!(row >= 2) || String(tsh.getRange(row, 1).getValue()).trim() !== String(ch.key)) { errors.push('The text "' + ch.key + '" moved in the sheet. Reload the page and try again.'); return; }
      plan.push(function () { tsh.getRange(row, 3, 1, 2).setValues([[safeCell_(ch.en), safeCell_(ch.ar)]]); });
    } else if (ch.type === 'setting') {
      var def = ADMIN_SETTINGS.filter(function (x) { return x[0] === ch.name; })[0];
      if (!def) { errors.push('Unknown setting "' + ch.name + '".'); return; }
      var v = String(ch.value == null ? '' : ch.value).trim();
      if (def[0] === 'Instagram handle') {
        v = v.replace(/^@/, '');
        if (!/^[A-Za-z0-9._]{1,30}$/.test(v)) { errors.push('The Instagram username can only have letters, numbers, dots and _.'); return; }
        v = '@' + v;
      }
      var e = checkValue_(def[1], v, def[0], false);
      if (e) { errors.push(e); return; }
      plan.push(function () { setSetting_(def[0], safeCell_(v, 300)); });
    } else if (ch.type === 'cell') {
      var t = readTab_(String(ch.tab));
      if (!t || TABLE_KEYS[t.name] === undefined) { errors.push('Unknown table.'); return; }
      var r = Number(ch.row);
      var current = t.rows.filter(function (x) { return x.row === r; })[0];
      if (!current || (t.keyCol >= 0 && current.values[t.keyCol] !== String(ch.key))) { errors.push('"' + ch.key + '" moved in the sheet. Reload the page and try again.'); return; }
      var vals = ch.values || {};
      var bad = false;
      Object.keys(vals).forEach(function (h) {
        var col = t.headers.indexOf(h);
        if (col === -1) { errors.push('Unknown column "' + h + '".'); bad = true; return; }
        var err = checkValue_(t.kinds[col], vals[h], h, col === t.keyCol);
        if (err) { errors.push((ch.key ? ch.key + ': ' : '') + err); bad = true; }
      });
      if (bad) return;
      plan.push(function () {
        var sh = ss.getSheetByName(t.name);
        Object.keys(vals).forEach(function (h) {
          var v2 = String(vals[h] == null ? '' : vals[h]).trim();
          if (t.kinds[t.headers.indexOf(h)] === 'number') v2 = v2.replace(/,/g, '');
          sh.getRange(r, t.headers.indexOf(h) + 1).setValue(safeCell_(v2));
        });
      });
    } else errors.push('Change ' + (i + 1) + ' is not valid.');
  });
  if (errors.length) return { ok: false, error: 'check', messages: errors.slice(0, 10) };
  plan.forEach(function (fn) { fn(); });
  return { ok: true, saved: plan.length };
}

// Add, delete or move a row in a table tab. op: add | delete | up | down
function adminRow_(d) {
  var t = readTab_(String(d.tab));
  if (!t || TABLE_KEYS[t.name] === undefined) return { ok: false, error: 'invalid' };
  var sh = SpreadsheetApp.getActive().getSheetByName(t.name);
  if (d.op === 'add') {
    var vals = d.values || {};
    var row = t.headers.map(function (h, i) {
      var v = vals[h] == null ? '' : String(vals[h]).trim();
      return v;
    });
    var errs = [];
    t.headers.forEach(function (h, i) { var e = checkValue_(t.kinds[i], row[i], h, i === t.keyCol); if (e) errs.push(e); });
    if (t.keyCol >= 0 && t.rows.some(function (x) { return x.values[t.keyCol] === row[t.keyCol]; })) errs.push('"' + row[t.keyCol] + '" already exists.');
    if (errs.length) return { ok: false, error: 'check', messages: errs };
    sh.appendRow(row.map(function (v) { return safeCell_(v); }));
    return { ok: true };
  }
  var r = Number(d.row);
  var current = t.rows.filter(function (x) { return x.row === r; })[0];
  if (!current || (t.keyCol >= 0 && current.values[t.keyCol] !== String(d.key))) return { ok: false, error: 'check', messages: ['That row moved in the sheet. Reload the page and try again.'] };
  if (d.op === 'delete') { sh.deleteRow(r); return { ok: true }; }
  if (d.op === 'up' || d.op === 'down') {
    var idx = t.rows.indexOf(current);
    var other = t.rows[d.op === 'up' ? idx - 1 : idx + 1];
    if (!other) return { ok: true };
    var width = sh.getLastColumn();
    var a = sh.getRange(r, 1, 1, width), b = sh.getRange(other.row, 1, 1, width);
    var av = cellsOf_(a), bv = cellsOf_(b);
    a.setValues(bv); b.setValues(av);
    return { ok: true };
  }
  return { ok: false, error: 'invalid' };
}

// A range's cells, keeping formulas where there are any.
function cellsOf_(range) {
  var v = range.getValues(), f = range.getFormulas();
  return v.map(function (row, i) { return row.map(function (x, j) { return f[i][j] || x; }); });
}

// ---------- Photos ----------
function folderProp_(prop, name) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(prop);
  if (id) { try { return DriveApp.getFolderById(id); } catch (err) { /* deleted: make a new one */ } }
  var f = DriveApp.createFolder(name);
  props.setProperty(prop, f.getId());
  return f;
}

function adminUpload_(d) {
  var ext = IMAGE_TYPES[d.mime];
  if (!ext || typeof d.data !== 'string' || d.data.length > Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 + 8) return { ok: false, error: 'check', messages: ['Photos only (JPG, PNG, WEBP), up to 10 MB.'] };
  var bytes = Utilities.base64Decode(d.data);
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES || !looksLikeImage_(bytes, d.mime)) return { ok: false, error: 'check', messages: ['That file is not a photo.'] };
  var name = String(d.name || 'photo').replace(/[^\w.\- ]+/g, '').slice(0, 60) || 'photo';
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HHmm');
  var file = folderProp_('PHOTOS_FOLDER_ID', PHOTOS_FOLDER_NAME).createFile(Utilities.newBlob(bytes, d.mime, stamp + '_' + name.replace(/\.\w+$/, '') + '.' + ext));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { ok: true, link: 'https://drive.google.com/file/d/' + file.getId() + '/view' };
}

// ---------- Publish, versions, restore ----------
function snapshotTabs_() {
  var ss = SpreadsheetApp.getActive();
  var tabs = {};
  CONTENT_TABS.forEach(function (n) {
    var sh = ss.getSheetByName(n);
    if (!sh || sh.getLastRow() < 1) return;
    tabs[n] = cellsOf_(sh.getDataRange());
  });
  return tabs;
}

function saveVersion_(label, content) {
  var now = new Date();
  var when = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  var data = { when: when, label: label || '', content: content, tabs: snapshotTabs_() };
  var file = folderProp_('VERSIONS_FOLDER_ID', VERSIONS_FOLDER_NAME)
    .createFile('Version ' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH-mm-ss') + (label ? ' - ' + String(label).replace(/[^\w ]+/g, '').slice(0, 40) : '') + '.json',
      JSON.stringify(data), 'application/json');
  return { id: file.getId(), when: when };
}

function writePublished_(content) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PUBLISHED_FILE_ID');
  var text = JSON.stringify(content);
  var file = null;
  if (id) { try { file = DriveApp.getFileById(id); file.setContent(text); } catch (err) { file = null; } }
  if (!file) {
    file = folderProp_('VERSIONS_FOLDER_ID', VERSIONS_FOLDER_NAME).createFile('LIVE - what the website shows (do not delete).json', text, 'application/json');
    props.setProperty('PUBLISHED_FILE_ID', file.getId());
  }
  props.setProperty('PUBLISHED_AT', Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'));
  clearContentCache_();
}

function readPublished_() {
  var id = PropertiesService.getScriptProperties().getProperty('PUBLISHED_FILE_ID');
  if (!id) return null;
  try { return JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString()); } catch (err) { console.error(err); return null; }
}

function adminPublish_(label) {
  var content = buildContent_();
  if (!content.text || !Object.keys(content.text).length) return { ok: false, error: 'check', messages: ['The Text tab looks empty, so nothing was published.'] };
  var v = saveVersion_(label || 'Published', content);
  writePublished_(content);
  return { ok: true, when: v.when };
}

function adminVersions_() {
  var folder = folderProp_('VERSIONS_FOLDER_ID', VERSIONS_FOLDER_NAME);
  var files = [], it = folder.getFilesByType('application/json');
  while (it.hasNext()) {
    var f = it.next();
    if (/^Version /.test(f.getName())) files.push({ id: f.getId(), name: f.getName().replace(/^Version /, '').replace(/\.json$/, ''), t: f.getDateCreated().getTime() });
  }
  files.sort(function (a, b) { return b.t - a.t; });
  return { ok: true, versions: files.slice(0, 40), published: PropertiesService.getScriptProperties().getProperty('PUBLISHED_AT') || '' };
}

// Puts an older version back: the sheet tabs AND the website. The current state is saved first, so this can be undone.
function adminRestore_(id) {
  if (!/^[\w-]{20,}$/.test(id)) return { ok: false, error: 'invalid' };
  var data;
  try {
    var f = DriveApp.getFileById(id);
    if (!/^Version /.test(f.getName())) return { ok: false, error: 'invalid' };
    data = JSON.parse(f.getBlob().getDataAsString());
  } catch (err) { return { ok: false, error: 'invalid' }; }
  if (!data || !data.content || !data.tabs) return { ok: false, error: 'invalid' };
  saveVersion_('Before restoring ' + data.when, buildContent_());
  var ss = SpreadsheetApp.getActive();
  Object.keys(data.tabs).forEach(function (n) {
    if (CONTENT_TABS.indexOf(n) === -1) return;
    var cells = data.tabs[n];
    if (!cells.length || !cells[0].length) return;
    var sh = ss.getSheetByName(n) || ss.insertSheet(n);
    sh.getRange(1, 1, Math.max(sh.getLastRow(), cells.length), Math.max(sh.getLastColumn(), cells[0].length)).clearContent();
    sh.getRange(1, 1, cells.length, cells[0].length).setValues(cells);
  });
  writePublished_(data.content);
  return { ok: true, when: data.when };
}

// ---------- Orders ----------
function adminOrders_() {
  var sh = ordersSheet_();
  if (sh.getLastRow() < 2) return { ok: true, orders: [], statuses: ADMIN_STATUSES };
  var m = colMap_(sh);
  var first = Math.max(2, sh.getLastRow() - 199);
  var rows = sh.getRange(first, 1, sh.getLastRow() - first + 1, sh.getLastColumn()).getValues();
  var tz = Session.getScriptTimeZone();
  var get = function (r, h) { return m[h] === undefined ? '' : r[m[h]]; };
  var orders = rows.filter(function (r) { return r[m['Order code']]; }).map(function (r) {
    var when = get(r, 'Received');
    return {
      code: get(r, 'Order code'), received: when instanceof Date ? Utilities.formatDate(when, tz, 'yyyy-MM-dd HH:mm') : String(when),
      status: get(r, 'Status'), name: get(r, 'Name'), phone: String(get(r, 'Phone')).replace(/^'/, ''), instagram: get(r, 'Instagram'),
      city: [get(r, 'Governorate'), get(r, 'Area')].filter(String).join(', '),
      items: get(r, 'Items') || [get(r, 'Tier'), get(r, 'Design')].filter(String).join(' · '),
      total: get(r, 'Estimated total'), deposit: get(r, 'Deposit')
    };
  }).reverse();
  return { ok: true, orders: orders, statuses: ADMIN_STATUSES };
}

function adminStatus_(code, status) {
  if (STATUSES.indexOf(status) === -1) return { ok: false, error: 'invalid' };
  var sh = ordersSheet_();
  var r = findOrderRow_(sh, code);
  if (r < 2) return { ok: false, error: 'check', messages: ['Order ' + code + ' was not found.'] };
  sh.getRange(r, colMap_(sh)['Status'] + 1).setValue(status);
  applyStatus_(sh, r); // same emails and dates as changing it in the sheet
  return { ok: true };
}
