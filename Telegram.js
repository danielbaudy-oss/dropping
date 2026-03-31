function getBotToken() { return getConfig('bot_token'); }

function sendMessage(chatId, text, options) {
  var token = getBotToken();
  var payload = { chat_id: chatId, text: text, parse_mode: 'Markdown' };
  if (options && options.parse_mode) payload.parse_mode = options.parse_mode;
  var r = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  return JSON.parse(r.getContentText());
}

function sendPhoto(chatId, photoUrl, caption) {
  var token = getBotToken();
  var payload = { chat_id: chatId, photo: photoUrl, caption: caption, parse_mode: 'Markdown' };
  var r = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendPhoto', {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  var result = JSON.parse(r.getContentText());
  if (!result.ok) {
    Logger.log('sendPhoto failed (' + (result.description || 'unknown') + '), falling back to text');
    return sendMessage(chatId, caption);
  }
  return result;
}