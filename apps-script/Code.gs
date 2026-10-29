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

var STATUSES = ['New', 'Waitlist', 'Deposit uploaded', 'Deposit screenshot missing', 'Confirmed', 'Deposit paid', 'In progress',
  'Balance due', 'Balance paid', 'Shipped', 'Delivered', 'Cancelled'];
// Extra columns for shop orders (added to the Orders sheet automatically if missing).
var SHOP_COLUMNS = ['Type', 'Items', 'Instagram', 'Items total', 'Shipping estimate', 'Reminder'];
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
      askHeight: isYes_(columnStarting_(r, 'Ask height'))
    };
  });
  var addons = readTable_('Add-ons').filter(function (r) { return isYes_(r['Show on site']) && r['Add-on']; }).map(function (r) {
    return {
      name: r['Add-on'], nameAr: r['Name (AR)'], price: toNum_(r['Price (LE)']), priceText: r['Price (LE)'], photo: r['Photo (Drive link)'],
      benefitEn: r['Benefit line (EN)'], benefitAr: r['Benefit line (AR)'], bonusEn: r['Bonus / note'], bonusAr: r['Bonus / note (AR)']
    };
  });
  return {
    s: s, tiers: tiers, designs: designs, addons: addons,
    depositPct: firstNum_(s['Deposit %'], 50),
    shipping: firstNum_(s['Shipping (LE)'], 200),
    shippingOutsideMin: firstNum_(s['Shipping outside Cairo & Giza'], 300)
  };
}

function publicContent_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('content');
  if (hit) return JSON.parse(hit);

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
  var spotsPerMonth = firstNum_(s['Spots per month'], 0);

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
      contactEmailEnc: Utilities.base64Encode((s['Order email'] || '').split('').reverse().join('')),
      instagram: String(s['Instagram handle'] || '').replace(/^@/, '').trim(),
      whatsapp: String(s['WhatsApp number'] || '').replace(/[^\d]/g, ''),
      express: isYes_(s['Express delivery on']),
      daysToMake: firstNum_(s['Days to make'], 14),
      plaqueUpgrade: firstNum_(s["Collector's plaque upgrade (LE)"], 1200),
      spotsPerMonth: spotsPerMonth,
      spotsLeft: spotsPerMonth ? Math.max(0, spotsPerMonth - confirmedThisMonth_()) : null
    },
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
  try {
    cache.put('content', JSON.stringify(out), CONTENT_CACHE_SECONDS);
  } catch (err) {
    // Google's cache holds at most 100 KB; when the Text tab grows past that, skip caching rather than fail.
  }
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
  var shipping = inCairoGiza ? c.shipping : c.shippingOutsideMin;
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
      'Status': full ? 'Waitlist' : 'New',
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

  countEvent_('order:sent');
  notifyMeyerNewOrder_(c.s, row, inCairoGiza);
  sendCustomer_(c.s, row['Email'].replace(/^'/, ''), row['Language'], 'received', {
    code: code, tier: tier.name, design: row['Design'], estimate: estimate, outside: !inCairoGiza, waitlist: full
  });
  return { ok: true, code: code };
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
  MailApp.sendEmail({
    to: s['Order email'],
    subject: 'Payment screenshot uploaded: ' + code,
    body: 'A payment screenshot was uploaded for ' + code + '.\n\nCheck it in your InstaPay app before changing the status.\n\n' +
      'Screenshot: ' + link + '\nOrders sheet: ' + sh.getParent().getUrl()
  });
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

  var r = e.range.getRow();
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
    CacheService.getScriptCache().remove('content'); // refresh the spots counter
    if (sendCustomer_(s, to, info.lang, 'deposit', info)) logEmail('Deposit received');
  } else if (status === 'Balance due') {
    var paid = Number(row[m['Deposit']]) || 0;
    var balance = Math.max(0, price - paid);
    sh.getRange(r, m['Balance'] + 1).setValue(balance);
    info.amount = balance;
    if (sendCustomer_(s, to, info.lang, 'balance', info)) logEmail('Balance due');
  } else if (status === 'Cancelled') {
    CacheService.getScriptCache().remove('content');
  }
}

/**
 * Sends one sample "order received" email, exactly as a customer would get it,
 * to the business address in Settings. Run it from the editor to check the sender.
 */
function sendTestEmail() {
  var s = settings_();
  var ok = sendCustomer_(s, s['Order email'], 'en', 'received', {
    code: 'GD-TEST', tier: 'Premium', design: 'Dragon Slayer', estimate: 4500, outside: false, waitlist: false
  });
  Logger.log(ok ? 'Test email sent to ' + s['Order email'] + ' by the Guts Decor mailer.' :
    'Not sent: connect the mailer first (MAILER_URL and MAILER_SECRET in Project Settings → Script Properties). Nothing was sent to the customer.');
}

function warnMeyer_(s, code, msg) {
  MailApp.sendEmail({ to: s['Order email'], subject: 'Action needed on ' + code, body: msg });
}

// =====================================================================
// Emails
// =====================================================================
function notifyMeyerNewOrder_(s, row, inCairoGiza) {
  var lines = ORDER_COLUMNS.filter(function (h) { return row.hasOwnProperty(h) && row[h] !== ''; }).map(function (h) {
    var v = row[h] instanceof Date ? Utilities.formatDate(row[h], Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') : String(row[h]).replace(/^'/, '');
    return h + ': ' + v;
  });
  MailApp.sendEmail({
    to: s['Order email'],
    subject: (row['Status'] === 'Waitlist' ? '[Waitlist] ' : '') + 'New order request ' + row['Order code'] + ' (' + row['Tier'] + ')',
    body: lines.join('\n') + (inCairoGiza ? '' : '\n\nOutside Cairo & Giza: shipping estimate is the minimum, check the real cost.') +
      '\n\nOrders sheet: ' + ordersSheet_().getParent().getUrl() +
      '\n\nTo confirm: fill "Final price (you fill)" if needed, then set Status to "Confirmed". The customer gets your InstaPay details automatically.'
  });
}

/**
 * Customer emails are sent BY the Guts Decor account itself, through the mailer (Mailer.gs) that lives there.
 * "Send mail as" is never used: it leaks the personal address in the email's hidden details.
 * If the mailer isn't connected or fails, nothing goes to the customer and Meyer is told instead.
 */
function sendCustomer_(s, to, lang, kind, info) {
  return deliver_(s, to, customerMessage_(s, lang, kind, info), info.code);
}

// Sends one customer email through the Guts Decor mailer (never from the personal account).
function deliver_(s, to, msg, code) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('MAILER_URL');
  var secret = props.getProperty('MAILER_SECRET');
  try {
    if (Session.getEffectiveUser().getEmail().toLowerCase() === String(s['Order email']).toLowerCase()) {
      MailApp.sendEmail({ to: to, subject: msg.subject, body: msg.body, name: 'Guts Decor' });
      return true;
    }
    if (url && secret) {
      var res = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'text/plain',
        payload: JSON.stringify({ secret: secret, to: to, subject: msg.subject, body: msg.body }),
        muteHttpExceptions: true
      });
      if (JSON.parse(res.getContentText()).ok) return true;
    }
  } catch (err) {
    console.error(err);
  }
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
  var sign = ar ? '\n\nماير\nGuts Decor\nhttps://www.instagram.com/guts_san_store/' : '\n\nMeyer\nGuts Decor\nhttps://www.instagram.com/guts_san_store/';

  if (kind === 'received') {
    var est = info.estimate ? (info.outside ? (ar ? 'من ' : 'from ') : '') + money_(info.estimate, lang) : (ar ? 'بالاتفاق' : 'by quote');
    return ar ? {
      subject: 'طلبك وصلني: ' + info.code,
      body: 'أهلًا،\n\nشكرًا على طلبك! كود طلبك: ' + info.code + '\n\nالمستوى: ' + info.tier + '\nالتصميم: ' + info.design +
        '\nالسعر التقريبي: ' + est + '\n\n' +
        (info.waitlist ? 'الشهر ده اتملى، فهحجزلك مكان في الشهر الجاي.\n\n' : '') +
        'هرد عليك خلال ٢٤ ساعة وأأكدلك الميعاد والسعر النهائي. مفيش أي دفع قبل ما أأكد.\n\n' + scamGeneric + sign
    } : {
      subject: 'I got your order request: ' + info.code,
      body: 'Hi,\n\nThank you for your request! Your order code is ' + info.code + '.\n\nLevel: ' + info.tier + '\nDesign: ' + info.design +
        '\nEstimated price: ' + est + '\n\n' +
        (info.waitlist ? "This month is full, so I'll reserve you a spot for next month.\n\n" : '') +
        "I'll reply within 24 hours to confirm your date and final price. Nothing is due before I confirm.\n\n" + scamGeneric + sign
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

  var name = p.d.name, parts = [], each = p.d.price;
  if (p.type === 'design' && p.d.classicPrice) {
    if (line.version !== 'Classic' && line.version !== 'Premium') return null;
    if (line.version === 'Classic') each = p.d.classicPrice;
    parts.push(line.version);
  }
  if (p.type === 'design' && p.d.askHeight) {
    var h = Number(line.height);
    if (!(h >= 160 && h <= 190)) return null;
    parts.push('height ' + h + ' cm');
  }
  if (p.type === 'tier') {
    var sword = String(line.sword || '').trim();
    if (sword.length < 2 || sword.length > 80) return null;
    parts.push('sword: ' + sword);
  }
  var collectors = p.type === 'tier' && /^collector/i.test(p.d.name);
  if (line.blade) {
    if (!collectors || String(line.blade).length > 20) return null;
    parts.push('name on blade: ' + String(line.blade).trim());
  }
  if (line.plaque) {
    if (!collectors) return null;
    each += firstNum_(c.s["Collector's plaque upgrade (LE)"], 1200);
    parts.push('BIG PLAQUE UPGRADE');
  }
  if (line.mount) {
    var mName = String(line.mount.name || '');
    var carve = String(line.mount.carve || '').trim();
    if (p.type === 'addon' || mName !== p.d.matchingMount || !carve || carve.length > 10) return null;
    var m = c.addons.filter(function (a) { return a.name === mName && typeof a.price === 'number'; })[0];
    if (!m) return null;
    each += m.price;
    parts.push('+ ' + mName + ', carved name: ' + carve);
  }
  var total = each * qty;
  return {
    total: total, plaque: !!line.plaque, shippingIncluded: p.type === 'design' && !!p.d.shippingIncluded,
    label: qty + ' x ' + name + (parts.length ? ' (' + parts.join('; ') + ')' : '') + ' = ' + total.toLocaleString('en-US') + ' LE'
  };
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
    !d.foundVia || ['Instagram post', 'Instagram ad', 'A friend', 'Other'].indexOf(d.foundVia) !== -1,
    d.terms === true
  ];
  if (checks.indexOf(false) !== -1) return { ok: false, error: 'invalid' };

  var itemsTotal = priced.reduce(function (s, p) { return s + p.total; }, 0);
  var allShipFree = priced.every(function (p) { return p.shippingIncluded; });
  var inCairoGiza = d.governorate === 'Cairo' || d.governorate === 'Giza';
  var shipping = allShipFree ? 0 : (inCairoGiza ? c.shipping : c.shippingOutsideMin);
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
      'Status': receipt ? 'Deposit uploaded' : 'Deposit screenshot missing',
      'Type': 'Shop', 'Items': priced.map(function (p) { return p.label; }).join('\n'),
      'Name': clean_(d.name, 80), 'Email': clean_(email, 120), 'Phone': "'" + phoneDigits,
      'Instagram': clean_(String(d.instagram || '').replace(/^@/, ''), 30),
      'Governorate': d.governorate, 'Area': clean_(d.area, 120), 'Street': clean_(d.street, 120),
      'Building': clean_(d.building, 30), 'Floor': clean_(d.floor, 20), 'Apartment': clean_(d.apartment, 20),
      'Landmark': clean_(d.landmark, 120), 'Gift': d.isGift ? 'Yes' : 'No', 'Recipient': d.isGift ? clean_(d.recipient, 80) : '',
      'Occasion date': d.occasionDate || '', 'Notes': clean_(d.notes, 500), 'Found us via': d.foundVia || '',
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
  MailApp.sendEmail({
    to: s['Order email'],
    subject: (receipt ? '' : '[No screenshot yet] ') + 'New shop order ' + code + ' (' + itemsTotal.toLocaleString('en-US') + ' LE)',
    body: 'Items:\n' + row['Items'] + '\n\nItems total: ' + itemsTotal + ' LE\nDeposit (' + c.depositPct + '%): ' + deposit + ' LE\n' +
      'Shipping estimate: ' + shipping + ' LE' + (inCairoGiza || allShipFree ? '' : ' (minimum, check the real cost)') + '\n\n' +
      ['Name', 'Email', 'Phone', 'Instagram', 'Governorate', 'Area', 'Street', 'Building', 'Floor', 'Apartment', 'Landmark',
        'Gift', 'Recipient', 'Occasion date', 'Notes', 'Found us via'].filter(function (h) { return row[h]; })
        .map(function (h) { return h + ': ' + String(row[h]).replace(/^'/, ''); }).join('\n') +
      '\n\nScreenshot: ' + (receipt || 'not uploaded yet') +
      '\n\nCheck the deposit in your InstaPay app, then set Status to "Deposit paid". If you can not take the order, refund within 24 hours.' +
      '\nOrders sheet: ' + sh.getParent().getUrl()
  });
  deliver_(s, email, shopEmail_(s, d.lang, code, priced, itemsTotal, deposit, shipping, !!receipt), code);
  return { ok: true, code: code, deposit: deposit, screenshot: !!receipt };
}

function shopEmail_(s, lang, code, priced, itemsTotal, deposit, shipping, gotShot) {
  var payLink = SITE_URL + 'pay.html?code=' + encodeURIComponent(code);
  var name = s['InstaPay name to check'];
  var body = [
    tx_('email.hi', lang),
    tx_('email.shop.intro', lang, { code: code }),
    tx_('email.shop.items', lang) + '\n' + priced.map(function (p) { return '- ' + p.label; }).join('\n'),
    tx_('email.shop.total', lang, { total: money_(itemsTotal, lang), deposit: money_(deposit, lang), shipping: money_(shipping, lang) }),
    gotShot ? tx_('email.shop.gotShot', lang) : tx_('email.shop.noShot', lang, { link: payLink }),
    tx_('email.shop.next', lang),
    tx_('email.refund', lang),
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
