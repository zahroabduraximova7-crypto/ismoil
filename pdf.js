// pdf.js — PDF chek va hisobot yaratish

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { fmtNum, fmtUsd, prettyDateTime, prettyDate } = require('./utils');

const RECEIPTS_DIR = path.join(process.cwd(), 'receipts');

function ensureDir() {
  if (!fs.existsSync(RECEIPTS_DIR)) fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
}

// Sotuv cheki PDF yaratish
function generateReceipt(sale, customer, product, userName, settings) {
  ensureDir();
  const filename = `receipt_${sale.id}.pdf`;
  const filepath = path.join(RECEIPTS_DIR, filename);
  const doc = new PDFDocument({ size: 'A4', margin: 50 });

  const stream = fs.createWriteStream(filepath);
  doc.pipe(stream);

  // Header
  doc.fontSize(22).font('Helvetica-Bold').text(settings.orgName || 'TUNKA HISOB', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(14).font('Helvetica').text('Sotuv cheki', { align: 'center' });
  doc.moveDown(1);

  // Chiziq
  drawLine(doc, 50);

  // Asosiy ma'lumotlar
  doc.fontSize(11).font('Helvetica');
  writeRow(doc, 'Sotuv ID:', sale.id);
  writeRow(doc, 'Mijoz:', customer.name);
  writeRow(doc, 'Mijoz ID:', customer.id);
  writeRow(doc, 'Tunka:', `${product.name} ${product.type}`);
  writeRow(doc, 'Miqdor:', `${fmtNum(sale.quantity)} metr`);
  writeRow(doc, '1 metr:', `${fmtNum(sale.unitPrice)} so'm`);
  writeRow(doc, 'Qayta ishlash:', sale.processingApplied ? `Ha (+${sale.processingPercent}%)` : 'Yo\'q');

  doc.moveDown(0.3);
  drawLine(doc, 50);

  writeRow(doc, 'Jami:', `${fmtNum(sale.total)} so'm`);
  writeRow(doc, 'USD:', fmtUsd(sale.usdAmount));
  writeRow(doc, 'Kurs:', `1 USD = ${fmtNum(sale.exchangeRate)} so'm`);

  doc.moveDown(0.3);
  drawLine(doc, 50);

  const payTypeMap = { cash: 'Naqd', card: 'Karta', debt: 'Nasiya', mixed: 'Aralash' };
  writeRow(doc, 'To\'lov:', payTypeMap[sale.paymentType] || sale.paymentType);
  writeRow(doc, 'To\'langan:', `${fmtNum(sale.paid)} so'm`);
  writeRow(doc, 'Qarz:', `${fmtNum(sale.debt)} so'm`);

  doc.moveDown(0.3);
  drawLine(doc, 50);

  writeRow(doc, 'Sotuvchi:', userName);
  writeRow(doc, 'Sana:', prettyDateTime(sale.date));

  doc.moveDown(1);
  drawLine(doc, 50);
  doc.fontSize(10).font('Helvetica-Oblique').text(settings.receiptFooter || 'Rahmat!', { align: 'center' });
  if (settings.phone) {
    doc.text(`Tel: ${settings.phone}`, { align: 'center' });
  }
  if (settings.address) {
    doc.text(`Manzil: ${settings.address}`, { align: 'center' });
  }

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(filepath));
    stream.on('error', reject);
  });
}

// Kunlik hisobot PDF
function generateDailyReport(report, dateStr, settings) {
  ensureDir();
  const filename = `daily_report_${dateStr}.pdf`;
  const filepath = path.join(RECEIPTS_DIR, filename);
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const stream = fs.createWriteStream(filepath);
  doc.pipe(stream);

  doc.fontSize(20).font('Helvetica-Bold').text(settings.orgName || 'TUNKA HISOB', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(14).font('Helvetica').text('Kunlik hisobot', { align: 'center' });
  doc.fontSize(12).text(prettyDate(dateStr), { align: 'center' });
  doc.moveDown(1);
  drawLine(doc, 50);

  doc.fontSize(11).font('Helvetica');
  writeRow(doc, 'Sotilgan tunka:', `${fmtNum(report.totalMeters)} metr`);
  writeRow(doc, 'Sotuvlar jami:', `${fmtNum(report.totalSales)} so'm`);
  writeRow(doc, 'Naqd:', `${fmtNum(report.cash)} so'm`);
  writeRow(doc, 'Karta:', `${fmtNum(report.card)} so'm`);
  writeRow(doc, 'Nasiya:', `${fmtNum(report.debt)} so'm`);
  writeRow(doc, 'Qarzdan tushgan:', `${fmtNum(report.debtPayments)} so'm`);
  writeRow(doc, 'Chiqim:', `${fmtNum(report.expenses)} so'm`);
  writeRow(doc, 'Ombor qoldig\'i:', `${fmtNum(report.stockTotal)} metr`);

  doc.moveDown(1);
  drawLine(doc, 50);

  if (report.sales && report.sales.length > 0) {
    doc.fontSize(12).font('Helvetica-Bold').text('Sotuvlar ro\'yxati:', { align: 'left' });
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(9);
    report.sales.forEach(s => {
      writeRow(doc, `${s.id}:`, `${s.customerName} - ${fmtNum(s.total)} so'm (${s.paymentType})`);
    });
  }

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(filepath));
    stream.on('error', reject);
  });
}

// Oylik hisobot PDF
function generateMonthlyReport(report, monthStr, settings) {
  ensureDir();
  ensureDir();
  const filename = `monthly_report_${monthStr}.pdf`;
  const filepath = path.join(RECEIPTS_DIR, filename);
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const stream = fs.createWriteStream(filepath);
  doc.pipe(stream);

  doc.fontSize(20).font('Helvetica-Bold').text(settings.orgName || 'TUNKA HISOB', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(14).font('Helvetica').text('Oylik hisobot', { align: 'center' });
  doc.moveDown(1);
  drawLine(doc, 50);

  doc.fontSize(11).font('Helvetica');
  writeRow(doc, 'Jami kirim:', `${fmtNum(report.totalIn)} metr`);
  writeRow(doc, 'Jami sotuv:', `${fmtNum(report.totalOut)} metr`);
  writeRow(doc, 'Qoldiq:', `${fmtNum(report.stockTotal)} metr`);
  writeRow(doc, 'Jami sotuv summasi:', `${fmtNum(report.totalSales)} so'm`);
  writeRow(doc, 'Naqd:', `${fmtNum(report.cash)} so'm`);
  writeRow(doc, 'Karta:', `${fmtNum(report.card)} so'm`);
  writeRow(doc, 'Nasiya:', `${fmtNum(report.debt)} so'm`);
  writeRow(doc, 'Qarzdan tushum:', `${fmtNum(report.debtPayments)} so'm`);
  writeRow(doc, 'Chiqim:', `${fmtNum(report.expenses)} so'm`);

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(filepath));
    stream.on('error', reject);
  });
}

// Yordamchi funksiyalar
function drawLine(doc, y) {
  doc.moveTo(50, y < 100 ? doc.y : y)
     .lineTo(550, y < 100 ? doc.y : y)
     .stroke();
  doc.moveDown(0.3);
}

function writeRow(doc, label, value) {
  doc.font('Helvetica-Bold').text(label, 50, doc.y, { width: 200, continued: false });
  doc.font('Helvetica').text(value, 200, doc.y - 14, { width: 300 });
  doc.moveDown(0.5);
}

module.exports = {
  generateReceipt,
  generateDailyReport,
  generateMonthlyReport,
  RECEIPTS_DIR,
};
