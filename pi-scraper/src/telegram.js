/* Telegram API wrapper */

const { getConfig } = require('./db');

let cachedToken = null;
async function getBotToken() {
  if (cachedToken) return cachedToken;
  cachedToken = await getConfig('bot_token');
  if (!cachedToken) throw new Error('bot_token not found in dropping.config');
  return cachedToken;
}

async function tgRequest(method, payload) {
  const token = await getBotToken();
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return res.json();
}

async function sendMessage(chatId, text, options) {
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'Markdown',
    ...(options || {})
  };
  return tgRequest('sendMessage', payload);
}

async function sendPhoto(chatId, photoUrl, caption) {
  const payload = {
    chat_id: chatId,
    photo: photoUrl,
    caption: caption,
    parse_mode: 'Markdown'
  };
  const result = await tgRequest('sendPhoto', payload);
  if (!result.ok) {
    console.log(`sendPhoto failed (${result.description || 'unknown'}), falling back to text`);
    return sendMessage(chatId, caption);
  }
  return result;
}

module.exports = { sendMessage, sendPhoto };
