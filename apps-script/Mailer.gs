/**
 * Guts Decor — mailer.
 * Lives in the Guts Decor business Google account (NOT the personal one).
 *
 * The order system sends each customer email here, and this account sends it itself,
 * so customers only ever see the Guts Decor business address.
 *
 * It only works with the private key (MAILER_SECRET) that setup() creates.
 * The key lives in Script Properties, never in this file.
 */

var DAILY_LIMIT = 80; // stays under Google's free sending limit

// Run once from the editor. It creates the private key and shows it in the log.
function setup() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('MAILER_SECRET');
  if (!secret) {
    secret = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('MAILER_SECRET', secret);
  }
  Logger.log('Mailer ready. Sending as: ' + Session.getEffectiveUser().getEmail());
  Logger.log('Private key (copy it, you will paste it into the order system): ' + secret);
}

function doPost(e) {
  var d;
  try {
    d = JSON.parse(e.postData.contents);
  } catch (err) {
    return out_({ ok: false, error: 'invalid' });
  }
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('MAILER_SECRET');
  if (!secret || d.secret !== secret) return out_({ ok: false, error: 'denied' });

  var to = String(d.to || '').trim();
  var subject = String(d.subject || '');
  var body = String(d.body || '');
  if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/.test(to) || !subject || !body || subject.length > 200 || body.length > 20000) {
    return out_({ ok: false, error: 'invalid' });
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var key = 'sent_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
    var count = Number(props.getProperty(key) || 0);
    if (count >= DAILY_LIMIT) return out_({ ok: false, error: 'limit' });
    MailApp.sendEmail({ to: to, subject: subject, body: body, name: 'Guts Decor' });
    props.setProperty(key, String(count + 1));
  } finally {
    lock.releaseLock();
  }
  return out_({ ok: true });
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
