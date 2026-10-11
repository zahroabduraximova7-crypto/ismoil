// index.js — TUNKA HISOB BOTI: Professional Telegram ERP tizimi
// Node.js + Telegraf + Luxon + PDFKit

require('dotenv').config();
const { Telegraf, Markup, session } = require('telegraf');
const fs = require('fs');
const path = require('path');

const {
  nowStr, todayStr, monthStr,
  prettyDateTime, prettyDate, prettyMonth,
  fmtNum, fmtSom, fmtUsd,
  isPositiveNumber, isNonNegativeNumber, isPositiveInt, isNonEmptyStr,
  genId,
} = require('./utils');

const {
  loadData, atomicSave, createBackup, listBackups, readBackupFile, mergeDefaults,
} = require('./store');

const {
  generateReceipt, generateDailyReport, generateMonthlyReport,
} = require('./pdf');

const {
  parseQuantity, formatQuantity, getProductCategory,
  getDebtAllocations, allocateDebtPayment,
  planStockReduction, calculateStockBalance,
  SALE_CATEGORY_LIST, SALE_MENU_CHOICES, recoverOrphanInventoryProducts,
  receiptSellerName,
} = require('./domain');

// ============================================================
// SOZLAMALAR
// ============================================================

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID, 10);
const PRIVATE_GROUP_ID = process.env.PRIVATE_GROUP_ID ? parseInt(process.env.PRIVATE_GROUP_ID, 10) : null;

if (!BOT_TOKEN || !ADMIN_ID) {
  console.error('❌ BOT_TOKEN va ADMIN_ID .env faylda bo\'lishi shart!');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ============================================================
// MA'LUMOTLAR BAZASI (global)
// ============================================================

let DB = loadData();

function save() {
  atomicSave(DB);
}

function saveMutation(mutate) {
  const originalDB = JSON.parse(JSON.stringify(DB));
  try {
    const result = mutate();
    save();
    return result;
  } catch (e) {
    DB = originalDB;
    throw e;
  }
}

function repairOrphanInventoryProducts() {
  const original = JSON.parse(JSON.stringify(DB));
  const recovered = recoverOrphanInventoryProducts(DB);
  if (!recovered.length) return true;

  const backup = createBackup(original);
  if (!backup) {
    DB = original;
    console.error('❌ Yetim ombor mahsulotlari topildi, ammo xavfsizlik backupini yaratib bo\'lmadi. Bot ishga tushirilmadi.');
    return false;
  }
  try {
    const actorId = DB.users.find(user => user.role === 'admin')?.id || 'USR-00001';
    recovered.forEach(product => {
      auditLog(actorId, 'Ombor mahsuloti tarixdan tiklandi', product.id, '', `${product.category} — ${product.name} ${product.type}`);
    });
    save();
    console.log(`✅ Ombor tarixidan ${recovered.length} ta mahsulot yozuvi tiklandi. Backup: ${backup.filename}`);
    return true;
  } catch (e) {
    DB = original;
    console.error('❌ Yetim mahsulotlarni tiklab saqlash muvaffaqiyatsiz:', e.message);
    return false;
  }
}

// ID generator
function nextId(prefix) {
  const key = prefix.toLowerCase();
  const keyMap = {
    'USR': 'user', 'CUST': 'customer', 'PROD': 'product', 'ROLL': 'roll',
    'SALE': 'sale', 'DEBT': 'debt', 'PAY': 'payment', 'EXP': 'expense',
    'INC': 'income', 'STMV': 'stockMovement', 'AUD': 'audit', 'BKP': 'backup',
  };
  const counterKey = keyMap[prefix] || key;
  DB.counters[counterKey] = (DB.counters[counterKey] || 0) + 1;
  return genId(prefix, DB.counters[counterKey]);
}

// ============================================================
// FOYDALANUVCHI ANIQLASH
// ============================================================

function getUserByTelegramId(telegramId) {
  return DB.users.find(u => u.telegramId === telegramId && u.active);
}

function isAuthorized(ctx) {
  const tid = ctx.from?.id;
  if (!tid) return false;
  if (tid === ADMIN_ID) return true;
  return DB.users.some(u => u.telegramId === tid && u.active && u.role === 'worker');
}

function getUser(ctx) {
  const tid = ctx.from?.id;
  if (tid === ADMIN_ID) {
    // Admin har doim mavjud
    let admin = DB.users.find(u => u.role === 'admin');
    if (!admin) {
      admin = {
        id: 'USR-00001',
        role: 'admin',
        telegramId: tid,
        name: 'ADMIN',
        active: true,
      };
      DB.users.push(admin);
      save();
    }
    return admin;
  }
  return getUserByTelegramId(tid);
}

function isAdmin(ctx) {
  return ctx.from?.id === ADMIN_ID;
}

// ============================================================
// AUDIT LOG
// ============================================================

function auditLog(userId, action, object, prevValue, newValue) {
  DB.auditLogs.push({
    id: nextId('AUD'),
    userId,
    action,
    object,
    prevValue: prevValue ? String(prevValue) : '',
    newValue: newValue ? String(newValue) : '',
    date: nowStr(),
  });
}

// ============================================================
// MAXFIY GURUHGA YUBORISH
// ============================================================

async function sendToGroup(text) {
  if (!PRIVATE_GROUP_ID) return;
  try {
    await bot.telegram.sendMessage(PRIVATE_GROUP_ID, text);
  } catch (e) {
    console.error('Guruhga yuborishda xatolik:', e.message);
  }
}

// ============================================================
// KAM QOLDIQ OGOHLANTIRISH
// ============================================================

function checkLowStock(productId) {
  const product = DB.products.find(p => p.id === productId);
  if (!product || product.status === 'archived') return;
  const stock = DB.stock.find(s => s.productId === productId);
  const qty = stock ? stock.quantity : 0;
  const alert = (DB.notifications || []).find(item => item.type === 'low_stock' && item.productId === productId && item.active);
  if (qty <= product.minStock && !alert) {
    const unit = getProductUnit(product);
    const msg = `⚠️ ${getProductCategory(product)} KAM QOLDI\n\n${product.name} ${product.type}\n\nQoldiq: ${formatQuantity(qty, unit)} ${unit}\nMinimal qoldiq: ${formatQuantity(product.minStock, unit)} ${unit}`;
    sendToGroup(msg);
    bot.telegram.sendMessage(ADMIN_ID, msg).catch(() => {});
    DB.notifications = DB.notifications || [];
    DB.notifications.push({ id: `LOW_${productId}`, type: 'low_stock', productId, message: msg, date: nowStr(), active: true });
    save();
  } else if (qty > product.minStock && alert) {
    alert.active = false;
    alert.resolvedAt = nowStr();
    save();
  }
}

// ============================================================
// OMBOR OPERATSIYALARI
// ============================================================

function getStockQuantity(productId) {
  const s = DB.stock.find(s => s.productId === productId);
  return s ? s.quantity : 0;
}

function getProductUnit(product) {
  return product?.unit || (['DUGA', 'DELA'].includes(getProductCategory(product)) ? 'dona' : 'metr');
}

function addStock(productId, quantity, rollId, note, userId, metadata = {}) {
  const productUnit = metadata.unit || DB.products.find(p => p.id === productId)?.unit || 'metr';
  quantity = productUnit === 'metr' ? Math.round(Number(quantity) * 1000) / 1000 : Math.round(Number(quantity));
  let stock = DB.stock.find(s => s.productId === productId);
  if (!stock) {
    stock = { productId, quantity: 0 };
    DB.stock.push(stock);
  }
  const before = stock.quantity;
  stock.quantity += quantity;

  DB.stockMovements.push({
    id: nextId('STMV'),
    productId,
    type: 'in',
    quantity,
    rollId: rollId || '',
    note: note || '',
    userId,
    date: nowStr(),
    unit: metadata.unit || 'metr',
    category: metadata.category || getProductCategory(DB.products.find(p => p.id === productId)),
    unitPrice: Number(metadata.unitPrice) || 0,
    totalValue: Number(metadata.totalValue) || 0,
    batchNumber: metadata.batchNumber || '',
    quantityBefore: Number.isFinite(metadata.before) ? metadata.before : before,
    quantityAfter: Number.isFinite(metadata.after) ? metadata.after : stock.quantity,
  });
}

function reconcileRollBalances(productId) {
  const stockQty = getStockQuantity(productId);
  const rolls = DB.rolls.filter(roll => roll.productId === productId)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));
  let remaining = Math.max(0, stockQty);
  for (let index = rolls.length - 1; index >= 0; index--) {
    const roll = rolls[index];
    const available = Math.max(0, Number(roll.quantity) || 0);
    roll.remaining = Math.min(available, remaining);
    remaining -= roll.remaining;
  }
}

function reduceStock(productId, quantity, userId, saleId) {
  const stock = DB.stock.find(s => s.productId === productId);
  if (!stock || stock.quantity + 1e-9 < quantity) return false;
  reconcileRollBalances(productId);
  const rolls = DB.rolls.filter(roll => roll.productId === productId)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));
  let remainingToAllocate = quantity;
  const rollAllocations = [];
  for (const roll of rolls) {
    if (remainingToAllocate <= 0) break;
    const available = Math.max(0, Number(roll.remaining) || 0);
    const taken = Math.min(available, remainingToAllocate);
    if (taken > 0) {
      roll.remaining -= taken;
      rollAllocations.push({ rollId: roll.id, quantity: taken });
      remainingToAllocate -= taken;
    }
  }
  if (remainingToAllocate > 1e-8 && rolls.length) {
    reconcileRollBalances(productId);
    rollAllocations.length = 0;
  }
  const before = stock.quantity;
  stock.quantity = Math.round((stock.quantity - quantity) * 1000) / 1000;

  DB.stockMovements.push({
    id: nextId('STMV'),
    productId,
    type: 'out',
    quantity,
    rollId: '',
    note: `Sotuv: ${saleId}`,
    userId,
    date: nowStr(),
    unit: DB.products.find(p => p.id === productId)?.unit || 'metr',
    category: getProductCategory(DB.products.find(p => p.id === productId)),
    quantityBefore: before,
    quantityAfter: stock.quantity,
    rollAllocations,
    saleId,
  });
  return true;
}

function returnStock(productId, quantity, userId, saleId) {
  let stock = DB.stock.find(s => s.productId === productId);
  if (!stock) {
    stock = { productId, quantity: 0 };
    DB.stock.push(stock);
  }
  const before = stock.quantity;
  stock.quantity = Math.round((stock.quantity + quantity) * 1000) / 1000;
  const saleMovement = DB.stockMovements.find(movement => movement.productId === productId && movement.type === 'out' && movement.saleId === saleId);
  if (saleMovement?.rollAllocations?.length) {
    saleMovement.rollAllocations.forEach(allocation => {
      const roll = DB.rolls.find(item => item.id === allocation.rollId);
      if (roll) roll.remaining = Math.min(Number(roll.quantity) || 0, (Number(roll.remaining) || 0) + Number(allocation.quantity || 0));
    });
  } else {
    reconcileRollBalances(productId);
  }
  DB.stockMovements.push({
    id: nextId('STMV'),
    productId,
    type: 'cancel',
    quantity,
    rollId: '',
    note: `Sotuv bekor qilindi: ${saleId}`,
    userId,
    date: nowStr(),
    unit: DB.products.find(p => p.id === productId)?.unit || 'metr',
    category: getProductCategory(DB.products.find(p => p.id === productId)),
    quantityBefore: before,
    quantityAfter: stock.quantity,
    saleId,
  });
}

// ============================================================
// KLAVIATURALAR
// ============================================================

function adminMenuKeyboard() {
  return Markup.keyboard([
    ['📦 Ombor', '🛒 Sotuv qilish'],
    ['👥 Mijozlar', '🔴 Qarzdorlar'],
    ['📥 Tunka kirimi', '💰 Pul kirimi', '📤 Chiqim'],
    ['📊 Kunlik hisobot', '📅 Oylik hisobot'],
    ['📜 Tarix', '🧾 Cheklar'],
    ['⚙️ Sozlamalar', '👑 Admin paneli'],
  ]).resize();
}

function workerMenuKeyboard() {
  return Markup.keyboard([
    ['🛒 Sotuv qilish', '👥 Mijozlar'],
    ['🔴 Qarzdorlar'],
    ['🧾 Mening cheklarim', '📜 Mening sotuvlarim'],
  ]).resize();
}

function backKeyboard() {
  return Markup.keyboard([['⬅️ Orqaga', '🏠 Bosh menyu']]).resize();
}

function cancelKeyboard() {
  return Markup.keyboard([['❌ Bekor qilish']]).resize();
}

function homeKeyboard(ctx) {
  return isAdmin(ctx) ? adminMenuKeyboard() : workerMenuKeyboard();
}

// Inline back button
function inlineBack(callbackData = 'home') {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⬅️ Orqaga', callbackData)],
  ]);
}

function productSavedKeyboard(productId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🏭 Mahsulotni ko\'rish', `prod_${productId}`)],
    [Markup.button.callback('📦 Omborga qaytish', 'warehouse')],
  ]);
}

// ============================================================
// SESSION / STATE BOSHQARUV
// ============================================================

bot.use(session());

// Foydalanuvchi holatini olish
function getState(ctx) {
  if (!ctx.session) ctx.session = {};
  return ctx.session;
}

function setState(ctx, partial) {
  if (!ctx.session) ctx.session = {};
  ctx.session = { ...ctx.session, ...partial };
}

function clearState(ctx) {
  ctx.session = {};
}

// ============================================================
// PERMISSION MIDDLEWARE
// ============================================================

async function authMiddleware(ctx, next) {
  if (!isAuthorized(ctx)) {
    return ctx.reply('❌ Sizda ushbu botdan foydalanish huquqi yo\'q.');
  }
  return next();
}

bot.use(async (ctx, next) => {
  try {
    return await authMiddleware(ctx, next);
  } catch (e) {
    console.error('Middleware xatolik:', e.message);
  }
});

// ============================================================
// ASOSIY MENYU
// ============================================================

async function showMenu(ctx) {
  clearState(ctx);
  const user = getUser(ctx);
  if (!user) return;

  if (isAdmin(ctx)) {
    // Admin dashboard
    const todaySales = DB.sales.filter(s => s.date.startsWith(todayStr()) && s.status === 'active');
    const todayTotal = todaySales.reduce((a, s) => a + s.total, 0);
    const totalDebt = DB.customers.reduce((a, c) => {
        return a + getCustomerDebt(c.id);
    }, 0);
    const stockByCategory = DB.products.reduce((totals, product) => {
      const category = getProductCategory(product);
      const unit = getProductUnit(product);
      totals[category] = totals[category] || { quantity: 0, unit };
      totals[category].quantity += getStockQuantity(product.id);
      return totals;
    }, {});
    const todayIncome = DB.income.filter(i => i.date.startsWith(todayStr())).reduce((a, i) => a + i.amount, 0);
    const todayExpenses = DB.expenses.filter(e => e.date.startsWith(todayStr())).reduce((a, e) => a + e.amount, 0);
    const lowStockCount = DB.products.filter(p => {
      if (p.status === 'archived') return false;
      return getStockQuantity(p.id) <= p.minStock;
    }).length;

    let msg = `🏭 TUNKA HISOB\n\n`;
    msg += `📦 Ombor: ${Object.entries(stockByCategory).map(([category, stock]) => `${category} ${formatQuantity(stock.quantity, stock.unit)} ${stock.unit}`).join(' | ') || 'bo\'sh'}\n`;
    msg += `🛒 Bugungi sotuv: ${fmtSom(todayTotal)}\n`;
    msg += `🔴 Jami nasiya: ${fmtSom(totalDebt)}\n`;
    msg += `💰 Bugun tushgan: ${fmtSom(todayIncome)}\n`;
    msg += `📤 Bugungi chiqim: ${fmtSom(todayExpenses)}\n`;
    msg += `⚠️ Kam qolgan mahsulot: ${lowStockCount} ta`;

    await ctx.reply(msg, adminMenuKeyboard());
  } else {
    await ctx.reply('🏭 TUNKA HISOB BOTI', workerMenuKeyboard());
  }
}

// ============================================================
// /start komandasi
// ============================================================

bot.start(async (ctx) => {
  if (!isAuthorized(ctx)) {
    return ctx.reply('❌ Sizda ushbu botdan foydalanish huquqi yo\'q.');
  }
  await ctx.reply(`🏭 TUNKA HISOB BOTI\n\nXush kelibsiz, ${getUser(ctx)?.name || 'Foydalanuvchi'}!`);
  await showMenu(ctx);
});

bot.command('menu', async (ctx) => {
  if (!isAuthorized(ctx)) return;
  await showMenu(ctx);
});

// ============================================================
// OMBOR BO'LIMI
// ============================================================

async function showWarehouse(ctx, page = 0) {
  if (!isAdmin(ctx)) return ctx.reply('❌ Bu bo\'lim faqat admin uchun.');
  if (page === 0) clearState(ctx);
  const products = DB.products.filter(p => p.status === 'active').sort((a, b) => getProductCategory(a).localeCompare(getProductCategory(b)) || a.name.localeCompare(b.name));
  const buttons = [];
  if (products.length === 0) {
    buttons.push([Markup.button.callback('➕ Mahsulot qo\'shish', 'stockin_menu')]);
    buttons.push([Markup.button.callback('🗃 Arxivlangan mahsulotlar', 'archived_products_page_0')]);
    buttons.push([Markup.button.callback('⬅️ Bosh menyu', 'home')]);
    return sendSalePrompt(ctx, '📦 Faol ombor mahsuloti yo\'q.\n\nYangi mahsulot qo\'shing yoki arxivlangan mahsulotlarni ko\'ring.', Markup.inlineKeyboard(buttons));
  }
  const perPage = 8;
  const pageCount = Math.ceil(products.length / perPage);
  const currentPage = Math.max(0, Math.min(pageCount - 1, Number(page) || 0));
  const categoryTotals = {};
  products.forEach(product => {
    const category = getProductCategory(product);
    const unit = getProductUnit(product);
    categoryTotals[category] = categoryTotals[category] || { quantity: 0, unit, count: 0 };
    categoryTotals[category].quantity += getStockQuantity(product.id);
    categoryTotals[category].count++;
  });
  let msg = `📦 OMBOR (${currentPage + 1}/${pageCount})\n\n`;
  msg += `Jami kategoriyalar:\n${Object.entries(categoryTotals).map(([category, total]) => `${category}: ${total.count} tur, ${formatQuantity(total.quantity, total.unit)} ${total.unit}`).join('\n')}\n\n`;
  products.slice(currentPage * perPage, (currentPage + 1) * perPage).forEach(p => {
    const qty = getStockQuantity(p.id);
    const unit = getProductUnit(p);
    const low = qty <= p.minStock ? ' ⚠️' : '';
    const movementList = DB.stockMovements.filter(m => m.productId === p.id);
    const totalIn = movementList.filter(m => m.type === 'in').reduce((sum, m) => sum + Number(m.quantity || 0), 0);
    const totalSold = movementList.filter(m => m.type === 'out').reduce((sum, m) => sum + Number(m.quantity || 0), 0);
    msg += `🏷 ${getProductCategory(p)} — ${p.name} ${p.type}\n`;
    msg += `📥 Kirim: ${formatQuantity(totalIn, unit)} ${unit} | 🛒 Sotilgan: ${formatQuantity(totalSold, unit)} ${unit}\n`;
    msg += `📦 Qoldiq: ${formatQuantity(qty, unit)} ${unit}${low}\n`;
    msg += `💰 Narx: ${fmtNum(p.unitPrice)} so'm/${unit}\n\n`;
  });
  products.slice(currentPage * perPage, (currentPage + 1) * perPage).forEach(p => buttons.push([Markup.button.callback(`${getProductCategory(p)} · ${p.name} ${p.type}`, `prod_${p.id}`)]));
  if (pageCount > 1) {
    const nav = [];
    if (currentPage > 0) nav.push(Markup.button.callback('⬅️ Oldingi', `warehouse_page_${currentPage - 1}`));
    if (currentPage + 1 < pageCount) nav.push(Markup.button.callback('Keyingi ➡️', `warehouse_page_${currentPage + 1}`));
    buttons.push(nav);
  }
  buttons.push([Markup.button.callback('➕ Mahsulot qo\'shish', 'stockin_menu')]);
  buttons.push([Markup.button.callback('🗃 Arxivlangan mahsulotlar', 'archived_products_page_0')]);
  buttons.push([Markup.button.callback('⬅️ Orqaga', 'home')]);
  return sendSalePrompt(ctx, msg, Markup.inlineKeyboard(buttons));
}

async function showArchivedProducts(ctx, page = 0) {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Faqat admin uchun.');
  const products = DB.products.filter(product => product.status === 'archived')
    .sort((a, b) => getProductCategory(a).localeCompare(getProductCategory(b)) || a.name.localeCompare(b.name));
  if (!products.length) return sendSalePrompt(ctx, '🗃 Arxivlangan mahsulotlar yo\'q.', inlineBack('warehouse'));

  const perPage = 8;
  const pageCount = Math.ceil(products.length / perPage);
  const currentPage = Math.max(0, Math.min(pageCount - 1, Number(page) || 0));
  const current = products.slice(currentPage * perPage, (currentPage + 1) * perPage);
  const message = `🗃 ARXIVLANGAN MAHSULOTLAR (${currentPage + 1}/${pageCount})\n\n${current.map(product => {
    const unit = getProductUnit(product);
    return `🏷 ${getProductCategory(product)} — ${product.name} ${product.type}\n📦 Qoldiq: ${formatQuantity(getStockQuantity(product.id), unit)} ${unit}`;
  }).join('\n\n')}\n\nMahsulotni ko\'rish yoki qayta faollashtirish uchun tanlang:`;
  const buttons = current.map(product => [Markup.button.callback(`${getProductCategory(product)} · ${product.name} ${product.type}`, `prod_${product.id}`)]);
  if (pageCount > 1) {
    const nav = [];
    if (currentPage > 0) nav.push(Markup.button.callback('⬅️ Oldingi', `archived_products_page_${currentPage - 1}`));
    if (currentPage + 1 < pageCount) nav.push(Markup.button.callback('Keyingi ➡️', `archived_products_page_${currentPage + 1}`));
    if (nav.length) buttons.push(nav);
  }
  buttons.push([Markup.button.callback('⬅️ Ombor', 'warehouse')]);
  return sendSalePrompt(ctx, message, Markup.inlineKeyboard(buttons));
}

// Mahsulot detallari
async function showProductDetail(ctx, productId) {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Faqat admin uchun.');
  const product = DB.products.find(p => p.id === productId);
  if (!product) return ctx.answerCbQuery('Mahsulot topilmadi.');

  const qty = getStockQuantity(productId);
  const totalIn = DB.stockMovements.filter(m => m.productId === productId && m.type === 'in').reduce((a, m) => a + m.quantity, 0);
  const totalOut = DB.stockMovements.filter(m => m.productId === productId && m.type === 'out').reduce((a, m) => a + m.quantity, 0);
  const totalReturned = DB.stockMovements.filter(m => m.productId === productId && m.type === 'cancel').reduce((a, m) => a + m.quantity, 0);
  const unit = getProductUnit(product);
  const value = qty * product.unitPrice;

  const firstIn = DB.stockMovements.find(m => m.productId === productId && m.type === 'in');

  let msg = `🏭 ${product.name} ${product.type}\n\n`;
  msg += `📅 Birinchi kirim: ${firstIn ? prettyDate(firstIn.date.split(' ')[0]) : '-'}\n\n`;
  msg += `🏷 Kategoriya: ${getProductCategory(product)}\n`;
  if (product.color) msg += `🎨 Rang: ${product.color}\n`;
  if (product.note) msg += `📝 Izoh: ${product.note}\n`;
  msg += `📥 Jami kirgan: ${formatQuantity(totalIn, unit)} ${unit}\n`;
  msg += `📉 Jami sotilgan: ${formatQuantity(totalOut, unit)} ${unit}\n`;
  msg += `↩️ Qaytgan: ${formatQuantity(totalReturned, unit)} ${unit}\n`;
  msg += `📦 Hozirgi qoldiq: ${formatQuantity(qty, unit)} ${unit}\n\n`;
  msg += `💰 Birlik narxi: ${fmtNum(product.unitPrice)} so'm/${unit}\n\n`;
  msg += `💵 Qoldiq qiymati:\n${fmtSom(value)}\n`;

  const buttons = [
    [Markup.button.callback('📥 Kirimlar tarixi', `prodin_${productId}`)],
    [Markup.button.callback('🛒 Sotuvlar tarixi', `prodsales_${productId}`)],
    [Markup.button.callback('📊 Qoldiq harakati', `prodmove_${productId}`)],
    [Markup.button.callback('✏️ Tahrirlash', `prodedit_${productId}`)],
    [Markup.button.callback('✏️ Rang / izoh', `prodeditmore_${productId}`)],
  ];
  if (product.status === 'active') {
    buttons.push([Markup.button.callback('🗑 Arxivlash', `prodarchive_${productId}`)]);
  } else {
    buttons.push([Markup.button.callback('♻️ Qayta faollashtirish', `prodrestore_${productId}`)]);
  }
  buttons.push([Markup.button.callback('⬅️ Orqaga', 'warehouse')]);

  await ctx.editMessageText(msg, Markup.inlineKeyboard(buttons));
}

// ============================================================
// SOTUV JARAYONI (multi-step session)
// ============================================================

function saleCategory(categoryId) {
  const predefined = SALE_CATEGORY_LIST.find(category => category.id === categoryId);
  if (predefined) return predefined;
  const menuProduct = (DB.saleMenuProducts || []).find(item => item.id === categoryId);
  const product = menuProduct && DB.products.find(p => p.id === menuProduct.productId && p.status === 'active');
  if (!product) return undefined;
  return {
    id: menuProduct.id,
    label: `🏭 ${product.name} ${product.type} sotish`,
    unit: getProductUnit(product),
    stock: true,
    stockProductId: product.id,
    reportCategory: getProductCategory(product),
  };
}

function getServicePrice() {
  const configuredPrice = Number(DB.settings.servicePrice);
  return Number.isFinite(configuredPrice) && configuredPrice >= 0 ? configuredPrice : 2000;
}

function getSaleUnitPrice(product, category) {
  if (category?.id === 'DELA' || getProductCategory(product) === 'DELA') return 20000;
  return Number(product?.unitPrice) || Number(category?.defaultPrice) || 0;
}

async function sendSalePrompt(ctx, message, keyboard) {
  if (ctx.callbackQuery) {
    try {
      return await ctx.editMessageText(message, keyboard);
    } catch {}
  }
  return ctx.reply(message, keyboard);
}

async function showSaleCategories(ctx) {
  const st = getState(ctx);
  const isMixed = st.saleMode === 'mixed';
  const visibleChoices = SALE_MENU_CHOICES.filter(category => !isMixed || category.id !== 'MIXED');
  const buttons = visibleChoices.map(category => [
    Markup.button.callback(category.label, `sellcat_${category.id}`),
  ]);
  if (isMixed) {
    buttons.push([Markup.button.callback('✅ Sotuvni yakunlash', 'sale_finish_items')]);
    buttons.push([Markup.button.callback('❌ Bekor qilish', 'cancel')]);
  }
  const items = st.saleItems || [];
  const itemSummary = items.length
    ? `\n\nSavat:\n${items.map((item, index) => `${index + 1}. ${item.productName}${item.productType ? ` ${item.productType}` : ''} — ${formatQuantity(item.quantity, item.unit)} ${item.unit} — ${fmtSom(item.total)}`).join('\n')}\nJami: ${fmtSom(items.reduce((sum, item) => sum + item.total, 0))}`
    : '';
  if (isMixed && items.length) {
    items.forEach((item, index) => buttons.push([Markup.button.callback(`🗑 ${index + 1}-qatorni olib tashlash`, `sale_item_remove_${index}`)]));
  }
  const message = `${isMixed ? '🛒 Aralash sotuv — mahsulot turini tanlang:' : '🛒 Sotuv turini tanlang:'}${itemSummary}`;
  return sendSalePrompt(ctx, message, Markup.inlineKeyboard(buttons));
}

async function showSaleCustomers(ctx) {
  setState(ctx, { step: 'sale_customer' });
  const customers = DB.customers.filter(c => c.status === 'active');
  const buttons = customers.slice(0, 20).map(c => [Markup.button.callback(`👤 ${c.name}`, `salecust_${c.id}`)]);
  buttons.push([Markup.button.callback('➕ Yangi mijoz', 'sale_new_customer')]);
  buttons.push([Markup.button.callback('❌ Bekor qilish', 'cancel')]);
  const list = customers.slice(0, 20).map(c => `• ${c.name} (${c.id})`).join('\n');
  const msg = customers.length ? `👤 Mijozni tanlang:\n\n${list}` : '👤 Mijozlar yo\'q. Yangi mijoz qo\'shing:';
  return sendSalePrompt(ctx, msg, Markup.inlineKeyboard(buttons));
}

async function startSale(ctx) {
  clearState(ctx);
  setState(ctx, { step: 'sale_category', saleMode: 'single', saleItems: [] });
  return showSaleCategories(ctx);
}

async function startSaleCategory(ctx, categoryId) {
  if (categoryId === 'MIXED') {
    setState(ctx, { step: 'sale_customer', saleMode: 'mixed', saleItems: [] });
    return showSaleCustomers(ctx);
  }
  if (!saleCategory(categoryId)) return ctx.answerCbQuery('Sotuv turi topilmadi.');
  const currentState = getState(ctx);
  if (currentState.saleMode === 'mixed' && currentState.saleCustomerId) {
    setState(ctx, { salePendingCategory: categoryId });
    return beginSaleItem(ctx, categoryId);
  }
  setState(ctx, { step: 'sale_customer', saleMode: 'single', saleCategoryId: categoryId, saleItems: [] });
  return showSaleCustomers(ctx);
}

async function saleNewCustomer(ctx) {
  setState(ctx, { step: 'sale_new_customer_name' });
  await sendSalePrompt(ctx, '👤 Mijoz ismi:', cancelKeyboard());
}

async function saleContinueForCustomer(ctx, customerId) {
  const customer = DB.customers.find(c => c.id === customerId);
  if (!customer) return ctx.answerCbQuery('Mijoz topilmadi.');
  const st = getState(ctx);
  setState(ctx, { step: st.saleMode === 'mixed' ? 'sale_category' : 'sale_customer', saleCustomerId: customerId });
  if (st.saleMode === 'mixed') return showSaleCategories(ctx);
  return beginSaleItem(ctx, st.saleCategoryId);
}

async function beginSaleItem(ctx, categoryId) {
  const st = getState(ctx);
  const customer = DB.customers.find(c => c.id === st.saleCustomerId);
  const category = saleCategory(categoryId);
  if (!category) return ctx.answerCbQuery('Sotuv turi topilmadi.');
  setState(ctx, { salePendingCategory: categoryId });

  if (category.stock || category.service) {
    if (category.service) {
      return sendSalePrompt(ctx, `👤 Mijoz: ${customer?.name || '-'}\n\nTunka mijozning o'zinikimi?`, Markup.inlineKeyboard([
        [Markup.button.callback('✅ Ha, mijozniki', 'service_owner_yes')],
        [Markup.button.callback('🏭 Yo\'q, ombordagi tunkadan', 'service_owner_no')],
        [Markup.button.callback('❌ Bekor qilish', 'cancel')],
      ]));
    }
    return showSaleStockProducts(ctx, categoryId);
  }

  const rate = Number(category.unitPrice ?? category.defaultPrice) || 0;
  setState(ctx, { step: 'sale_quantity', salePendingProductId: null, salePendingUnitPrice: rate, salePendingUnit: category.unit });
  return sendSalePrompt(ctx, `👤 Mijoz: ${customer?.name || '-'}\n\n${category.label}\nNarxi: ${fmtNum(rate)} so'm/${category.unit}\n\nMiqdor (${category.unit}) kiriting:`, cancelKeyboard());
}

async function showSaleStockProducts(ctx, categoryId) {
  const st = getState(ctx);
  const customer = DB.customers.find(c => c.id === st.saleCustomerId);
  const category = saleCategory(categoryId);
  const selectedProduct = category?.stockProductId
    ? DB.products.find(product => product.id === category.stockProductId)
    : null;
  const inventoryCategory = categoryId === 'USLUGA' ? 'TUNKA' : (selectedProduct ? getProductCategory(selectedProduct) : categoryId);
  const products = DB.products.filter(p => p.status === 'active'
    && getProductCategory(p) === inventoryCategory
    && (!category?.stockProductId || p.id === category.stockProductId)
    && getStockQuantity(p.id) > 0)
    .sort((a, b) => {
      const aFeatured = (DB.saleMenuProducts || []).some(item => item.productId === a.id) ? 0 : 1;
      const bFeatured = (DB.saleMenuProducts || []).some(item => item.productId === b.id) ? 0 : 1;
      return aFeatured - bFeatured || a.name.localeCompare(b.name);
    });
  if (!products.length) {
    if (getState(ctx).saleMode === 'mixed' && (getState(ctx).saleItems || []).length) {
      return showSaleCategories(ctx);
    }
    return sendSalePrompt(ctx, `📦 Sotish uchun omborda ${category?.label || 'mahsulot'} yo\'q.`, Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor qilish', 'cancel')]]));
  }
  setState(ctx, {
    step: 'sale_product',
    salePendingCategory: categoryId,
    saleProductChoices: products.map(product => product.id),
    saleProductChoiceIndex: 0,
  });
  return showSaleStockProductAt(ctx, 0);
}

async function showSaleStockProductAt(ctx, index) {
  const st = getState(ctx);
  const choices = st.saleProductChoices || [];
  const customer = DB.customers.find(c => c.id === st.saleCustomerId);
  const productId = choices[index];
  const product = DB.products.find(p => p.id === productId && p.status === 'active' && getStockQuantity(p.id) > 0);

  if (!product) {
    if (st.saleMode === 'mixed' && (st.saleItems || []).length) return showSaleCategories(ctx);
    return sendSalePrompt(ctx, '📦 Tanlash uchun boshqa mahsulot qolmadi.', Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Boshidan ko\'rish', `sellcat_${st.salePendingCategory}`)],
      [Markup.button.callback('❌ Bekor qilish', 'cancel')],
    ]));
  }

  setState(ctx, { step: 'sale_product', saleProductChoiceIndex: index });
  const service = st.salePendingCategory === 'USLUGA';
  const unit = saleCategory(st.salePendingCategory)?.unit || 'metr';
  const unitPrice = getSaleUnitPrice(product, saleCategory(st.salePendingCategory));
  const message = `👤 Mijoz: ${customer?.name || '-'}\n\n${service ? 'Usluga uchun shu tunka tanlanadimi?' : 'Sotiladigan mahsulot shu-mi?'}\n\n🏭 ${product.name} ${product.type}\n📦 Omborda: ${formatQuantity(getStockQuantity(product.id), unit)} ${unit}\n💰 Narxi: ${fmtNum(unitPrice)} so'm/${unit}\n\nMahsulot to'g'ri bo'lsa Ha, boshqa mahsulot kerak bo'lsa Yo'q bosing.`;
  return sendSalePrompt(ctx, message, Markup.inlineKeyboard([
    [Markup.button.callback('✅ Ha, shu mahsulot', 'saleprod_yes')],
    [Markup.button.callback('➡️ Yo\'q, keyingisi', 'saleprod_no')],
    [Markup.button.callback('❌ Bekor qilish', 'cancel')],
  ]));
}

async function skipSaleStockProduct(ctx) {
  const st = getState(ctx);
  return showSaleStockProductAt(ctx, (st.saleProductChoiceIndex || 0) + 1);
}

async function chooseSaleStockProduct(ctx) {
  const st = getState(ctx);
  const productId = (st.saleProductChoices || [])[st.saleProductChoiceIndex || 0];
  if (!productId) return ctx.answerCbQuery('Mahsulot topilmadi.');
  return saleEnterQuantity(ctx, productId);
}

async function saleEnterQuantity(ctx, productId) {
  const st = getState(ctx);
  const product = DB.products.find(p => p.id === productId && p.status === 'active');
  if (!product) return ctx.answerCbQuery('Mahsulot topilmadi.');
  const qty = getStockQuantity(productId);
  const isService = st.salePendingCategory === 'USLUGA';
  const category = saleCategory(st.salePendingCategory);
  const unit = category?.unit || 'metr';
  const basePrice = getSaleUnitPrice(product, category);
  const serviceRate = getServicePrice();
  const unitPrice = basePrice + (isService ? serviceRate : 0);
  setState(ctx, { step: 'sale_quantity', salePendingProductId: productId, salePendingUnitPrice: unitPrice, salePendingBasePrice: basePrice, salePendingServiceFee: isService ? serviceRate : 0, salePendingUnit: unit });
  const priceLine = `💰 Narx: ${fmtNum(basePrice)} so'm/${unit}${isService ? ` + usluga ${fmtNum(serviceRate)} so'm/metr = ${fmtNum(unitPrice)} so'm/metr` : ''}`;
  return sendSalePrompt(ctx, `🏭 ${product.name} ${product.type}\n📦 Mavjud: ${formatQuantity(qty, unit)} ${unit}\n${priceLine}\n\nNecha ${unit}${isService ? ' bukib berilsin' : ' sotildi'}?`, cancelKeyboard());
}

async function addSaleItemFromQuantity(ctx, quantity) {
  const st = getState(ctx);
  const category = saleCategory(st.salePendingCategory);
  const product = st.salePendingProductId ? DB.products.find(p => p.id === st.salePendingProductId) : null;
  if (!category) return ctx.reply('❌ Sotuv turi topilmadi. Qaytadan boshlang.', homeKeyboard(ctx));
  if (product && getStockQuantity(product.id) < quantity) {
    return ctx.reply(`❌ Omborda yetarli mahsulot yo\'q. Mavjud: ${formatQuantity(getStockQuantity(product.id), st.salePendingUnit)} ${st.salePendingUnit}`, cancelKeyboard());
  }
  const unitPrice = Number(st.salePendingUnitPrice);
  const serviceFee = Number(st.salePendingServiceFee || 0);
  const item = {
    category: category.reportCategory || category.id,
    productId: product?.id || null,
    productName: product ? product.name : (category.id === 'USLUGA' ? 'Usluga (mijoz materiali)' : category.id === 'DELA' ? 'Dela xizmati' : category.id),
    productType: product?.type || '',
    quantity,
    unit: st.salePendingUnit || category.unit,
    baseUnitPrice: Number(st.salePendingBasePrice ?? unitPrice),
    serviceFeeSom: serviceFee,
    unitPrice,
    total: Math.round(quantity * unitPrice),
    processingApplied: false,
  };
  const saleItems = [...(st.saleItems || []), item];
  setState(ctx, { saleItems });
  if (st.saleMode === 'mixed') return showSaleCategories(ctx);
  return saleSelectPayment(ctx);
}

async function saleSelectPayment(ctx) {
  const st = getState(ctx);
  const items = st.saleItems || [];
  if (!items.length) return ctx.reply('❌ Savatda mahsulot yo\'q.', homeKeyboard(ctx));
  const total = items.reduce((sum, item) => sum + item.total, 0);
  const exchangeRate = DB.settings.dollarRate || 12500;
  const usdAmount = total / exchangeRate;
  setState(ctx, { step: 'sale_payment', saleTotal: total, saleExchangeRate: exchangeRate, saleUsdAmount: usdAmount });
  const summary = items.map(item => `• ${item.productName}${item.productType ? ` ${item.productType}` : ''}: ${formatQuantity(item.quantity, item.unit)} ${item.unit} — ${fmtSom(item.total)}`).join('\n');
  const msg = `💳 To'lov turini tanlang:\n\n${summary}\n\nJami: ${fmtSom(total)}\nDollar: ${fmtUsd(usdAmount)}\nKurs: 1 USD = ${fmtNum(exchangeRate)} so'm`;
  const buttons = [
    [Markup.button.callback('💵 Naqd', 'paycash'), Markup.button.callback('💳 Karta', 'paycard')],
    [Markup.button.callback('🔴 Nasiya', 'paydebt'), Markup.button.callback('🔀 Aralash to\'lov', 'paymixed')],
    [Markup.button.callback('❌ Bekor qilish', 'cancel')],
  ];
  return ctx.reply(msg, Markup.inlineKeyboard(buttons));
}

async function prepareSaleConfirmation(ctx, paymentType, mixedPayments = null) {
  const st = getState(ctx);
  const items = st.saleItems || [];
  if (!items.length) return ctx.answerCbQuery('Savat bo\'sh.');
  const total = items.reduce((sum, item) => sum + Number(item.total || 0), 0);
  if (paymentType === 'mixed') {
    const cash = Number(mixedPayments?.cash);
    const card = Number(mixedPayments?.card);
    const debt = Number(mixedPayments?.debt);
    if (![cash, card, debt].every(Number.isFinite) || [cash, card, debt].some(value => value < 0)) {
      return ctx.reply('❌ Naqd, karta va nasiya summalari manfiy bo\'lmagan son bo\'lishi kerak.', cancelKeyboard());
    }
    if (Math.abs(cash + card + debt - total) > 0.01) {
      return ctx.reply(`❌ Naqd + karta + nasiya jami sotuvga teng bo\'lishi kerak.\n\nSotuv: ${fmtSom(total)}\nKiritildi: ${fmtSom(cash + card + debt)}`, cancelKeyboard());
    }
    mixedPayments = { cash, card, debt };
  }
  setState(ctx, {
    step: 'sale_confirm',
    saleConfirmType: paymentType,
    saleConfirmMixedPayments: mixedPayments,
    saleTotal: total,
    saleExchangeRate: Number(DB.settings.dollarRate) || 12500,
    saleUsdAmount: total / (Number(DB.settings.dollarRate) || 12500),
  });
  const paymentMap = { cash: 'Naqd', card: 'Karta', debt: 'Nasiya', mixed: 'Aralash' };
  let message = `🧾 SOTUVNI TASDIQLASH\n\n${items.map(item => `• ${item.productName}${item.productType ? ` ${item.productType}` : ''}: ${formatQuantity(item.quantity, item.unit)} ${item.unit} × ${fmtNum(item.unitPrice)} = ${fmtSom(item.total)}`).join('\n')}\n\nJami: ${fmtSom(total)}\nTo'lov turi: ${paymentMap[paymentType]}`;
  if (paymentType === 'mixed') message += `\n💵 Naqd: ${fmtSom(mixedPayments.cash)}\n💳 Karta: ${fmtSom(mixedPayments.card)}\n🔴 Nasiya: ${fmtSom(mixedPayments.debt)}`;
  message += `\n\nTasdiqlasangiz sotuv saqlanadi va ombor qoldig'i kamayadi.`;
  return ctx.reply(message, Markup.inlineKeyboard([
    [Markup.button.callback('✅ Tasdiqlash va saqlash', 'sale_confirm_yes')],
    [Markup.button.callback('⬅️ To\'lov turiga qaytish', 'sale_confirm_no')],
    [Markup.button.callback('❌ Bekor qilish', 'cancel')],
  ]));
}

// Aralash to'lov: naqd kiritish
async function saleMixedCash(ctx) {
  setState(ctx, { step: 'sale_mixed_cash' });
  const st = getState(ctx);
  await ctx.reply(`💵 Naqd to'lov summasini kiriting:\n\nJami: ${fmtSom(st.saleTotal)}\n\nMasalan: 500000`, cancelKeyboard());
}

// Aralash to'lov: karta kiritish
async function saleMixedCard(ctx) {
  setState(ctx, { step: 'sale_mixed_card' });
  const st = getState(ctx);
  const paid = st.saleMixedCash || 0;
  const remaining = st.saleTotal - paid;
  await ctx.reply(`💳 Karta to'lov summasini kiriting:\n\nQolgan (karta + nasiya): ${fmtSom(remaining)}\n\nMasalan: 300000`, cancelKeyboard());
}

async function saleMixedDebt(ctx) {
  setState(ctx, { step: 'sale_mixed_debt' });
  const st = getState(ctx);
  const remaining = st.saleTotal - (st.saleMixedCash || 0) - (st.saleMixedCard || 0);
  return ctx.reply(`🔴 Nasiya summasini kiriting:\n\nQolgan qismi: ${fmtSom(remaining)}\n\nTo'lovlar jami sotuv summasiga teng bo'lishi shart.`, cancelKeyboard());
}

// Sotuvni tasdiqlash va saqlash (ATOMIK)
async function confirmSale(ctx, paymentType, mixedPayments) {
  const st = getState(ctx);
  if (st.step !== 'sale_confirm') return ctx.answerCbQuery('Bu sotuv allaqachon tasdiqlangan yoki muddati o\'tgan.');
  if (st.saleCommitStarted) return ctx.answerCbQuery('Sotuv saqlanmoqda.');
  paymentType = st.saleConfirmType;
  mixedPayments = st.saleConfirmMixedPayments;
  if (paymentType === 'mixed' && (!mixedPayments || [mixedPayments.cash, mixedPayments.card, mixedPayments.debt].some(value => !Number.isFinite(Number(value)) || Number(value) < 0))) {
    return ctx.answerCbQuery('Aralash to\'lov tarkibi noto\'g\'ri.', { show_alert: true });
  }
  setState(ctx, { saleCommitStarted: true, step: 'sale_committing' });
  const user = getUser(ctx);
  const customer = DB.customers.find(c => c.id === st.saleCustomerId);
  const items = st.saleItems || [];

  if (!customer || !items.length) {
    clearState(ctx);
    return ctx.reply('❌ Mijoz yoki sotuv mahsuloti topilmadi. Sotuv bekor qilindi.', homeKeyboard(ctx));
  }
  const total = items.reduce((sum, item) => sum + item.total, 0);
  const exchangeRate = st.saleExchangeRate || DB.settings.dollarRate || 12500;
  const usdAmount = total / exchangeRate;
  const stockRequirements = new Map();
  items.filter(item => item.productId).forEach(item => {
    const combined = (stockRequirements.get(item.productId) || 0) + item.quantity;
    stockRequirements.set(item.productId, item.unit === 'metr' ? Math.round(combined * 1000) / 1000 : Math.round(combined));
  });
  let stockPlan;
  try {
    stockPlan = planStockReduction(DB.stock, stockRequirements);
  } catch (e) {
    setState(ctx, { step: 'sale_confirm', saleCommitStarted: false });
    return ctx.reply(`❌ Omborda mahsulot yetarli emas.\n\n${e.message}\nSavatni tahrirlang yoki miqdorni kamaytiring.`, cancelKeyboard());
  }

  // 2. To'lovni tekshirish
  let paid = 0;
  let debt = 0;

  if (paymentType === 'cash' || paymentType === 'card') {
    paid = total;
    debt = 0;
  } else if (paymentType === 'debt') {
    paid = 0;
    debt = total;
  } else if (paymentType === 'mixed') {
    paid = (mixedPayments.cash || 0) + (mixedPayments.card || 0);
    debt = (mixedPayments.debt || 0);
    if ([mixedPayments.cash, mixedPayments.card, mixedPayments.debt].some(value => !Number.isFinite(Number(value)) || Number(value) < 0)
      || Math.abs(paid + debt - total) > 0.01) {
      return ctx.reply(`❌ To'lov summasi noto'g'ri.\n\nNaqd + Karta + Nasiya = Jami bo'lishi kerak.\n\nJami: ${fmtSom(total)}\nSiz kiritdingiz: ${fmtSom(paid + debt)}`, cancelKeyboard());
    }
  }

  // 3. Sotuv yaratish
  const originalDB = JSON.parse(JSON.stringify(DB));
  const saleId = nextId('SALE');
  const sale = {
    id: saleId,
    customerId: customer.id,
    productId: items.find(item => item.productId)?.productId || null,
    items,
    quantity: items.filter(item => item.unit === 'metr').reduce((sum, item) => sum + item.quantity, 0),
    unitPrice: items[0].unitPrice,
    total,
    paid,
    debt,
    paymentType,
    mixedPayments: paymentType === 'mixed' ? mixedPayments : null,
    exchangeRate,
    usdAmount,
    userId: user.id,
    date: nowStr(),
    status: 'active',
    cancelledBy: null,
    cancelledAt: null,
    cancelReason: null,
  };
  DB.sales.push(sale);

  // 4. Ombordagi mahsulotlarni kamaytirish
  let stockReduced = true;
  for (const planned of stockPlan) {
    if (!reduceStock(planned.productId, planned.quantity, user.id, saleId)) {
      stockReduced = false;
      break;
    }
  }
  if (!stockReduced) {
    DB = originalDB;
    clearState(ctx);
    return ctx.reply('❌ Omborni kamaytirishda xatolik. Hech qanday o\'zgarish saqlanmadi.', homeKeyboard(ctx));
  }

  // 5. Nasiya bo'lsa qarz yaratish
  if (debt > 0) {
    const debtId = nextId('DEBT');
    DB.debts.push({
      id: debtId,
      customerId: customer.id,
      saleId,
      amount: debt,
      reason: `Sotuv: ${saleId}`,
      userId: user.id,
      date: nowStr(),
      status: 'active',
    });
  }

  // 6. Naqd va karta tushumlarini alohida saqlash
  const tenderParts = paymentType === 'mixed'
    ? [{ method: 'cash', amount: mixedPayments.cash }, { method: 'card', amount: mixedPayments.card }]
    : [{ method: paymentType, amount: paid }];
  for (const tender of tenderParts.filter(part => part.amount > 0 && (part.method === 'cash' || part.method === 'card'))) {
    const payId = nextId('PAY');
    DB.payments.push({
      id: payId,
      customerId: customer.id,
      saleId,
      amount: tender.amount,
      prevDebt: 0,
      remaining: 0,
      method: tender.method,
      userId: user.id,
      date: nowStr(),
    });
    const incId = nextId('INC');
    DB.income.push({
      id: incId,
      source: tender.method === 'cash' ? 'Naqd sotuv' : 'Karta sotuv',
      customerId: customer.id,
      amount: tender.amount,
      note: `Sotuv: ${saleId}`,
      userId: user.id,
      date: nowStr(),
    });
  }

  // Nasiya qarzi buyerning qarz daftarida alohida yaratiladi.
  if (debt > 0) {
    // The debt record above is the only place where the unpaid amount is booked.
  }

  /*
   * 7. Persist the complete sale, stock, debt, tenders, and income as one
   * synchronous JSON snapshot. Restore the in-memory snapshot on write errors.
   */
  try {
    auditLog(user.id, 'Sotuv yaratildi', saleId, '', `${fmtSom(total)} - ${customer.name} - ${items.map(item => item.productName).join(', ')}`);
    save();
  } catch (e) {
    DB = originalDB;
    clearState(ctx);
    console.error('Sotuvni saqlashda xatolik:', e.message);
    return ctx.reply('❌ Sotuvni saqlab bo\'lmadi. Ombor, to\'lov va qarz o\'zgarishlari bekor qilindi.', homeKeyboard(ctx));
  }

  const saleDescription = items.map(item => `${item.productName} ${formatQuantity(item.quantity, item.unit)} ${item.unit}`).join(', ');

  // 10. PDF yaratish
  let receiptPath = null;
  try {
    receiptPath = await generateReceipt(sale, customer, DB.products.find(p => p.id === sale.productId), receiptSellerName(user), DB.settings);
  } catch (e) {
    console.error('PDF yaratishda xatolik:', e.message);
  }

  // 11. Kam qoldiq tekshirish
  stockRequirements.forEach((quantity, productId) => checkLowStock(productId));

  // 12. Maxfiy guruhga yuborish
  const payTypeMap = { cash: 'Naqd', card: 'Karta', debt: 'Nasiya', mixed: 'Aralash' };
  let groupMsg = `🛒 YANGI SOTUV\n\nSotuv ID: ${saleId}\nMijoz: ${customer.name}\nMahsulotlar:\n${saleDescription}\nJami: ${fmtSom(total)}\nTo'lov: ${payTypeMap[paymentType]}\nSotuvchi: ${user.name}\nSana: ${prettyDateTime(sale.date)}`;
  await sendToGroup(groupMsg);

  // Mijozga natija
  let resultMsg = `✅ Sotuv muvaffaqiyatli saqlandi.\n\n`;
  resultMsg += `🧾 Sotuv ID: ${saleId}\n`;
  resultMsg += `👤 Mijoz: ${customer.name}\n`;
  resultMsg += `${items.map(item => `📦 ${item.productName}${item.productType ? ` ${item.productType}` : ''}: ${formatQuantity(item.quantity, item.unit)} ${item.unit}`).join('\n')}\n`;
  resultMsg += `💰 Jami: ${fmtSom(total)}\n`;
  resultMsg += `💵 Dollar: ${fmtUsd(usdAmount)}\n`;
  resultMsg += `💳 To'lov: ${payTypeMap[paymentType]}\n`;
  if (debt > 0) {
    resultMsg += `🔴 Qarz: ${fmtSom(debt)}\n`;
  }
  resultMsg += `\n🧾 Chek tayyor.`;

  clearState(ctx);

  const buttons = [];
  if (receiptPath) {
    buttons.push([Markup.button.callback('📄 PDF chek', `getpdf_${saleId}`)]);
  }
  buttons.push([Markup.button.callback('🏠 Bosh menyu', 'home')]);
  await ctx.reply(resultMsg, Markup.inlineKeyboard(buttons));
}

// ============================================================
// MIJOZLAR BO'LIMI
// ============================================================

async function showCustomers(ctx) {
  clearState(ctx);
  const customers = DB.customers.filter(c => c.status === 'active');
  if (customers.length === 0) {
    return ctx.reply('👥 Mijozlar yo\'q.', backKeyboard());
  }
  let msg = '👥 MIJOZLAR\n\n';
  const buttons = [];
  customers.forEach(c => {
    const debt = getCustomerDebt(c.id);
    msg += `👤 ${c.name} (${c.id})\n`;
    if (c.phone) msg += `📞 ${c.phone}\n`;
    if (debt > 0) msg += `🔴 Qarz: ${fmtSom(debt)}\n`;
    msg += '\n';
    buttons.push([Markup.button.callback(`👤 ${c.name}`, `cust_${c.id}`)]);
  });
  buttons.push([Markup.button.callback('➕ Yangi mijoz', 'newcustomer')]);
  buttons.push([Markup.button.callback('⬅️ Orqaga', 'home')]);
  await ctx.reply(msg, Markup.inlineKeyboard(buttons));
}

// Mijoz detallari
async function showCustomerDetail(ctx, customerId) {
  const customer = DB.customers.find(c => c.id === customerId);
  if (!customer) return ctx.answerCbQuery('Mijoz topilmadi.');

  const debt = getCustomerDebt(customerId);
  const sales = DB.sales.filter(s => s.customerId === customerId && s.status === 'active');
  const totalSales = sales.reduce((a, s) => a + s.total, 0);

  let msg = `👤 ${customer.name}\n\n`;
  msg += `ID: ${customer.id}\n`;
  if (customer.phone) msg += `📞 ${customer.phone}\n`;
  if (customer.note) msg += `📝 ${customer.note}\n`;
  msg += `📅 Qo'shilgan: ${prettyDate(customer.createdAt.split(' ')[0])}\n\n`;
  msg += `🛒 Jami sotuv: ${fmtNum(sales.length)} ta\n`;
  msg += `💰 Sotuv summasi: ${fmtSom(totalSales)}\n`;
  msg += `🔴 Hozirgi qarz: ${fmtSom(debt)}\n`;

  const buttons = [
    [Markup.button.callback('📜 Qarz tarixi', `custdebt_${customerId}`)],
    [Markup.button.callback('🛒 Sotuvlari', `custsales_${customerId}`)],
  ];
  if (debt > 0) {
    buttons.push([Markup.button.callback('💵 Qarz to\'lash', `custpay_${customerId}`)]);
  }
  if (isAdmin(ctx)) {
    buttons.push([Markup.button.callback('🔴 Nasiya qo\'shish', `custadddebt_${customerId}`)]);
    buttons.push([Markup.button.callback('✏️ Tahrirlash', `custedit_${customerId}`)]);
    buttons.push([Markup.button.callback('🗑 Arxivlash', `custarchive_${customerId}`)]);
  }
  buttons.push([Markup.button.callback('⬅️ Orqaga', 'customers')]);

  await ctx.editMessageText(msg, Markup.inlineKeyboard(buttons));
}

// Mijoz qarzi
function getCustomerDebt(customerId) {
  return getDebtAllocations(DB.debts, DB.payments, customerId)
    .reduce((total, debt) => total + debt.remaining, 0);
}

// Yangi mijoz qo'shish
async function newCustomerStart(ctx) {
  setState(ctx, { step: 'new_customer_name' });
  await ctx.reply('👤 Mijoz ismi:', cancelKeyboard());
}

// ============================================================
// QARZDORLAR BO'LIMI
// ============================================================

async function showDebtors(ctx) {
  clearState(ctx);
  return renderDebtorsPage(ctx, 0);
}

async function renderDebtorsPage(ctx, page) {
  const rate = Number(DB.settings.dollarRate) || 12500;
  const debtors = DB.customers.filter(customer => customer.status === 'active').map(customer => {
    const balances = getDebtAllocations(DB.debts, DB.payments, customer.id);
    const remaining = balances.reduce((sum, debt) => sum + debt.remaining, 0);
    return { customer, balances, remaining };
  }).filter(item => item.remaining > 0);
  if (!debtors.length) return ctx.reply('🔴 Qarzdorlar yo\'q.', backKeyboard());

  const perPage = 6;
  const pageCount = Math.ceil(debtors.length / perPage);
  const currentPage = Math.max(0, Math.min(pageCount - 1, page));
  const totalDebt = debtors.reduce((sum, item) => sum + item.remaining, 0);
  const current = debtors.slice(currentPage * perPage, (currentPage + 1) * perPage);
  let message = `🔴 QARZDORLAR (${currentPage + 1}/${pageCount})\n\n`;
  current.forEach(({ customer, balances, remaining }) => {
    const original = balances.reduce((sum, debt) => sum + Number(debt.amount || 0), 0);
    const paid = original - remaining;
    const payments = DB.payments.filter(payment => payment.customerId === customer.id && payment.method === 'debt_payment' && payment.status !== 'cancelled');
    const lastPayment = payments.sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    const debtRefs = balances.filter(debt => debt.remaining > 0).map(debt => debt.saleId || debt.id).join(', ');
    message += `👤 ${customer.name} (${customer.id})\n`;
    if (customer.phone) message += `📞 ${customer.phone}\n`;
    message += `Dastlabki: ${fmtSom(original)} | To'langan: ${fmtSom(paid)}\n`;
    message += `Qoldiq: ${fmtSom(remaining)} ≈ ${fmtUsd(remaining / rate)}\n`;
    message += `So'nggi to'lov: ${lastPayment ? prettyDateTime(lastPayment.date) : '-'}\n`;
    message += `Holati: 🔴 QARZ BOR | ID: ${debtRefs || '-'}\n\n`;
  });
  message += `━━━━━━━━━━━━\nQarzdorlar: ${debtors.length} ta\nJami qarz: ${fmtSom(totalDebt)}\nUSD: ${fmtUsd(totalDebt / rate)}\nKurs: 1 USD = ${fmtNum(rate)} so'm`;

  const buttons = current.map(item => [Markup.button.callback(`👤 ${item.customer.name} — ${fmtNum(item.remaining)} so'm`, `cust_${item.customer.id}`)]);
  if (pageCount > 1) {
    const nav = [];
    if (currentPage > 0) nav.push(Markup.button.callback('⬅️ Oldingi', `debtors_page_${currentPage - 1}`));
    if (currentPage + 1 < pageCount) nav.push(Markup.button.callback('Keyingi ➡️', `debtors_page_${currentPage + 1}`));
    buttons.push(nav);
  }
  buttons.push([Markup.button.callback('⬅️ Bosh menyu', 'home')]);
  return sendSalePrompt(ctx, message, Markup.inlineKeyboard(buttons));
}

// Qarz to'lash
async function payDebtStart(ctx, customerId) {
  const customer = DB.customers.find(c => c.id === customerId);
  if (!customer) return ctx.answerCbQuery('Mijoz topilmadi.');
  const debt = getCustomerDebt(customerId);
  if (debt <= 0) return ctx.answerCbQuery('Bu mijozda qarz yo\'q.');

  setState(ctx, { step: 'pay_debt', payDebtCustomerId: customerId });
  let msg = `👤 ${customer.name}\n\n🔴 Hozirgi qarz:\n${fmtSom(debt)}\n\n💵 Qancha to'ldi?\n\nMasalan: 500000`;
  await ctx.editMessageText(msg, Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor qilish', 'cancel')]]));
}

// Qarz to'lashni saqlash
async function payDebtSave(ctx, amount) {
  const st = getState(ctx);
  if (st.step !== 'pay_debt') return ctx.reply('⏳ Ushbu qarz to\'lovi qayta yuborilmaydi.');
  const customer = DB.customers.find(c => c.id === st.payDebtCustomerId);
  if (!customer) {
    clearState(ctx);
    return ctx.reply('❌ Mijoz topilmadi.', homeKeyboard(ctx));
  }

  const prevDebt = getCustomerDebt(customer.id);
  if (amount > prevDebt) {
    return ctx.reply(`❌ To'lov summasi qarzdan ko'p.\n\nQarz: ${fmtSom(prevDebt)}\nSiz: ${fmtSom(amount)}`, cancelKeyboard());
  }

  setState(ctx, { step: 'pay_debt_committing' });
  const originalDB = JSON.parse(JSON.stringify(DB));
  const remaining = prevDebt - amount;
  const user = getUser(ctx);
  const payId = nextId('PAY');
  const allocations = allocateDebtPayment(DB.debts, DB.payments, customer.id, amount);

  DB.payments.push({
    id: payId,
    customerId: customer.id,
    saleId: null,
    amount,
    prevDebt,
    remaining,
    method: 'debt_payment',
    allocations,
    userId: user.id,
    date: nowStr(),
  });

  // Pul kirimi
  const incId = nextId('INC');
  DB.income.push({
    id: incId,
    source: 'Qarz to\'lovi',
    customerId: customer.id,
    amount,
    note: `To'lov: ${payId}`,
    userId: user.id,
    date: nowStr(),
  });

  try {
    auditLog(user.id, 'Qarz to\'lovi', customer.id, `${prevDebt}`, `${remaining}`);
    save();
  } catch (e) {
    DB = originalDB;
    clearState(ctx);
    console.error('Qarz to\'lovini saqlashda xatolik:', e.message);
    return ctx.reply('❌ To\'lovni saqlab bo\'lmadi. Qarzdorlik o\'zgartirilmadi.', homeKeyboard(ctx));
  }

  // Maxfiy guruhga
  let groupMsg = `💵 QARZ TO'LOVI\n\nMijoz: ${customer.name}\nTo'landi: ${fmtSom(amount)}\nQolgan qarz: ${fmtSom(remaining)}\nQabul qildi: ${user.name}\nSana: ${prettyDateTime(nowStr())}`;
  await sendToGroup(groupMsg);

  clearState(ctx);
  let msg = '';
  if (remaining === 0) {
    msg = `✅ QARZ TO'LIQ TO'LANDI\n\n👤 ${customer.name}\n\nTo'langan:\n${fmtSom(amount)}\n\nQoldiq:\n0 so'm\n\nHolat:\n✅ TO'LANDI`;
  } else {
    msg = `✅ TO'LOV QABUL QILINDI\n\n👤 Mijoz:\n${customer.name}\n\nOldingi qarz:\n${fmtSom(prevDebt)}\n\nTo'landi:\n${fmtSom(amount)}\n\nQolgan qarz:\n${fmtSom(remaining)}`;
  }
  await ctx.reply(msg, homeKeyboard(ctx));
}

// Nasiya qo'shish (admin)
async function addDebtStart(ctx, customerId) {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Faqat admin uchun.');
  const customer = DB.customers.find(c => c.id === customerId);
  if (!customer) return ctx.answerCbQuery('Mijoz topilmadi.');

  setState(ctx, { step: 'add_debt', addDebtCustomerId: customerId });
  await ctx.editMessageText(
    `🔴 Nasiya qo'shish\n\n👤 Mijoz: ${customer.name}\n\n💰 Summa:\n\nMasalan: 2000000`,
    Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor qilish', 'cancel')]])
  );
}

// Nasiya qo'shishni saqlash
async function addDebtSave(ctx, amount) {
  const st = getState(ctx);
  if (st.step !== 'add_debt') return ctx.reply('⏳ Nasiya yozuvi qayta yuborilmaydi.');
  const customer = DB.customers.find(c => c.id === st.addDebtCustomerId);
  if (!customer) {
    clearState(ctx);
    return ctx.reply('❌ Mijoz topilmadi.', homeKeyboard(ctx));
  }

  const user = getUser(ctx);
  const prevDebt = getCustomerDebt(customer.id);
  setState(ctx, { step: 'add_debt_committing' });
  const originalDB = JSON.parse(JSON.stringify(DB));
  const debtId = nextId('DEBT');

  DB.debts.push({
    id: debtId,
    customerId: customer.id,
    saleId: null,
    amount,
    reason: 'Qo\'shimcha nasiya',
    userId: user.id,
    date: nowStr(),
    status: 'active',
  });

  const newDebt = prevDebt + amount;
  try {
    auditLog(user.id, 'Nasiya qo\'shildi', customer.id, `${prevDebt}`, `${newDebt}`);
    save();
  } catch (e) {
    DB = originalDB;
    clearState(ctx);
    console.error('Nasiya saqlashda xatolik:', e.message);
    return ctx.reply('❌ Nasiya saqlanmadi; qarz o\'zgartirilmadi.', homeKeyboard(ctx));
  }

  let groupMsg = `🔴 NASIYA QO'SHILDI\n\nMijoz: ${customer.name}\nSumma: ${fmtSom(amount)}\nJami qarz: ${fmtSom(newDebt)}\nKim: ${user.name}\nSana: ${prettyDateTime(nowStr())}`;
  await sendToGroup(groupMsg);

  clearState(ctx);
  await ctx.reply(`✅ Nasiya qo'shildi.\n\n👤 ${customer.name}\n\nOldingi qarz: ${fmtSom(prevDebt)}\nQo'shildi: +${fmtSom(amount)}\nJami qarz: ${fmtSom(newDebt)}`, homeKeyboard(ctx));
}

// Qarz tarixi
async function showDebtHistory(ctx, customerId) {
  const customer = DB.customers.find(c => c.id === customerId);
  if (!customer) return ctx.answerCbQuery('Mijoz topilmadi.');

  const debts = DB.debts.filter(d => d.customerId === customerId && d.status === 'active').sort((a, b) => a.date.localeCompare(b.date));
  const payments = DB.payments.filter(p => p.customerId === customerId && p.method === 'debt_payment' && p.status !== 'cancelled').sort((a, b) => a.date.localeCompare(b.date));

  // Birlashtirish
  const events = [];
  debts.forEach(d => events.push({ type: 'debt', date: d.date, amount: d.amount, id: d.id }));
  payments.forEach(p => events.push({ type: 'payment', date: p.date, amount: p.amount, id: p.id }));
  events.sort((a, b) => a.date.localeCompare(b.date));

  if (events.length === 0) {
    return ctx.editMessageText(`👤 ${customer.name}\n\nQarz tarixi yo\'q.`, inlineBack('customers'));
  }

  let msg = `👤 ${customer.name.toUpperCase()}\n\n`;
  let runningDebt = 0;
  events.forEach(e => {
    if (e.type === 'debt') {
      runningDebt += e.amount;
      msg += `${prettyDateTime(e.date)}\n🔴 Nasiya:\n${fmtSom(e.amount)}\n\n`;
    } else {
      runningDebt -= e.amount;
      msg += `${prettyDateTime(e.date)}\n💵 To'lov:\n${fmtSom(e.amount)}\n\n`;
    }
  });
  const currentDebt = getCustomerDebt(customerId);
  msg += `━━━━━━━━━━━━\nHozirgi qarz:\n${fmtSom(currentDebt)}\n`;
  msg += `Holat: ${currentDebt <= 0 ? '✅ TO\'LANDI' : '🔴 QARZ BOR'}`;

  await ctx.editMessageText(msg, inlineBack('customers'));
}

// ============================================================
// TUNKA KIRIMI
// ============================================================

async function startStockIn(ctx) {
  if (!isAdmin(ctx)) return ctx.reply('❌ Bu bo\'lim faqat admin uchun.');
  clearState(ctx);
  const buttons = [
    [Markup.button.callback('🏭 Tunka', 'stockin_cat_TUNKA')],
    [Markup.button.callback('📏 Reka', 'stockin_cat_REKA')],
    [Markup.button.callback('🧱 Latok', 'stockin_cat_LATOK')],
    [Markup.button.callback('🔩 Duga', 'stockin_cat_DUGA')],
    [Markup.button.callback('🛠 Dela xizmati', 'stockin_cat_DELA')],
    [Markup.button.callback('❌ Bekor qilish', 'cancel')],
  ];
  setState(ctx, { step: 'stock_in_category' });
  return sendSalePrompt(ctx, '📥 Omborga kirim\n\nMahsulot kategoriyasini tanlang:', Markup.inlineKeyboard(buttons));
}

async function showStockProductsForIn(ctx, category) {
  if (!['TUNKA', 'REKA', 'LATOK', 'DUGA', 'DELA'].includes(category)) return ctx.answerCbQuery('Ombor kategoriyasi noto\'g\'ri.');
  const products = DB.products.filter(product => product.status === 'active' && getProductCategory(product) === category);
  const buttons = products.map(product => [Markup.button.callback(
    `🏭 ${product.name} ${product.type} (${formatQuantity(getStockQuantity(product.id), getProductUnit(product))} ${getProductUnit(product)})`,
    `stockin_${product.id}`,
  )]);
  buttons.push([Markup.button.callback('➕ Yangi mahsulot turi', `stockinnew_${category}`)]);
  buttons.push([Markup.button.callback('⬅️ Kategoriyalar', 'stockin_menu')]);
  setState(ctx, { step: 'stock_in_select', stockInCategory: category });
  const message = products.length
    ? `📥 ${category} kirimi\n\nMavjud turini tanlang yoki yangi mahsulot turini yarating:`
    : `📥 ${category} uchun omborda mahsulot turi yo\'q.\n\nAvval yangi mahsulot turini qo\'shing:`;
  return sendSalePrompt(ctx, message, Markup.inlineKeyboard(buttons));
}

// Mavjud mahsulotga kirim
async function stockInForProduct(ctx, productId) {
  const product = DB.products.find(p => p.id === productId);
  if (!product) return ctx.answerCbQuery('Mahsulot topilmadi.');
  const category = getProductCategory(product);
  const unit = getProductUnit(product);
  setState(ctx, { step: 'stock_in_roll', stockInProductId: productId, stockInCategory: category, stockInUnit: unit });
  await ctx.editMessageText(
    `🏭 ${product.name} ${product.type}\n\n📦 ${unit === 'dona' ? 'Partiya raqami' : 'Rulon yoki partiya raqami'}:\n\n${unit === 'dona' ? 'Partiya bo\'lmasa "-" yozing.' : 'Rulon bo\'lmasa "-" yozing.'}`,
    Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor qilish', 'cancel')]])
  );
}

// Yangi tunka qo'shish
async function newProductStart(ctx, category = 'TUNKA') {
  if (!['TUNKA', 'REKA', 'LATOK', 'DUGA', 'DELA'].includes(category)) return ctx.answerCbQuery('Mahsulot kategoriyasi noto\'g\'ri.');
  const unit = ['DUGA', 'DELA'].includes(category) ? 'dona' : 'metr';
  const defaultPrice = saleCategory(category)?.defaultPrice || 0;
  setState(ctx, { step: 'new_product_name', newProdCategory: category, newProdUnit: unit, newProdDefaultPrice: defaultPrice });
  return sendSalePrompt(ctx, `🏭 ${category} mahsulot nomi:\n\nMasalan: ${category === 'TUNKA' ? 'Premium' : category}`, cancelKeyboard());
}

// ============================================================
// PUL KIRIMI
// ============================================================

async function startIncome(ctx) {
  if (!isAdmin(ctx)) return ctx.reply('❌ Bu bo\'lim faqat admin uchun.');
  clearState(ctx);
  setState(ctx, { step: 'income_source' });
  const buttons = [
    [Markup.button.callback('💵 Qarz to\'lovi', 'incsrc_qarz'), Markup.button.callback('💰 Boshqa', 'incsrc_other')],
    [Markup.button.callback('❌ Bekor qilish', 'cancel')],
  ];
  await ctx.reply('💰 Pul kirimi\n\nManba:', Markup.inlineKeyboard(buttons));
}

// ============================================================
// CHIQIM
// ============================================================

async function startExpense(ctx) {
  if (!isAdmin(ctx)) return ctx.reply('❌ Bu bo\'lim faqat admin uchun.');
  clearState(ctx);
  setState(ctx, { step: 'expense_type' });
  const buttons = [
    [Markup.button.callback('🚚 Transport', 'exptype_transport'), Markup.button.callback('👷 Ishchi haqi', 'exptype_worker')],
    [Markup.button.callback('🏢 Ijara', 'exptype_rent'), Markup.button.callback('🔧 Ta\'mirlash', 'exptype_repair')],
    [Markup.button.callback('📦 Boshqa', 'exptype_other')],
    [Markup.button.callback('❌ Bekor qilish', 'cancel')],
  ];
  await ctx.reply('📤 Chiqim\n\nTurini tanlang:', Markup.inlineKeyboard(buttons));
}

// ============================================================
// HISOBOTLAR
// ============================================================

async function dailyReportStart(ctx) {
  if (!isAdmin(ctx)) return ctx.reply('❌ Bu bo\'lim faqat admin uchun.');
  setState(ctx, { step: 'daily_report_date' });
  await ctx.reply('📊 Kunlik hisobot\n\nSanani kiriting (DD.MM.YYYY):\n\nMasalan: 11.09.2026\n\nYoki bugun uchun "bugun" deb yozing:', cancelKeyboard());
}

function generateDailyReportData(dateStr) {
  return generatePeriodReportData(dateStr, `${dateStr} 23:59:59`, false);
}

function reportSaleItems(sale) {
  if (Array.isArray(sale.items) && sale.items.length) return sale.items;
  const product = DB.products.find(item => item.id === sale.productId);
  return [{
    productId: sale.productId,
    productName: product?.name || '?',
    productType: product?.type || '',
    category: getProductCategory(product),
    quantity: Number(sale.quantity) || 0,
    unit: product?.unit || (getProductCategory(product) === 'DUGA' ? 'dona' : 'metr'),
    unitPrice: Number(sale.unitPrice) || 0,
    total: Number(sale.total) || 0,
  }];
}

function saleContainsProduct(sale, productId) {
  return Array.isArray(sale.items) && sale.items.length
    ? sale.items.some(item => item.productId === productId)
    : sale.productId === productId;
}

function generatePeriodReportData(prefix, endDateTime, includeMonth) {
  const activeSales = DB.sales.filter(sale => sale.date.startsWith(prefix) && sale.status === 'active');
  const cancelledSales = DB.sales.filter(sale => sale.status === 'cancelled' && String(sale.cancelledAt || sale.date).startsWith(prefix));
  const totalSales = activeSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const cash = activeSales.reduce((sum, sale) => sum + (sale.paymentType === 'cash' ? Number(sale.paid || 0) : sale.paymentType === 'mixed' ? Number(sale.mixedPayments?.cash || 0) : 0), 0);
  const card = activeSales.reduce((sum, sale) => sum + (sale.paymentType === 'card' ? Number(sale.paid || 0) : sale.paymentType === 'mixed' ? Number(sale.mixedPayments?.card || 0) : 0), 0);
  const debt = activeSales.reduce((sum, sale) => sum + Number(sale.debt || 0), 0);
  const debtPaymentRows = DB.payments.filter(payment => payment.date.startsWith(prefix) && payment.method === 'debt_payment' && payment.status !== 'cancelled');
  const linkedDebtPaymentIds = new Set(debtPaymentRows.map(payment => payment.id));
  const legacyDebtIncome = DB.income.filter(income => income.date.startsWith(prefix) && income.source === 'Qarz to\'lovi' && income.status !== 'cancelled'
    && ![...linkedDebtPaymentIds].some(paymentId => String(income.note || '').includes(paymentId)))
    .reduce((sum, income) => sum + Number(income.amount || 0), 0);
  const debtPayments = debtPaymentRows.reduce((sum, payment) => sum + Number(payment.amount || 0), 0) + legacyDebtIncome;
  const excludedIncome = new Set(['Naqd sotuv', 'Karta sotuv', 'Aralash to\'lov', 'Qarz to\'lovi']);
  const otherIncome = DB.income.filter(income => income.date.startsWith(prefix) && income.status !== 'cancelled' && !excludedIncome.has(income.source)).reduce((sum, income) => sum + Number(income.amount || 0), 0);
  const expenses = DB.expenses.filter(expense => expense.date.startsWith(prefix) && expense.status !== 'cancelled').reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const categoryStats = {};
  for (const category of ['TUNKA', 'REKA', 'LATOK', 'DUGA', 'DELA']) {
    const unit = category === 'DUGA' || category === 'DELA' ? 'dona' : 'metr';
    categoryStats[category] = { unit, stockIn: 0, sold: 0, returned: 0, closingStock: 0, currentStock: 0, sales: 0, revenue: 0 };
  }

  const periodMovements = DB.stockMovements.filter(movement => movement.date.startsWith(prefix));
  periodMovements.forEach(movement => {
    const product = DB.products.find(item => item.id === movement.productId);
    const category = getProductCategory(product);
    const movementUnit = product ? getProductUnit(product) : movement.unit || (category === 'DUGA' || category === 'DELA' ? 'dona' : 'metr');
    const stat = categoryStats[category] || (categoryStats[category] = { unit: movementUnit, stockIn: 0, sold: 0, returned: 0, closingStock: 0, currentStock: 0, sales: 0, revenue: 0 });
    const quantity = Number(movement.quantity || 0);
    if (movement.type === 'in') stat.stockIn += quantity;
    else if (movement.type === 'out') stat.sold += quantity;
    else if (movement.type === 'cancel') stat.returned += quantity;
  });

  const saleDetails = activeSales.map(sale => {
    const customer = DB.customers.find(item => item.id === sale.customerId);
    const user = DB.users.find(item => item.id === sale.userId);
    const lines = reportSaleItems(sale).map(item => {
      const product = DB.products.find(candidate => candidate.id === item.productId);
      const category = String(item.category || product?.category || getProductCategory(product)).toUpperCase();
      const stat = categoryStats[category] || (categoryStats[category] = { unit: item.unit || 'metr', stockIn: 0, sold: 0, returned: 0, closingStock: 0, currentStock: 0, sales: 0, revenue: 0 });
      stat.sold += 0; // Sales quantity comes from stock movements; avoids counting a movement twice.
      stat.sales += 1;
      stat.revenue += Number(item.total || 0);
      return { ...item, category, quantity: Number(item.quantity) || 0, unit: item.unit || 'metr', unitPrice: Number(item.unitPrice) || 0, total: Number(item.total) || 0 };
    });
    const payTypeMap = { cash: 'Naqd', card: 'Karta', debt: 'Nasiya', mixed: 'Aralash' };
    return {
      id: sale.id,
      date: sale.date,
      customerName: customer?.name || '?',
      sellerName: user?.name || '?',
      total: Number(sale.total) || 0,
      paid: Number(sale.paid) || 0,
      debt: Number(sale.debt) || 0,
      paymentType: payTypeMap[sale.paymentType] || sale.paymentType,
      exchangeRate: Number(sale.exchangeRate) || Number(DB.settings.dollarRate) || 12500,
      lines,
    };
  });

  const cutoff = String(endDateTime).slice(0, 10);
  DB.products.forEach(product => {
    const category = getProductCategory(product);
    const stat = categoryStats[category] || (categoryStats[category] = { unit: getProductUnit(product), stockIn: 0, sold: 0, returned: 0, closingStock: 0, currentStock: 0, sales: 0, revenue: 0 });
    stat.currentStock += getStockQuantity(product.id);
    stat.closingStock += calculateStockBalance(DB.stockMovements, product.id, cutoff);
  });

  const cancelledTotal = cancelledSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const serviceLines = saleDetails.flatMap(sale => sale.lines).filter(item => item.category === 'USLUGA');
  const delaLines = saleDetails.flatMap(sale => sale.lines).filter(item => item.category === 'DELA');
  const meters = saleDetails.flatMap(sale => sale.lines).filter(item => item.unit === 'metr').reduce((sum, item) => sum + item.quantity, 0);
  return {
    totalMeters: meters,
    totalSales,
    totalSaleCount: activeSales.length,
    cash,
    card,
    debt,
    debtPayments,
    otherIncome,
    expenses,
    cancelledCount: cancelledSales.length,
    cancelledTotal,
    stockTotal: DB.stock.reduce((sum, stock) => sum + Number(stock.quantity || 0), 0),
    categoryStats,
    serviceCount: serviceLines.length,
    serviceMeters: serviceLines.reduce((sum, item) => sum + (item.unit === 'metr' ? item.quantity : 0), 0),
    serviceRevenue: serviceLines.reduce((sum, item) => sum + item.total, 0),
    delaCount: delaLines.length,
    delaPieces: delaLines.reduce((sum, item) => sum + item.quantity, 0),
    delaRevenue: delaLines.reduce((sum, item) => sum + item.total, 0),
    sales: saleDetails,
    exchangeRate: Number(DB.settings.dollarRate) || 12500,
    includeMonth,
  };
}

async function showDailyReport(ctx, dateStr) {
  const report = generateDailyReportData(dateStr);
  let msg = `📊 KUNLIK HISOBOT\n\n📅 ${prettyDate(dateStr)}\n\n`;
  msg += `🛒 Sotuvlar: ${report.totalSaleCount} ta — ${fmtSom(report.totalSales)}\n`;
  msg += `💵 Naqd: ${fmtSom(report.cash)}\n`;
  msg += `💳 Karta: ${fmtSom(report.card)}\n`;
  msg += `🔴 Yangi nasiya: ${fmtSom(report.debt)}\n`;
  msg += `💰 Qarzdan tushgan: ${fmtSom(report.debtPayments)}\n`;
  msg += `➕ Boshqa kirim: ${fmtSom(report.otherIncome)}\n`;
  msg += `📤 Chiqim: ${fmtSom(report.expenses)}\n`;
  msg += `❌ Bekor qilingan sotuv: ${report.cancelledCount} ta — ${fmtSom(report.cancelledTotal)}\n\n`;
  msg += `📦 MAHSULOTLAR\n`;
  Object.entries(report.categoryStats).forEach(([category, stat]) => {
    msg += `${category}: kirim ${formatQuantity(stat.stockIn, stat.unit)} ${stat.unit}, sotuv ${formatQuantity(stat.sold, stat.unit)} ${stat.unit}, qoldiq (${prettyDate(dateStr)}) ${formatQuantity(stat.closingStock, stat.unit)} ${stat.unit}, hozir ${formatQuantity(stat.currentStock, stat.unit)} ${stat.unit}\n`;
  });
  msg += `🛠 Usluga: ${report.serviceCount} ta, ${formatQuantity(report.serviceMeters, 'metr')} metr — ${fmtSom(report.serviceRevenue)}\n`;
  msg += `🛠 Dela xizmati: ${report.delaCount} ta qator, ${formatQuantity(report.delaPieces, 'dona')} dona — ${fmtSom(report.delaRevenue)}\n`;
  msg += `💵 USD kursi: 1 USD = ${fmtNum(report.exchangeRate)} so'm | Sotuv USD: ${fmtUsd(report.totalSales / report.exchangeRate)}\n`;
  msg += `\nOxirgi sotuvlar:\n${report.sales.slice(-5).map(sale => `${sale.id} | ${sale.customerName} | ${fmtSom(sale.total)} | ${sale.paymentType}`).join('\n') || 'Sotuv yo\'q'}`;

  clearState(ctx);
  const buttons = [
    [Markup.button.callback('📄 PDF qilib yuklash', `dailypdf_${dateStr}`)],
    [Markup.button.callback('🏠 Bosh menyu', 'home')],
  ];
  await ctx.reply(msg, Markup.inlineKeyboard(buttons));
}

async function monthlyReportStart(ctx) {
  if (!isAdmin(ctx)) return ctx.reply('❌ Bu bo\'lim faqat admin uchun.');
  setState(ctx, { step: 'monthly_report' });
  await ctx.reply('📅 Oylik hisobot\n\nOyni kiriting (YYYY-MM):\n\nMasalan: 2026-09\n\nYoki shu oy uchun "shuoy" deb yozing:', cancelKeyboard());
}

function generateMonthlyReportData(monthStr) {
  const [year, month] = monthStr.split('-').map(Number);
  const monthEnd = new Date(year, month, 0).getDate();
  const report = generatePeriodReportData(monthStr, `${monthStr}-${String(monthEnd).padStart(2, '0')} 23:59:59`, true);
  report.totalIn = Object.values(report.categoryStats).reduce((sum, stat) => sum + stat.stockIn, 0);
  report.totalOut = Object.values(report.categoryStats).reduce((sum, stat) => sum + stat.sold, 0);
  report.closingStock = Object.values(report.categoryStats).reduce((sum, stat) => sum + stat.closingStock, 0);
  report.currentStock = report.stockTotal;
  report.activeDebt = DB.customers.reduce((sum, customer) => sum + getCustomerDebt(customer.id), 0);
  return report;
}

async function showMonthlyReport(ctx, monthStr) {
  const report = generateMonthlyReportData(monthStr);
  const [year, month] = monthStr.split('-').map(Number);
  const monthEnd = new Date(year, month, 0).getDate();
  let msg = `📊 OYLIK HISOBOT\n\nOy: ${prettyMonth(monthStr)} (${monthStr}-01 — ${monthStr}-${String(monthEnd).padStart(2, '0')})\n\n`;
  msg += `🛒 Faol sotuvlar: ${report.totalSaleCount} ta — ${fmtSom(report.totalSales)}\n`;
  msg += `💵 Naqd: ${fmtSom(report.cash)}\n`;
  msg += `💳 Karta: ${fmtSom(report.card)}\n`;
  msg += `🔴 Yangi nasiya: ${fmtSom(report.debt)}\n`;
  msg += `💰 Qarzdan tushum: ${fmtSom(report.debtPayments)}\n`;
  msg += `➕ Boshqa kirim: ${fmtSom(report.otherIncome)}\n`;
  msg += `📤 Chiqim: ${fmtSom(report.expenses)}\n`;
  msg += `❌ Bekor qilingan sotuvlar: ${report.cancelledCount} ta — ${fmtSom(report.cancelledTotal)}\n`;
  msg += `🔴 Hozirgi faol qarz: ${fmtSom(report.activeDebt)}\n\n`;
  msg += `KATEGORIYA BO'YICHA\n`;
  Object.entries(report.categoryStats).forEach(([category, stat]) => {
    msg += `${category}: kirim ${formatQuantity(stat.stockIn, stat.unit)} ${stat.unit}, sotilgan ${formatQuantity(stat.sold, stat.unit)} ${stat.unit}, oy oxiri ${formatQuantity(stat.closingStock, stat.unit)} ${stat.unit}, hozir ${formatQuantity(stat.currentStock, stat.unit)} ${stat.unit}\n`;
  });
  msg += `🛠 Usluga: ${report.serviceCount} ta, ${formatQuantity(report.serviceMeters, 'metr')} metr — ${fmtSom(report.serviceRevenue)}\n`;
  msg += `🛠 Dela xizmati: ${report.delaCount} ta qator, ${formatQuantity(report.delaPieces, 'dona')} dona — ${fmtSom(report.delaRevenue)}\n`;
  msg += `\nUSD kursi: 1 USD = ${fmtNum(report.exchangeRate)} so'm\nSotuv USD: ${fmtUsd(report.totalSales / report.exchangeRate)}\n`;
  msg += `\nSotuv tafsilotlari PDF hisobotda to'liq beriladi.`;

  clearState(ctx);
  const buttons = [
    [Markup.button.callback('📄 PDF qilib yuklash', `monthlypdf_${monthStr}`)],
    [Markup.button.callback('🏠 Bosh menyu', 'home')],
  ];
  await ctx.reply(msg, Markup.inlineKeyboard(buttons));
}

// ============================================================
// TARIX
// ============================================================

async function showHistory(ctx, page = 0) {
  if (!isAdmin(ctx)) return ctx.reply('❌ Bu bo\'lim faqat admin uchun.');
  if (page === 0) clearState(ctx);
  const products = DB.products.filter(p => p.status === 'active').sort((a, b) => getProductCategory(a).localeCompare(getProductCategory(b)) || a.name.localeCompare(b.name));
  const events = [];

  DB.stockMovements.forEach(m => {
    const p = DB.products.find(p => p.id === m.productId);
    const u = DB.users.find(u => u.id === m.userId);
    const unit = m.unit || p?.unit || (getProductCategory(p) === 'DUGA' ? 'dona' : 'metr');
    const icon = m.type === 'in' ? '📥' : m.type === 'cancel' ? '↩️' : '📤';
    const sign = m.type === 'in' || m.type === 'cancel' ? '+' : '-';
    events.push({ date: m.date, id: m.id, text: `${icon} ${getProductCategory(p)} ${m.type === 'in' ? 'kirim' : m.type === 'cancel' ? 'qaytarish' : 'sotuv chiqimi'} ${m.id}\n${u?.name || '?'}\n${sign}${formatQuantity(m.quantity, unit)} ${unit}${p ? ` — ${p.name} ${p.type}` : ''}${m.totalValue ? `\nQiymat: ${fmtSom(m.totalValue)}` : ''}${m.note ? `\nIzoh: ${m.note}` : ''}` });
  });

  DB.sales.forEach(s => {
    const c = DB.customers.find(c => c.id === s.customerId);
    const u = DB.users.find(u => u.id === s.userId);
    const lines = reportSaleItems(s).map(item => `${item.productName || '?'} ${formatQuantity(item.quantity, item.unit)} ${item.unit}`).join(', ');
    events.push({ date: s.status === 'cancelled' ? s.cancelledAt || s.date : s.date, id: s.id, text: `${s.status === 'cancelled' ? '❌ Bekor qilingan sotuv' : '🛒 Sotuv'} ${s.id}\n${u?.name || '?'} — ${c?.name || '?'} (${c?.id || '-'})\n${lines}\n${fmtSom(s.total)} | To'langan ${fmtSom(s.paid)} | Qarz ${fmtSom(s.debt)}${s.cancelReason ? `\nSabab: ${s.cancelReason}` : ''}` });
  });

  DB.payments.forEach(p => {
    const c = DB.customers.find(c => c.id === p.customerId);
    const u = DB.users.find(u => u.id === p.userId);
    events.push({ date: p.date, id: p.id, text: `${p.method === 'debt_payment' ? '💵 Qarz to\'lovi' : '💳 Sotuv to\'lovi'} ${p.id}\n${u?.name || '?'}\n${fmtSom(p.amount)}${c ? ` — ${c.name} (${c.id})` : ''}${p.saleId ? `\nSotuv: ${p.saleId}` : ''}${p.allocations?.length ? `\nQarzlar: ${p.allocations.map(a => `${a.debtId} ${fmtSom(a.amount)}`).join(', ')}` : ''}${p.status === 'cancelled' ? '\n❌ Bekor qilingan' : ''}` });
  });

  DB.income.filter(income => income.status !== 'cancelled').forEach(income => {
    const c = DB.customers.find(customer => customer.id === income.customerId);
    const u = DB.users.find(user => user.id === income.userId);
    events.push({ date: income.date, id: income.id, text: `💰 Pul kirimi ${income.id}\n${income.source}\n${fmtSom(income.amount)}${c ? ` — ${c.name} (${c.id})` : ''}${u ? `\n${u.name}` : ''}${income.note ? `\n${income.note}` : ''}` });
  });

  DB.expenses.forEach(e => {
    const u = DB.users.find(user => user.id === e.userId);
    events.push({ date: e.date, id: e.id, text: `📤 Chiqim ${e.id}\n${fmtSom(e.amount)} — ${e.type}${u ? `\n${u.name}` : ''}${e.note ? `\n${e.note}` : ''}` });
  });

  DB.auditLogs.forEach(log => {
    const user = DB.users.find(item => item.id === log.userId);
    events.push({ date: log.date, id: log.id, text: `📋 ${log.action} ${log.id}\n${user?.name || log.userId}\nOb'ekt: ${log.object}${log.prevValue ? `\nOldingi: ${log.prevValue}` : ''}${log.newValue ? `\nYangi: ${log.newValue}` : ''}` });
  });

  events.sort((a, b) => b.date.localeCompare(a.date));
  const pageSize = 8;
  const pageCount = Math.max(1, Math.ceil(events.length / pageSize));
  const currentPage = Math.max(0, Math.min(pageCount - 1, page));
  const top = events.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  if (top.length === 0) {
    return ctx.reply('📜 Tarix bo\'sh.', backKeyboard());
  }

  let msg = `📜 OPERATSIYALAR TARIXI (${currentPage + 1}/${pageCount})\n\n`;
  top.forEach(e => {
    msg += `${prettyDateTime(e.date)}\n${e.text}\n\n`;
  });
  const buttons = [];
  const nav = [];
  if (currentPage > 0) nav.push(Markup.button.callback('⬅️ Oldingi', `history_page_${currentPage - 1}`));
  if (currentPage + 1 < pageCount) nav.push(Markup.button.callback('Keyingi ➡️', `history_page_${currentPage + 1}`));
  if (nav.length) buttons.push(nav);
  buttons.push([Markup.button.callback('🏠 Bosh menyu', 'home')]);
  await sendSalePrompt(ctx, msg, Markup.inlineKeyboard(buttons));
}

// Ishchining o'z sotuvlari
async function showMySales(ctx) {
  clearState(ctx);
  const user = getUser(ctx);
  const sales = DB.sales.filter(s => s.userId === user.id && s.status === 'active').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);

  if (sales.length === 0) {
    return ctx.reply('📜 Sotuvlar yo\'ch.', backKeyboard());
  }

  let msg = '📜 SOTUVLAR TARIXI\n\n';
  sales.forEach(s => {
    const c = DB.customers.find(c => c.id === s.customerId);
    const payTypeMap = { cash: 'Naqd', card: 'Karta', debt: 'Nasiya', mixed: 'Aralash' };
    const items = Array.isArray(s.items) && s.items.length
      ? s.items
      : [{ productId: s.productId, productName: DB.products.find(p => p.id === s.productId)?.name || '?', quantity: s.quantity, unit: s.unit || 'metr' }];
    msg += `Sotuv ID: ${s.id}\n`;
    msg += `Mijoz: ${c?.name || '?'}\n`;
    msg += `${items.map(item => `• ${item.productName || DB.products.find(p => p.id === item.productId)?.name || '?'}: ${formatQuantity(item.quantity, item.unit || 'metr')} ${item.unit || 'metr'}`).join('\n')}\n`;
    msg += `Jami: ${fmtSom(s.total)}\n`;
    msg += `USD: ${fmtUsd(s.usdAmount)}\n`;
    msg += `To'lov: ${payTypeMap[s.paymentType]}\n`;
    msg += `Sana: ${prettyDateTime(s.date)}\n\n`;
  });

  await ctx.reply(msg, backKeyboard());
}

// Admin uchun barcha sotuvlar
async function showAllSales(ctx) {
  if (!isAdmin(ctx)) return ctx.reply('❌ Bu bo\'lim faqat admin uchun.');
  clearState(ctx);
  const sales = DB.sales.filter(s => s.status === 'active').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);

  if (sales.length === 0) {
    return ctx.reply('📜 Sotuvlar yo\'q.', backKeyboard());
  }

  let msg = '📜 BARCHA SOTUVLAR (oxirgi 30 ta)\n\n';
  const buttons = sales.map(s => {
    const c = DB.customers.find(c => c.id === s.customerId);
    return [Markup.button.callback(`🧾 ${s.id} - ${c?.name || '?'} - ${fmtNum(s.total)} so'm`, `saledetail_${s.id}`)];
  });
  buttons.push([Markup.button.callback('⬅️ Orqaga', 'home')]);
  await ctx.reply(msg, Markup.inlineKeyboard(buttons));
}

// Sotuv detallari
async function showSaleDetail(ctx, saleId) {
  const sale = DB.sales.find(s => s.id === saleId);
  if (!sale) return ctx.answerCbQuery('Sotuv topilmadi.');

  const c = DB.customers.find(c => c.id === sale.customerId);
  const p = DB.products.find(p => p.id === sale.productId);
  const u = DB.users.find(u => u.id === sale.userId);
  const payTypeMap = { cash: 'Naqd', card: 'Karta', debt: 'Nasiya', mixed: 'Aralash' };

  let msg = `Sotuv ID: ${sale.id}\n\n`;
  msg += `Mijoz: ${c?.name || '?'}\n`;
  msg += `Mijoz ID: ${c?.id || '-'}\n\n`;
  const items = Array.isArray(sale.items) && sale.items.length
    ? sale.items
    : [{ productName: p?.name || '?', productType: p?.type || '', quantity: sale.quantity, unit: p?.unit || (getProductCategory(p) === 'DUGA' ? 'dona' : 'metr'), unitPrice: sale.unitPrice, total: sale.total }];
  msg += `Mahsulotlar:\n${items.map(item => `• ${item.productName || '?'} ${item.productType || ''} — ${formatQuantity(item.quantity, item.unit || 'metr')} ${item.unit || 'metr'} × ${fmtNum(item.unitPrice)} so'm`).join('\n')}\n\n`;
  msg += `Jami: ${fmtSom(sale.total)}\n`;
  msg += `USD: ${fmtUsd(sale.usdAmount)}\n`;
  msg += `Kurs: 1 USD = ${fmtNum(sale.exchangeRate)} so'm\n\n`;
  msg += `To'lov: ${payTypeMap[sale.paymentType]}\n`;
  msg += `To'langan: ${fmtSom(sale.paid)}\n`;
  msg += `Qarz: ${fmtSom(sale.debt)}\n\n`;
  msg += `Sotuvchi: ${u?.name || '?'}\n`;
  msg += `Sana: ${prettyDateTime(sale.date)}`;

  if (sale.status === 'cancelled') {
    msg += `\n\n❌ BEKOR QILINGAN\nBekor qilgan: ${sale.cancelledBy}\nSana: ${prettyDateTime(sale.cancelledAt)}`;
  }

  const buttons = [];
  if (isAdmin(ctx) && sale.status === 'active') {
    buttons.push([Markup.button.callback('🗑 Sotuvni bekor qilish', `salecancel_${sale.id}`)]);
  }
  buttons.push([Markup.button.callback('📄 PDF chek', `getpdf_${sale.id}`)]);
  buttons.push([Markup.button.callback('⬅️ Orqaga', 'allsales')]);

  await ctx.editMessageText(msg, Markup.inlineKeyboard(buttons));
}

// Sotuvni bekor qilish
async function cancelSaleConfirm(ctx, saleId) {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Faqat admin uchun.');
  const sale = DB.sales.find(s => s.id === saleId);
  if (!sale) return ctx.answerCbQuery('Sotuv topilmadi.');
  if (sale.status === 'cancelled') return ctx.answerCbQuery('Allaqachon bekor qilingan.');

  setState(ctx, { cancelSaleId: saleId });
  let msg = `⚠️ DIQQAT!\n\nBu sotuvni bekor qilsangiz:\n\n📦 Mahsulot qayta omborga qaytariladi.\n💰 Moliyaviy hisob qayta hisoblanadi.\n🔴 Nasiya bo'lsa qarz qayta hisoblanadi.\n\nDavom etasizmi?\n\nSotuv ID: ${sale.id}`;
  await ctx.editMessageText(msg, Markup.inlineKeyboard([
    [Markup.button.callback('✅ Ha, bekor qilish', `salecancelyes_${saleId}`)],
    [Markup.button.callback('❌ Yo\'q', `saledetail_${saleId}`)],
  ]));
}

async function cancelSaleExecute(ctx, saleId) {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Faqat admin uchun.');
  const sale = DB.sales.find(s => s.id === saleId);
  if (!sale) return ctx.answerCbQuery('Sotuv topilmadi.');
  if (sale.status === 'cancelled') return ctx.answerCbQuery('Allaqachon bekor qilingan.');

  const saleDebt = DB.debts.find(debt => debt.saleId === saleId && debt.status === 'active');
  if (saleDebt) {
    const debtBalance = getDebtAllocations(DB.debts, DB.payments, saleDebt.customerId).find(debt => debt.id === saleDebt.id);
    if (debtBalance && debtBalance.paid > 0) {
      return ctx.answerCbQuery('Bu sotuv qarziga to\'lov tushgan. Avval qarz to\'lovini alohida hisob-kitob qiling.', { show_alert: true });
    }
  }

  const originalDB = JSON.parse(JSON.stringify(DB));
  const user = getUser(ctx);

  // 1. Savatdagi ombor mahsulotlarini qaytarish
  const stockItems = Array.isArray(sale.items) && sale.items.length
    ? sale.items.filter(item => item.productId)
    : (sale.productId ? [{ productId: sale.productId, quantity: sale.quantity, unit: DB.products.find(product => product.id === sale.productId)?.unit || 'metr' }] : []);
  stockItems.forEach(item => returnStock(item.productId, item.quantity, user.id, sale.id));

  // 2. Qarzni bekor qilish (agar nasiya bo'lsa)
  if (saleDebt) saleDebt.status = 'cancelled';

  // 3. To'lovni bekor qilish (agar bo'lsa)
  DB.payments.filter(payment => payment.saleId === saleId).forEach(payment => { payment.status = 'cancelled'; });

  // 4. Pul kiriminini bekor qilish
  DB.income.filter(income => income.note && income.note.includes(saleId)).forEach(income => { income.status = 'cancelled'; });

  // 5. Sotuv statusini o'zgartirish
  sale.status = 'cancelled';
  sale.cancelledBy = user.name;
  sale.cancelledAt = nowStr();
  sale.cancelReason = 'Admin tomonidan bekor qilindi';

  try {
    auditLog(user.id, 'Sotuv bekor qilindi', saleId, 'active', 'cancelled');
    save();
  } catch (e) {
    DB = originalDB;
    console.error('Sotuvni bekor qilishda saqlash xatosi:', e.message);
    return ctx.answerCbQuery('Bekor qilish saqlanmadi; o\'zgarishlar qaytarildi.', { show_alert: true });
  }
  stockItems.forEach(item => checkLowStock(item.productId));

  let groupMsg = `🗑 SOTUV BEKOR QILINDI\n\nSotuv ID: ${saleId}\nBekor qilgan: ${user.name}\nSana: ${prettyDateTime(nowStr())}`;
  await sendToGroup(groupMsg);

  clearState(ctx);
  await ctx.editMessageText(`✅ Sotuv bekor qilindi.\n\nSotuv ID: ${saleId}\n📦 Mahsulot omborga qaytarildi.\n💰 Moliyaviy hisob qayta hisoblandi.`, inlineBack('home'));
}

// ============================================================
// CHEKLAR BO'LIMI
// ============================================================

async function showReceipts(ctx) {
  clearState(ctx);
  const user = getUser(ctx);
  const sales = DB.sales.filter(s => s.userId === user.id && s.status === 'active').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15);

  if (sales.length === 0) {
    return ctx.reply('🧾 Cheklar yo\'q.', backKeyboard());
  }

  const buttons = sales.map(s => {
    const c = DB.customers.find(c => c.id === s.customerId);
    return [Markup.button.callback(`🧾 ${s.id} - ${c?.name || '?'} - ${prettyDate(s.date.split(' ')[0])}`, `getpdf_${s.id}`)];
  });
  buttons.push([Markup.button.callback('⬅️ Orqaga', 'home')]);
  await ctx.reply('🧾 CHEKLAR\n\nChekni yuklash uchun bosing:', Markup.inlineKeyboard(buttons));
}

// PDF chek yuborish
async function sendReceipt(ctx, saleId) {
  const sale = DB.sales.find(s => s.id === saleId);
  if (!sale) return ctx.answerCbQuery('Sotuv topilmadi.');

  const customer = DB.customers.find(c => c.id === sale.customerId);
  const product = DB.products.find(p => p.id === sale.productId);
  const user = DB.users.find(u => u.id === sale.userId);

  try {
    const filepath = await generateReceipt(sale, customer, product, receiptSellerName(user), DB.settings);
    await ctx.replyWithDocument({ source: filepath, filename: `receipt_${saleId}.pdf` });
    await ctx.answerCbQuery('Chek yuborildi.');
  } catch (e) {
    console.error('PDF yuborishda xatolik:', e.message);
    await ctx.answerCbQuery('PDF yaratishda xatolik.');
  }
}

// ============================================================
// SOZLAMALAR
// ============================================================

async function showSettings(ctx) {
  if (!isAdmin(ctx)) return ctx.reply('❌ Bu bo\'lim faqat admin uchun.');
  clearState(ctx);
  let msg = `⚙️ SOZLAMALAR\n\n`;
  msg += `💵 Dollar kursi: 1 USD = ${fmtNum(DB.settings.dollarRate)} so'm\n`;
  msg += `⚠️ Minimal qoldiq: ${fmtNum(DB.settings.minStock)} metr\n`;
  msg += `🛠 Usluga narxi: ${fmtNum(getServicePrice())} so'm/metr\n`;
  msg += `🕐 Timezone: ${DB.settings.timezone}\n`;
  msg += `🏭 Tashkilot nomi: ${DB.settings.orgName}\n`;
  if (DB.settings.phone) msg += `📞 Telefon: ${DB.settings.phone}\n`;
  if (DB.settings.address) msg += `📍 Manzil: ${DB.settings.address}\n`;

  const buttons = [
    [Markup.button.callback('💵 Dollar kursi', 'set_dollar'), Markup.button.callback('⚠️ Minimal qoldiq', 'set_minstock')],
    [Markup.button.callback('🛠 Usluga narxi', 'set_service_price'), Markup.button.callback('🏭 Tashkilot nomi', 'set_orgname')],
    [Markup.button.callback('📞 Telefon', 'set_phone'), Markup.button.callback('📍 Manzil', 'set_address')],
    [Markup.button.callback('🧾 Chek sozlamalari', 'set_receipt')],
    [Markup.button.callback('👥 Ishchilar', 'set_workers')],
    [Markup.button.callback('💾 Backup', 'set_backup')],
    [Markup.button.callback('⬅️ Orqaga', 'home')],
  ];
  await ctx.reply(msg, Markup.inlineKeyboard(buttons));
}

async function showSaleMenuManager(ctx) {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Faqat admin uchun.');

  const linked = DB.saleMenuProducts || [];
  const availableProducts = DB.products.filter(product => product.status === 'active'
    && !linked.some(item => item.productId === product.id));
  const buttons = availableProducts.map(product => [Markup.button.callback(
    `➕ ${product.name} ${product.type} (${formatQuantity(getStockQuantity(product.id), getProductUnit(product))} ${getProductUnit(product)})`,
    `sale_menu_add_${product.id}`,
  )]);
  linked.forEach(item => {
    const product = DB.products.find(p => p.id === item.productId);
    if (product?.status === 'active') {
      buttons.push([Markup.button.callback(`➖ ${product.name} ${product.type}`, `sale_menu_remove_${item.id}`)]);
    }
  });
  buttons.push([Markup.button.callback('⬅️ Admin paneli', 'home_panel')]);

  const list = linked.map(item => {
    const product = DB.products.find(p => p.id === item.productId);
    return product?.status === 'active' ? `• ${product.name} ${product.type}` : null;
  }).filter(Boolean);
  let message = '🛒 SOTUV MENYUSI MAHSULOTLARI\n\n';
  message += list.length ? `Menyuda:\n${list.join('\n')}\n\n` : 'Menyuga qo\'shimcha mahsulot ulanmagan.\n\n';
  message += availableProducts.length ? 'Sotuv menyusiga qo\'shish uchun ombor mahsulotini tanlang:' : 'Qo\'shish uchun yangi faol ombor mahsuloti yo\'q.';
  return sendSalePrompt(ctx, message, Markup.inlineKeyboard(buttons));
}

async function addStockProductToSaleMenu(ctx, productId) {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Faqat admin uchun.');
  const product = DB.products.find(p => p.id === productId && p.status === 'active');
  if (!product) return ctx.answerCbQuery('Faol ombor mahsuloti topilmadi.');
  if ((DB.saleMenuProducts || []).some(item => item.productId === productId)) {
    return ctx.answerCbQuery('Bu mahsulot sotuv menyusida bor.');
  }
  saveMutation(() => {
    DB.saleMenuProducts = DB.saleMenuProducts || [];
    DB.saleMenuProducts.push({ id: `WARE_${product.id}`, productId: product.id, createdAt: nowStr() });
    auditLog(getUser(ctx).id, 'Sotuv menyusiga mahsulot qo\'shildi', product.id, '', `${product.name} ${product.type}`);
  });
  await ctx.answerCbQuery('Mahsulot sotuv menyusiga qo\'shildi.');
  return showSaleMenuManager(ctx);
}

async function removeStockProductFromSaleMenu(ctx, menuItemId) {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Faqat admin uchun.');
  const index = (DB.saleMenuProducts || []).findIndex(item => item.id === menuItemId);
  if (index < 0) return ctx.answerCbQuery('Menyu mahsuloti topilmadi.');
  const item = DB.saleMenuProducts[index];
  const product = DB.products.find(p => p.id === item.productId);
  saveMutation(() => {
    DB.saleMenuProducts.splice(index, 1);
    auditLog(getUser(ctx).id, 'Sotuv menyusidan mahsulot olib tashlandi', item.productId, product?.name || '', '');
  });
  await ctx.answerCbQuery('Mahsulot menyudan olib tashlandi.');
  return showSaleMenuManager(ctx);
}

// ============================================================
// ADMIN PANELI
// ============================================================

async function showAdminPanel(ctx) {
  if (!isAdmin(ctx)) return ctx.reply('❌ Bu bo\'lim faqat admin uchun.');
  clearState(ctx);
  let msg = `👑 ADMIN PANELI\n\n`;
  msg += `👥 Foydalanuvchilar: ${DB.users.length}\n`;
  msg += `📦 Mahsulotlar: ${DB.products.filter(p => p.status === 'active').length}\n`;
  msg += `🛒 Sotuvlar: ${DB.sales.length}\n`;
  msg += `👥 Mijozlar: ${DB.customers.length}\n`;
  msg += `🔴 Qarzlar: ${DB.debts.length}\n`;
  msg += `📥 Kirim: ${DB.income.length}\n`;
  msg += `📤 Chiqim: ${DB.expenses.length}\n`;
  msg += `📜 Audit log: ${DB.auditLogs.length}\n`;

  const buttons = [
    [Markup.button.callback('📦 Mahsulot qo\'shish', 'admin_addprod')],
    [Markup.button.callback('🛒 Sotuv menyusini boshqarish', 'admin_sale_menu')],
    [Markup.button.callback('👥 Ishchilar', 'set_workers')],
    [Markup.button.callback('📥 Barcha sotuvlar', 'allsales')],
    [Markup.button.callback('📋 Audit log', 'admin_audit')],
    [Markup.button.callback('💾 Backup yaratish', 'admin_backup')],
    [Markup.button.callback('⬅️ Orqaga', 'home')],
  ];
  await ctx.reply(msg, Markup.inlineKeyboard(buttons));
}

// Audit log
async function showAuditLog(ctx) {
  if (!isAdmin(ctx)) return ctx.reply('❌ Bu bo\'lim faqat admin uchun.');
  const logs = DB.auditLogs.slice(-20).reverse();
  if (logs.length === 0) {
    return ctx.reply('📋 Audit log bo\'sh.', backKeyboard());
  }
  let msg = '📋 AUDIT LOG (oxirgi 20 ta)\n\n';
  logs.forEach(l => {
    const u = DB.users.find(u => u.id === l.userId);
    msg += `${prettyDateTime(l.date)}\n${u?.name || l.userId}\n${l.action}\nOb'ekt: ${l.object}\n`;
    if (l.prevValue) msg += `Oldingi: ${l.prevValue}\n`;
    if (l.newValue) msg += `Yangi: ${l.newValue}\n`;
    msg += '\n';
  });
  await ctx.reply(msg, backKeyboard());
}

// ============================================================
// ISHCHILARNI BOSHQARISH
// ============================================================

async function showWorkers(ctx) {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Faqat admin uchun.');
  const workers = DB.users.filter(u => u.role === 'worker');

  let msg = '👥 ISHCHILAR\n\n';
  if (workers.length === 0) {
    msg += 'Ishchilar yo\'q.';
  } else {
    workers.forEach(w => {
      msg += `${w.name}\nTelegram ID: ${w.telegramId}\nHolat: ${w.active ? '🟢 Faol' : '🔴 Nofaol'}\n\n`;
    });
  }

  const buttons = workers.map(w => [Markup.button.callback(`👤 ${w.name} ${w.active ? '🟢' : '🔴'}`, `worker_${w.id}`)]);
  buttons.push([Markup.button.callback('➕ Ishchi qo\'shish', 'addworker')]);
  buttons.push([Markup.button.callback('⬅️ Orqaga', 'settings')]);
  await ctx.editMessageText(msg, Markup.inlineKeyboard(buttons));
}

async function showWorkerDetail(ctx, workerId) {
  const worker = DB.users.find(u => u.id === workerId);
  if (!worker) return ctx.answerCbQuery('Ishchi topilmadi.');

  let msg = `👤 ${worker.name}\n\nTelegram ID: ${worker.telegramId}\nHolat: ${worker.active ? '🟢 Faol' : '🔴 Nofaol'}\n`;

  const buttons = [
    [Markup.button.callback(worker.active ? '🚫 Faolsizlantirish' : '🟢 Faollashtirish', `workertoggle_${worker.id}`)],
    [Markup.button.callback('✏️ Tahrirlash', `workeredit_${worker.id}`)],
    [Markup.button.callback('🗑 O\'chirish', `workerdelete_${worker.id}`)],
    [Markup.button.callback('⬅️ Orqaga', 'set_workers')],
  ];
  await ctx.editMessageText(msg, Markup.inlineKeyboard(buttons));
}

// Ishchi qo'shish
async function addWorkerStart(ctx) {
  setState(ctx, { step: 'add_worker_name' });
  await ctx.reply('👤 Ishchi ismi:\n\nMasalan: ISHCHI 1', cancelKeyboard());
}

// ============================================================
// BACKUP BO'LIMI
// ============================================================

async function showBackupMenu(ctx) {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Faqat admin uchun.');
  const backups = listBackups().slice(0, 10);
  let msg = '💾 BACKUP\n\n';
  if (backups.length === 0) {
    msg += 'Backuplar yo\'q.';
  } else {
    backups.forEach(b => {
      msg += `📁 ${b.filename}\n${prettyDateTime(b.date)} - ${fmtNum(b.size)} bayt\n\n`;
    });
  }
  const buttons = [
    [Markup.button.callback('💾 Backup yaratish', 'backup_create')],
  ];
  if (backups.length > 0) {
    buttons.push([Markup.button.callback('📋 Backup tarixi', 'backup_list')]);
  }
  buttons.push([Markup.button.callback('⬅️ Orqaga', 'settings')]);
  await ctx.editMessageText(msg, Markup.inlineKeyboard(buttons));
}

async function createBackupNow(ctx) {
  const result = createBackup(DB);
  if (!result) return ctx.answerCbQuery('Backup yaratishda xatolik.');

  const bId = nextId('BKP');
  DB.backups.push({ id: bId, filename: result.filename, date: result.date, size: result.size });
  save();

  // Guruhga yuborish
  if (PRIVATE_GROUP_ID) {
    try {
      await bot.telegram.sendDocument(PRIVATE_GROUP_ID, {
        source: result.filepath,
        filename: result.filename,
      });
    } catch (e) {
      console.error('Backup guruhga yuborishda xatolik:', e.message);
    }
  }

  await ctx.answerCbQuery('Backup yaratildi.');
  await ctx.reply(`✅ Backup yaratildi.\n\n📁 ${result.filename}`, Markup.inlineKeyboard([[Markup.button.callback('⬅️ Orqaga', 'set_backup')]]));
}

async function showBackupList(ctx) {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Faqat admin uchun.');
  const backups = listBackups().slice(0, 15);
  if (backups.length === 0) {
    return ctx.editMessageText('Backuplar yo\'q.', inlineBack('set_backup'));
  }
  const buttons = backups.map(b => [Markup.button.callback(`📁 ${b.filename}`, `backuprestore_${b.filename}`)]);
  buttons.push([Markup.button.callback('⬅️ Orqaga', 'set_backup')]);
  await ctx.editMessageText('📋 BACKUP TARIXI\n\nTiklash uchun tanlang:', Markup.inlineKeyboard(buttons));
}

async function confirmRestoreBackup(ctx, filename) {
  setState(ctx, { restoreBackup: filename });
  await ctx.editMessageText(
    `⚠️ DIQQAT!\n\nEski ma'lumotlar backup bilan almashtiriladi.\n\nBackup: ${filename}\n\nDavom etasizmi?`,
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ Ha, tiklash', `backuprestoreyes_${filename}`)],
      [Markup.button.callback('❌ Yo\'q', 'set_backup')],
    ])
  );
}

async function restoreBackupNow(ctx, filename) {
  const data = readBackupFile(filename);
  if (!data) return ctx.answerCbQuery('Backup buzilgan yoki topilmadi.');

  // Avval joriy holatni backup qilish
  createBackup(DB);

  DB = mergeDefaults(data);
  save();

  await ctx.editMessageText(`✅ Backup tiklandi.\n\n📁 ${filename}`, inlineBack('home'));
}

// ============================================================
// TEXT MESSAGE HANDLER (state-based)
// ============================================================

bot.on('text', async (ctx) => {
  if (!isAuthorized(ctx)) return;
  const text = ctx.message.text;
  const st = getState(ctx);

  // Agar state bo'sh bo'lsa — menyu tugmalari
  if (!st.step) {
    return handleMenuText(ctx, text);
  }

  // Bekor qilish
  if (text === '❌ Bekor qilish' || text === '⬅️ Orqaga' || text === '🏠 Bosh menyu') {
    clearState(ctx);
    return showMenu(ctx);
  }

  try {
    switch (st.step) {
      // === SOTUV: YANGI MIJOZ ===
      case 'sale_new_customer_name':
        if (!isNonEmptyStr(text)) return ctx.reply('❌ Ism bo\'sh bo\'lmasin.', cancelKeyboard());
        setState(ctx, { step: 'sale_new_customer_phone', newCustName: text.trim() });
        return ctx.reply('📞 Telefon raqami:\n\nMasalan: +998901234567\n\nYoki "-" deb o\'tkazib yuboring:', cancelKeyboard());

      case 'sale_new_customer_phone': {
        let phone = text.trim();
        if (phone === '-') phone = '';
        setState(ctx, { step: 'sale_new_customer_note', newCustPhone: phone });
        return ctx.reply('📝 Izoh:\n\nYoki "-" deb o\'tkazib yuboring:', cancelKeyboard());
      }

      case 'sale_new_customer_note': {
        let note = text.trim();
        if (note === '-') note = '';
        setState(ctx, { step: 'sale_customer_committing' });
        const originalDB = JSON.parse(JSON.stringify(DB));
        const cId = nextId('CUST');
        const customer = {
          id: cId,
          name: st.newCustName,
          phone: st.newCustPhone,
          note,
          telegramId: null,
          createdAt: nowStr(),
          status: 'active',
        };
        DB.customers.push(customer);
        try {
          auditLog(getUser(ctx).id, 'Yangi mijoz', cId, '', st.newCustName);
          save();
        } catch (e) {
          DB = originalDB;
          clearState(ctx);
          console.error('Mijozni saqlashda xatolik:', e.message);
          return ctx.reply('❌ Mijoz yaratilmadi. Qaytadan urinib ko\'ring.', homeKeyboard(ctx));
        }
        // Sotuvga davom etish — tunka tanlash
        return saleContinueForCustomer(ctx, cId);
      }

      // === SOTUV: METR KIRITISH ===
      case 'sale_quantity': {
        let qty;
        try {
          qty = parseQuantity(text, st.salePendingUnit || 'metr');
        } catch (e) {
          const example = st.salePendingUnit === 'dona' ? 'Masalan: 10 dona' : 'Masalan: 4.25 m yoki 1 m 25 sm';
          return ctx.reply(`❌ ${e.message}\n\n${example}`, cancelKeyboard());
        }
        return addSaleItemFromQuantity(ctx, qty);
      }

      // === ARALASH TO'LOV: NAQD ===
      case 'sale_mixed_cash': {
        if (!isNonNegativeNumber(text)) return ctx.reply('❌ Noto\'g\'ri summa.', cancelKeyboard());
        const cash = Number(text);
        const st2 = getState(ctx);
        if (cash > st2.saleTotal) return ctx.reply(`❌ Naqd summa jami summadan ko'p.\n\nJami: ${fmtSom(st2.saleTotal)}`, cancelKeyboard());
        setState(ctx, { saleMixedCash: cash });
        return saleMixedCard(ctx);
      }

      // === ARALASH TO'LOV: KARTA ===
      case 'sale_mixed_card': {
        if (!isNonNegativeNumber(text)) return ctx.reply('❌ Noto\'g\'ri summa.', cancelKeyboard());
        const card = Number(text);
        const st2 = getState(ctx);
        const cash = st2.saleMixedCash || 0;
        const remaining = st2.saleTotal - cash - card;
        if (remaining < 0) return ctx.reply(`❌ Naqd + Karta jami summadan ko'p.\n\nJami: ${fmtSom(st2.saleTotal)}`, cancelKeyboard());
        setState(ctx, { saleMixedCard: card });
        return saleMixedDebt(ctx);
      }

      case 'sale_mixed_debt': {
        if (!isNonNegativeNumber(text)) return ctx.reply('❌ Noto\'g\'ri nasiya summasi.', cancelKeyboard());
        const debt = Number(text);
        const cash = Number(st.saleMixedCash || 0);
        const card = Number(st.saleMixedCard || 0);
        if (Math.abs(cash + card + debt - st.saleTotal) > 0.01) {
          return ctx.reply(`❌ Naqd + karta + nasiya jami sotuvga teng bo\'lishi kerak.\n\nJami: ${fmtSom(st.saleTotal)}\nKiritildi: ${fmtSom(cash + card + debt)}`, cancelKeyboard());
        }
        return prepareSaleConfirmation(ctx, 'mixed', { cash, card, debt });
      }

      // === YANGI MIJOZ (menyudan) ===
      case 'new_customer_name':
        if (!isNonEmptyStr(text)) return ctx.reply('❌ Ism bo\'sh bo\'lmasin.', cancelKeyboard());
        setState(ctx, { step: 'new_customer_phone', newCustName: text.trim() });
        return ctx.reply('📞 Telefon raqami:\n\nYoki "-" deb o\'tkazib yuboring:', cancelKeyboard());

      case 'new_customer_phone': {
        let phone = text.trim();
        if (phone === '-') phone = '';
        setState(ctx, { step: 'new_customer_note', newCustPhone: phone });
        return ctx.reply('📝 Izoh:\n\nYoki "-" deb o\'tkazib yuboring:', cancelKeyboard());
      }

      case 'new_customer_note': {
        let note = text.trim();
        if (note === '-') note = '';
        const cId = nextId('CUST');
        DB.customers.push({
          id: cId,
          name: st.newCustName,
          phone: st.newCustPhone,
          note,
          telegramId: null,
          createdAt: nowStr(),
          status: 'active',
        });
        auditLog(getUser(ctx).id, 'Yangi mijoz', cId, '', st.newCustName);
        save();
        clearState(ctx);
        return ctx.reply(`✅ Mijoz qo'shildi.\n\n👤 ${st.newCustName}\nID: ${cId}`, homeKeyboard(ctx));
      }

      // === QARZ TO'LASH ===
      case 'pay_debt': {
        if (!isPositiveNumber(text)) return ctx.reply('❌ Noto\'g\'ri summa.\n\nMasalan: 500000', cancelKeyboard());
        return payDebtSave(ctx, Number(text));
      }

      // === NASIYA QO'SHISH ===
      case 'add_debt': {
        if (!isPositiveNumber(text)) return ctx.reply('❌ Noto\'g\'ri summa.\n\nMasalan: 2000000', cancelKeyboard());
        return addDebtSave(ctx, Number(text));
      }

      // === TUNKA KIRIMI: RULON RAQAMI ===
      case 'stock_in_roll': {
        const roll = text.trim() === '-' ? '' : text.trim();
        setState(ctx, { step: 'stock_in_qty', stockInRoll: roll });
        const example = st.stockInUnit === 'dona' ? 'Masalan: 100 dona' : 'Masalan: 1000 m, 125 sm yoki 500 mm';
        return ctx.reply(`📦 Kirim miqdori (${st.stockInUnit}):\n\n${example}`, cancelKeyboard());
      }

      case 'stock_in_qty': {
        let quantity;
        try {
          quantity = parseQuantity(text, st.stockInUnit || 'metr');
        } catch (e) {
          return ctx.reply(`❌ ${e.message}`, cancelKeyboard());
        }
        setState(ctx, { step: 'stock_in_price', stockInQty: quantity });
        return ctx.reply(`💰 1 ${st.stockInUnit || 'metr'} narxi (so'm):`, cancelKeyboard());
      }

      case 'stock_in_price': {
        if (!isPositiveNumber(text)) return ctx.reply('❌ Narx noldan katta son bo\'lishi kerak.', cancelKeyboard());
        setState(ctx, { step: 'stock_in_note', stockInPrice: Number(text) });
        return ctx.reply('📝 Izoh:\n\nYoki "-" deb o\'tkazib yuboring:', cancelKeyboard());
      }

      case 'stock_in_note': {
        let note = text.trim();
        if (note === '-') note = '';
        const user = getUser(ctx);
        const product = DB.products.find(p => p.id === st.stockInProductId);
        if (!product) {
          clearState(ctx);
          return ctx.reply('❌ Mahsulot topilmadi.', homeKeyboard(ctx));
        }
        if (st.step !== 'stock_in_note') return ctx.reply('⏳ Ushbu kirim allaqachon qayta ishlanmoqda.');
        setState(ctx, { step: 'stock_in_committing' });
        const originalDB = JSON.parse(JSON.stringify(DB));

        const unit = product.unit || st.stockInUnit || 'metr';
        const before = getStockQuantity(product.id);
        const rollId = unit === 'metr' ? nextId('ROLL') : '';
        const rollNumber = st.stockInRoll || '';
        if (unit === 'metr') {
          DB.rolls.push({
            id: rollId,
            productId: product.id,
            rollNumber,
            quantity: st.stockInQty,
            remaining: st.stockInQty,
            unitPrice: st.stockInPrice,
            date: nowStr(),
            note,
          });
        }

        addStock(product.id, st.stockInQty, rollId, note, user.id, {
          unit,
          unitPrice: st.stockInPrice,
          totalValue: st.stockInQty * st.stockInPrice,
          before,
          after: before + st.stockInQty,
          category: getProductCategory(product),
          batchNumber: rollNumber,
        });
        try {
          auditLog(user.id, `${getProductCategory(product)} kirimi`, product.id, `${formatQuantity(before, unit)} ${unit}`, `+${formatQuantity(st.stockInQty, unit)} ${unit}; narx ${fmtSom(st.stockInPrice)}`);
          save();
        } catch (e) {
          DB = originalDB;
          clearState(ctx);
          console.error('Kirimni saqlashda xatolik:', e.message);
          return ctx.reply('❌ Kirim saqlanmadi; ombor qoldig\'i o\'zgartirilmadi.', homeKeyboard(ctx));
        }
        checkLowStock(product.id);

        let groupMsg = `📥 ${getProductCategory(product)} KIRIMI\n\n${product.name} ${product.type}\n${rollNumber ? `Partiya/rulon: ${rollNumber}\n` : ''}+${formatQuantity(st.stockInQty, unit)} ${unit}\n${fmtNum(st.stockInPrice)} so'm/${unit}\nJami: ${fmtSom(st.stockInQty * st.stockInPrice)}\nKiritgan: ${user.name}\nSana: ${prettyDateTime(nowStr())}`;
        await sendToGroup(groupMsg);

        clearState(ctx);
        let msg = `✅ ${getProductCategory(product)} kirimi saqlandi.\n\n`;
        msg += `🏭 ${product.name} ${product.type}\n`;
        if (rollNumber) msg += `📦 Rulon/partiya: ${rollNumber}\n`;
        msg += `📦 +${formatQuantity(st.stockInQty, unit)} ${unit}\n`;
        msg += `💰 ${fmtNum(st.stockInPrice)} so'm/${unit}\n`;
        msg += `💵 Jami: ${fmtSom(st.stockInQty * st.stockInPrice)}\n`;
        msg += `📦 Yangi qoldiq: ${formatQuantity(getStockQuantity(product.id), unit)} ${unit}`;
        return ctx.reply(msg, homeKeyboard(ctx));
      }

      // === YANGI TUNKA QO'SHISH ===
      case 'new_product_name':
        if (!isNonEmptyStr(text)) return ctx.reply('❌ Nomi bo\'sh bo\'lmasin.', cancelKeyboard());
        setState(ctx, { step: 'new_product_type', newProdName: text.trim() });
        return ctx.reply('📏 Turi/qalinligi:\n\nMasalan: 0.45', cancelKeyboard());

      case 'new_product_type':
        if (!isNonEmptyStr(text)) return ctx.reply('❌ Turi bo\'sh bo\'lmasin.', cancelKeyboard());
        setState(ctx, { step: 'new_product_color', newProdType: text.trim() });
        return ctx.reply('🎨 Rangi:\n\nYoki "-" deb o\'tkazib yuboring:', cancelKeyboard());

      case 'new_product_color': {
        let color = text.trim();
        if (color === '-') color = '';
        setState(ctx, { step: 'new_product_qty', newProdColor: color });
        return ctx.reply(`📦 Boshlang'ich miqdor (${st.newProdUnit || 'metr'}):\n\n${st.newProdUnit === 'dona' ? 'Masalan: 100 dona yoki 0' : 'Masalan: 1000 m, 125 sm yoki 0'}`, cancelKeyboard());
      }

      case 'new_product_qty': {
        let quantity = 0;
        if (text.trim() !== '0' && text.trim() !== '-') {
          try {
            quantity = parseQuantity(text, st.newProdUnit || 'metr');
          } catch (e) {
            return ctx.reply(`❌ ${e.message}`, cancelKeyboard());
          }
        }
        if (st.newProdCategory === 'DELA') {
          setState(ctx, { step: 'new_product_minstock', newProdQty: quantity, newProdPrice: 20000 });
          return ctx.reply('💰 Dela xizmati narxi belgilangan: 20 000 so\'m/dona.\n\n⚠️ Minimal qoldiqni kiriting:', cancelKeyboard());
        }
        setState(ctx, { step: 'new_product_price', newProdQty: quantity });
        return ctx.reply(`💰 Sotuv narxi — 1 ${st.newProdUnit || 'metr'} uchun (so'm):\n\nBoshlang'ich tavsiya: ${fmtNum(st.newProdDefaultPrice || 0)}\nTavsiyani olish uchun "-" yozing yoki boshqa narx kiriting.`, cancelKeyboard());
      }

      case 'new_product_price': {
        const enteredPrice = text.trim() === '-' ? Number(st.newProdDefaultPrice) : Number(text);
        if (!Number.isFinite(enteredPrice) || enteredPrice <= 0) return ctx.reply('❌ Narx noldan katta son bo\'lishi kerak. Tavsiya narxidan foydalanish uchun "-" yozing.', cancelKeyboard());
        setState(ctx, { step: 'new_product_minstock', newProdPrice: enteredPrice });
        return ctx.reply('⚠️ Minimal qoldiq:\n\nMasalan: 100', cancelKeyboard());
      }

      case 'new_product_minstock': {
        const minStock = Number(text);
        if (!isNonNegativeNumber(text) || (st.newProdUnit === 'dona' && !Number.isSafeInteger(minStock))) {
          return ctx.reply(`❌ Minimal qoldiq noto\'g\'ri. ${st.newProdUnit === 'dona' ? 'Dona miqdori butun son bo\'lishi kerak.' : 'Noldan katta yoki teng son kiriting.'}`, cancelKeyboard());
        }
        setState(ctx, { step: 'new_product_note', newProdMinStock: minStock });
        return ctx.reply('📝 Izoh:\n\nYoki "-" deb o\'tkazib yuboring:', cancelKeyboard());
      }

      case 'new_product_note': {
        let note = text.trim();
        if (note === '-') note = '';
        const user = getUser(ctx);
        if (st.step !== 'new_product_note') return ctx.reply('⏳ Mahsulot allaqachon qayta ishlanmoqda.');
        setState(ctx, { step: 'new_product_committing' });
        const originalDB = JSON.parse(JSON.stringify(DB));
        const pId = nextId('PROD');
        const product = {
          id: pId,
          category: st.newProdCategory || 'TUNKA',
          unit: st.newProdUnit || 'metr',
          name: st.newProdName,
          type: st.newProdType,
          color: st.newProdColor,
          unitPrice: st.newProdPrice,
          minStock: st.newProdMinStock,
          status: 'active',
          createdAt: nowStr(),
          note,
        };
        DB.products.push(product);

        // Rulon yoki boshlang'ich kirimni mahsulot bilan bitta snapshotda saqlash.
        if (st.newProdQty > 0) {
          const rollId = product.unit === 'metr' ? nextId('ROLL') : '';
          if (rollId) DB.rolls.push({
            id: rollId,
            productId: pId,
            rollNumber: '001',
            quantity: st.newProdQty,
            remaining: st.newProdQty,
            unitPrice: st.newProdPrice,
            date: nowStr(),
            note: 'Boshlang\'ich kirim',
          });
          addStock(pId, st.newProdQty, rollId, 'Boshlang\'ich kirim', user.id, {
            unit: product.unit,
            unitPrice: st.newProdPrice,
            totalValue: st.newProdQty * st.newProdPrice,
            before: 0,
            after: st.newProdQty,
            category: product.category,
          });
        }

        try {
          auditLog(user.id, 'Yangi mahsulot', pId, '', `${product.category} — ${product.name} ${product.type}`);
          save();
        } catch (e) {
          DB = originalDB;
          clearState(ctx);
          console.error('Mahsulotni saqlashda xatolik:', e.message);
          return ctx.reply('❌ Mahsulot saqlanmadi; ombor ma\'lumotlari o\'zgartirilmadi.', homeKeyboard(ctx));
        }
        checkLowStock(product.id);

        let groupMsg = `🏭 YANGI ${product.category}\n\n${product.name} ${product.type}\nBoshlang'ich: ${formatQuantity(st.newProdQty, product.unit)} ${product.unit}\nNarx: ${fmtNum(product.unitPrice)} so'm/${product.unit}\nQo'shgan: ${user.name}\nSana: ${prettyDateTime(nowStr())}`;
        await sendToGroup(groupMsg);

        clearState(ctx);
        let msg = `✅ ${product.category} mahsuloti qo'shildi.\n\n`;
        msg += `🏭 ${product.name} ${product.type}\n`;
        if (product.color) msg += `🎨 ${product.color}\n`;
        msg += `📦 ${formatQuantity(st.newProdQty, product.unit)} ${product.unit}\n`;
        msg += `💰 ${fmtNum(product.unitPrice)} so'm/${product.unit}\n`;
        msg += `🏷 Kategoriya: ${product.category}\n`;
        msg += `⚠️ Minimal qoldiq: ${formatQuantity(product.minStock, product.unit)} ${product.unit}\n`;
        msg += `ID: ${pId}`;
        return ctx.reply(msg, homeKeyboard(ctx));
      }

      // === PUL KIRIMI ===
      case 'income_amount': {
        if (!isPositiveNumber(text)) return ctx.reply('❌ Noto\'g\'ri summa.', cancelKeyboard());
        const user = getUser(ctx);
        const incId = nextId('INC');
        DB.income.push({
          id: incId,
          source: st.incomeSource || 'Boshqa',
          customerId: st.incomeCustomerId || null,
          amount: Number(text),
          note: st.incomeNote || '',
          userId: user.id,
          date: nowStr(),
        });
        auditLog(user.id, 'Pul kirimi', incId, '', fmtSom(Number(text)));
        save();
        clearState(ctx);
        return ctx.reply(`✅ Pul kirimi saqlandi.\n\nManba: ${st.incomeSource || 'Boshqa'}\nSumma: ${fmtSom(Number(text))}`, homeKeyboard(ctx));
      }

      case 'income_note':
        setState(ctx, { step: 'income_amount', incomeNote: text.trim() });
        return ctx.reply('💰 Summa:\n\nMasalan: 500000', cancelKeyboard());

      // === CHIQIM ===
      case 'expense_amount': {
        if (!isPositiveNumber(text)) return ctx.reply('❌ Noto\'g\'ri summa.', cancelKeyboard());
        const user = getUser(ctx);
        setState(ctx, { step: 'expense_committing' });
        const originalDB = JSON.parse(JSON.stringify(DB));
        const expId = nextId('EXP');
        DB.expenses.push({
          id: expId,
          type: st.expenseType,
          amount: Number(text),
          note: st.expenseNote || '',
          userId: user.id,
          date: nowStr(),
        });
        try {
          auditLog(user.id, 'Chiqim', expId, '', `${st.expenseType}: ${fmtSom(Number(text))}`);
          save();
        } catch (e) {
          DB = originalDB;
          clearState(ctx);
          console.error('Chiqim saqlashda xatolik:', e.message);
          return ctx.reply('❌ Chiqim saqlanmadi.', homeKeyboard(ctx));
        }
        let groupMsg = `📤 CHIQIM\n\nTur: ${st.expenseType}\nSumma: ${fmtSom(Number(text))}\nKim: ${user.name}\nSana: ${prettyDateTime(nowStr())}`;
        await sendToGroup(groupMsg);
        clearState(ctx);
        return ctx.reply(`✅ Chiqim saqlandi.\n\nTur: ${st.expenseType}\nSumma: ${fmtSom(Number(text))}`, homeKeyboard(ctx));
      }

      case 'expense_note':
        setState(ctx, { step: 'expense_amount', expenseNote: text.trim() });
        return ctx.reply('💰 Summa:\n\nMasalan: 1200000', cancelKeyboard());

      // === KUNLIK HISOBOT SANA ===
      case 'daily_report_date': {
        let dateStr;
        if (text.trim().toLowerCase() === 'bugun') {
          dateStr = todayStr();
        } else {
          // DD.MM.YYYY -> YYYY-MM-DD
          const m = text.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
          if (!m) return ctx.reply('❌ Sana noto\'g\'ri.\n\nMasalan: 11.09.2026', cancelKeyboard());
          dateStr = `${m[3]}-${m[2]}-${m[1]}`;
        }
        return showDailyReport(ctx, dateStr);
      }

      // === OYLIK HISOBOT ===
      case 'monthly_report': {
        let mStr;
        if (text.trim().toLowerCase() === 'shuoy') {
          mStr = monthStr();
        } else {
          const m = text.trim().match(/^(\d{4})-(\d{2})$/);
          if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return ctx.reply('❌ Oy noto\'g\'ri.\n\nMasalan: 2026-09', cancelKeyboard());
          mStr = `${m[1]}-${m[2]}`;
        }
        return showMonthlyReport(ctx, mStr);
      }

      // === SOZLAMALAR ===
      case 'set_dollar_value': {
        if (!isPositiveNumber(text)) return ctx.reply('❌ Noto\'g\'ri kurs.', cancelKeyboard());
        const old = DB.settings.dollarRate;
        DB.settings.dollarRate = Number(text);
        auditLog(getUser(ctx).id, 'Dollar kursi o\'zgartirildi', 'settings', old, text);
        save();
        clearState(ctx);
        return ctx.reply(`✅ Dollar kursi o'zgartirildi.\n\n1 USD = ${fmtNum(DB.settings.dollarRate)} so'm`, homeKeyboard(ctx));
      }

      case 'set_minstock_value': {
        if (!isNonNegativeNumber(text)) return ctx.reply('❌ Noto\'g\'ri miqdor.', cancelKeyboard());
        const old = DB.settings.minStock;
        DB.settings.minStock = Number(text);
        auditLog(getUser(ctx).id, 'Minimal qoldiq o\'zgartirildi', 'settings', old, text);
        save();
        clearState(ctx);
        return ctx.reply(`✅ Minimal qoldiq: ${fmtNum(DB.settings.minStock)} metr`, homeKeyboard(ctx));
      }

      case 'set_service_price_value': {
        if (!isNonNegativeNumber(text)) return ctx.reply('❌ Noto\'g\'ri xizmat narxi.', cancelKeyboard());
        const old = DB.settings.servicePrice;
        DB.settings.servicePrice = Number(text);
        auditLog(getUser(ctx).id, 'Usluga narxi o\'zgartirildi', 'settings', old, text);
        save();
        clearState(ctx);
        return ctx.reply(`✅ Usluga narxi: ${fmtNum(DB.settings.servicePrice)} so'm/metr`, homeKeyboard(ctx));
      }

      case 'set_orgname_value': {
        if (!isNonEmptyStr(text)) return ctx.reply('❌ Nomi bo\'sh bo\'lmasin.', cancelKeyboard());
        const old = DB.settings.orgName;
        DB.settings.orgName = text.trim();
        auditLog(getUser(ctx).id, 'Tashkilot nomi o\'zgartirildi', 'settings', old, DB.settings.orgName);
        save();
        clearState(ctx);
        return ctx.reply(`✅ Tashkilot nomi: ${DB.settings.orgName}`, homeKeyboard(ctx));
      }

      case 'set_phone_value': {
        const old = DB.settings.phone;
        DB.settings.phone = text.trim();
        auditLog(getUser(ctx).id, 'Tashkilot telefoni o\'zgartirildi', 'settings', old, DB.settings.phone);
        save();
        clearState(ctx);
        return ctx.reply(`✅ Telefon: ${DB.settings.phone}`, homeKeyboard(ctx));
      }

      case 'set_address_value': {
        const old = DB.settings.address;
        DB.settings.address = text.trim();
        auditLog(getUser(ctx).id, 'Tashkilot manzili o\'zgartirildi', 'settings', old, DB.settings.address);
        save();
        clearState(ctx);
        return ctx.reply(`✅ Manzil: ${DB.settings.address}`, homeKeyboard(ctx));
      }

      case 'set_receipt_footer': {
        const old = DB.settings.receiptFooter;
        DB.settings.receiptFooter = text.trim();
        auditLog(getUser(ctx).id, 'Chek matni o\'zgartirildi', 'settings', old, DB.settings.receiptFooter);
        save();
        clearState(ctx);
        return ctx.reply(`✅ Chek matni: ${DB.settings.receiptFooter}`, homeKeyboard(ctx));
      }

      // === ISHCHI QO'SHISH ===
      case 'add_worker_name':
        if (!isNonEmptyStr(text)) return ctx.reply('❌ Ism bo\'sh bo\'lmasin.', cancelKeyboard());
        setState(ctx, { step: 'add_worker_id', newWorkerName: text.trim() });
        return ctx.reply(' Telegram ID:\n\nIshchining Telegram ID raqamini kiriting.\n(Buni ishchi @userinfobot ga yozib bilishi mumkin)', cancelKeyboard());

      case 'add_worker_id': {
        const tid = parseInt(text.trim(), 10);
        if (!tid || isNaN(tid)) return ctx.reply('❌ Noto\'g\'ri Telegram ID.\n\nFaqat raqam bo\'lishi kerak.', cancelKeyboard());
        if (DB.users.some(u => u.telegramId === tid)) return ctx.reply('❌ Bu ID allaqachon mavjud.', cancelKeyboard());
        if (tid === ADMIN_ID) return ctx.reply('❌ Bu ID admin.', cancelKeyboard());
        const uId = nextId('USR');
        DB.users.push({
          id: uId,
          role: 'worker',
          telegramId: tid,
          name: st.newWorkerName,
          active: true,
        });
        auditLog(getUser(ctx).id, 'Ishchi qo\'shildi', uId, '', st.newWorkerName);
        save();
        clearState(ctx);
        return ctx.reply(`✅ Ishchi qo'shildi.\n\n👤 ${st.newWorkerName}\nTelegram ID: ${tid}`, homeKeyboard(ctx));
      }

      // === ISHCHINI TAHRIRLASH ===
      case 'edit_worker_name':
        if (!isNonEmptyStr(text)) return ctx.reply('❌ Ism bo\'sh bo\'lmasin.', cancelKeyboard());
        setState(ctx, { step: 'edit_worker_id', editWorkerName: text.trim() });
        return ctx.reply(' Telegram ID:\n\nYoki eski ID qolsin bo\'lsa "-" yozing:', cancelKeyboard());

      case 'edit_worker_id': {
        const worker = DB.users.find(u => u.id === st.editWorkerId);
        if (!worker) { clearState(ctx); return ctx.reply('❌ Ishchi topilmadi.', homeKeyboard(ctx)); }
        if (text.trim() !== '-') {
          const tid = parseInt(text.trim(), 10);
          if (!tid || isNaN(tid)) return ctx.reply('❌ Noto\'g\'ri Telegram ID.', cancelKeyboard());
          if (DB.users.some(u => u.telegramId === tid && u.id !== worker.id)) return ctx.reply('❌ Bu ID allaqachon mavjud.', cancelKeyboard());
          worker.telegramId = tid;
        }
        worker.name = st.editWorkerName;
        auditLog(getUser(ctx).id, 'Ishchi tahrirlandi', worker.id, '', worker.name);
        save();
        clearState(ctx);
        return ctx.reply(`✅ Ishchi tahrirlandi.\n\n👤 ${worker.name}\nTelegram ID: ${worker.telegramId}`, homeKeyboard(ctx));
      }

      // === MAHSULOT TAHRIRLASH ===
      case 'edit_product_price': {
        if (!isPositiveNumber(text)) return ctx.reply('❌ Noto\'g\'ri narx.', cancelKeyboard());
        const product = DB.products.find(p => p.id === st.editProductId);
        if (!product) { clearState(ctx); return ctx.reply('❌ Mahsulot topilmadi.', homeKeyboard(ctx)); }
        const old = product.unitPrice;
        const value = Number(text);
        saveMutation(() => {
          product.unitPrice = value;
          auditLog(getUser(ctx).id, 'Mahsulot narxi o\'zgartirildi', product.id, old, value);
        });
        clearState(ctx);
        const unit = getProductUnit(product);
        return ctx.reply(`✅ Narx o'zgartirildi.\n\n🏭 ${product.name} ${product.type}\n💰 ${fmtNum(product.unitPrice)} so'm/${unit}`, productSavedKeyboard(product.id));
      }

      case 'edit_product_minstock': {
        const product = DB.products.find(p => p.id === st.editProductId);
        if (!product) { clearState(ctx); return ctx.reply('❌ Mahsulot topilmadi.', homeKeyboard(ctx)); }
        const unit = getProductUnit(product);
        const minStock = Number(text);
        if (!isNonNegativeNumber(text) || (unit === 'dona' && !Number.isSafeInteger(minStock))) {
          return ctx.reply(`❌ Minimal qoldiq noto\'g\'ri. ${unit === 'dona' ? 'Dona miqdori butun son bo\'lishi kerak.' : 'Noldan katta yoki teng son kiriting.'}`, cancelKeyboard());
        }
        const old = product.minStock;
        const value = minStock;
        saveMutation(() => {
          product.minStock = value;
          auditLog(getUser(ctx).id, 'Mahsulot minimal qoldig\'i o\'zgartirildi', product.id, old, value);
        });
        clearState(ctx);
        return ctx.reply(`✅ Minimal qoldiq o'zgartirildi.\n\n🏭 ${product.name} ${product.type}\n⚠️ ${formatQuantity(product.minStock, unit)} ${unit}`, productSavedKeyboard(product.id));
      }

      case 'edit_product_name': {
        if (!isNonEmptyStr(text)) return ctx.reply('❌ Nomi bo\'sh bo\'lmasin.', cancelKeyboard());
        const product = DB.products.find(p => p.id === st.editProductId);
        if (!product) { clearState(ctx); return ctx.reply('❌ Mahsulot topilmadi.', homeKeyboard(ctx)); }
        const old = product.name;
        const value = text.trim();
        saveMutation(() => {
          product.name = value;
          auditLog(getUser(ctx).id, 'Mahsulot nomi o\'zgartirildi', product.id, old, value);
        });
        clearState(ctx);
        return ctx.reply(`✅ Nomi o'zgartirildi.\n\n🏭 ${product.name} ${product.type}`, productSavedKeyboard(product.id));
      }

      case 'edit_product_type': {
        if (!isNonEmptyStr(text)) return ctx.reply('❌ Turi bo\'sh bo\'lmasin.', cancelKeyboard());
        const product = DB.products.find(p => p.id === st.editProductId);
        if (!product) { clearState(ctx); return ctx.reply('❌ Mahsulot topilmadi.', homeKeyboard(ctx)); }
        const old = product.type;
        const value = text.trim();
        saveMutation(() => {
          product.type = value;
          auditLog(getUser(ctx).id, 'Mahsulot turi o\'zgartirildi', product.id, old, value);
        });
        clearState(ctx);
        return ctx.reply(`✅ Turi o'zgartirildi.\n\n🏭 ${product.name} ${product.type}`, productSavedKeyboard(product.id));
      }

      case 'edit_product_color':
      case 'edit_product_note': {
        const product = DB.products.find(p => p.id === st.editProductId);
        if (!product) { clearState(ctx); return ctx.reply('❌ Mahsulot topilmadi.', homeKeyboard(ctx)); }
        const field = st.step === 'edit_product_color' ? 'color' : 'note';
        const action = field === 'color' ? 'Mahsulot rangi o\'zgartirildi' : 'Mahsulot izohi o\'zgartirildi';
        const old = product[field] || '';
        const value = text.trim() === '-' ? '' : text.trim();
        saveMutation(() => {
          product[field] = value;
          auditLog(getUser(ctx).id, action, product.id, old, value);
        });
        clearState(ctx);
        const label = field === 'color' ? 'Rang' : 'Izoh';
        return ctx.reply(`✅ ${label} saqlandi.\n\n🏭 ${product.name} ${product.type}\n${label}: ${value || '-'}`, productSavedKeyboard(product.id));
      }

      // === MIJOZ TAHRIRLASH ===
      case 'edit_customer_name': {
        if (!isNonEmptyStr(text)) return ctx.reply('❌ Ism bo\'sh bo\'lmasin.', cancelKeyboard());
        const c = DB.customers.find(c => c.id === st.editCustomerId);
        if (!c) { clearState(ctx); return ctx.reply('❌ Mijoz topilmadi.', homeKeyboard(ctx)); }
        const old = c.name;
        c.name = text.trim();
        auditLog(getUser(ctx).id, 'Mijoz ismi o\'zgartirildi', c.id, old, c.name);
        save();
        clearState(ctx);
        return ctx.reply(`✅ Mijoz nomi o'zgartirildi.\n\n👤 ${c.name}`, homeKeyboard(ctx));
      }

      case 'edit_customer_phone': {
        const c = DB.customers.find(c => c.id === st.editCustomerId);
        if (!c) { clearState(ctx); return ctx.reply('❌ Mijoz topilmadi.', homeKeyboard(ctx)); }
        let phone = text.trim();
        if (phone === '-') phone = '';
        const old = c.phone;
        c.phone = phone;
        auditLog(getUser(ctx).id, 'Mijoz telefoni o\'zgartirildi', c.id, old, c.phone);
        save();
        clearState(ctx);
        return ctx.reply(`✅ Telefon o'zgartirildi.\n\n📞 ${c.phone || '-'}`, homeKeyboard(ctx));
      }

      default:
        clearState(ctx);
        return showMenu(ctx);
    }
  } catch (e) {
    console.error('Text handler xatolik:', e.message);
    clearState(ctx);
    return ctx.reply('❌ Xatolik yuz berdi. Ma\'lumot saqlanmadi. Iltimos, qaytadan urinib ko\'ring.', homeKeyboard(ctx));
  }
});

// Menyu matnlarini boshqarish
async function handleMenuText(ctx, text) {
  switch (text) {
    case '📦 Ombor': return showWarehouse(ctx);
    case '🛒 Sotuv qilish': return startSale(ctx);
    case '👥 Mijozlar': return showCustomers(ctx);
    case '🔴 Qarzdorlar': return showDebtors(ctx);
    case '📥 Tunka kirimi': return startStockIn(ctx);
    case '💰 Pul kirimi': return startIncome(ctx);
    case '📤 Chiqim': return startExpense(ctx);
    case '📊 Kunlik hisobot': return dailyReportStart(ctx);
    case '📅 Oylik hisobot': return monthlyReportStart(ctx);
    case '📜 Tarix': return showHistory(ctx);
    case '🧾 Cheklar': return showReceipts(ctx);
    case '⚙️ Sozlamalar': return showSettings(ctx);
    case '👑 Admin paneli': return showAdminPanel(ctx);
    case '🧾 Mening cheklarim': return showReceipts(ctx);
    case '📜 Mening sotuvlarim': return showMySales(ctx);
    case '⬅️ Orqaga':
    case '🏠 Bosh menyu':
      return showMenu(ctx);
    default:
      return ctx.reply('Tanlangan tugma topilmadi. Bosh menyu uchun /menu bosing.');
  }
}

// ============================================================
// CALLBACK QUERY HANDLER
// ============================================================

bot.on('callback_query', async (ctx) => {
  if (!isAuthorized(ctx)) return ctx.answerCbQuery('Huquq yo\'q.');
  const data = ctx.callbackQuery.data;
  const st = getState(ctx);

  try {
    // Umumiy callbacklar
    if (data === 'home') { clearState(ctx); await ctx.deleteMessage().catch(() => {}); return showMenu(ctx); }
    if (data === 'cancel') { clearState(ctx); await ctx.deleteMessage().catch(() => {}); return showMenu(ctx); }
    if (data === 'cancel_sale') { clearState(ctx); await ctx.deleteMessage().catch(() => {}); return showMenu(ctx); }
    if (data === 'warehouse') return showWarehouse(ctx);
    if (data.startsWith('warehouse_page_')) return showWarehouse(ctx, Number(data.substring(15)) || 0);
    if (data.startsWith('archived_products_page_')) return showArchivedProducts(ctx, Number(data.substring(23)) || 0);
    if (data === 'stockin_menu') return startStockIn(ctx);
    if (data.startsWith('stockin_cat_')) return showStockProductsForIn(ctx, data.substring(12));
    if (data.startsWith('stockinnew_')) return newProductStart(ctx, data.substring(11));
    if (data === 'customers') return showCustomers(ctx);
    if (data === 'settings') return showSettings(ctx);
    if (data.startsWith('history_page_')) return showHistory(ctx, Number(data.substring(13)) || 0);
    if (data.startsWith('debtors_page_')) return renderDebtorsPage(ctx, Number(data.substring(13)) || 0);
    if (data === 'home_panel') return showAdminPanel(ctx);
    if (data === 'allsales') return showAllSales(ctx);
    if (data === 'set_workers') return showWorkers(ctx);
    if (data === 'set_backup') return showBackupMenu(ctx);
    if (data === 'backup_list') return showBackupList(ctx);
    if (data === 'backup_create') return createBackupNow(ctx);

    // === OMBOR ===
    if (data.startsWith('prod_') && !data.startsWith('prodin_') && !data.startsWith('prodsales_') && !data.startsWith('prodmove_') && !data.startsWith('prodedit_') && !data.startsWith('prodarchive_')) {
      const pid = data.substring(5);
      return showProductDetail(ctx, pid);
    }
    if (data.startsWith('prodin_')) {
      const pid = data.substring(7);
      const movements = DB.stockMovements.filter(m => m.productId === pid && m.type === 'in').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15);
      const product = DB.products.find(p => p.id === pid);
      if (movements.length === 0) return ctx.answerCbQuery('Kirim yo\'q.');
      const unit = product?.unit || (getProductCategory(product) === 'DUGA' ? 'dona' : 'metr');
      let msg = `📥 ${getProductCategory(product)} ${product?.name} ${product?.type} - KIRIMLAR\n\n`;
      movements.forEach(m => {
        const u = DB.users.find(u => u.id === m.userId);
        msg += `${m.id} | ${prettyDateTime(m.date)}\n+${formatQuantity(m.quantity, unit)} ${unit}\nNarx: ${fmtNum(m.unitPrice || 0)} so'm/${unit} | Jami: ${fmtSom(m.totalValue || m.quantity * (m.unitPrice || 0))}\nPartiya: ${m.batchNumber || m.rollId || '-'}\n${u?.name || '?'}\n${m.note || ''}\n\n`;
      });
      return ctx.editMessageText(msg, inlineBack(`prod_${pid}`));
    }
    if (data.startsWith('prodsales_')) {
      const pid = data.substring(10);
      const sales = DB.sales.filter(s => saleContainsProduct(s, pid) && s.status === 'active').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15);
      const product = DB.products.find(p => p.id === pid);
      if (sales.length === 0) return ctx.answerCbQuery('Sotuv yo\'q.');
      let msg = `🛒 ${product?.name} ${product?.type} - SOTUVLAR\n\n`;
      sales.forEach(s => {
        const c = DB.customers.find(c => c.id === s.customerId);
        const lineItems = reportSaleItems(s).filter(item => item.productId === pid);
        msg += `${s.id}\n${prettyDateTime(s.date)}\n${c?.name || '?'} — ${lineItems.map(item => `${formatQuantity(item.quantity, item.unit)} ${item.unit}`).join(', ')} — ${fmtSom(lineItems.reduce((sum, item) => sum + item.total, 0))}\n\n`;
      });
      return ctx.editMessageText(msg, inlineBack(`prod_${pid}`));
    }
    if (data.startsWith('prodmove_')) {
      const pid = data.substring(9);
      const movements = DB.stockMovements.filter(m => m.productId === pid).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
      const product = DB.products.find(p => p.id === pid);
      if (movements.length === 0) return ctx.answerCbQuery('Harakat yo\'q.');
      const unit = product?.unit || (getProductCategory(product) === 'DUGA' ? 'dona' : 'metr');
      let msg = `📊 ${getProductCategory(product)} ${product?.name} ${product?.type} - QOLDIQ HARAKATI\n\n`;
      movements.forEach(m => {
        const sign = m.type === 'in' ? '+' : (m.type === 'cancel' ? '+' : '-');
        const icon = m.type === 'in' ? '📥' : (m.type === 'cancel' ? '↩️' : '📤');
        const u = DB.users.find(user => user.id === m.userId);
        msg += `${m.id} | ${prettyDateTime(m.date)}\n${icon} ${sign}${formatQuantity(m.quantity, unit)} ${unit}\nQoldiq: ${formatQuantity(m.quantityAfter ?? 0, unit)} ${unit}\n${m.note || ''}${u ? `\n${u.name}` : ''}\n\n`;
      });
      return ctx.editMessageText(msg, inlineBack(`prod_${pid}`));
    }
    if (data.startsWith('prodedit_')) {
      clearState(ctx);
      const pid = data.substring(9);
      const product = DB.products.find(p => p.id === pid);
      if (!product) return ctx.answerCbQuery('Topilmadi.');
      const buttons = [
        [Markup.button.callback('✏️ Nomi', `epname_${pid}`), Markup.button.callback('✏️ Turi', `eptype_${pid}`)],
        [Markup.button.callback('✏️ Minimal qoldiq', `epmin_${pid}`)],
        [Markup.button.callback('⬅️ Orqaga', `prod_${pid}`)],
      ];
      if (getProductCategory(product) !== 'DELA') {
        buttons[1].unshift(Markup.button.callback('✏️ Narxi', `epprice_${pid}`));
      }
      return ctx.editMessageText(`✏️ ${product.name} ${product.type}\n\nNimani tahrirlaysiz?`, Markup.inlineKeyboard(buttons));
    }
    if (data.startsWith('prodeditmore_')) {
      clearState(ctx);
      const pid = data.substring(13);
      const product = DB.products.find(p => p.id === pid);
      if (!product) return ctx.answerCbQuery('Mahsulot topilmadi.');
      return ctx.editMessageText(`✏️ ${product.name} ${product.type}\n\nRang: ${product.color || '-'}\nIzoh: ${product.note || '-'}\n\nNimani tahrirlaysiz?`, Markup.inlineKeyboard([
        [Markup.button.callback('🎨 Rang', `epcolor_${pid}`)],
        [Markup.button.callback('📝 Izoh', `epnote_${pid}`)],
        [Markup.button.callback('⬅️ Orqaga', `prod_${pid}`)],
      ]));
    }
    if (data.startsWith('epname_')) {
      const pid = data.substring(6);
      const p = DB.products.find(p => p.id === pid);
      if (!p) return ctx.answerCbQuery('Mahsulot topilmadi.');
      setState(ctx, { step: 'edit_product_name', editProductId: pid });
      return ctx.editMessageText(`✏️ Nomi:\n\nJoriy: ${p.name}`, Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor qilish', `prodedit_${pid}`)]]));
    }
    if (data.startsWith('eptype_')) {
      const pid = data.substring(6);
      const p = DB.products.find(p => p.id === pid);
      if (!p) return ctx.answerCbQuery('Mahsulot topilmadi.');
      setState(ctx, { step: 'edit_product_type', editProductId: pid });
      return ctx.editMessageText(`✏️ Turi:\n\nJoriy: ${p.type}`, Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor qilish', `prodedit_${pid}`)]]));
    }
    if (data.startsWith('epprice_')) {
      const pid = data.substring(7);
      const p = DB.products.find(p => p.id === pid);
      if (!p) return ctx.answerCbQuery('Mahsulot topilmadi.');
      if (getProductCategory(p) === 'DELA') return ctx.answerCbQuery('Dela xizmati narxi belgilangan: 20 000 so\'m/dona.');
      setState(ctx, { step: 'edit_product_price', editProductId: pid });
      return ctx.editMessageText(`✏️ Narxi:\n\nJoriy: ${fmtNum(p.unitPrice)} so'm`, Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor qilish', `prodedit_${pid}`)]]));
    }
    if (data.startsWith('epmin_')) {
      const pid = data.substring(6);
      const p = DB.products.find(p => p.id === pid);
      if (!p) return ctx.answerCbQuery('Mahsulot topilmadi.');
      setState(ctx, { step: 'edit_product_minstock', editProductId: pid });
      const unit = getProductUnit(p);
      return ctx.editMessageText(`✏️ Minimal qoldiq:\n\nJoriy: ${formatQuantity(p.minStock, unit)} ${unit}`, Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor qilish', `prodedit_${pid}`)]]));
    }
    if (data.startsWith('epcolor_')) {
      const pid = data.substring(8);
      const product = DB.products.find(p => p.id === pid);
      if (!product) return ctx.answerCbQuery('Mahsulot topilmadi.');
      setState(ctx, { step: 'edit_product_color', editProductId: pid });
      return ctx.editMessageText(`🎨 Yangi rang:\n\nJoriy: ${product.color || '-'}\nBo\'sh qilish uchun "-" yozing.`, Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor qilish', `prodeditmore_${pid}`)]]));
    }
    if (data.startsWith('epnote_')) {
      const pid = data.substring(7);
      const product = DB.products.find(p => p.id === pid);
      if (!product) return ctx.answerCbQuery('Mahsulot topilmadi.');
      setState(ctx, { step: 'edit_product_note', editProductId: pid });
      return ctx.editMessageText(`📝 Yangi izoh:\n\nJoriy: ${product.note || '-'}\nBo\'sh qilish uchun "-" yozing.`, Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor qilish', `prodeditmore_${pid}`)]]));
    }
    if (data.startsWith('prodarchive_')) {
      if (!isAdmin(ctx)) return ctx.answerCbQuery('Faqat admin uchun.');
      const pid = data.substring(12);
      const product = DB.products.find(p => p.id === pid);
      if (!product) return ctx.answerCbQuery('Topilmadi.');
      setState(ctx, { archiveProductId: pid });
      return ctx.editMessageText(
        `⚠️ Rostdan ham arxivlaysizmi?\n\n🏭 ${product.name} ${product.type}\n\nMahsulot faol ombor va sotuv menyusidan olinadi. Tarix va qoldiq yozuvlari saqlanadi; uni keyin qayta faollashtirish mumkin.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Ha, arxivlash', `prodarchiveyes_${pid}`)],
          [Markup.button.callback('❌ Yo\'q', `prod_${pid}`)],
        ])
      );
    }
    if (data.startsWith('prodarchiveyes_')) {
      if (!isAdmin(ctx)) return ctx.answerCbQuery('Faqat admin uchun.');
      const pid = data.substring(15);
      const product = DB.products.find(p => p.id === pid);
      if (!product) return ctx.answerCbQuery('Topilmadi.');
      if (product.status === 'archived') return ctx.answerCbQuery('Mahsulot allaqachon arxivlangan.');
      saveMutation(() => {
        product.status = 'archived';
        auditLog(getUser(ctx).id, 'Mahsulot arxivlandi', pid, 'active', 'archived');
      });
      clearState(ctx);
      return ctx.editMessageText(`✅ Mahsulot arxivlandi.\n\n🏭 ${product.name} ${product.type}`, inlineBack('warehouse'));
    }
    if (data.startsWith('prodrestore_')) {
      if (!isAdmin(ctx)) return ctx.answerCbQuery('Faqat admin uchun.');
      const pid = data.substring(12);
      const product = DB.products.find(p => p.id === pid);
      if (!product) return ctx.answerCbQuery('Mahsulot topilmadi.');
      if (product.status !== 'archived') return ctx.answerCbQuery('Mahsulot faol holatda.');
      saveMutation(() => {
        product.status = 'active';
        auditLog(getUser(ctx).id, 'Mahsulot qayta faollashtirildi', pid, 'archived', 'active');
      });
      clearState(ctx);
      return ctx.editMessageText(`✅ Mahsulot qayta faollashtirildi.\n\n🏭 ${product.name} ${product.type}`, inlineBack('warehouse'));
    }

    // === SOTUV ===
    if (data === 'admin_sale_menu') return showSaleMenuManager(ctx);
    if (data.startsWith('sale_menu_add_')) return addStockProductToSaleMenu(ctx, data.substring(14));
    if (data.startsWith('sale_menu_remove_')) return removeStockProductFromSaleMenu(ctx, data.substring(17));
    if (data.startsWith('sellcat_')) {
      const categoryId = data.substring(8);
      return startSaleCategory(ctx, categoryId);
    }
    if (data === 'sale_finish_items') {
      if (!(st.saleItems || []).length) return ctx.answerCbQuery('Avval kamida bitta mahsulot qo\'shing.');
      return saleSelectPayment(ctx);
    }
    if (data.startsWith('sale_item_remove_')) {
      if (st.saleMode !== 'mixed') return ctx.answerCbQuery('Faqat aralash savatda qatorni o\'zgartirish mumkin.');
      const index = Number(data.substring(17));
      if (!Number.isInteger(index) || index < 0 || index >= (st.saleItems || []).length) return ctx.answerCbQuery('Savat qatori topilmadi.');
      const saleItems = [...st.saleItems];
      saleItems.splice(index, 1);
      setState(ctx, { saleItems, step: 'sale_category' });
      return showSaleCategories(ctx);
    }
    if (data === 'sale_confirm_yes') return confirmSale(ctx);
    if (data === 'sale_confirm_no') return saleSelectPayment(ctx);
    if (data === 'service_owner_yes') {
      const serviceRate = getServicePrice();
      setState(ctx, { step: 'sale_quantity', salePendingCategory: 'USLUGA', salePendingProductId: null, salePendingUnitPrice: serviceRate, salePendingBasePrice: serviceRate, salePendingServiceFee: 0, salePendingUnit: 'metr' });
      return sendSalePrompt(ctx, `🛠 Mijozning o'z tunkasini bukish\nUsluga narxi: ${fmtNum(serviceRate)} so'm/metr\n\nNecha metr?`, cancelKeyboard());
    }
    if (data === 'service_owner_no') return showSaleStockProducts(ctx, 'USLUGA');
    if (data === 'saleprod_yes') return chooseSaleStockProduct(ctx);
    if (data === 'saleprod_no') return skipSaleStockProduct(ctx);
    if (data.startsWith('salecust_')) {
      const cid = data.substring(9);
      return saleContinueForCustomer(ctx, cid);
    }
    if (data === 'sale_new_customer') return saleNewCustomer(ctx);
    if (data.startsWith('saleprod_')) {
      const pid = data.substring(9);
      return saleEnterQuantity(ctx, pid);
    }
    if (data === 'paycash') return prepareSaleConfirmation(ctx, 'cash');
    if (data === 'paycard') return prepareSaleConfirmation(ctx, 'card');
    if (data === 'paydebt') return prepareSaleConfirmation(ctx, 'debt');
    if (data === 'paymixed') return saleMixedCash(ctx);

    // === PDF ===
    if (data.startsWith('getpdf_')) {
      const sid = data.substring(7);
      return sendReceipt(ctx, sid);
    }
    if (data.startsWith('dailypdf_')) {
      const dateStr = data.substring(9);
      const report = generateDailyReportData(dateStr);
      try {
        const filepath = await generateDailyReport(report, dateStr, DB.settings);
        await ctx.replyWithDocument({ source: filepath, filename: `daily_report_${dateStr}.pdf` });
        return ctx.answerCbQuery('Hisobot yuborildi.');
      } catch (e) {
        return ctx.answerCbQuery('PDF xatolik.');
      }
    }
    if (data.startsWith('monthlypdf_')) {
      const mStr = data.substring(11);
      const report = generateMonthlyReportData(mStr);
      try {
        const filepath = await generateMonthlyReport(report, mStr, DB.settings);
        await ctx.replyWithDocument({ source: filepath, filename: `monthly_report_${mStr}.pdf` });
        return ctx.answerCbQuery('Hisobot yuborildi.');
      } catch (e) {
        return ctx.answerCbQuery('PDF xatolik.');
      }
    }

    // === MIJOZLAR ===
    if (data === 'newcustomer') return newCustomerStart(ctx);
    if (data.startsWith('cust_') && !data.startsWith('custdebt_') && !data.startsWith('custsales_') && !data.startsWith('custpay_') && !data.startsWith('custadddebt_') && !data.startsWith('custedit_') && !data.startsWith('custarchive_')) {
      const cid = data.substring(5);
      return showCustomerDetail(ctx, cid);
    }
    if (data.startsWith('custdebt_')) {
      const cid = data.substring(9);
      return showDebtHistory(ctx, cid);
    }
    if (data.startsWith('custsales_')) {
      const cid = data.substring(10);
      const sales = DB.sales.filter(s => s.customerId === cid && s.status === 'active').sort((a, b) => b.date.localeCompare(a.date));
      const c = DB.customers.find(c => c.id === cid);
      if (sales.length === 0) return ctx.answerCbQuery('Sotuv yo\'q.');
      let msg = `🛒 ${c?.name} - SOTUVLARI\n\n`;
      sales.forEach(s => {
        const lines = reportSaleItems(s).map(item => `${item.productName || '?'}: ${formatQuantity(item.quantity, item.unit)} ${item.unit} — ${fmtSom(item.total)}`).join('\n');
        msg += `${s.id}\n${prettyDateTime(s.date)}\n${lines}\n${fmtSom(s.total)}\n\n`;
      });
      return ctx.editMessageText(msg, inlineBack(`cust_${cid}`));
    }
    if (data.startsWith('custpay_')) {
      const cid = data.substring(8);
      return payDebtStart(ctx, cid);
    }
    if (data.startsWith('custadddebt_')) {
      const cid = data.substring(12);
      return addDebtStart(ctx, cid);
    }
    if (data.startsWith('custedit_')) {
      const cid = data.substring(9);
      const c = DB.customers.find(c => c.id === cid);
      if (!c) return ctx.answerCbQuery('Topilmadi.');
      const buttons = [
        [Markup.button.callback('✏️ Ismi', `ecname_${cid}`), Markup.button.callback('✏️ Telefoni', `ecphone_${cid}`)],
        [Markup.button.callback('⬅️ Orqaga', `cust_${cid}`)],
      ];
      return ctx.editMessageText(`✏️ ${c.name}\n\nNimani tahrirlaysiz?`, Markup.inlineKeyboard(buttons));
    }
    if (data.startsWith('ecname_')) {
      const cid = data.substring(6);
      setState(ctx, { step: 'edit_customer_name', editCustomerId: cid });
      return ctx.editMessageText('✏️ Yangi ism:', Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor qilish', `custedit_${cid}`)]]));
    }
    if (data.startsWith('ecphone_')) {
      const cid = data.substring(7);
      setState(ctx, { step: 'edit_customer_phone', editCustomerId: cid });
      return ctx.editMessageText('✏️ Yangi telefon:\n\nYoki "-" bo\'sh qilish uchun:', Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor qilish', `custedit_${cid}`)]]));
    }
    if (data.startsWith('custarchive_')) {
      const cid = data.substring(12);
      const c = DB.customers.find(c => c.id === cid);
      if (!c) return ctx.answerCbQuery('Topilmadi.');
      const debt = getCustomerDebt(cid);
      if (debt > 0) return ctx.answerCbQuery('Mijozda qarz bor! Avval qarzni yeching.');
      setState(ctx, { archiveCustomerId: cid });
      return ctx.editMessageText(
        `⚠️ Rostdan ham arxivlaysizmi?\n\n👤 ${c.name}\nID: ${c.id}\n\nBu amal tarixga ta'sir qilishi mumkin.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🗑 Ha, arxivlash', `custarchiveyes_${cid}`)],
          [Markup.button.callback('❌ Yo\'q', `cust_${cid}`)],
        ])
      );
    }
    if (data.startsWith('custarchiveyes_')) {
      const cid = data.substring(15);
      const c = DB.customers.find(c => c.id === cid);
      if (!c) return ctx.answerCbQuery('Topilmadi.');
      c.status = 'archived';
      auditLog(getUser(ctx).id, 'Mijoz arxivlandi', cid, 'active', 'archived');
      save();
      clearState(ctx);
      return ctx.editMessageText(`✅ Mijoz arxivlandi.\n\n👤 ${c.name}`, inlineBack('customers'));
    }

    // === TUNKA KIRIMI ===
    if (data.startsWith('stockin_') && !data.includes('new') && !data.startsWith('stockin_cat_')) {
      const pid = data.substring(8);
      return stockInForProduct(ctx, pid);
    }
    if (data === 'stockin_new') return newProductStart(ctx, 'TUNKA');

    // === PUL KIRIMI ===
    if (data === 'incsrc_qarz') {
      setState(ctx, { step: 'income_select_customer', incomeSource: 'Qarz to\'lovi' });
      const customers = DB.customers.filter(c => c.status === 'active' && getCustomerDebt(c.id) > 0);
      if (customers.length === 0) return ctx.answerCbQuery('Faol qarzdor mijoz yo\'q.');
      const buttons = customers.slice(0, 20).map(c => [Markup.button.callback(`👤 ${c.name}`, `incust_${c.id}`)]);
      buttons.push([Markup.button.callback('❌ Bekor qilish', 'cancel')]);
      return ctx.editMessageText('👤 Qarz to\'lovini qabul qilinadigan mijozni tanlang:', Markup.inlineKeyboard(buttons));
    }
    if (data === 'incsrc_other') {
      setState(ctx, { step: 'income_note', incomeSource: 'Boshqa' });
      return ctx.editMessageText('📝 Izoh:\n\nYoki "-" yozing:', Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor qilish', 'cancel')]]));
    }
    if (data.startsWith('incust_')) {
      const cid = data.substring(7);
      const c = DB.customers.find(c => c.id === cid);
      if (!c || getCustomerDebt(cid) <= 0) return ctx.answerCbQuery('Mijozda faol qarz yo\'q.');
      setState(ctx, { step: 'pay_debt', payDebtCustomerId: cid });
      return ctx.editMessageText(`👤 ${c.name}\n\n🔴 Hozirgi qarz: ${fmtSom(getCustomerDebt(cid))}\n\n💵 Qancha to'landi?`, Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor qilish', 'cancel')]]));
    }

    // === CHIQIM ===
    if (data.startsWith('exptype_')) {
      const typeMap = { transport: 'Transport', worker: 'Ishchi haqi', rent: 'Ijara', repair: 'Ta\'mirlash', other: 'Boshqa' };
      const type = typeMap[data.substring(8)];
      setState(ctx, { step: 'expense_note', expenseType: type });
      return ctx.editMessageText(`📤 ${type}\n\n📝 Izoh:\n\nYoki "-" yozing:`, Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor qilish', 'cancel')]]));
    }

    // === SOTUV DETAIL / BEKOR QILISH ===
    if (data.startsWith('saledetail_')) {
      const sid = data.substring(11);
      return showSaleDetail(ctx, sid);
    }
    if (data.startsWith('salecancel_')) {
      const sid = data.substring(11);
      return cancelSaleConfirm(ctx, sid);
    }
    if (data.startsWith('salecancelyes_')) {
      const sid = data.substring(14);
      return cancelSaleExecute(ctx, sid);
    }

    // === SOZLAMALAR ===
    if (data === 'set_dollar') {
      setState(ctx, { step: 'set_dollar_value' });
      return ctx.editMessageText(`💵 Dollar kursi:\n\nJoriy: 1 USD = ${fmtNum(DB.settings.dollarRate)} so'm\n\nYangi kurs:\n\nMasalan: 12500`, Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor qilish', 'settings')]]));
    }
    if (data === 'set_minstock') {
      setState(ctx, { step: 'set_minstock_value' });
      return ctx.editMessageText(`⚠️ Minimal qoldiq:\n\nJoriy: ${fmtNum(DB.settings.minStock)} metr\n\nYangi qiymat:\n\nMasalan: 100`, Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor qilish', 'settings')]]));
    }
    if (data === 'set_service_price') {
      setState(ctx, { step: 'set_service_price_value' });
      return ctx.editMessageText(`🛠 Usluga narxi (1 metr uchun):\n\nJoriy: ${fmtNum(getServicePrice())} so'm/metr\n\nYangi narxni kiriting:`, Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor qilish', 'settings')]]));
    }
    if (data === 'set_orgname') {
      setState(ctx, { step: 'set_orgname_value' });
      return ctx.editMessageText(`🏭 Tashkilot nomi:\n\nJoriy: ${DB.settings.orgName}\n\nYangi nom:`, Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor qilish', 'settings')]]));
    }
    if (data === 'set_phone') {
      setState(ctx, { step: 'set_phone_value' });
      return ctx.editMessageText(`📞 Telefon:\n\nJoriy: ${DB.settings.phone || '-'}\n\nYangi telefon:`, Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor qilish', 'settings')]]));
    }
    if (data === 'set_address') {
      setState(ctx, { step: 'set_address_value' });
      return ctx.editMessageText(`📍 Manzil:\n\nJoriy: ${DB.settings.address || '-'}\n\nYangi manzil:`, Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor qilish', 'settings')]]));
    }
    if (data === 'set_receipt') {
      setState(ctx, { step: 'set_receipt_footer' });
      return ctx.editMessageText(`🧾 Chek matni (footer):\n\nJoriy: ${DB.settings.receiptFooter}\n\nYangi matn:`, Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor qilish', 'settings')]]));
    }

    // === ADMIN PANEL ===
    if (data === 'admin_addprod') return startStockIn(ctx);
    if (data === 'admin_audit') return showAuditLog(ctx);
    if (data === 'admin_backup') return createBackupNow(ctx);

    // === ISHCHILAR ===
    if (data === 'addworker') return addWorkerStart(ctx);
    if (data.startsWith('worker_') && !data.startsWith('workertoggle_') && !data.startsWith('workeredit_') && !data.startsWith('workerdelete_')) {
      const wid = data.substring(7);
      return showWorkerDetail(ctx, wid);
    }
    if (data.startsWith('workertoggle_')) {
      const wid = data.substring(13);
      const worker = DB.users.find(u => u.id === wid);
      if (!worker) return ctx.answerCbQuery('Topilmadi.');
      worker.active = !worker.active;
      auditLog(getUser(ctx).id, 'Ishchi holati o\'zgartirildi', wid, !worker.active, worker.active);
      save();
      return showWorkerDetail(ctx, wid);
    }
    if (data.startsWith('workeredit_')) {
      const wid = data.substring(11);
      setState(ctx, { step: 'edit_worker_name', editWorkerId: wid });
      const w = DB.users.find(u => u.id === wid);
      return ctx.editMessageText(`✏️ ${w?.name}\n\nYangi ism:`, Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor qilish', `worker_${wid}`)]]));
    }
    if (data.startsWith('workerdelete_')) {
      const wid = data.substring(13);
      const worker = DB.users.find(u => u.id === wid);
      if (!worker) return ctx.answerCbQuery('Topilmadi.');
      setState(ctx, { deleteWorkerId: wid });
      return ctx.editMessageText(
        `⚠️ Rostdan ham o'chirmoqchimisiz?\n\n👤 ${worker.name}\nTelegram ID: ${worker.telegramId}`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🗑 Ha, o\'chirish', `workerdeleteyes_${wid}`)],
          [Markup.button.callback('❌ Yo\'q', `worker_${wid}`)],
        ])
      );
    }
    if (data.startsWith('workerdeleteyes_')) {
      const wid = data.substring(16);
      const idx = DB.users.findIndex(u => u.id === wid);
      if (idx === -1) return ctx.answerCbQuery('Topilmadi.');
      const name = DB.users[idx].name;
      DB.users.splice(idx, 1);
      auditLog(getUser(ctx).id, 'Ishchi o\'chirildi', wid, name, '');
      save();
      clearState(ctx);
      return ctx.editMessageText(`✅ Ishchi o'chirildi.\n\n👤 ${name}`, inlineBack('set_workers'));
    }

    // === BACKUP RESTORE ===
    if (data.startsWith('backuprestore_') && !data.startsWith('backuprestoreyes_')) {
      const filename = data.substring(14);
      return confirmRestoreBackup(ctx, filename);
    }
    if (data.startsWith('backuprestoreyes_')) {
      const filename = data.substring(17);
      return restoreBackupNow(ctx, filename);
    }

    return ctx.answerCbQuery('Tanilmadi.');
  } catch (e) {
    console.error('Callback handler xatolik:', e.message);
    return ctx.answerCbQuery('Xatolik yuz berdi.');
  }
});

// ============================================================
// GLOBAL ERROR HANDLING
// ============================================================

bot.catch((err, ctx) => {
  console.error('Global xatolik:', err.message);
  try {
    ctx.reply('❌ Xatolik yuz berdi. Iltimos, qaytadan urinib ko\'ring.');
  } catch {}
  if (PRIVATE_GROUP_ID) {
    sendToGroup(`❌ TEXNIK XATO\n\n${err.message}\nSana: ${prettyDateTime(nowStr())}`);
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
});

// ============================================================
// BOTNI ISHGA TUSHIRISH
// ============================================================

async function startup() {
  console.log('🏭 TUNKA HISOB BOTI');
  console.log('✅ Bot ishga tushdi');
  console.log('🗄 JSON baza yuklandi');
  console.log(`🕐 Timezone: Asia/Samarkand`);
  console.log('👑 Admin tizimi tayyor');
  console.log('👥 Ishchilar tizimi tayyor');
  console.log('📦 Ombor tizimi tayyor');
  console.log('🛒 Sotuv tizimi tayyor');
  console.log('🔴 Nasiya tizimi tayyor');
  console.log('📊 Hisobot tizimi tayyor');
  console.log('🧾 PDF tizimi tayyor');
  console.log('💾 Backup tizimi tayyor');

  if (!repairOrphanInventoryProducts()) {
    console.error('❌ Ombor mahsulotlarini xavfsiz tiklash tugamadi; bot ishga tushirilmadi.');
    process.exit(1);
    return;
  }

  // Adminni ro'yxatdan o'tkazish
  let admin = DB.users.find(u => u.role === 'admin');
  if (!admin) {
    DB.users.push({
      id: 'USR-00001',
      role: 'admin',
      telegramId: ADMIN_ID,
      name: 'ADMIN',
      active: true,
    });
    DB.counters.user = 1;
    save();
  } else if (admin.telegramId !== ADMIN_ID) {
    admin.telegramId = ADMIN_ID;
    save();
  }

  // Kunlik avtomatik backup (har 24 soatda)
  let lastBackupDate = todayStr();
  setInterval(() => {
    const today = todayStr();
    if (today !== lastBackupDate) {
      const result = createBackup(DB);
      if (result) {
        const bId = nextId('BKP');
        DB.backups.push({ id: bId, filename: result.filename, date: result.date, size: result.size });
        save();
        if (PRIVATE_GROUP_ID) {
          bot.telegram.sendDocument(PRIVATE_GROUP_ID, {
            source: result.filepath,
            filename: result.filename,
          }).catch(() => {});
        }
      }
      lastBackupDate = today;
    }
  }, 3600000); // Har soatda tekshirish

  bot.launch().then(() => {
    console.log('\n🚀 Bot to\'liq ishlamoqda...');
  }).catch(e => {
    console.error('❌ Bot ishga tushmadi:', e.message);
    process.exit(1);
  });
}

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

startup();
