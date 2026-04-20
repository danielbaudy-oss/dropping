/* Shared currency symbol resolver */

const CURRENCY_SYMBOLS = {
  GBP: '£', EUR: '€', USD: '$', CHF: 'CHF', SEK: 'kr',
  DKK: 'kr', NOK: 'kr', PLN: 'zł', CAD: '$', AUD: '$'
};

function getCurrencyInfo(code, fallback) {
  return {
    code: code,
    symbol: CURRENCY_SYMBOLS[code] || (fallback ? fallback.symbol : '€')
  };
}

function getCurrSymbol(code) {
  return CURRENCY_SYMBOLS[code] || '€';
}

module.exports = { CURRENCY_SYMBOLS, getCurrencyInfo, getCurrSymbol };
