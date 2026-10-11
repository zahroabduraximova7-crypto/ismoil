'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('generates a mixed-unit receipt into an isolated temp directory', async () => {
  const originalCwd = process.cwd();
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tunka-pdf-test-'));
  try {
    process.chdir(tempDirectory);
    const pdfPath = require.resolve('../pdf');
    delete require.cache[pdfPath];
    const { generateReceipt, generateDailyReport, generateMonthlyReport } = require('../pdf');
    const sale = {
      id: 'SALE-TEST-00001',
      date: '2026-10-11 12:34:56',
      items: [
        { category: 'TUNKA', productName: 'Premium', productType: '0.45', quantity: 1.255, unit: 'metr', unitPrice: 67000, baseUnitPrice: 65000, serviceFeeSom: 2000, total: 84092.5 },
        { category: 'DUGA', productName: 'Duga', quantity: 3, unit: 'dona', unitPrice: 4000, total: 12000 },
      ],
      total: 96092.5,
      paid: 50000,
      debt: 46092.5,
      paymentType: 'mixed',
      mixedPayments: { cash: 30000, card: 20000, debt: 46092.5 },
      exchangeRate: 12500,
      usdAmount: 7.6874,
    };
    const generated = await generateReceipt(sale, { id: 'C-1', name: 'Sinov', phone: '' }, null, 'Admin', { orgName: 'Sinov', dollarRate: 12500 });
    assert.equal(fs.existsSync(generated), true);
    assert.ok(fs.statSync(generated).size > 1000);

    const report = {
      totalMeters: 1.255,
      totalSales: 96092.5,
      totalSaleCount: 1,
      cash: 30000,
      card: 20000,
      debt: 46092.5,
      debtPayments: 0,
      otherIncome: 0,
      expenses: 0,
      cancelledCount: 0,
      cancelledTotal: 0,
      stockTotal: 109,
      categoryStats: {
        TUNKA: { unit: 'metr', stockIn: 10, sold: 1.255, returned: 0, closingStock: 8.745, currentStock: 8.745 },
        DUGA: { unit: 'dona', stockIn: 100, sold: 3, returned: 0, closingStock: 97, currentStock: 97 },
      },
      serviceCount: 0,
      serviceMeters: 0,
      serviceRevenue: 0,
      sales: [{ id: sale.id, customerName: 'Sinov', sellerName: 'Admin', total: sale.total, paymentType: 'Aralash', lines: sale.items }],
      exchangeRate: 12500,
      closingStock: 105.745,
      currentStock: 105.745,
      activeDebt: 46092.5,
      totalIn: 110,
      totalOut: 4.255,
    };
    const daily = await generateDailyReport(report, '2026-10-11', { orgName: 'Sinov', dollarRate: 12500 });
    const monthly = await generateMonthlyReport(report, '2026-10', { orgName: 'Sinov', dollarRate: 12500 });
    assert.ok(fs.statSync(daily).size > 1000);
    assert.ok(fs.statSync(monthly).size > 1000);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});
