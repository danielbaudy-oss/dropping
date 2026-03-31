/* ============================
   SHEET HELPERS
   ============================ */

function getSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    var h = {
      'Config': [['key', 'value']],
      'Users': [['chat_id', 'username', 'first_name', 'size_tops', 'size_bottoms', 'region', 'product_count', 'joined_at', 'api_secret']],
      'Products': [['id', 'chat_id', 'product_code', 'color_code', 'color_name', 'size_code', 'name', 'image_url', 'product_url', 'initial_price', 'last_price', 'lowest_price', 'target_price', 'currency', 'region', 'status', 'added_at', 'store', 'last_checked']],
      'PriceHistory': [['product_code', 'region', 'price', 'on_sale', 'checked_at']],
      'Notifications': [['chat_id', 'product_code', 'old_price', 'new_price', 'sent_at']]
    };
    if (h[name]) { sh.getRange(1, 1, 1, h[name][0].length).setValues(h[name]); sh.setFrozenRows(1); }
  }
  return sh;
}

function migrateProductsSheet() {
  var s = getSheet('Products');
  var headers = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
  var lastRow = s.getLastRow();

  // Add 'store' column if missing
  if (headers.indexOf('store') === -1) {
    var col = headers.length + 1;
    s.getRange(1, col).setValue('store');
    if (lastRow > 1) {
      var vals = [];
      for (var i = 0; i < lastRow - 1; i++) vals.push(['uniqlo']);
      s.getRange(2, col, lastRow - 1, 1).setValues(vals);
    }
    headers.push('store');
    Logger.log('Migrated: added store column');
  }

  // Add 'last_checked' column if missing
  if (headers.indexOf('last_checked') === -1) {
    var col = headers.length + 1;
    s.getRange(1, col).setValue('last_checked');
    if (lastRow > 1) {
      var vals = [];
      for (var i = 0; i < lastRow - 1; i++) vals.push(['']);
      s.getRange(2, col, lastRow - 1, 1).setValues(vals);
    }
    Logger.log('Migrated: added last_checked column');
  }
}

function migrateUsersSheet() {
  var s = getSheet('Users');
  var headers = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
  var lastRow = s.getLastRow();

  var columnsToAdd = ['api_secret', 'sale_alerts', 'sale_prefs'];
  var defaults = {
    'api_secret': function() { return Utilities.getUuid().substring(0, 16); },
    'sale_alerts': function() { return 'off'; },
    'sale_prefs': function() { return ''; }
  };

  for (var c = 0; c < columnsToAdd.length; c++) {
    var colName = columnsToAdd[c];
    if (headers.indexOf(colName) === -1) {
      var col = headers.length + 1;
      s.getRange(1, col).setValue(colName);
      if (lastRow > 1) {
        var vals = [];
        for (var i = 0; i < lastRow - 1; i++) vals.push([defaults[colName]()]);
        s.getRange(2, col, lastRow - 1, 1).setValues(vals);
      }
      headers.push(colName);
      Logger.log('Migrated: added ' + colName + ' column to Users');
    }
  }
}

/* ============================
   CONFIG
   ============================ */

function getConfig(key) {
  var d = getSheet('Config').getDataRange().getValues();
  for (var i = 1; i < d.length; i++) if (d[i][0] === key) return d[i][1];
  return null;
}

function setConfig(key, value) {
  var s = getSheet('Config'), d = s.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) if (d[i][0] === key) { s.getRange(i + 1, 2).setValue(value); return; }
  s.appendRow([key, value]);
}

/* ============================
   USERS
   ============================ */

function ensureUser(chatId, username, firstName) {
  var s = getSheet('Users'), d = s.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) if (String(d[i][0]) === String(chatId)) return;
  var secret = Utilities.getUuid().substring(0, 16);
  s.appendRow([chatId, username || '', firstName || '', 'M', 'M', 'es', 0, new Date().toISOString(), secret]);
}

function getUser(chatId) {
  var s = getSheet('Users'), d = s.getDataRange().getValues(), h = d[0];
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][0]) === String(chatId)) {
      var u = {};
      for (var j = 0; j < h.length; j++) u[h[j]] = d[i][j];
      return u;
    }
  }
  return null;
}

function getUserSecret(chatId) {
  var u = getUser(chatId);
  return u ? (u.api_secret || '') : '';
}

function verifyAuth(chatId, secret) {
  if (!chatId || !secret) return false;
  var stored = getUserSecret(chatId);
  return stored && stored === secret;
}

function updateUser(chatId, field, value) {
  var s = getSheet('Users'), d = s.getDataRange().getValues(), c = d[0].indexOf(field);
  if (c === -1) return;
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][0]) === String(chatId)) { s.getRange(i + 1, c + 1).setValue(value); return; }
  }
}

/* ============================
   PRODUCTS
   ============================ */

function getColumnIndex(headers, name) {
  for (var i = 0; i < headers.length; i++) {
    if (headers[i] === name) return i;
  }
  return -1;
}

function getUserProducts(chatId) {
  var s = getSheet('Products'), d = s.getDataRange().getValues(), h = d[0], r = [];
  var statusIdx = getColumnIndex(h, 'status');
  var cidIdx = getColumnIndex(h, 'chat_id');

  for (var i = 1; i < d.length; i++) {
    if (String(d[i][cidIdx]) === String(chatId) && d[i][statusIdx] === 'watching') {
      var p = {};
      for (var j = 0; j < h.length; j++) p[h[j]] = d[i][j];
      if (!p.store) p.store = 'uniqlo';
      r.push(p);
    }
  }
  return r;
}

function getAllActiveProducts() {
  var s = getSheet('Products'), d = s.getDataRange().getValues(), h = d[0], r = [];
  var statusIdx = getColumnIndex(h, 'status');

  for (var i = 1; i < d.length; i++) {
    if (d[i][statusIdx] === 'watching') {
      var p = {};
      for (var j = 0; j < h.length; j++) p[h[j]] = d[i][j];
      if (!p.store) p.store = 'uniqlo';
      r.push(p);
    }
  }
  return r;
}

function addProduct(chatId, d) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    throw new Error('System busy, try again');
  }

  try {
    var s = getSheet('Products');
    var headers = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
    var numCols = headers.length;

    var id = Utilities.getUuid().substring(0, 8);
    var row = s.getLastRow() + 1;

    var values = [];
    for (var c = 0; c < numCols; c++) {
      var col = headers[c];
      switch (col) {
        case 'id': values.push(id); break;
        case 'chat_id': values.push(String(chatId)); break;
        case 'product_code': values.push(d.product_code || ''); break;
        case 'color_code': values.push(d.color_code || ''); break;
        case 'color_name': values.push(d.color_name || ''); break;
        case 'size_code': values.push(d.size_code || ''); break;
        case 'name': values.push(d.name || ''); break;
        case 'image_url': values.push(d.image_url || ''); break;
        case 'product_url': values.push(d.product_url || ''); break;
        case 'initial_price': values.push(String(d.initial_price || 0)); break;
        case 'last_price': values.push(String(d.last_price || d.initial_price || 0)); break;
        case 'lowest_price': values.push(String(d.lowest_price || d.initial_price || 0)); break;
        case 'target_price': values.push(d.target_price ? String(d.target_price) : ''); break;
        case 'currency': values.push(d.currency || 'EUR'); break;
        case 'region': values.push(d.region || 'es'); break;
        case 'status': values.push('watching'); break;
        case 'added_at': values.push(new Date().toISOString()); break;
        case 'store': values.push(d.store || 'uniqlo'); break;
        case 'last_checked': values.push(new Date().toISOString()); break;
        default: values.push(''); break;
      }
    }

    s.getRange(row, 1, 1, numCols).setNumberFormat('@');
    s.getRange(row, 1, 1, numCols).setValues([values]);

    var ipIdx = getColumnIndex(headers, 'initial_price');
    if (ipIdx !== -1) s.getRange(row, ipIdx + 1, 1, 3).setNumberFormat('0.00');

    return id;
  } finally {
    lock.releaseLock();
  }
}

function removeProductById(productId, chatId) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    throw new Error('System busy, try again');
  }

  try {
    var s = getSheet('Products'), d = s.getDataRange().getValues(), h = d[0];
    var idIdx = getColumnIndex(h, 'id');
    var cidIdx = getColumnIndex(h, 'chat_id');

    for (var i = 1; i < d.length; i++) {
      if (String(d[i][idIdx]) === String(productId) && String(d[i][cidIdx]) === String(chatId)) {
        s.deleteRow(i + 1);
        return true;
      }
    }
    return false;
  } finally {
    lock.releaseLock();
  }
}

function isAlreadyWatching(chatId, pc, cc) {
  var p = getUserProducts(chatId);
  for (var i = 0; i < p.length; i++) {
    if (p[i].product_code === pc && (p[i].color_code || '') === (cc || '')) return true;
  }
  return false;
}

function updateProductPriceById(productId, price, lowest) {
  var s = getSheet('Products'), d = s.getDataRange().getValues(), h = d[0];
  var idIdx = getColumnIndex(h, 'id');
  var lpIdx = getColumnIndex(h, 'last_price');

  for (var i = 1; i < d.length; i++) {
    if (String(d[i][idIdx]) === String(productId)) {
      s.getRange(i + 1, lpIdx + 1, 1, 2).setValues([[price, lowest]]);
      return true;
    }
  }
  return false;
}

function updateProduct(productId, chatId, data) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    throw new Error('System busy, try again');
  }

  try {
    var s = getSheet('Products'), d = s.getDataRange().getValues(), h = d[0];
    var idIdx = getColumnIndex(h, 'id');
    var cidIdx = getColumnIndex(h, 'chat_id');

    for (var i = 1; i < d.length; i++) {
      if (String(d[i][idIdx]) === String(productId) && String(d[i][cidIdx]) === String(chatId)) {
        var row = i + 1;
        var numCols = h.length;
        var values = s.getRange(row, 1, 1, numCols).getValues()[0];

        var fieldMap = {
          'color_code': data.color_code,
          'color_name': data.color_name,
          'size_code': data.size_code,
          'image_url': data.image_url,
          'product_url': data.product_url,
          'target_price': data.target_price
        };

        for (var field in fieldMap) {
          if (fieldMap[field] !== undefined) {
            var fi = getColumnIndex(h, field);
            if (fi !== -1) values[fi] = field === 'size_code' || field === 'color_code' ? String(fieldMap[field]) : fieldMap[field];
          }
        }

        s.getRange(row, 1, 1, numCols).setNumberFormat('@');
        s.getRange(row, 1, 1, numCols).setValues([values]);

        var ipIdx = getColumnIndex(h, 'initial_price');
        if (ipIdx !== -1) s.getRange(row, ipIdx + 1, 1, 3).setNumberFormat('0.00');

        return true;
      }
    }
    return false;
  } finally {
    lock.releaseLock();
  }
}

/* ============================
   HISTORY & NOTIFICATIONS
   ============================ */

function addPriceHistory(pc, region, price, onSale) {
  getSheet('PriceHistory').appendRow([pc, region, price, onSale ? 'TRUE' : 'FALSE', new Date().toISOString()]);
}

function logNotification(chatId, pc, oldP, newP) {
  getSheet('Notifications').appendRow([chatId, pc, oldP, newP, new Date().toISOString()]);
}

/* ============================
   CLEANUP — run monthly to prevent sheet bloat
   ============================ */

function cleanupOldHistory() {
  var s = getSheet('PriceHistory');
  var d = s.getDataRange().getValues();
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90); // keep 90 days

  var keep = [d[0]]; // header
  for (var i = 1; i < d.length; i++) {
    var ts = d[i][4];
    if (!ts || new Date(ts) >= cutoff) keep.push(d[i]);
  }

  var removed = d.length - keep.length;
  if (removed > 0) {
    s.clearContents();
    if (keep.length > 0) {
      s.getRange(1, 1, keep.length, keep[0].length).setValues(keep);
    }
  }

  Logger.log('Cleanup: removed ' + removed + ' old history rows');
}