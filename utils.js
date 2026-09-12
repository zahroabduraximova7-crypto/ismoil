// utils.js — yordamchi funksiyalar: vaqt, formatlash, validatsiya, ID

const { DateTime } = require('luxon');

const TIMEZONE = 'Asia/Samarkand';

// Joriy vaqt ISO formatda: YYYY-MM-DD HH:mm:ss
function nowStr() {
  return DateTime.now().setZone(TIMEZONE).toFormat('yyyy-MM-dd HH:mm:ss');
}

// Sanagina: YYYY-MM-DD
function todayStr() {
  return DateTime.now().setZone(TIMEZONE).toFormat('yyyy-MM-dd');
}

// Oy: YYYY-MM
function monthStr() {
  return DateTime.now().setZone(TIMEZONE).toFormat('yyyy-MM');
}

// Vaqtni chiroyli ko'rinishga keltirish: DD.MM.YYYY HH:mm:ss
function prettyDateTime(str) {
  if (!str) return '-';
  // str: "2026-09-11 18:42:15"
  const [d, t] = str.split(' ');
  if (!d) return str;
  const [y, m, day] = d.split('-');
  if (!y || !m || !day) return str;
  return `${day}.${m}.${y} ${t || ''}`.trim();
}

// Sanani chiroyli ko'rinishga: DD.MM.YYYY
function prettyDate(str) {
  if (!str) return '-';
  const [y, m, d] = str.split('-');
  if (!y || !m || !d) return str;
  return `${d}.${m}.${y}`;
}

// Oy nomi o'zbekcha
const MONTH_NAMES_UZ = [
  'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
  'Iyul', 'Avgust', 'Sentabr', 'Oktyabr', 'Noyabr', 'Dekabr'
];

function prettyMonth(str) {
  // str: "2026-09"
  const [y, m] = str.split('-');
  if (!y || !m) return str;
  const mi = parseInt(m, 10) - 1;
  if (mi < 0 || mi > 11) return str;
  return `${MONTH_NAMES_UZ[mi]} ${y}`;
}

// Sonni mingliklar bo'yicha ajratish: 1240000 -> "1 240 000"
function fmtNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  const num = Math.round(Number(n));
  return num.toLocaleString('ru-RU').replace(/,/g, ' ');
}

// Pul formati: 1240000 -> "1 240 000 so'm"
function fmtSom(n) {
  return `${fmtNum(n)} so'm`;
}

// Dollar formati: 99.2 -> "99.20 USD"
function fmtUsd(n) {
  if (n === null || n === undefined || isNaN(n)) n = 0;
  return `${Number(n).toFixed(2)} USD`;
}

// Validatsiya: manfiy emas, son
function isPositiveNumber(val) {
  const n = Number(val);
  return !isNaN(n) && n > 0;
}

function isNonNegativeNumber(val) {
  const n = Number(val);
  return !isNaN(n) && n >= 0;
}

function isPositiveInt(val) {
  const n = Number(val);
  return Number.isInteger(n) && n > 0;
}

// String bo'sh emas
function isNonEmptyStr(val) {
  return typeof val === 'string' && val.trim().length > 0;
}

// ID generator: prefix + 5 xonali raqam
function genId(prefix, counter) {
  return `${prefix}-${String(counter).padStart(5, '0')}`;
}

//kunlik sotuv summasi formatting for Telegram message
function escapeMarkdown(text) {
  if (!text) return '';
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!]/g, (m) => '\\' + m);
}

module.exports = {
  TIMEZONE,
  nowStr,
  todayStr,
  monthStr,
  prettyDateTime,
  prettyDate,
  prettyMonth,
  fmtNum,
  fmtSom,
  fmtUsd,
  isPositiveNumber,
  isNonNegativeNumber,
  isPositiveInt,
  isNonEmptyStr,
  genId,
  escapeMarkdown,
};
