'use strict';

const UNIT_LABELS = Object.freeze({ metr: 'metr', dona: 'dona' });
const SALE_CATEGORY_LIST = Object.freeze([
  { id: 'TUNKA', label: '🏭 Tunka sotish', unit: 'metr', stock: true, defaultPrice: 65000 },
  { id: 'REKA', label: '📏 Reka sotish', unit: 'metr', stock: true, defaultPrice: 3500 },
  { id: 'LATOK', label: '🧱 Latok sotish', unit: 'metr', stock: true, defaultPrice: 24000 },
  { id: 'DUGA', label: '🔩 Duga sotish', unit: 'dona', stock: true, defaultPrice: 4000 },
  { id: 'USLUGA', label: '🛠 Usluga', unit: 'metr', service: true },
  { id: 'DELA', label: '🛠 Dela xizmati — dona', unit: 'dona', stock: true, defaultPrice: 20000 },
]);
const SALE_MENU_CHOICES = Object.freeze([
  ...SALE_CATEGORY_LIST,
  { id: 'MIXED', label: '🔀 Aralash sotish' },
]);

function parseQuantity(input, unit = 'metr') {
  const text = String(input ?? '').trim().toLowerCase();
  if (!text) throw new Error('Miqdor kiritilmagan.');

  if (unit === 'dona') {
    const match = text.match(/^(\d+)\s*(?:dona|ta)?$/i);
    if (!match) throw new Error('Dona miqdori butun musbat son bo\'lishi kerak.');
    const count = Number(match[1]);
    if (!Number.isSafeInteger(count) || count <= 0) throw new Error('Dona miqdori musbat butun son bo\'lishi kerak.');
    return count;
  }
  if (unit !== 'metr') throw new Error(`Noma'lum o'lchov birligi: ${unit}`);

  const token = /(\d+(?:[.,]\d+)?)\s*(millimeters|millimeter|millimetres|millimetre|metr|метр|metр|mm|sm|cm|м|m)?/gy;
  let offset = 0;
  let sawUnit = false;
  let millimeters = 0;
  while (offset < text.length) {
    while (/\s/.test(text[offset] || '')) offset++;
    if (offset >= text.length) break;
    token.lastIndex = offset;
    const match = token.exec(text);
    if (!match || match.index !== offset) throw new Error('Miqdor formatini tushunib bo\'lmadi. Masalan: 4.25 m yoki 1 m 25 sm.');
    offset = token.lastIndex;
    const amount = Number(match[1].replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Miqdor musbat son bo\'lishi kerak.');
    const suffix = (match[2] || '').toLowerCase();
    if (suffix) sawUnit = true;
    const factor = ['sm', 'cm'].includes(suffix) ? 10 : ['mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres'].includes(suffix) ? 1 : 1000;
    millimeters += amount * factor;
  }
  if (!sawUnit && !/^\d+(?:[.,]\d+)?$/.test(text)) throw new Error('Miqdor formati noto\'g\'ri.');
  if (!Number.isSafeInteger(Math.round(millimeters)) || millimeters <= 0 || Math.abs(millimeters - Math.round(millimeters)) > 1e-7) {
    throw new Error('Uzunlik 1 mm aniqlikda kiritilishi kerak.');
  }
  return Math.round(millimeters) / 1000;
}

function formatQuantity(quantity, unit = 'metr') {
  const value = Number(quantity);
  if (!Number.isFinite(value)) return '0';
  if (unit === 'dona') return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
  const mm = Math.round(value * 1000);
  const meters = Math.floor(mm / 1000);
  const centimeters = Math.floor((mm % 1000) / 10);
  const millimeters = mm % 10;
  const parts = [];
  if (meters) parts.push(`${meters} m`);
  if (centimeters) parts.push(`${centimeters} sm`);
  if (millimeters) parts.push(`${millimeters} mm`);
  return parts.join(' ') || '0 mm';
}

function getProductCategory(product) {
  const category = String(product?.category || '').toUpperCase();
  if (['TUNKA', 'REKA', 'LATOK', 'DUGA', 'DELA'].includes(category)) return category;
  const text = `${product?.name || ''} ${product?.type || ''}`.toLowerCase();
  if (text.includes('reka') || text.includes('рейка')) return 'REKA';
  if (text.includes('latok') || text.includes('лоток')) return 'LATOK';
  if (text.includes('duga') || text.includes('дуга')) return 'DUGA';
  if (text.includes('dela')) return 'DELA';
  return 'TUNKA';
}

function receiptSellerName(user) {
  return user?.role === 'admin' ? 'Ismoil' : (user?.name || '?');
}

function recoverOrphanInventoryProducts(data) {
  if (!data || !Array.isArray(data.products)) return [];
  data.stock = Array.isArray(data.stock) ? data.stock : [];
  data.stockMovements = Array.isArray(data.stockMovements) ? data.stockMovements : [];
  data.rolls = Array.isArray(data.rolls) ? data.rolls : [];
  data.auditLogs = Array.isArray(data.auditLogs) ? data.auditLogs : [];
  const known = new Set(data.products.map(product => product.id));
  const orphanIds = new Set([
    ...data.stock.map(row => row.productId),
    ...data.stockMovements.map(row => row.productId),
    ...data.rolls.map(row => row.productId),
  ].filter(id => id && !known.has(id)));
  const recovered = [];

  for (const id of orphanIds) {
    const movements = data.stockMovements.filter(row => row.productId === id);
    const rolls = data.rolls.filter(row => row.productId === id);
    const audit = data.auditLogs.find(row => row.object === id && /yangi mahsulot/i.test(row.action));
    const category = String(
      movements.find(row => row.category)?.category ||
      audit?.newValue?.match(/^(TUNKA|REKA|LATOK|DUGA|DELA)\s*[—-]/i)?.[1] ||
      'TUNKA'
    ).toUpperCase();
    const auditDetail = audit?.newValue?.replace(/^(TUNKA|REKA|LATOK|DUGA|DELA)\s*[—-]\s*/i, '').trim() || '';
    const nameMatch = auditDetail.match(/^(\S+)(?:\s+(.+))?$/);
    const inbound = movements.filter(row => row.type === 'in').sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    const latestRoll = rolls.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    const categoryConfig = SALE_CATEGORY_LIST.find(item => item.id === category);
    const product = {
      id,
      category,
      unit: inbound?.unit || (category === 'DUGA' || category === 'DELA' ? 'dona' : 'metr'),
      name: nameMatch?.[1] || `${category} mahsuloti`,
      type: nameMatch?.[2] || '',
      color: '',
      unitPrice: Number(inbound?.unitPrice || latestRoll?.unitPrice || categoryConfig?.defaultPrice || data.settings?.minStockPrice || 0),
      minStock: Number(data.settings?.minStock) || 0,
      status: 'active',
      createdAt: inbound?.date || latestRoll?.date || audit?.date || nowForRecovery(),
      note: 'Mavjud ombor tarixidan avtomatik tiklandi',
      recoveredFromHistory: true,
    };
    data.products.push(product);
    recovered.push(product);
  }
  return recovered;
}

function nowForRecovery() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function planStockReduction(stockRows, requirements) {
  const requiredRows = requirements instanceof Map ? [...requirements.entries()] : Object.entries(requirements || {});
  const rowsByProduct = new Map((stockRows || []).map(row => [row.productId, Number(row.quantity) || 0]));
  const plan = [];
  for (const [productId, requestedValue] of requiredRows) {
    const requested = Number(requestedValue);
    const before = rowsByProduct.get(productId) || 0;
    if (!Number.isFinite(requested) || requested <= 0) throw new Error(`Mahsulot ${productId} uchun miqdor noto'g'ri.`);
    if (before + 1e-9 < requested) {
      const error = new Error(`Mahsulot ${productId}: omborda ${before}, kerak ${requested}.`);
      error.productId = productId;
      error.available = before;
      error.required = requested;
      throw error;
    }
    const after = Math.round((before - requested) * 1000) / 1000;
    rowsByProduct.set(productId, after);
    plan.push({ productId, quantity: requested, before, after });
  }
  return plan;
}

function calculateStockBalance(movements, productId, endDate = null) {
  const total = (movements || []).filter(movement => movement.productId === productId
    && (!endDate || String(movement.date || '').slice(0, 10) <= endDate))
    .reduce((balance, movement) => {
      const quantity = Number(movement.quantity) || 0;
      if (movement.type === 'in' || movement.type === 'cancel') return balance + quantity;
      if (movement.type === 'out') return balance - quantity;
      return balance;
    }, 0);
  return Math.round(total * 1000) / 1000;
}

function getDebtAllocations(debts, payments, customerId) {
  const customerDebts = debts
    .filter(debt => debt.customerId === customerId && debt.status === 'active')
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));
  const remaining = new Map(customerDebts.map(debt => [debt.id, Math.max(0, Number(debt.amount) || 0)]));
  const validIds = new Set(remaining.keys());
  const customerPayments = payments
    .filter(payment => payment.customerId === customerId && payment.status !== 'cancelled'
      && (payment.method === 'debt_payment' || Array.isArray(payment.allocations)))
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));

  for (const payment of customerPayments) {
    let allocations = Array.isArray(payment.allocations) ? payment.allocations : null;
    if (!allocations) {
      // Backward compatibility: older aggregate debt payments are allocated FIFO.
      let left = Math.max(0, Number(payment.amount) || 0);
      allocations = [];
      for (const debt of customerDebts) {
        if (left <= 0) break;
        const available = remaining.get(debt.id) || 0;
        const applied = Math.min(left, available);
        if (applied > 0) allocations.push({ debtId: debt.id, amount: applied });
        left -= applied;
        remaining.set(debt.id, available - applied);
      }
    } else {
      for (const allocation of allocations) {
        if (!validIds.has(allocation.debtId)) continue;
        const applied = Math.min(remaining.get(allocation.debtId) || 0, Math.max(0, Number(allocation.amount) || 0));
        remaining.set(allocation.debtId, (remaining.get(allocation.debtId) || 0) - applied);
      }
    }
  }
  return customerDebts.map(debt => ({ ...debt, paid: Math.max(0, (Number(debt.amount) || 0) - (remaining.get(debt.id) || 0)), remaining: remaining.get(debt.id) || 0 }));
}

function allocateDebtPayment(debts, payments, customerId, amount) {
  let left = Number(amount);
  if (!Number.isFinite(left) || left <= 0) throw new Error('To\'lov summasi musbat bo\'lishi kerak.');
  const balances = getDebtAllocations(debts, payments, customerId);
  if (left > balances.reduce((sum, debt) => sum + debt.remaining, 0) + 1e-8) throw new Error('To\'lov qolgan qarzdan katta.');
  const allocations = [];
  for (const debt of balances) {
    if (left <= 0) break;
    const applied = Math.min(left, debt.remaining);
    if (applied > 0) allocations.push({ debtId: debt.id, amount: applied });
    left -= applied;
  }
  return allocations;
}

module.exports = {
  UNIT_LABELS,
  SALE_CATEGORY_LIST,
  SALE_MENU_CHOICES,
  parseQuantity,
  formatQuantity,
  getProductCategory,
  receiptSellerName,
  recoverOrphanInventoryProducts,
  planStockReduction,
  calculateStockBalance,
  getDebtAllocations,
  allocateDebtPayment,
};
