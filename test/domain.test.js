'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseQuantity,
  formatQuantity,
  getProductCategory,
  SALE_MENU_CHOICES,
  recoverOrphanInventoryProducts,
  receiptSellerName,
  getDebtAllocations,
  allocateDebtPayment,
  planStockReduction,
  calculateStockBalance,
} = require('../domain');

test('parses metric inputs to meters at millimeter precision', () => {
  assert.equal(parseQuantity('1000 m'), 1000);
  assert.equal(parseQuantity('125 sm'), 1.25);
  assert.equal(parseQuantity('500 mm'), 0.5);
  assert.equal(parseQuantity('1 m 25 sm 5 mm'), 1.255);
  assert.equal(parseQuantity('4.25 m'), 4.25);
  assert.equal(formatQuantity(1.255), '1 m 25 sm 5 mm');
});

test('rejects invalid metric and fractional-count values', () => {
  assert.throws(() => parseQuantity('0 m'));
  assert.throws(() => parseQuantity('-2 m'));
  assert.throws(() => parseQuantity('1.5 dona', 'dona'));
  assert.throws(() => parseQuantity('1.2 mm'));
});

test('parses Duga only as whole pieces', () => {
  assert.equal(parseQuantity('100 dona', 'dona'), 100);
  assert.equal(parseQuantity('10', 'dona'), 10);
  assert.equal(formatQuantity(3, 'dona'), '3');
});

test('infers legacy categories and respects stored categories', () => {
  assert.equal(getProductCategory({ name: 'Rangi', type: 'reka 1' }), 'REKA');
  assert.equal(getProductCategory({ name: 'X', category: 'DUGA' }), 'DUGA');
  assert.equal(getProductCategory({ name: 'Dela xizmati' }), 'DELA');
  assert.equal(getProductCategory({ name: 'tmz', type: '0.4' }), 'TUNKA');
});

test('defines sale choices including Dela service by piece at 20,000 so\'m', () => {
  assert.equal(SALE_MENU_CHOICES.length, 7);
  assert.deepEqual(SALE_MENU_CHOICES.map(choice => choice.id), ['TUNKA', 'REKA', 'LATOK', 'DUGA', 'USLUGA', 'DELA', 'MIXED']);
  assert.deepEqual(SALE_MENU_CHOICES.slice(0, 4).map(choice => [choice.unit, choice.defaultPrice]), [
    ['metr', 65000], ['metr', 3500], ['metr', 24000], ['dona', 4000],
  ]);
  assert.deepEqual(SALE_MENU_CHOICES.find(choice => choice.id === 'DELA'), {
    id: 'DELA', label: '🛠 Dela xizmati — dona', unit: 'dona', stock: true, defaultPrice: 20000,
  });
});

test('uses Ismoil as the receipt seller only for admin users', () => {
  assert.equal(receiptSellerName({ role: 'admin', name: 'ADMIN' }), 'Ismoil');
  assert.equal(receiptSellerName({ role: 'worker', name: 'Muhammad Ali' }), 'Muhammad Ali');
  assert.equal(receiptSellerName(undefined), '?');
});

test('recovers category products whose stock and rolls exist but product rows are missing', () => {
  const data = {
    settings: { minStock: 25 },
    products: [{ id: 'PROD-00001', category: 'TUNKA', name: 'Steel', type: '0.4', unit: 'metr', unitPrice: 65000 }],
    stock: [{ productId: 'PROD-00002', quantity: 4000 }],
    stockMovements: [{ id: 'M1', productId: 'PROD-00002', category: 'REKA', unit: 'metr', type: 'in', quantity: 4000, unitPrice: 3500, date: '2026-10-11 12:00:00' }],
    rolls: [{ id: 'R1', productId: 'PROD-00002', unitPrice: 3500, date: '2026-10-11 12:00:00' }],
    auditLogs: [{ id: 'A1', action: 'Yangi mahsulot', object: 'PROD-00002', newValue: 'REKA — Reka 1/2', date: '2026-10-11 12:00:00' }],
  };
  const originalQuantity = data.stock[0].quantity;
  const recovered = recoverOrphanInventoryProducts(data);
  assert.equal(recovered.length, 1);
  assert.deepEqual({ id: recovered[0].id, category: recovered[0].category, name: recovered[0].name, type: recovered[0].type, unit: recovered[0].unit, unitPrice: recovered[0].unitPrice }, {
    id: 'PROD-00002', category: 'REKA', name: 'Reka', type: '1/2', unit: 'metr', unitPrice: 3500,
  });
  assert.equal(data.stock[0].quantity, originalQuantity);
  assert.equal(recoverOrphanInventoryProducts(data).length, 0);
});

test('allocates debt payments only against debts and preserves sale payments', () => {
  const debts = [
    { id: 'D1', customerId: 'C1', amount: 100, date: '2026-01-01', status: 'active' },
    { id: 'D2', customerId: 'C1', amount: 200, date: '2026-01-02', status: 'active' },
  ];
  const payments = [
    { id: 'P-sale', customerId: 'C1', amount: 500, method: 'cash', date: '2026-01-01' },
    { id: 'P-debt', customerId: 'C1', amount: 30, method: 'debt_payment', date: '2026-01-03' },
  ];
  const allocation = allocateDebtPayment(debts, payments, 'C1', 50);
  assert.deepEqual(allocation, [{ debtId: 'D1', amount: 50 }]);
  const withNewPayment = [...payments, { id: 'P-new', customerId: 'C1', amount: 50, method: 'debt_payment', allocations: allocation, date: '2026-01-04' }];
  assert.deepEqual(getDebtAllocations(debts, withNewPayment, 'C1').map(d => d.remaining), [20, 200]);
  assert.throws(() => allocateDebtPayment(debts, payments, 'C1', 271));
});

test('applies explicit allocations to the exact debt record', () => {
  const debts = [
    { id: 'D1', customerId: 'C1', amount: 100, date: '2026-01-01', status: 'active' },
    { id: 'D2', customerId: 'C1', amount: 200, date: '2026-01-02', status: 'active' },
  ];
  const payments = [{ id: 'P1', customerId: 'C1', amount: 75, method: 'debt_payment', allocations: [{ debtId: 'D2', amount: 75 }] }];
  assert.deepEqual(getDebtAllocations(debts, payments, 'C1').map(d => d.remaining), [100, 125]);
});

test('preflights a multi-product sale without mutating stock and rejects the whole plan if short', () => {
  const stocks = [{ productId: 'T', quantity: 12 }, { productId: 'D', quantity: 4 }];
  const before = structuredClone(stocks);
  const plan = planStockReduction(stocks, new Map([['T', 5], ['D', 3]]));
  assert.deepEqual(plan.map(row => row.after), [7, 1]);
  assert.deepEqual(stocks, before);
  assert.throws(() => planStockReduction(stocks, new Map([['T', 5], ['D', 5]])), /omborda 4, kerak 5/);
  assert.deepEqual(stocks, before);
});

test('calculates dated stock from entries, sales, and returns', () => {
  const movements = [
    { productId: 'T', type: 'in', quantity: 1000, date: '2026-10-01 10:00:00' },
    { productId: 'T', type: 'out', quantity: 25.125, date: '2026-10-05 10:00:00' },
    { productId: 'T', type: 'cancel', quantity: 1, date: '2026-10-07 10:00:00' },
    { productId: 'T', type: 'out', quantity: 200, date: '2026-11-02 10:00:00' },
  ];
  assert.equal(calculateStockBalance(movements, 'T', '2026-10-31'), 975.875);
  assert.equal(calculateStockBalance(movements, 'T'), 775.875);
});
