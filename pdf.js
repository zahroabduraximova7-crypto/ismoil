// // // pdf.js — PDF chek va hisobot yaratish

// // const PDFDocument = require('pdfkit');
// // const fs = require('fs');
// // const path = require('path');
// // const { fmtNum, fmtUsd, prettyDateTime, prettyDate } = require('./utils');

// // const RECEIPTS_DIR = path.join(process.cwd(), 'receipts');

// // function ensureDir() {
// //   if (!fs.existsSync(RECEIPTS_DIR)) fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
// // }

// // // Sotuv cheki PDF yaratish
// // function generateReceipt(sale, customer, product, userName, settings) {
// //   ensureDir();
// //   const filename = `receipt_${sale.id}.pdf`;
// //   const filepath = path.join(RECEIPTS_DIR, filename);
// //   const doc = new PDFDocument({ size: 'A4', margin: 50 });

// //   const stream = fs.createWriteStream(filepath);
// //   doc.pipe(stream);

// //   // Header
// //   doc.fontSize(22).font('Helvetica-Bold').text(settings.orgName || 'TUNKA HISOB', { align: 'center' });
// //   doc.moveDown(0.3);
// //   doc.fontSize(14).font('Helvetica').text('Sotuv cheki', { align: 'center' });
// //   doc.moveDown(1);

// //   // Chiziq
// //   drawLine(doc, 50);

// //   // Asosiy ma'lumotlar
// //   doc.fontSize(11).font('Helvetica');
// //   writeRow(doc, 'Sotuv ID:', sale.id);
// //   writeRow(doc, 'Mijoz:', customer.name);
// //   writeRow(doc, 'Mijoz ID:', customer.id);
// //   writeRow(doc, 'Tunka:', `${product.name} ${product.type}`);
// //   writeRow(doc, 'Miqdor:', `${fmtNum(sale.quantity)} metr`);
// //   writeRow(doc, '1 metr:', `${fmtNum(sale.unitPrice)} so'm`);
// //   writeRow(doc, 'Qayta ishlash:', sale.processingApplied ? `Ha (+${sale.processingPercent}%)` : 'Yo\'q');

// //   doc.moveDown(0.3);
// //   drawLine(doc, 50);

// //   writeRow(doc, 'Jami:', `${fmtNum(sale.total)} so'm`);
// //   writeRow(doc, 'USD:', fmtUsd(sale.usdAmount));
// //   writeRow(doc, 'Kurs:', `1 USD = ${fmtNum(sale.exchangeRate)} so'm`);

// //   doc.moveDown(0.3);
// //   drawLine(doc, 50);

// //   const payTypeMap = { cash: 'Naqd', card: 'Karta', debt: 'Nasiya', mixed: 'Aralash' };
// //   writeRow(doc, 'To\'lov:', payTypeMap[sale.paymentType] || sale.paymentType);
// //   writeRow(doc, 'To\'langan:', `${fmtNum(sale.paid)} so'm`);
// //   writeRow(doc, 'Qarz:', `${fmtNum(sale.debt)} so'm`);

// //   doc.moveDown(0.3);
// //   drawLine(doc, 50);

// //   writeRow(doc, 'Sotuvchi:', userName);
// //   writeRow(doc, 'Sana:', prettyDateTime(sale.date));

// //   doc.moveDown(1);
// //   drawLine(doc, 50);
// //   doc.fontSize(10).font('Helvetica-Oblique').text(settings.receiptFooter || 'Rahmat!', { align: 'center' });
// //   if (settings.phone) {
// //     doc.text(`Tel: ${settings.phone}`, { align: 'center' });
// //   }
// //   if (settings.address) {
// //     doc.text(`Manzil: ${settings.address}`, { align: 'center' });
// //   }

// //   doc.end();

// //   return new Promise((resolve, reject) => {
// //     stream.on('finish', () => resolve(filepath));
// //     stream.on('error', reject);
// //   });
// // }

// // // Kunlik hisobot PDF
// // function generateDailyReport(report, dateStr, settings) {
// //   ensureDir();
// //   const filename = `daily_report_${dateStr}.pdf`;
// //   const filepath = path.join(RECEIPTS_DIR, filename);
// //   const doc = new PDFDocument({ size: 'A4', margin: 50 });
// //   const stream = fs.createWriteStream(filepath);
// //   doc.pipe(stream);

// //   doc.fontSize(20).font('Helvetica-Bold').text(settings.orgName || 'TUNKA HISOB', { align: 'center' });
// //   doc.moveDown(0.3);
// //   doc.fontSize(14).font('Helvetica').text('Kunlik hisobot', { align: 'center' });
// //   doc.fontSize(12).text(prettyDate(dateStr), { align: 'center' });
// //   doc.moveDown(1);
// //   drawLine(doc, 50);

// //   doc.fontSize(11).font('Helvetica');
// //   writeRow(doc, 'Sotilgan tunka:', `${fmtNum(report.totalMeters)} metr`);
// //   writeRow(doc, 'Sotuvlar jami:', `${fmtNum(report.totalSales)} so'm`);
// //   writeRow(doc, 'Naqd:', `${fmtNum(report.cash)} so'm`);
// //   writeRow(doc, 'Karta:', `${fmtNum(report.card)} so'm`);
// //   writeRow(doc, 'Nasiya:', `${fmtNum(report.debt)} so'm`);
// //   writeRow(doc, 'Qarzdan tushgan:', `${fmtNum(report.debtPayments)} so'm`);
// //   writeRow(doc, 'Chiqim:', `${fmtNum(report.expenses)} so'm`);
// //   writeRow(doc, 'Ombor qoldig\'i:', `${fmtNum(report.stockTotal)} metr`);

// //   doc.moveDown(1);
// //   drawLine(doc, 50);

// //   if (report.sales && report.sales.length > 0) {
// //     doc.fontSize(12).font('Helvetica-Bold').text('Sotuvlar ro\'yxati:', { align: 'left' });
// //     doc.moveDown(0.3);
// //     doc.font('Helvetica').fontSize(9);
// //     report.sales.forEach(s => {
// //       writeRow(doc, `${s.id}:`, `${s.customerName} - ${fmtNum(s.total)} so'm (${s.paymentType})`);
// //     });
// //   }

// //   doc.end();
// //   return new Promise((resolve, reject) => {
// //     stream.on('finish', () => resolve(filepath));
// //     stream.on('error', reject);
// //   });
// // }

// // // Oylik hisobot PDF
// // function generateMonthlyReport(report, monthStr, settings) {
// //   ensureDir();
// //   ensureDir();
// //   const filename = `monthly_report_${monthStr}.pdf`;
// //   const filepath = path.join(RECEIPTS_DIR, filename);
// //   const doc = new PDFDocument({ size: 'A4', margin: 50 });
// //   const stream = fs.createWriteStream(filepath);
// //   doc.pipe(stream);

// //   doc.fontSize(20).font('Helvetica-Bold').text(settings.orgName || 'TUNKA HISOB', { align: 'center' });
// //   doc.moveDown(0.3);
// //   doc.fontSize(14).font('Helvetica').text('Oylik hisobot', { align: 'center' });
// //   doc.moveDown(1);
// //   drawLine(doc, 50);

// //   doc.fontSize(11).font('Helvetica');
// //   writeRow(doc, 'Jami kirim:', `${fmtNum(report.totalIn)} metr`);
// //   writeRow(doc, 'Jami sotuv:', `${fmtNum(report.totalOut)} metr`);
// //   writeRow(doc, 'Qoldiq:', `${fmtNum(report.stockTotal)} metr`);
// //   writeRow(doc, 'Jami sotuv summasi:', `${fmtNum(report.totalSales)} so'm`);
// //   writeRow(doc, 'Naqd:', `${fmtNum(report.cash)} so'm`);
// //   writeRow(doc, 'Karta:', `${fmtNum(report.card)} so'm`);
// //   writeRow(doc, 'Nasiya:', `${fmtNum(report.debt)} so'm`);
// //   writeRow(doc, 'Qarzdan tushum:', `${fmtNum(report.debtPayments)} so'm`);
// //   writeRow(doc, 'Chiqim:', `${fmtNum(report.expenses)} so'm`);

// //   doc.end();
// //   return new Promise((resolve, reject) => {
// //     stream.on('finish', () => resolve(filepath));
// //     stream.on('error', reject);
// //   });
// // }

// // // Yordamchi funksiyalar
// // function drawLine(doc, y) {
// //   doc.moveTo(50, y < 100 ? doc.y : y)
// //      .lineTo(550, y < 100 ? doc.y : y)
// //      .stroke();
// //   doc.moveDown(0.3);
// // }

// // function writeRow(doc, label, value) {
// //   doc.font('Helvetica-Bold').text(label, 50, doc.y, { width: 200, continued: false });
// //   doc.font('Helvetica').text(value, 200, doc.y - 14, { width: 300 });
// //   doc.moveDown(0.5);
// // }

// // module.exports = {
// //   generateReceipt,
// //   generateDailyReport,
// //   generateMonthlyReport,
// //   RECEIPTS_DIR,
// // };


// // pdf.js — PDF chek va hisobotlar
// // PDFKit + Cyrillic/Uzbek + ko'p mahsulotli sotuvlar

// const PDFDocument = require('pdfkit');
// const fs = require('fs');
// const path = require('path');

// const RECEIPTS_DIR = path.join(process.cwd(), 'receipts');

// function ensureDir() {
//   if (!fs.existsSync(RECEIPTS_DIR)) {
//     fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
//   }
// }

// function num(v) {
//   const n = Number(v);
//   return Number.isFinite(n) ? n : 0;
// }

// function fmtNum(v) {
//   return new Intl.NumberFormat('ru-RU', {
//     maximumFractionDigits: 3,
//   }).format(num(v));
// }

// function fmtSom(v) {
//   return `${fmtNum(v)} so'm`;
// }

// function fmtUsd(v) {
//   return `$${num(v).toFixed(2)}`;
// }

// // Metrni m/sm/mm ko'rinishiga o'tkazadi
// function formatLength(meters) {
//   const mmTotal = Math.round(num(meters) * 1000);

//   if (mmTotal <= 0) return '0 mm';

//   const m = Math.floor(mmTotal / 1000);
//   const cm = Math.floor((mmTotal % 1000) / 10);
//   const mm = mmTotal % 10;

//   const parts = [];

//   if (m) parts.push(`${m} m`);
//   if (cm) parts.push(`${cm} sm`);
//   if (mm) parts.push(`${mm} mm`);

//   return parts.join(' ') || '0 mm';
// }

// function prettyDateTime(value) {
//   if (!value) return '-';
//   return String(value);
// }

// function prettyDate(value) {
//   if (!value) return '-';

//   const s = String(value).slice(0, 10);
//   const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);

//   return m
//     ? `${m[3]}.${m[2]}.${m[1]}`
//     : s;
// }

// // Kategoriya
// function getCategory(product, item) {
//   if (item?.category) return item.category;
//   if (product?.category) return product.category;

//   const s = `${product?.name || ''} ${product?.type || ''}`.toLowerCase();

//   if (s.includes('reka') || s.includes('рейка')) {
//     return 'REKA';
//   }

//   if (s.includes('duga') || s.includes('дуга')) {
//     return 'DUGA';
//   }

//   if (s.includes('latok') || s.includes('лоток')) {
//     return 'LATOK';
//   }

//   return 'TUNKA';
// }

// // Sotuv mahsulotlari
// function getItems(sale, fallbackProduct) {
//   // Yangi ko'p mahsulotli sotuv
//   if (Array.isArray(sale?.items) && sale.items.length) {
//     return sale.items.map(item => {
//       let product = null;

//       if (item.productId) {
//         if (fallbackProduct?.id === item.productId) {
//           product = fallbackProduct;
//         }
//       }

//       return {
//         ...item,

//         productName:
//           item.productName ||
//           product?.name ||
//           '',

//         productType:
//           item.productType ||
//           product?.type ||
//           '',

//         category:
//           getCategory(product, item),

//         quantity:
//           num(item.quantity),

//         baseUnitPrice:
//           num(
//             item.baseUnitPrice ??
//             item.unitPrice
//           ),

//         processingFeeSom:
//           num(item.serviceFeeSom ?? item.processingFeeSom),

//         serviceFeeSom:
//           num(item.serviceFeeSom),

//         unit:
//           item.unit || 'metr',

//         unitPrice:
//           num(item.unitPrice),

//         total:
//           num(item.total),

//         processingApplied:
//           Boolean(item.processingApplied),
//       };
//     });
//   }

//   // Eski bitta mahsulotli sotuvlar
//   return [
//     {
//       productId:
//         fallbackProduct?.id ||
//         sale?.productId,

//       productName:
//         fallbackProduct?.name ||
//         '',

//       productType:
//         fallbackProduct?.type ||
//         '',

//       category:
//         getCategory(fallbackProduct, null),

//       quantity:
//         num(sale?.quantity),

//       baseUnitPrice:
//         num(
//           sale?.baseUnitPrice ??
//           sale?.unitPrice
//         ),

//       processingFeeSom:
//         num(sale?.processingFeeSom),

//       serviceFeeSom:
//         num(sale?.serviceFeeSom),

//       unit:
//         sale?.unit || 'metr',

//       unitPrice:
//         num(sale?.unitPrice),

//       total:
//         num(sale?.total),

//       processingApplied:
//         Boolean(sale?.processingApplied),
//     },
//   ];
// }

// // Font topish
// function findFont(preferred = []) {
//   const candidates = [
//     ...preferred,

//     process.env.TUNKA_FONT_PATH,

//     // Linux / Railway
//     '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
//     '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',

//     // Windows
//     'C:/Windows/Fonts/arial.ttf',
//     'C:/Windows/Fonts/arialbd.ttf',

//     'C:/Windows/Fonts/calibri.ttf',
//     'C:/Windows/Fonts/calibrib.ttf',
//   ].filter(Boolean);

//   return (
//     candidates.find(p => fs.existsSync(p)) ||
//     null
//   );
// }

// // PDF fontlar
// function registerFonts(doc) {
//   const regular = findFont([
//     process.env.TUNKA_FONT_REGULAR,

//     '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',

//     'C:/Windows/Fonts/arial.ttf',
//   ]);

//   const bold = findFont([
//     process.env.TUNKA_FONT_BOLD,

//     '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',

//     'C:/Windows/Fonts/arialbd.ttf',
//   ]);

//   if (!regular) {
//     throw new Error('PDF uchun Unicode shrift topilmadi. TUNKA_FONT_REGULAR sozlang yoki Arial/DejaVu Sans o\'rnating.');
//   }

//   if (regular) {
//     doc.registerFont(
//       'TunkaRegular',
//       regular
//     );
//   }

//   if (bold) {
//     doc.registerFont(
//       'TunkaBold',
//       bold
//     );
//   }

//   return {
//     regular:
//       regular
//         ? 'TunkaRegular'
//         : 'Helvetica',

//     bold:
//       bold
//         ? 'TunkaBold'
//         : 'TunkaRegular',
//   };
// }

// function money(v) {
//   return new Intl.NumberFormat('ru-RU', {
//     maximumFractionDigits: 0,
//   }).format(num(v));
// }

// // Chek raqami
// function saleNumber(sale) {
//   if (sale?.receiptNumber) {
//     return String(sale.receiptNumber);
//   }

//   const raw =
//     String(sale?.id || '')
//       .match(/(\d+)$/);

//   if (!raw) {
//     return String(sale?.id || '-');
//   }

//   return Number(raw[1])
//     .toLocaleString('ru-RU');
// }

// // Chiziq
// function drawLine(
//   doc,
//   x1 = 30,
//   x2 = 565,
//   y = doc.y,
//   width = 1
// ) {
//   doc.save();

//   doc.lineWidth(width);

//   doc
//     .moveTo(x1, y)
//     .lineTo(x2, y)
//     .stroke();

//   doc.restore();
// }

// // Jadval katagi
// function cellText(
//   doc,
//   text,
//   x,
//   y,
//   width,
//   height,
//   opts = {}
// ) {
//   doc
//     .font(
//       opts.font ||
//       'TunkaRegular'
//     )
//     .fontSize(
//       opts.size || 8
//     )
//     .text(
//       String(text ?? ''),
//       x + 4,
//       y + 4,
//       {
//         width:
//           Math.max(
//             1,
//             width - 8
//           ),

//         height:
//           Math.max(
//             1,
//             height - 8
//           ),

//         align:
//           opts.align ||
//           'left',

//         ellipsis: true,

//         lineBreak: false,
//       }
//     );
// }

// // ============================================================
// // MAHSULOTLAR JADVALI
// // ============================================================

// function drawTable(
//   doc,
//   items,
//   fonts,
//   settings,
//   sale
// ) {
//   const x = 30;

//   const widths = [
//     62,
//     145,
//     72,
//     40,
//     55,
//     80,
//     81,
//   ];

//   const headers = [
//     'Категория',
//     'Рулон / маҳсулот',
//     'Миқдор',
//     'Сони',
//     'Бирлик',
//     'Цена',
//     'Сумма',
//   ];

//   let y = doc.y;

//   const headerH = 30;

//   // Header
//   function header() {
//     doc.save();

//     doc.lineWidth(1);

//     let xx = x;

//     headers.forEach((h, i) => {
//       doc
//         .rect(
//           xx,
//           y,
//           widths[i],
//           headerH
//         )
//         .stroke();

//       cellText(
//         doc,
//         h,
//         xx,
//         y,
//         widths[i],
//         headerH,
//         {
//           font: fonts.bold,
//           size: 8,
//           align: 'center',
//         }
//       );

//       xx += widths[i];
//     });

//     doc.restore();

//     y += headerH;
//   }

//   // Row
//   function row(item) {
//     const productText =
//       [
//         item.productName,
//         item.productType,
//       ]
//         .filter(Boolean)
//         .join(' ');

//     let priceText =
//       money(item.baseUnitPrice ?? item.unitPrice);

//     if (
//       num(item.serviceFeeSom || item.processingFeeSom) > 0
//     ) {
//       priceText +=
//         `\n+${money(item.serviceFeeSom || item.processingFeeSom)}/${item.unit || 'metr'}`;
//     }

//     const values = [
//       item.category || 'TUNKA',

//       productText || '-',

//       item.unit === 'dona'
//         ? fmtNum(item.quantity)
//         : formatLength(item.quantity),

//       '1',

//       item.unit || 'metr',

//       priceText,

//       money(
//         item.total
//       ),
//     ];

//     const h = 40;

//     if (
//       y + h >
//       doc.page.height - 95
//     ) {
//       doc.addPage();

//       y = 40;

//       header();
//     }

//     let xx = x;

//     values.forEach(
//       (v, i) => {
//         doc
//           .rect(
//             xx,
//             y,
//             widths[i],
//             h
//           )
//           .stroke();

//         cellText(
//           doc,
//           v,
//           xx,
//           y,
//           widths[i],
//           h,
//           {
//             font:
//               i === 6
//                 ? fonts.bold
//                 : fonts.regular,

//             size: 7,

//             align:
//               i === 0 ||
//               i === 3
//                 ? 'center'
//                 : i >= 4
//                   ? 'right'
//                   : 'left',
//           }
//         );

//         xx += widths[i];
//       }
//     );

//     y += h;
//   }

//   header();

//   items.forEach(row);

//   const totalQty =
//     items.reduce(
//       (a, i) =>
//         a + (i.unit === 'metr' ? num(i.quantity) : 0),
//       0
//     );

//   const total =
//     items.reduce(
//       (a, i) =>
//         a + num(i.total),
//       0
//     );

//   const totalH = 28;

//   let xx = x;

//   const totalValues = [
//     'Общий',
//     '',
//     '',
//     String(items.length),
//     totalQty > 0 ? `${fmtNum(totalQty)} m` : '',
//     '',
//     money(total),
//   ];

//   totalValues.forEach(
//     (v, i) => {
//       doc
//         .rect(
//           xx,
//           y,
//           widths[i],
//           totalH
//         )
//         .stroke();

//       cellText(
//         doc,
//         v,
//         xx,
//         y,
//         widths[i],
//         totalH,
//         {
//           font: fonts.bold,
//           size: 8,

//           align:
//             i === 0 ||
//             i === 3
//               ? 'center'
//               : i >= 4
//                 ? 'right'
//                 : 'left',
//         }
//       );

//       xx += widths[i];
//     }
//   );

//   y += totalH;

//   doc.y = y + 10;

//   return {
//     totalQty,
//     total,
//   };
// }

// // ============================================================
// // PDF CHEK
// // ============================================================

// function generateReceipt(
//   sale,
//   customer,
//   product,
//   userName,
//   settings = {}
// ) {
//   ensureDir();

//   const filename =
//     `receipt_${sale.id}.pdf`;

//   const filepath =
//     path.join(
//       RECEIPTS_DIR,
//       filename
//     );

//   const doc =
//     new PDFDocument({
//       size: 'A4',
//       margin: 30,
//       bufferPages: true,
//     });

//   const stream =
//     fs.createWriteStream(
//       filepath
//     );

//   doc.pipe(stream);

//   const fonts =
//     registerFonts(doc);

//   doc.font(
//     fonts.regular
//   );

//   const items =
//     getItems(
//       sale,
//       product
//     );

//   // Dollar kursi
//   const exchangeRate =
//     num(
//       sale.exchangeRate
//     ) ||
//     num(
//       settings.dollarRate
//     ) ||
//     12500;

//   // Jami
//   const total =
//     num(sale.total) ||
//     items.reduce(
//       (a, i) =>
//         a + num(i.total),
//       0
//     );

//   // To'langan
//   const paid =
//     num(sale.paid);

//   // Qarz
//   const debt =
//     num(sale.debt);

//   // USD
//   const usdTotal =
//     total / exchangeRate;

//   const usdDebt =
//     debt / exchangeRate;

//   // ==========================================================
//   // HEADER
//   // ==========================================================

//   doc
//     .font(fonts.bold)
//     .fontSize(17)
//     .text(
//       `Буюртма номери: № ${saleNumber(sale)} - ${prettyDateTime(sale.date)}`,
//       {
//         align: 'center',
//       }
//     );

//   doc.moveDown(0.7);

//   // ==========================================================
//   // YUQORI MA'LUMOTLAR
//   // ==========================================================

//   const topY =
//     doc.y;

//   const leftX = 30;
//   const midX = 335;

//   const boxW = 285;
//   const rowH = 26;

//   // Chap tomon
//   doc
//     .rect(
//       leftX,
//       topY,
//       boxW,
//       rowH * 3
//     )
//     .stroke();

//   drawCellPair(
//     doc,
//     fonts,
//     leftX,
//     topY,
//     boxW,
//     rowH,
//     'Мижоз:',
//     customer?.name || '-'
//   );

//   drawCellPair(
//     doc,
//     fonts,
//     leftX,
//     topY + rowH,
//     boxW,
//     rowH,
//     'ID:',
//     customer?.id || '-'
//   );

//   drawCellPair(
//     doc,
//     fonts,
//     leftX,
//     topY + rowH * 2,
//     boxW,
//     rowH,
//     'Телефон:',
//     customer?.phone || '-'
//   );

//   // O'ng tomon
//   doc
//     .rect(
//       midX,
//       topY,
//       boxW,
//       rowH * 3
//     )
//     .stroke();

//   // Logo
//   const logoPath =
//     settings.logoPath ||
//     path.join(
//       process.cwd(),
//       'assets',
//       'logo.png'
//     );

//   if (
//     logoPath &&
//     fs.existsSync(logoPath)
//   ) {
//     try {
//       doc.image(
//         logoPath,
//         midX + boxW - 125,
//         topY + 5,
//         {
//           fit: [115, 50],
//           align: 'right',
//           valign: 'center',
//         }
//       );
//     } catch (e) {
//       console.error(
//         'Logo PDF xatosi:',
//         e.message
//       );
//     }
//   }

//   drawCellPair(
//     doc,
//     fonts,
//     midX,
//     topY,
//     boxW,
//     rowH,
//     'Сотувчи:',
//     userName || '-'
//   );

//   drawCellPair(
//     doc,
//     fonts,
//     midX,
//     topY + rowH,
//     boxW,
//     rowH,
//     'Ташкилот:',
//     settings.orgName || '-'
//   );

//   drawCellPair(
//     doc,
//     fonts,
//     midX,
//     topY + rowH * 2,
//     boxW,
//     rowH,
//     'Телефон:',
//     settings.phone || '-'
//   );

//   doc.y =
//     topY +
//     rowH * 3 +
//     15;

//   // ==========================================================
//   // MUDDATLAR
//   // ==========================================================

//   const deadlineY =
//     doc.y;

//   doc
//     .rect(
//       30,
//       deadlineY,
//       590,
//       52
//     )
//     .stroke();

//   drawCellPair(
//     doc,
//     fonts,
//     30,
//     deadlineY,
//     295,
//     26,
//     'Тайёр бўлиш муддати:',
//     sale.readyDate || ''
//   );

//   drawCellPair(
//     doc,
//     fonts,
//     325,
//     deadlineY,
//     295,
//     26,
//     'Тўлов муддати:',
//     sale.paymentDueDate || ''
//   );

//   doc
//     .rect(
//       30,
//       deadlineY + 26,
//       590,
//       26
//     )
//     .stroke();

//   doc.y =
//     deadlineY + 66;

//   // ==========================================================
//   // MAHSULOTLAR
//   // ==========================================================

//   drawTable(
//     doc,
//     items,
//     fonts,
//     settings,
//     sale
//   );

//   // ==========================================================
//   // HISOB
//   // ==========================================================

//   const sumY =
//     doc.y + 10;

//   const rightX = 320;
//   const rightW = 300;

//   // Jami
//   doc
//     .font(fonts.bold)
//     .fontSize(11)
//     .fillColor('red')
//     .text(
//       'Жами сумма:',
//       rightX,
//       sumY,
//       {
//         width: 180,
//         align: 'left',
//       }
//     );

//   doc
//     .font(fonts.bold)
//     .fontSize(12)
//     .text(
//       `${money(total)} сўм`,
//       rightX + 180,
//       sumY,
//       {
//         width: 120,
//         align: 'right',
//       }
//     );

//   drawLine(
//     doc,
//     rightX,
//     rightX + rightW,
//     sumY + 22,
//     0.6
//   );

//   // To'langan
//   doc
//     .fillColor('black')
//     .font(fonts.bold)
//     .fontSize(10)
//     .text(
//       'Тўланган сумма:',
//       rightX,
//       sumY + 27,
//       {
//         width: 180,
//       }
//     );

//   doc
//     .font(fonts.bold)
//     .text(
//       `${money(paid)} сўм`,
//       rightX + 180,
//       sumY + 27,
//       {
//         width: 120,
//         align: 'right',
//       }
//     );

//   drawLine(
//     doc,
//     rightX,
//     rightX + rightW,
//     sumY + 49,
//     0.6
//   );

//   // Qarz
//   doc
//     .text(
//       'Қолган $:',
//       rightX,
//       sumY + 54,
//       {
//         width: 180,
//       }
//     );

//   doc
//     .font(fonts.bold)
//     .fillColor('red')
//     .text(
//       `${money(debt)} сўм = ${usdDebt.toFixed(2)} $`,
//       rightX + 135,
//       sumY + 54,
//       {
//         width: 165,
//         align: 'right',
//       }
//     );

//   doc.fillColor('black');

//   if (sale.paymentType === 'mixed' && sale.mixedPayments) {
//     doc
//       .font(fonts.regular)
//       .fontSize(9)
//       .text(
//         `Нағд: ${money(sale.mixedPayments.cash)} сўм | Карта: ${money(sale.mixedPayments.card)} сўм | Насия: ${money(sale.mixedPayments.debt)} сўм`,
//         rightX,
//         sumY + 78,
//         { width: rightW, align: 'right' }
//       );
//   }

//   doc.y =
//     sumY + (sale.paymentType === 'mixed' ? 102 : 88);

//   // ==========================================================
//   // USD
//   // ==========================================================

//   doc
//     .font(fonts.regular)
//     .fontSize(9)
//     .text(
//       `Жами USD: ${usdTotal.toFixed(2)} $    |    1 USD = ${money(exchangeRate)} сўм`,
//       {
//         align: 'right',
//       }
//     );

//   doc.moveDown(1.1);

//   // ==========================================================
//   // FOOTER
//   // ==========================================================

//   drawLine(
//     doc,
//     30,
//     565,
//     doc.y,
//     0.7
//   );

//   doc.moveDown(0.5);

//   doc
//     .font(fonts.bold)
//     .fontSize(12)
//     .text(
//       settings.receiptFooter ||
//       'Харидингиз учун РАХМАТ.',
//       {
//         align: 'center',
//       }
//     );

//   if (settings.phone) {
//     doc
//       .font(fonts.bold)
//       .fontSize(10)
//       .text(
//         settings.phone,
//         {
//           align: 'center',
//         }
//       );
//   }

//   if (settings.address) {
//     doc
//       .font(fonts.regular)
//       .fontSize(9)
//       .text(
//         settings.address,
//         {
//           align: 'center',
//         }
//       );
//   }

//   doc
//     .font(fonts.regular)
//     .fontSize(8)
//     .text(
//       `Sotuvchi: ${userName || '-'}   |   ${prettyDateTime(sale.date)}`,
//       {
//         align: 'center',
//       }
//     );

//   doc.end();

//   return new Promise(
//     (resolve, reject) => {
//       stream.on(
//         'finish',
//         () => resolve(filepath)
//       );

//       stream.on(
//         'error',
//         reject
//       );
//     }
//   );
// }

// // ============================================================
// // YUQORI JADVAL UCHUN CELL
// // ============================================================

// function drawCellPair(
//   doc,
//   fonts,
//   x,
//   y,
//   width,
//   height,
//   label,
//   value
// ) {
//   const labelW =
//     Math.min(
//       125,
//       width * 0.42
//     );

//   doc
//     .rect(
//       x,
//       y,
//       width,
//       height
//     )
//     .stroke();

//   doc
//     .font(fonts.bold)
//     .fontSize(8)
//     .text(
//       label,
//       x + 5,
//       y + 7,
//       {
//         width:
//           labelW - 10,

//         height:
//           height - 8,

//         ellipsis: true,
//       }
//     );

//   doc
//     .font(fonts.regular)
//     .fontSize(8)
//     .text(
//       String(value || '-'),
//       x + labelW + 2,
//       y + 7,
//       {
//         width:
//           width - labelW - 7,

//         height:
//           height - 8,

//         ellipsis: true,
//       }
//     );
// }

// // ============================================================
// // KUNLIK HISOBOT
// // ============================================================

// function generateDailyReport(
//   report,
//   dateStr,
//   settings = {}
// ) {
//   ensureDir();

//   const filename =
//     `daily_report_${dateStr}.pdf`;

//   const filepath =
//     path.join(
//       RECEIPTS_DIR,
//       filename
//     );

//   const doc =
//     new PDFDocument({
//       size: 'A4',
//       margin: 40,
//     });

//   const stream =
//     fs.createWriteStream(
//       filepath
//     );

//   doc.pipe(stream);

//   const fonts =
//     registerFonts(doc);

//   doc
//     .font(fonts.bold)
//     .fontSize(20)
//     .text(
//       settings.orgName ||
//       'TUNKA HISOB',
//       {
//         align: 'center',
//       }
//     );

//   doc
//     .font(fonts.regular)
//     .fontSize(13)
//     .text(
//       'КУНЛИК ҲИСОБОТ',
//       {
//         align: 'center',
//       }
//     );

//   doc
//     .fontSize(10)
//     .text(
//       prettyDate(dateStr),
//       {
//         align: 'center',
//       }
//     );

//   doc.moveDown(1);

//   drawLine(
//     doc,
//     40,
//     555
//   );

//   const rows = [
//     [
//       'Сотилган узунлик:',
//       formatLength(
//         report.totalMeters
//       ),
//     ],

//     [
//       'Сотувлар жами:',
//       fmtSom(
//         report.totalSales
//       ),
//     ],

//     [
//       'Нағд:',
//       fmtSom(
//         report.cash
//       ),
//     ],

//     [
//       'Карта:',
//       fmtSom(
//         report.card
//       ),
//     ],

//     [
//       'Насия:',
//       fmtSom(
//         report.debt
//       ),
//     ],

//     [
//       'Қарздан тушган:',
//       fmtSom(
//         report.debtPayments
//       ),
//     ],

//     [
//       'Чиқим:',
//       fmtSom(
//         report.expenses
//       ),
//     ],

//     [
//       'Бошқа кирим:',
//       fmtSom(report.otherIncome),
//     ],

//     [
//       'Бекор қилинган сотув:',
//       `${report.cancelledCount || 0} та / ${fmtSom(report.cancelledTotal || 0)}`,
//     ],

//     [
//       'Услуга:',
//       `${report.serviceCount || 0} та / ${formatLength(report.serviceMeters || 0)} / ${fmtSom(report.serviceRevenue || 0)}`,
//     ],

//   ];

//   rows.forEach(
//     ([label, value]) => {
//       doc
//         .font(fonts.bold)
//         .fontSize(10)
//         .text(
//           label,
//           45,
//           doc.y,
//           {
//             width: 210,
//           }
//         );

//       doc
//         .font(fonts.regular)
//         .text(
//           value,
//           260,
//           doc.y - 12,
//           {
//             width: 290,
//             align: 'right',
//           }
//         );

//       doc.moveDown(0.65);
//     }
//   );

//   if (report.categoryStats) {
//     doc.moveDown(0.3);
//     doc.font(fonts.bold).fontSize(11).text('Категориялар бўйича омбор:');
//     Object.entries(report.categoryStats).forEach(([category, stat]) => {
//       const line = `${category}: кирим ${fmtNum(stat.stockIn)} ${stat.unit}; сотув ${fmtNum(stat.sold)} ${stat.unit}; қайтган ${fmtNum(stat.returned)} ${stat.unit}; давр охири ${fmtNum(stat.closingStock)} ${stat.unit}; ҳозир ${fmtNum(stat.currentStock)} ${stat.unit}`;
//       if (doc.y > 750) doc.addPage();
//       doc.font(fonts.regular).fontSize(8).text(line, { width: 510 });
//     });
//   }

//   doc.moveDown(0.5);

//   drawLine(
//     doc,
//     40,
//     555
//   );

//   if (
//     Array.isArray(
//       report.sales
//     ) &&
//     report.sales.length
//   ) {
//     doc.moveDown(0.5);

//     doc
//       .font(fonts.bold)
//       .fontSize(12)
//       .text(
//         'Сотувлар рўйхати'
//       );

//     doc.moveDown(0.4);

//     report.sales.forEach(
//       (s, i) => {
//         if (doc.y > 750) {
//           doc.addPage();
//         }

//         doc
//           .font(fonts.regular)
//           .fontSize(8)
//           .text(
//             `${i + 1}. ${s.id} | ${s.customerName || '-'} | ${s.sellerName || '-'} | ${fmtSom(s.total)} | ${s.paymentType || '-'}`
//           );

//         doc.moveDown(0.25);
//           (s.lines || []).forEach(item => {
//             doc.font(fonts.regular).fontSize(8).text(
//               `   ${item.category} ${item.productName || ''} ${item.productType || ''}: ${fmtNum(item.quantity)} ${item.unit} × ${money(item.unitPrice)} = ${money(item.total)} so'm`,
//               { width: 510 }
//             );
//           });
//           doc.moveDown(0.25);
//       }
//     );
//   }

//   doc.end();

//   return new Promise(
//     (resolve, reject) => {
//       stream.on(
//         'finish',
//         () => resolve(filepath)
//       );

//       stream.on(
//         'error',
//         reject
//       );
//     }
//   );
// }

// // ============================================================
// // OYLIK HISOBOT
// // ============================================================

// function generateMonthlyReport(
//   report,
//   monthStr,
//   settings = {}
// ) {
//   ensureDir();

//   const filename =
//     `monthly_report_${monthStr}.pdf`;

//   const filepath =
//     path.join(
//       RECEIPTS_DIR,
//       filename
//     );

//   const doc =
//     new PDFDocument({
//       size: 'A4',
//       margin: 40,
//     });

//   const stream =
//     fs.createWriteStream(
//       filepath
//     );

//   doc.pipe(stream);

//   const fonts =
//     registerFonts(doc);

//   doc
//     .font(fonts.bold)
//     .fontSize(20)
//     .text(
//       settings.orgName ||
//       'TUNKA HISOB',
//       {
//         align: 'center',
//       }
//     );

//   doc
//     .font(fonts.regular)
//     .fontSize(13)
//     .text(
//       'ОЙЛИК ҲИСОБОТ',
//       {
//         align: 'center',
//       }
//     );

//   doc
//     .fontSize(10)
//     .text(
//       `${monthStr} | davr yakuni (hisoblangan)`,
//       {
//         align: 'center',
//       }
//     );

//   doc.moveDown(1);

//   drawLine(
//     doc,
//     40,
//     555
//   );

//   const rows = [
//     [
//       'Жами сотув:',
//       fmtSom(
//         report.totalSales
//       ),
//     ],

//     [
//       'Нағд:',
//       fmtSom(
//         report.cash
//       ),
//     ],

//     [
//       'Карта:',
//       fmtSom(
//         report.card
//       ),
//     ],

//     [
//       'Насия:',
//       fmtSom(
//         report.debt
//       ),
//     ],

//     [
//       'Қарздан тушум:',
//       fmtSom(
//         report.debtPayments
//       ),
//     ],

//     [
//       'Чиқим:',
//       fmtSom(
//         report.expenses
//       ),
//     ],

//     [
//       'Бошқа кирим:',
//       fmtSom(report.otherIncome),
//     ],

//     [
//       'Бекор қилинган сотув:',
//       `${report.cancelledCount || 0} та / ${fmtSom(report.cancelledTotal || 0)}`,
//     ],

//     [
//       'Ҳозирги умумий қарз:',
//       fmtSom(report.activeDebt || 0),
//     ],

//     [
//       'Услуга:',
//       `${report.serviceCount || 0} та / ${formatLength(report.serviceMeters || 0)} / ${fmtSom(report.serviceRevenue || 0)}`,
//     ],
//   ];

//   rows.forEach(
//     ([label, value]) => {
//       doc
//         .font(fonts.bold)
//         .fontSize(10)
//         .text(
//           label,
//           45,
//           doc.y,
//           {
//             width: 210,
//           }
//         );

//       doc
//         .font(fonts.regular)
//         .text(
//           value,
//           260,
//           doc.y - 12,
//           {
//             width: 290,
//             align: 'right',
//           }
//         );

//       doc.moveDown(0.7);
//     }
//   );

//   if (report.categoryStats) {
//     doc.moveDown(0.4);
//     doc.font(fonts.bold).fontSize(11).text('Категориялар кесимида:');
//     Object.entries(report.categoryStats).forEach(([category, stat]) => {
//       if (doc.y > 750) doc.addPage();
//       doc.font(fonts.regular).fontSize(8).text(
//         `${category}: кирим ${fmtNum(stat.stockIn)} ${stat.unit}; сотув ${fmtNum(stat.sold)} ${stat.unit}; қайтган ${fmtNum(stat.returned)} ${stat.unit}; ой охири ${fmtNum(stat.closingStock)} ${stat.unit}; ҳозир ${fmtNum(stat.currentStock)} ${stat.unit}`,
//         { width: 510 }
//       );
//     });
//   }

//   doc.moveDown(0.5);

//   drawLine(
//     doc,
//     40,
//     555
//   );

//   doc.moveDown(0.5);

//   doc
//     .font(fonts.regular)
//     .fontSize(9)
//     .text(
//       `USD kursi: 1 USD = ${money(report.exchangeRate || settings.dollarRate || 12500)} so'm | Sotuvlar USD: ${(Number(report.totalSales || 0) / (Number(report.exchangeRate || settings.dollarRate) || 12500)).toFixed(2)} USD`,
//       {
//         align: 'right',
//       }
//     );

//   if (Array.isArray(report.sales) && report.sales.length) {
//     doc.moveDown(1);
//     doc.font(fonts.bold).fontSize(12).text('Сотувлар тафсилоти:');
//     report.sales.forEach((sale, index) => {
//       if (doc.y > 745) doc.addPage();
//       doc.moveDown(0.3);
//       doc.font(fonts.bold).fontSize(9).text(`${index + 1}. ${sale.id} | ${sale.customerName} | ${sale.sellerName} | ${fmtSom(sale.total)} | ${sale.paymentType}`);
//       (sale.lines || []).forEach(item => {
//         doc.font(fonts.regular).fontSize(8).text(`   ${item.category} ${item.productName || ''}: ${fmtNum(item.quantity)} ${item.unit} × ${money(item.unitPrice)} = ${money(item.total)} so'm`);
//       });
//     });
//   }

//   doc.end();

//   return new Promise(
//     (resolve, reject) => {
//       stream.on(
//         'finish',
//         () => resolve(filepath)
//       );

//       stream.on(
//         'error',
//         reject
//       );
//     }
//   );
// }

// // ============================================================
// // EXPORT
// // ============================================================

// module.exports = {
//   generateReceipt,
//   generateDailyReport,
//   generateMonthlyReport,
//   RECEIPTS_DIR,
// };



'use strict';

// ============================================================
// TUNKAFON XIZMATI — PDF GENERATOR
// Chek + Kunlik hisobot + Oylik hisobot
// ============================================================

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const RECEIPTS_DIR = path.join(process.cwd(), 'receipts');
const LOGO_PATH = path.join(__dirname, '344.jpg');

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 30;
const CONTENT_W = PAGE_W - MARGIN * 2;

const C = {
  black: '#171717',
  dark: '#30343B',
  gray: '#E9ECEF',
  light: '#F5F6F8',
  white: '#FFFFFF',
  border: '#B7BDC5',
  red: '#D71920',
  muted: '#555B65',
};

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function money(value) {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 0,
  }).format(num(value));
}

function fmtNum(value) {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 3,
  }).format(num(value));
}

function fmtSom(value) {
  return `${money(value)} so'm`;
}

function formatLength(value) {
  return `${fmtNum(value)} m`;
}

function prettyDate(value) {
  const s = String(value || '-').slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
}

function prettyDateTime(value) {
  return String(value || '-');
}

function ensureDir() {
  fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
}

function safeFileName(value) {
  return String(value ?? 'unknown')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 100);
}

function findFont(paths) {
  return paths.filter(Boolean).find(fs.existsSync);
}

function registerFonts(doc) {
  const regular = findFont([
    process.env.TUNKA_FONT_REGULAR,
    process.env.TUNKA_FONT_PATH,
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    'C:/Windows/Fonts/arial.ttf',
  ]);

  const bold = findFont([
    process.env.TUNKA_FONT_BOLD,
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    'C:/Windows/Fonts/arialbd.ttf',
  ]);

  if (!regular) {
    throw new Error(
      'Unicode shrift topilmadi. TUNKA_FONT_REGULAR ni sozlang.'
    );
  }

  doc.registerFont('Regular', regular);
  doc.registerFont('Bold', bold || regular);

  return {
    regular: 'Regular',
    bold: 'Bold',
  };
}

function createDocument(filepath) {
  ensureDir();

  const doc = new PDFDocument({
    size: 'A4',
    margins: {
      top: MARGIN,
      bottom: MARGIN,
      left: MARGIN,
      right: MARGIN,
    },
    bufferPages: true,
  });

  const stream = fs.createWriteStream(filepath);

  const completion = new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(filepath));
    stream.on('error', reject);
    doc.on('error', reject);
  });

  const fonts = registerFonts(doc);
  doc.pipe(stream);

  return { doc, fonts, completion };
}

function drawLine(doc, x1, y, x2, color = C.border) {
  doc.save()
    .strokeColor(color)
    .lineWidth(0.8)
    .moveTo(x1, y)
    .lineTo(x2, y)
    .stroke()
    .restore();
}

// Matnni katak ichiga moslash.
// Hech qachon sahifa chetidan chiqarilmaydi.
function cellText(doc, text, x, y, w, h, options = {}) {
  const {
    font = 'Regular',
    size = 9,
    minSize = 6,
    color = C.black,
    align = 'left',
    padding = 4,
  } = options;

  const content = String(text ?? '-');
  const innerW = Math.max(4, w - padding * 2);
  const innerH = Math.max(4, h - padding * 2);

  let fontSize = size;

  doc.font(font);

  while (fontSize > minSize) {
    doc.fontSize(fontSize);

    const textHeight = doc.heightOfString(content, {
      width: innerW,
      lineGap: 0,
    });

    if (textHeight <= innerH) break;
    fontSize -= 0.25;
  }

  doc.font(font)
    .fontSize(fontSize)
    .fillColor(color)
    .text(content, x + padding, y + padding, {
      width: innerW,
      height: innerH,
      align,
      lineGap: 0,
      ellipsis: true,
    });

  doc.fillColor(C.black);
}

function fillRect(doc, x, y, w, h, color) {
  doc.save()
    .fillColor(color)
    .rect(x, y, w, h)
    .fill()
    .restore();
}

function strokeRect(doc, x, y, w, h) {
  doc.save()
    .strokeColor(C.border)
    .lineWidth(0.7)
    .rect(x, y, w, h)
    .stroke()
    .restore();
}

// ============================================================
// MAHSULOTLAR
// ============================================================

function getCategory(product, item) {
  if (item?.category) return item.category;
  if (product?.category) return product.category;

  const name = [
    product?.name,
    product?.type,
    item?.productName,
    item?.productType,
  ].filter(Boolean).join(' ').toLowerCase();

  if (name.includes('reka')) return 'REKA';
  if (name.includes('latok')) return 'LATOK';
  if (name.includes('duga')) return 'DUGA';
  if (name.includes('usluga')) return 'USLUGA';

  return 'TUNKA';
}

function getItems(sale, product) {
  if (Array.isArray(sale?.items) && sale.items.length) {
    return sale.items.map(item => ({
      ...item,
      productName: item.productName || '',
      productType: item.productType || '',
      category: getCategory(null, item),
      quantity: num(item.quantity),
      unit: item.unit || 'metr',
      unitPrice: num(item.unitPrice),
      baseUnitPrice: num(
        item.baseUnitPrice ?? item.unitPrice
      ),
      serviceFeeSom: num(item.serviceFeeSom),
      total: num(item.total),
    }));
  }

  return [{
    productId: sale?.productId,
    productName: product?.name || '',
    productType: product?.type || '',
    category: getCategory(product),
    quantity: num(sale?.quantity),
    unit: sale?.unit || 'metr',
    unitPrice: num(sale?.unitPrice),
    baseUnitPrice: num(
      sale?.baseUnitPrice ?? sale?.unitPrice
    ),
    serviceFeeSom: num(sale?.serviceFeeSom),
    total: num(sale?.total),
  }];
}

function saleNumber(sale) {
  if (sale?.receiptNumber != null) {
    return String(sale.receiptNumber);
  }

  const match = String(sale?.id || '').match(/(\d+)$/);

  return match
    ? String(Number(match[1]))
    : String(sale?.id || '-');
}

// ============================================================
// MIJOZ / SOTUVCHI KATAKLARI
// ============================================================

function drawPair(doc, fonts, x, y, w, h, label, value) {
  const labelW = w * 0.39;

  fillRect(doc, x, y, labelW, h, C.gray);
  fillRect(doc, x + labelW, y, w - labelW, h, C.white);

  strokeRect(doc, x, y, w, h);

  drawLine(
    doc,
    x + labelW,
    y,
    x + labelW,
    C.border
  );

  doc.save()
    .strokeColor(C.border)
    .lineWidth(0.7)
    .moveTo(x + labelW, y)
    .lineTo(x + labelW, y + h)
    .stroke()
    .restore();

  cellText(doc, label, x, y, labelW, h, {
    font: fonts.bold,
    size: 9.5,
    minSize: 7,
  });

  cellText(doc, value, x + labelW, y, w - labelW, h, {
    font: fonts.bold,
    size: 9.5,
    minSize: 7,
  });
}

// ============================================================
// JADVAL
// ============================================================

function drawTable(doc, items, fonts, layout = {}) {
  const x = MARGIN;
  const widths = [64, 133, 78, 35, 54, 81, 90];

  const headers = [
    'Категория',
    'Рулон / маҳсулот',
    'Миқдор',
    'Сони',
    'Бирлик',
    'Цена',
    'Сумма',
  ];

  const rowH = layout.rowH || 35;
  const headH = layout.headH || 31;
  const totalH = layout.totalH || 33;

  let y = doc.y;

  function row(values, height, type = 'normal') {
    let xx = x;

    values.forEach((value, i) => {
      const bg = type === 'header'
        ? C.gray
        : type === 'total'
          ? C.gray
          : i === 0
            ? C.light
            : C.white;

      fillRect(doc, xx, y, widths[i], height, bg);
      strokeRect(doc, xx, y, widths[i], height);

      cellText(doc, value, xx, y, widths[i], height, {
        font: fonts.bold,
        size: type === 'header' ? 9 : 9.5,
        minSize: 6.5,
        align:
          i === 0 || i === 3
            ? 'center'
            : i >= 5
              ? 'right'
              : 'left',
        color: C.black,
      });

      xx += widths[i];
    });

    y += height;
  }

  function header() {
    row(headers, headH, 'header');
  }

  header();

  for (const item of items) {
    if (y + rowH + totalH > PAGE_H - 45) {
      doc.addPage();
      y = 45;
      header();
    }

    const name = [
      item.productName,
      item.productType,
    ].filter(Boolean).join(' ') || '-';

    const qty = item.unit === 'dona'
      ? `${fmtNum(item.quantity)} dona`
      : `${fmtNum(item.quantity)} m`;

    const price = num(item.serviceFeeSom) > 0
      ? `${money(item.baseUnitPrice)} + ${money(item.serviceFeeSom)}`
      : money(item.unitPrice);

    row([
      item.category,
      name,
      qty,
      '1',
      item.unit,
      price,
      money(item.total),
    ], rowH);
  }

  if (y + totalH > PAGE_H - 45) {
    doc.addPage();
    y = 45;
    header();
  }

  const meters = items.reduce(
    (s, item) => s + (
      item.unit === 'metr' ? num(item.quantity) : 0
    ), 0
  );

  const pieces = items.reduce(
    (s, item) => s + (
      item.unit === 'dona' ? num(item.quantity) : 0
    ), 0
  );

  const total = items.reduce(
    (s, item) => s + num(item.total), 0
  );

  const quantities = [
    meters ? `${fmtNum(meters)} m` : '',
    pieces ? `${fmtNum(pieces)} dona` : '',
  ].filter(Boolean).join(', ');

  row([
    'Общий',
    '',
    '',
    String(items.length),
    quantities,
    '',
    money(total),
  ], totalH, 'total');

  doc.y = y + 10;
}

// ============================================================
// LOGOTIP
// ============================================================

function drawReceiptLogo(doc, x, y, width = 190, height = 105) {
  if (!fs.existsSync(LOGO_PATH)) {
    console.warn('Logotip topilmadi:', LOGO_PATH);
    return;
  }

  try {
    doc.image(LOGO_PATH, x, y, {
      fit: [width, height],
      align: 'center',
      valign: 'center',
    });
  } catch (err) {
    console.error('Logotip xatosi:', err.message);
  }
}

// ============================================================
// JAMI SUMMALAR
// ============================================================

function drawSummaryRow(doc, fonts, y, label, value, red = false) {
  const x = 267;
  const w = PAGE_W - MARGIN - x;
  const h = 42;
  const labelW = 135;

  fillRect(doc, x, y, w, h, C.light);

  fillRect(doc, x, y, 4, h, red ? C.red : C.dark);

  cellText(doc, label, x + 8, y, labelW - 8, h, {
    font: fonts.bold,
    size: 14,
    minSize: 9,
    color: red ? C.red : C.dark,
    padding: 3,
  });

  cellText(
    doc,
    value,
    x + labelW,
    y,
    w - labelW,
    h,
    {
      font: fonts.bold,
      size: 15,
      minSize: 8,
      color: red ? C.red : C.black,
      align: 'right',
      padding: 3,
    }
  );

  drawLine(doc, x, y + h, x + w);
}

// ============================================================
// CHEK
// ============================================================

function generateReceipt(
  sale,
  customer,
  product,
  userName,
  settings = {}
) {
  const filepath = path.join(
    RECEIPTS_DIR,
    `receipt_${safeFileName(sale.id)}.pdf`
  );

  const { doc, fonts, completion } = createDocument(filepath);
  const items = getItems(sale, product);

  const total = num(sale.total);
  const paid = num(sale.paid);
  const debt = num(sale.debt);

  const exchangeRate =
    num(sale.exchangeRate) ||
    num(settings.dollarRate) ||
    12500;

  // SARLAVHA

  fillRect(doc, MARGIN, 25, CONTENT_W, 39, C.light);

  doc.font(fonts.bold)
    .fontSize(12)
    .fillColor(C.dark)
    .text(
      `Буюртма номери: № ${saleNumber(sale)} - ${prettyDateTime(sale.date)}`,
      MARGIN + 5,
      37,
      {
        width: CONTENT_W - 10,
        align: 'center',
      }
    );

  let y = 77;

  const gap = 10;
  const boxW = (CONTENT_W - gap) / 2;
  const rightX = MARGIN + boxW + gap;
  const rowH = 25;

  // MIJOZ

  drawPair(
    doc, fonts, MARGIN, y, boxW, rowH,
    'Мижоз:', customer?.name || '-'
  );

  drawPair(
    doc, fonts, MARGIN, y + rowH, boxW, rowH,
    'ID:', customer?.id || '-'
  );

  drawPair(
    doc, fonts, MARGIN, y + rowH * 2, boxW, rowH,
    'Телефон:', customer?.phone || '-'
  );

  // SOTUVCHI

  drawPair(
    doc, fonts, rightX, y, boxW, rowH,
    'Сотувчи:', userName || '-'
  );

  drawPair(
    doc, fonts, rightX, y + rowH, boxW, rowH,
    'Ташкилот:', settings.orgName || 'TUNKA HISOB'
  );

  drawPair(
    doc, fonts, rightX, y + rowH * 2, boxW, rowH,
    'Телефон:', settings.phone || '-'
  );

  y += rowH * 3 + 10;

  // MUDDATLAR

  drawPair(
    doc, fonts, MARGIN, y, boxW, 28,
    'Тайёр бўлиш муддати:',
    sale.readyDate || '-'
  );

  drawPair(
    doc, fonts, rightX, y, boxW, 28,
    'Тўлов муддати:',
    sale.paymentDueDate || '-'
  );

  y += 39;
  doc.y = y;

  // MAHSULOTLAR

  // Bitta sahifaga sig'ishi uchun qatorlar
  // soniga qarab balandlik tanlanadi.
  const remainingForTable = PAGE_H - y - 265;
  const preferredRow = 35;

  const rowHAdaptive = Math.max(
    25,
    Math.min(
      preferredRow,
      Math.floor(
        (remainingForTable - 64) / Math.max(items.length, 1)
      )
    )
  );

  drawTable(doc, items, fonts, {
    rowH: rowHAdaptive,
    headH: 31,
    totalH: 33,
  });

  // PASTKI QISM
  // Bitta sahifaga joylashishi uchun jami blok
  // jadvaldan keyin ixcham joylashtiriladi.

  const summaryHeight = 235;

  if (doc.y + summaryHeight > PAGE_H - MARGIN) {
    doc.addPage();
    doc.y = 40;
  }

  const summaryY = doc.y + 6;

  // LOGO — CHAP TOMON

  drawReceiptLogo(
    doc,
    MARGIN + 8,
    summaryY + 12,
    190,
    105
  );

  // SUMMALAR — O'NG TOMON

  drawSummaryRow(
    doc, fonts, summaryY,
    'Жами сумма:',
    `${money(total)} сўм`,
    true
  );

  drawSummaryRow(
    doc, fonts, summaryY + 47,
    'Тўланган сумма:',
    `${money(paid)} сўм`
  );

  drawSummaryRow(
    doc, fonts, summaryY + 94,
    'Қолган қарз:',
    `${money(debt)} сўм`,
    debt > 0
  );

  y = summaryY + 147;

  // ARALASH TO'LOV

  if (
    sale.paymentType === 'mixed' &&
    sale.mixedPayments
  ) {
    const mp = sale.mixedPayments;

    doc.font(fonts.bold)
      .fontSize(9)
      .fillColor(C.dark)
      .text(
        `Нағд: ${money(mp.cash)} | ` +
        `Карта: ${money(mp.card)} | ` +
        `Насия: ${money(mp.debt)} сўм`,
        MARGIN,
        y,
        {
          width: CONTENT_W,
          align: 'right',
        }
      );

    y = doc.y + 9;
  }

  // DOLLAR HISOBI

  doc.font(fonts.bold)
    .fontSize(10)
    .fillColor(C.dark)
    .text(
      `Жами USD: ${(total / exchangeRate).toFixed(2)} $ | ` +
      `1 USD = ${money(exchangeRate)} сўм`,
      MARGIN,
      y,
      {
        width: CONTENT_W,
        align: 'right',
      }
    );

  y = doc.y + 17;

  if (y + 52 > PAGE_H - MARGIN) {
    doc.addPage();
    y = 40;
  }

  drawLine(doc, MARGIN, y, PAGE_W - MARGIN, C.dark);

  doc.font(fonts.bold)
    .fontSize(12)
    .fillColor(C.dark)
    .text(
      settings.receiptFooter || 'Харидингиз учун РАҲМАТ!',
      MARGIN,
      y + 9,
      {
        width: CONTENT_W,
        align: 'center',
      }
    );

  doc.font(fonts.bold)
    .fontSize(8.5)
    .fillColor(C.muted)
    .text(
      `Sotuvchi: ${userName || '-'} | ${prettyDateTime(sale.date)}`,
      MARGIN,
      doc.y + 4,
      {
        width: CONTENT_W,
        align: 'center',
      }
    );

  doc.end();
  return completion;
}

// ============================================================
// HISOBOTLAR
// ============================================================

function reportHeader(doc, fonts, title, subtitle, settings) {
  fillRect(doc, MARGIN, 28, CONTENT_W, 67, C.light);

  doc.font(fonts.bold)
    .fontSize(17)
    .fillColor(C.dark)
    .text(
      settings.orgName || 'TUNKA HISOB',
      MARGIN,
      35,
      { width: CONTENT_W, align: 'center' }
    );

  doc.font(fonts.bold)
    .fontSize(12)
    .text(
      title,
      MARGIN,
      59,
      { width: CONTENT_W, align: 'center' }
    );

  doc.font(fonts.regular)
    .fontSize(9)
    .text(
      subtitle,
      MARGIN,
      78,
      { width: CONTENT_W, align: 'center' }
    );

  doc.y = 110;
}

function reportRow(doc, fonts, label, value) {
  const leftW = 215;
  const rightW = CONTENT_W - leftW;

  doc.font(fonts.bold).fontSize(9);
  const h1 = doc.heightOfString(String(label), {
    width: leftW - 12,
  });

  doc.font(fonts.regular).fontSize(9);
  const h2 = doc.heightOfString(String(value), {
    width: rightW - 12,
  });

  const h = Math.max(29, h1 + 12, h2 + 12);

  if (doc.y + h > PAGE_H - 40) {
    doc.addPage();
    doc.y = 40;
  }

  const y = doc.y;

  fillRect(doc, MARGIN, y, leftW, h, C.gray);
  fillRect(doc, MARGIN + leftW, y, rightW, h, C.white);

  strokeRect(doc, MARGIN, y, CONTENT_W, h);

  doc.save()
    .strokeColor(C.border)
    .lineWidth(0.7)
    .moveTo(MARGIN + leftW, y)
    .lineTo(MARGIN + leftW, y + h)
    .stroke()
    .restore();

  cellText(doc, label, MARGIN, y, leftW, h, {
    font: fonts.bold,
    size: 9,
  });

  cellText(
    doc, value,
    MARGIN + leftW, y, rightW, h,
    {
      font: fonts.regular,
      size: 9,
      align: 'right',
    }
  );

  doc.y = y + h;
}

function reportCategories(doc, fonts, stats) {
  if (!stats) return;

  doc.moveDown(1);

  if (doc.y > PAGE_H - 100) {
    doc.addPage();
  }

  doc.font(fonts.bold)
    .fontSize(12)
    .fillColor(C.dark)
    .text('МАҲСУЛОТЛАР БЎЙИЧА ҲИСОБОТ');

  doc.moveDown(0.5);

  for (const [category, stat] of Object.entries(stats)) {
    const unit = stat.unit || 'metr';

    reportRow(
      doc,
      fonts,
      category,
      `Kirim: ${fmtNum(stat.stockIn)} ${unit}\n` +
      `Sotuv: ${fmtNum(stat.sold)} ${unit}\n` +
      `Qaytgan: ${fmtNum(stat.returned)} ${unit}\n` +
      `Qoldiq: ${fmtNum(stat.closingStock)} ${unit}`
    );
  }
}

function reportSales(doc, fonts, sales) {
  if (!Array.isArray(sales) || !sales.length) return;

  doc.moveDown(1);

  if (doc.y > PAGE_H - 100) {
    doc.addPage();
  }

  doc.font(fonts.bold)
    .fontSize(12)
    .fillColor(C.dark)
    .text('СОТУВЛАР ТАФСИЛОТИ');

  doc.moveDown(0.5);

  sales.forEach((sale, index) => {
    if (doc.y > PAGE_H - 110) {
      doc.addPage();
    }

    doc.font(fonts.bold)
      .fontSize(9.5)
      .text(
        `${index + 1}. ${sale.id} | ` +
        `${sale.customerName || '-'} | ${fmtSom(sale.total)}`,
        { width: CONTENT_W }
      );

    doc.font(fonts.regular)
      .fontSize(9)
      .text(
        `Sotuvchi: ${sale.sellerName || '-'} | ` +
        `To'lov: ${sale.paymentType || '-'}`,
        { width: CONTENT_W }
      );

    for (const item of sale.lines || []) {
      if (doc.y > PAGE_H - 60) {
        doc.addPage();
      }

      doc.font(fonts.regular)
        .fontSize(9)
        .text(
          `${item.category || ''} ` +
          `${item.productName || ''} ` +
          `${item.productType || ''}: ` +
          `${fmtNum(item.quantity)} ${item.unit || ''} × ` +
          `${money(item.unitPrice)} = ${fmtSom(item.total)}`,
          {
            width: CONTENT_W,
            indent: 12,
          }
        );
    }

    doc.moveDown(0.6);
  });
}

// ============================================================
// KUNLIK HISOBOT
// ============================================================

function generateDailyReport(report, dateStr, settings = {}) {
  const filepath = path.join(
    RECEIPTS_DIR,
    `daily_report_${safeFileName(dateStr)}.pdf`
  );

  const { doc, fonts, completion } = createDocument(filepath);

  reportHeader(
    doc,
    fonts,
    'КУНЛИК ҲИСОБОТ',
    prettyDate(dateStr),
    settings
  );

  const rows = [
    ['Сотилган узунлик:', formatLength(report.totalMeters)],
    ['Сотувлар жами:', fmtSom(report.totalSales)],
    ['Нағд:', fmtSom(report.cash)],
    ['Карта:', fmtSom(report.card)],
    ['Насия:', fmtSom(report.debt)],
    ['Қарздан тушган:', fmtSom(report.debtPayments)],
    ['Чиқим:', fmtSom(report.expenses)],
    ['Бошқа кирим:', fmtSom(report.otherIncome)],
    [
      'Бекор қилинган сотув:',
      `${report.cancelledCount || 0} ta / ${fmtSom(report.cancelledTotal)}`,
    ],
    [
      'Услуга:',
      `${report.serviceCount || 0} ta / ` +
      `${formatLength(report.serviceMeters)} / ` +
      fmtSom(report.serviceRevenue),
    ],
  ];

  rows.forEach(([label, value]) => {
    reportRow(doc, fonts, label, value);
  });

  reportCategories(doc, fonts, report.categoryStats);
  reportSales(doc, fonts, report.sales);

  doc.end();
  return completion;
}

// ============================================================
// OYLIK HISOBOT
// ============================================================

function generateMonthlyReport(report, monthStr, settings = {}) {
  const filepath = path.join(
    RECEIPTS_DIR,
    `monthly_report_${safeFileName(monthStr)}.pdf`
  );

  const { doc, fonts, completion } = createDocument(filepath);

  reportHeader(
    doc,
    fonts,
    'ОЙЛИК ҲИСОБОТ',
    String(monthStr),
    settings
  );

  const rows = [
    ['Жами сотув:', fmtSom(report.totalSales)],
    ['Нағд:', fmtSom(report.cash)],
    ['Карта:', fmtSom(report.card)],
    ['Насия:', fmtSom(report.debt)],
    ['Қарздан тушум:', fmtSom(report.debtPayments)],
    ['Чиқим:', fmtSom(report.expenses)],
    ['Бошқа кирим:', fmtSom(report.otherIncome)],
    [
      'Бекор қилинган сотув:',
      `${report.cancelledCount || 0} ta / ${fmtSom(report.cancelledTotal)}`,
    ],
    ['Ҳозирги умумий қарз:', fmtSom(report.activeDebt)],
    [
      'Услуга:',
      `${report.serviceCount || 0} ta / ` +
      `${formatLength(report.serviceMeters)} / ` +
      fmtSom(report.serviceRevenue),
    ],
  ];

  rows.forEach(([label, value]) => {
    reportRow(doc, fonts, label, value);
  });

  reportCategories(doc, fonts, report.categoryStats);

  const rate =
    num(report.exchangeRate) ||
    num(settings.dollarRate) ||
    12500;

  if (doc.y > PAGE_H - 85) {
    doc.addPage();
  }

  doc.moveDown(1);

  doc.font(fonts.bold)
    .fontSize(9.5)
    .fillColor(C.dark)
    .text(
      `1 USD = ${money(rate)} so'm | ` +
      `Sotuvlar: ${(num(report.totalSales) / rate).toFixed(2)} USD`,
      {
        align: 'right',
        width: CONTENT_W,
      }
    );

  reportSales(doc, fonts, report.sales);

  doc.end();
  return completion;
}

// ============================================================
// EXPORT
// ============================================================

module.exports = {
  generateReceipt,
  generateDailyReport,
  generateMonthlyReport,
  RECEIPTS_DIR,
};
