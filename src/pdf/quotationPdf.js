const path = require('path');
const { NAVY, LH, BANK_BLOCK, drawLetterhead, formatDate } = require('./helpers');
const { groupByGstRate } = require('../services/gstCalculator');

// Column layout copied from the paper quotation book: description | qty | unit | rate | = | amount.
// No header row, no HSN/GST% columns — GST appears only as grouped total lines ("GST 5%", "GST 18%").
const COLS = [
  { key: 'desc', width: 122, align: 'left' },
  { key: 'qty', width: 54, align: 'center' },
  { key: 'unit', width: 34, align: 'center' },
  { key: 'rate', width: 58, align: 'center' },   // reduced 6pt to fund wider eq column
  { key: 'eq', width: 18, align: 'center' },     // widened: = now has 10pt usable space (was 4pt)
  { key: 'amount', width: 98, align: 'right' },
];
const TABLE_WIDTH = COLS.reduce((sum, c) => sum + c.width, 0);
const ROW_HEIGHT = 22;

// Bold = 12pt, regular = 11pt throughout — matches the reference layout.
const BOLD_SIZE = 12;
const REG_SIZE = 11;
const CALIBRI = path.join(__dirname, '..', '..', 'assets', 'fonts', 'Calibri-Regular.ttf');
const CALIBRI_BOLD = path.join(__dirname, '..', '..', 'assets', 'fonts', 'Calibri-Bold.ttf');

// registerFont is per-PDFDocument instance, not global — must be called fresh for every doc.
function registerFonts(doc) {
  doc.registerFont('Calibri', CALIBRI);
  doc.registerFont('Calibri-Bold', CALIBRI_BOLD);
}

function money(n, { decimals = true } = {}) {
  const num = Number(n || 0);
  const opts = decimals
    ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : { maximumFractionDigits: 2 };
  const sign = num < 0 ? '- ' : '';
  return `${sign}Rs. ${Math.abs(num).toLocaleString('en-IN', opts)}`;
}

function ensureSpace(doc, needed, bodyOnly) {
  if (doc.y + needed > LH.bottom) {
    doc.addPage();
    drawLetterhead(doc, { bodyOnly });
  }
}

function drawRow(doc, cells, { bold = true, color = '#000000', bodyOnly, shiftX = 0 } = {}) {
  doc.font(bold ? 'Calibri-Bold' : 'Calibri').fontSize(bold ? BOLD_SIZE : REG_SIZE);

  // Row height grows with the tallest wrapped cell (long descriptions wrap onto extra lines)
  const rowHeight = Math.max(
    ROW_HEIGHT,
    ...COLS.map((col, idx) => {
      const cell = cells[idx];
      if (cell === null || cell === undefined || cell === '') return 0;
      return doc.heightOfString(String(cell), { width: col.width - 8 }) + 10;
    })
  );

  ensureSpace(doc, rowHeight, bodyOnly);
  const y = doc.y;
  let x = LH.x + shiftX;

  doc.strokeColor('#8a8a8a').lineWidth(0.6);
  doc.rect(LH.x + shiftX, y, TABLE_WIDTH, rowHeight).stroke();

  doc.fillColor(color);
  COLS.forEach((col, idx) => {
    const cell = cells[idx];
    if (cell !== null && cell !== undefined && cell !== '') {
      // Description column stays top-aligned (can wrap to multiple lines).
      // All other columns (qty, unit, rate, =, amount) hold a single value — vertically center them.
      const fontSize = bold ? BOLD_SIZE : REG_SIZE;
      const textY = col.key === 'desc'
        ? y + 5
        : y + Math.max(4, (rowHeight - fontSize - 2) / 2);
      doc.text(String(cell), x + 4, textY, { width: col.width - 8, align: col.align });
    }
    if (idx < COLS.length - 1) {
      doc.moveTo(x + col.width, y).lineTo(x + col.width, y + rowHeight).stroke();
    }
    x += col.width;
  });
  doc.fillColor('#000000');
  doc.y = y + rowHeight;
}

/** A totals row where the label spans the first four columns (like "Gross Total" on the paper). */
function drawTotalsRow(doc, label, amount, { bold = true, color = NAVY, bodyOnly, shiftX = 0 } = {}) {
  ensureSpace(doc, ROW_HEIGHT, bodyOnly);
  const y = doc.y;
  const x0 = LH.x + shiftX;
  const labelWidth = COLS[0].width + COLS[1].width + COLS[2].width + COLS[3].width;
  const eqX = x0 + labelWidth;
  const amountX = eqX + COLS[4].width;

  doc.strokeColor('#8a8a8a').lineWidth(0.6);
  doc.rect(x0, y, TABLE_WIDTH, ROW_HEIGHT).stroke();
  doc.moveTo(eqX, y).lineTo(eqX, y + ROW_HEIGHT).stroke();
  doc.moveTo(amountX, y).lineTo(amountX, y + ROW_HEIGHT).stroke();

  doc.font(bold ? 'Calibri-Bold' : 'Calibri').fontSize(bold ? BOLD_SIZE : REG_SIZE).fillColor(color);
  doc.text(label, x0 + 4, y + 5, { width: labelWidth - 12, align: 'center', lineBreak: false });
  doc.text('=', eqX + 2, y + 5, { width: COLS[4].width - 4, align: 'center', lineBreak: false });
  doc.text(money(amount), amountX + 4, y + 5, { width: COLS[5].width - 8, align: 'right', lineBreak: false });
  doc.fillColor('#000000');
  doc.y = y + ROW_HEIGHT;
}

/**
 * Renders the quotation onto the company's real printed letterhead, replicating the paper
 * quotation book's layout: TO block + QTN no/date, SUB line, "DEAR SIR" intro, "Quotation Area :"
 * table (no header row, `=` column), Gross Total → grouped GST lines → Grand Total, validity note,
 * and the consultant / "Thanks & Regards" sign-off. Bank details are deliberately never printed.
 *
 * Pass `bodyOnly: true` to skip painting the letterhead artwork — for printing onto pre-printed
 * letterhead paper stock. The on-screen preview and WhatsApp-sent PDF always use the full artwork;
 * only the print action uses bodyOnly.
 */
function renderQuotationPdf(doc, { company, customer, quotation, bodyOnly = false }) {
  registerFonts(doc);
  const isGst = quotation.quotationType === 'GST';
  drawLetterhead(doc, { bodyOnly });

  // Body-only print mode uses the same LH.x / LH.right margins as the normal letterhead.
  // LH.x=45 already sits just inside the physical paper's left design zone, and LH.right=390
  // stops before the pre-printed ad column on the right side of the physical sheet.
  // Do NOT shift right — a positive shiftX would push the table into the ad column.
  // bodyTopOffset: shift body 0.5 cm (≈14pt) down on pre-printed stock so content aligns with
  // the physical paper's content zone (which starts slightly lower than the digital artwork).
  const x = LH.x;
  const rightEdge = LH.right;
  const bodyTopOffset = bodyOnly ? 14 : 0;

  // TO block (left) and QTN number/date (right), side by side like the pad
  const blockY = LH.top + 32 + bodyTopOffset;
  doc.font('Calibri-Bold').fontSize(BOLD_SIZE).fillColor('#000000').text('TO:', x, blockY);
  doc.font('Calibri-Bold').fontSize(BOLD_SIZE);
  doc.text(customer.name, x + 32, blockY, { width: 200 });
  doc.font('Calibri').fontSize(REG_SIZE).fillColor('#222222');
  doc.text([customer.address, `${customer.city}${customer.pincode ? ' - ' + customer.pincode : ''}`].filter(Boolean).join('\n'), x + 32, doc.y + 1, { width: 200 });
  doc.text(`ph.no: ${customer.mobile}`, x + 32, doc.y + 1, { width: 200 });
  const leftBlockEnd = doc.y;

  doc.font('Calibri-Bold').fontSize(BOLD_SIZE).fillColor('#000000');
  doc.text(quotation.quotationNumber, 290, blockY, { width: 95, align: 'left', lineBreak: false });
  doc.font('Calibri').fontSize(REG_SIZE).fillColor('#222222');
  doc.text(formatDate(quotation.createdAt), 290, blockY + 16, { width: 95, align: 'left', lineBreak: false });

  doc.y = Math.max(leftBlockEnd, blockY + 36) + 14;

  // SUB line
  doc.font('Calibri-Bold').fontSize(BOLD_SIZE).fillColor('#000000');
  doc.text('SUB:  ', x, doc.y, { continued: true, width: rightEdge - x });
  doc.font('Calibri').fontSize(REG_SIZE).text(quotation.remarks || 'Quotation for interior furnishing works', { width: rightEdge - x });
  doc.moveDown(1);

  // Greeting
  doc.font('Calibri-Bold').fontSize(BOLD_SIZE).text('DEAR SIR', x, doc.y);
  doc.font('Calibri').fontSize(REG_SIZE).fillColor('#222222');
  doc.text(
    'We are very much delighted by your kind enquiry and very happy to present you the quotation for the service you have enquired. Anticipating for your support and positive response.',
    x + 30,
    doc.y + 3,
    { width: rightEdge - x - 40, align: 'left' }
  );
  doc.fillColor('#000000');
  doc.moveDown(1);

  // Quotation Area heading
  doc.font('Calibri-Bold').fontSize(BOLD_SIZE).fillColor('#000000');
  const headingY = doc.y;
  doc.text('Quotation Area :', x, headingY, { underline: true });
  doc.y = headingY + 22;

  // Item rows — exactly like the pad: description | qty | unit | rate | = | amount.
  // Row amount is the pre-tax value (qty × rate less discount): on the paper, GST appears only
  // as the grouped total lines below, so the rows must sum to the Gross Total.
  quotation.items.forEach((item) => {
    const taxable = item.quantity * item.unitPrice * (1 - (item.discountPercent || 0) / 100);
    drawRow(doc, [
      item.description,
      Number(item.quantity).toLocaleString('en-IN', { maximumFractionDigits: 2 }),
      item.unit || '',
      money(item.unitPrice, { decimals: false }),
      '=',
      money(taxable),
    ], { bodyOnly });
  });

  // Totals rows continue the same table grid
  drawTotalsRow(doc, 'Gross Total', quotation.subtotal, { bodyOnly });
  if (quotation.discountAmount > 0) {
    drawTotalsRow(doc, 'Discount', -quotation.discountAmount, { color: '#000000', bodyOnly });
  }
  if (isGst) {
    groupByGstRate(quotation.items).forEach((g) => {
      drawTotalsRow(doc, `GST ${g.rate} %`, g.taxAmount, { color: '#000000', bodyOnly });
    });
  }

  drawTotalsRow(doc, 'Grand Total', quotation.total, { bodyOnly });

  doc.moveDown(1.2);

  // Validity / advance note — entire line in bold (label + body)
  ensureSpace(doc, 40, bodyOnly);
  doc.font('Calibri-Bold').fontSize(BOLD_SIZE).fillColor('#000000');
  doc.text('Note :  ', x, doc.y, { continued: true, width: rightEdge - x });
  doc.text(
    quotation.terms ||
    `All prices quoted are valid for ${quotation.validityDays} days from the date of stated on the quotation. 70% advance for the order confirmation.`,
    { width: rightEdge - x }
  );
  doc.fillColor('#000000');

  // Footer exactly like the pad: company + bank block bottom-left, Thanks & Regards on the right
  ensureSpace(doc, 100, bodyOnly);
  const signY = Math.min(doc.y + 30, LH.bottom - 90);
  doc.font('Calibri-Bold').fontSize(BOLD_SIZE).fillColor('#000000');
  doc.text((company?.name || 'Panju Intext').toUpperCase(), x, signY, { width: 200 });
  BANK_BLOCK.forEach((line, idx) => {
    doc.text(line, x, signY + 17 + idx * 15, { width: 200, lineBreak: false });
  });

  doc.font('Calibri-Bold').fontSize(BOLD_SIZE);
  doc.text('Thanks & Regards', 262, signY, { width: 120, align: 'center', lineBreak: false });
  doc.font('Calibri').fontSize(REG_SIZE).fillColor('#222222');
  doc.text(company?.name || 'Panju Intext', 262, signY + 16, { width: 120, align: 'center' });
  doc.fillColor('#000000');
}

module.exports = { renderQuotationPdf };
