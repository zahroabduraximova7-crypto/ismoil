// store.js — xavfsiz JSON saqlash: atomic write, backup, tiklash

const fs = require('fs');
const path = require('path');
const { nowStr } = require('./utils');

const DATA_FILE = path.join(process.cwd(), 'data.json');
const BACKUP_DIR = path.join(process.cwd(), 'backups');
const TMP_FILE = path.join(process.cwd(), 'data.tmp.json');

// Boshlang'ich bo'sh ma'lumotlar strukturasi
function defaultData() {
  return {
    settings: {
      orgName: 'TUNKA HISOB',
      phone: '',
      address: '',
      dollarRate: 12500,
      minStock: 100,
      servicePrice: 2000,
      timezone: 'Asia/Samarkand',
      receiptFooter: 'Rahmat!',
    },
    users: [],        // { id, role, telegramId, name, active }
    customers: [],    // { id, name, phone, note, telegramId, createdAt, status }
    products: [],     // { id, category, unit, name, type, color, unitPrice, minStock, status, createdAt }
    saleMenuProducts: [], // { id, productId, createdAt }
    stock: [],        // { productId, quantity }
    stockMovements: [], // Includes unit, before/after quantity, valuation, batch number and linked sale when available.
    rolls: [],        // { id, productId, rollNumber, quantity, remaining, unitPrice, date, note }
    sales: [],        // Legacy single-line fields remain; new sales include immutable item lines and price/unit snapshots.
    payments: [],     // Includes method and optional debt allocations for FIFO, per-debt settlement.
    debts: [],        // { id, customerId, saleId, amount, reason, userId, date, status }
    income: [],       // { id, source, customerId, amount, note, userId, date }
    expenses: [],     // { id, type, amount, note, userId, date }
    auditLogs: [],    // { id, userId, action, object, prevValue, newValue, date }
    notifications: [], // { id, type, message, date }
    backups: [],      // { id, filename, date, size }
    counters: {
      user: 0,
      customer: 0,
      product: 0,
      roll: 0,
      sale: 0,
      debt: 0,
      payment: 0,
      expense: 0,
      income: 0,
      stockMovement: 0,
      audit: 0,
      backup: 0,
    },
  };
}

// Papkalarni yaratish
function ensureDirs() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// JSON buzilganligini tekshirish
function tryParse(jsonStr) {
  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

// data.json ni yuklash yoki yaratish
function loadData() {
  ensureDirs();
  if (!fs.existsSync(DATA_FILE)) {
    const d = defaultData();
    atomicSave(d);
    return d;
  }
  let raw;
  try {
    raw = fs.readFileSync(DATA_FILE, 'utf8');
  } catch (e) {
    // backupdan tiklashga urinish
    return restoreFromLatestBackup();
  }
  const parsed = tryParse(raw);
  if (parsed) return mergeDefaults(parsed);
  // JSON buzilgan — backupdan tiklash
  console.error('⚠️ data.json buzilgan, backupdan tiklanmoqda...');
  return restoreFromLatestBackup();
}

// Yangi maydonlar qo'shilganda default bilan birlashtirish
function mergeDefaults(data) {
  const def = defaultData();
  const result = { ...def, ...data };
  for (const key of Object.keys(def)) {
    if (def[key] && typeof def[key] === 'object' && !Array.isArray(def[key]) && key !== 'counters') {
      result[key] = { ...def[key], ...(data[key] || {}) };
    }
    if (Array.isArray(def[key]) && !Array.isArray(result[key])) {
      result[key] = def[key];
    }
  }
  if (!result.counters) result.counters = def.counters;
  return result;
}

// Backupdan tiklash
function restoreFromLatestBackup() {
  ensureDirs();
  let files = [];
  try {
    files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.json')).sort().reverse();
  } catch {}
  if (files.length === 0) {
    console.error('⚠️ Backup topilmadi, yangi bo\'sh baza yaratiladi.');
    const d = defaultData();
    atomicSave(d);
    return d;
  }
  for (const f of files) {
    try {
      const raw = fs.readFileSync(path.join(BACKUP_DIR, f), 'utf8');
      const parsed = tryParse(raw);
      if (parsed) {
        console.log(`✅ Backupdan tiklandi: ${f}`);
        atomicSave(parsed);
        return mergeDefaults(parsed);
      }
    } catch {}
  }
  console.error('⚠️ Barcha backuplar buzilgan, yangi baza yaratiladi.');
  const d = defaultData();
  atomicSave(d);
  return d;
}

// Atomic save: avval temp faylga, keyin almashtirish
function atomicSave(data) {
  ensureDirs();
  const jsonStr = JSON.stringify(data, null, 2);
  try {
    fs.writeFileSync(TMP_FILE, jsonStr, 'utf8');
    fs.renameSync(TMP_FILE, DATA_FILE);
  } catch (e) {
    console.error('❌ Ma\'lumotni saqlashda xatolik:', e.message);
    try { if (fs.existsSync(TMP_FILE)) fs.unlinkSync(TMP_FILE); } catch {}
    throw e;
  }
}

// Backup fayl yaratish
function createBackup(data) {
  ensureDirs();
  const { nowStr } = require('./utils');
  const ts = nowStr().replace(/[: ]/g, '-');
  const filename = `backup_${ts}.json`;
  const filepath = path.join(BACKUP_DIR, filename);
  try {
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
    const stats = fs.statSync(filepath);
    return { filename, filepath, size: stats.size, date: nowStr() };
  } catch (e) {
    console.error('Backup yaratishda xatolik:', e.message);
    return null;
  }
}

// Backuplar ro'yxati
function listBackups() {
  ensureDirs();
  let files = [];
  try {
    files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.json')).sort().reverse();
  } catch {}
  return files.map(f => {
    let size = 0;
    let date = '';
    try {
      const stats = fs.statSync(path.join(BACKUP_DIR, f));
      size = stats.size;
      date = stats.mtime.toISOString().replace('T', ' ').substring(0, 19);
    } catch {}
    return { filename: f, size, date };
  });
}

// Backup faylni o'qish
function readBackupFile(filename) {
  try {
    const filepath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filepath)) return null;
    const raw = fs.readFileSync(filepath, 'utf8');
    return tryParse(raw);
  } catch {
    return null;
  }
}

module.exports = {
  loadData,
  atomicSave,
  createBackup,
  listBackups,
  readBackupFile,
  defaultData,
  mergeDefaults,
  restoreFromLatestBackup,
  DATA_FILE,
  BACKUP_DIR,
};
