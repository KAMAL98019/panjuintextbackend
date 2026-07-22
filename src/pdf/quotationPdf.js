const { NAVY, LH, BANK_BLOCK, drawLetterhead, formatDate } = require('./helpers');
const { groupByGstRate } = require('../services/gstCalculator');

// Column layout copied from the paper quotation book: description | qty | unit | rate | = | amount.
// No header row, no HSN/GST% columns — GST appears only as grouped total lines ("GST 5%", "GST 18%").
const COLS = [
  { key: 'desc', width: 122, align: 'left' },
  { key: 'qty', width: 38, align: 'right' },
  { key: 'unit', width: 36, align: 'center' },
  { key: 'rate', width: 56, align: 'right' },
  { key: 'eq', width: 12, align: 'center' },
  { key: 'amount', width: 74, align: 'right' },
];
const TABLE_WIDTH = COLS.reduce((sum, c) => sum + c.width, 0);
const ROW_HEIGHT = 17;

function money(n, { decimals = true } = {}) {
  const num = Number(n || 0);
  const opts = decimals
    ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : { maximumFractionDigits: 2 };
  const sign = num < 0 ? '- ' : '';
  return `${sign}Rs. ${Math.abs(num).toLocaleString('en-IN', opts)}`;
}

function ensureSpace(doc, needed) {
  if (doc.y + needed > LH.bottom) {
    doc.addPage();
    drawLetterhead(doc);
  }
}

function drawRow(doc, cells, { bold = true, color = '#000000' } = {}) {
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);

  // Row height grows with the tallest wrapped cell (long descriptions wrap onto extra lines)
  const rowHeight = Math.max(
    ROW_HEIGHT,
    ...COLS.map((col, idx) => {
      const cell = cells[idx];
      if (cell === null || cell === undefined || cell === '') return 0;
      return doc.heightOfString(String(cell), { width: col.width - 8 }) + 10;
    })
  );

  ensureSpace(doc, rowHeight);
  const y = doc.y;
  let x = LH.x;

  doc.strokeColor('#8a8a8a').lineWidth(0.6);
  doc.rect(LH.x, y, TABLE_WIDTH, rowHeight).stroke();

  doc.fillColor(color);
  COLS.forEach((col, idx) => {
    const cell = cells[idx];
    if (cell !== null && cell !== undefined && cell !== '') {
      doc.text(String(cell), x + 4, y + 5, { width: col.width - 8, align: col.align });
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
function drawTotalsRow(doc, label, amount, { bold = true, color = NAVY } = {}) {
  ensureSpace(doc, ROW_HEIGHT);
  const y = doc.y;
  const labelWidth = COLS[0].width + COLS[1].width + COLS[2].width + COLS[3].width;
  const eqX = LH.x + labelWidth;
  const amountX = eqX + COLS[4].width;

  doc.strokeColor('#8a8a8a').lineWidth(0.6);
  doc.rect(LH.x, y, TABLE_WIDTH, ROW_HEIGHT).stroke();
  doc.moveTo(eqX, y).lineTo(eqX, y + ROW_HEIGHT).stroke();
  doc.moveTo(amountX, y).lineTo(amountX, y + ROW_HEIGHT).stroke();

  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(color);
  doc.text(label, LH.x + 4, y + 5, { width: labelWidth - 12, align: 'center', lineBreak: false });
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
 */
function renderQuotationPdf(doc, { company, customer, quotation }) {
  const isGst = quotation.quotationType === 'GST';
  drawLetterhead(doc);

  // TO block (left) and QTN number/date (right), side by side like the pad
  const blockY = LH.top + 32;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000').text('TO:', LH.x, blockY);
  doc.font('Helvetica-Bold').fontSize(9.5);
  doc.text(customer.name, LH.x + 32, blockY, { width: 200 });
  doc.font('Helvetica').fontSize(9).fillColor('#222222');
  doc.text([customer.address, `${customer.city}${customer.pincode ? ' - ' + customer.pincode : ''}`].filter(Boolean).join('\n'), LH.x + 32, doc.y + 1, { width: 200 });
  doc.text(`ph.no: ${customer.mobile}`, LH.x + 32, doc.y + 1, { width: 200 });
  const leftBlockEnd = doc.y;

  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#000000');
  doc.text(quotation.quotationNumber, 290, blockY, { width: 95, align: 'left', lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor('#222222');
  doc.text(formatDate(quotation.createdAt), 290, blockY + 13, { width: 95, align: 'left', lineBreak: false });

  doc.y = Math.max(leftBlockEnd, blockY + 30) + 14;

  // SUB line
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000');
  doc.text('SUB:  ', LH.x, doc.y, { continued: true, width: LH.right - LH.x });
  doc.font('Helvetica').text(quotation.remarks || 'Quotation for interior furnishing works', { width: LH.right - LH.x });
  doc.moveDown(1);

  // Greeting
  doc.font('Helvetica-Bold').fontSize(9).text('DEAR SIR', LH.x, doc.y);
  doc.font('Helvetica').fontSize(9).fillColor('#222222');
  doc.text(
    'We are very much delighted by your kind enquiry and very happy to present you the quotation for the service you have enquired. Anticipating for your support and positive response.',
    LH.x + 30,
    doc.y + 3,
    { width: LH.right - LH.x - 40, align: 'left' }
  );
  doc.fillColor('#000000');
  doc.moveDown(1);

  // Quotation Area heading
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000');
  const headingY = doc.y;
  doc.text('Quotation Area :', LH.x, headingY, { underline: true });
  doc.y = headingY + 18;

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
    ]);
  });

  // Totals rows continue the same table grid
  drawTotalsRow(doc, 'Gross Total', quotation.subtotal);
  if (quotation.discountAmount > 0) {
    drawTotalsRow(doc, 'Discount', -quotation.discountAmount, { color: '#000000' });
  }
  if (isGst) {
    groupByGstRate(quotation.items).forEach((g) => {
      drawTotalsRow(doc, `GST ${g.rate} %`, g.taxAmount, { color: '#000000' });
    });
  }

  // A lump-sum bargained quotation stores a negotiated total that no longer equals
  // items + GST; print the difference as a Special Discount so the column still adds up.
  const computedGrand = quotation.subtotal - (quotation.discountAmount || 0) + (isGst ? quotation.gstAmount || 0 : 0);
  const negotiatedDiff = computedGrand - quotation.total;
  if (Math.abs(negotiatedDiff) > 0.5) {
    drawTotalsRow(doc, negotiatedDiff > 0 ? 'Special Discount' : 'Adjustment', -negotiatedDiff, { color: '#000000' });
  }

  drawTotalsRow(doc, 'Grand Total', quotation.total);

  doc.moveDown(1.2);

  // Validity / advance note
  ensureSpace(doc, 40);
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000');
  doc.text('Note :  ', LH.x, doc.y, { continued: true, width: LH.right - LH.x });
  doc.font('Helvetica').fillColor('#222222');
  doc.text(
    quotation.terms ||
    `All prices quoted are valid for ${quotation.validityDays} days from the date of stated on the quotation. 70% advance for the order confirmation.`,
    { width: LH.right - LH.x }
  );
  doc.fillColor('#000000');

  // Footer exactly like the pad: company + bank block bottom-left, Thanks & Regards on the right
  ensureSpace(doc, 100);
  const signY = Math.min(doc.y + 30, LH.bottom - 80);
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000');
  doc.text((company?.name || 'Panju Intext').toUpperCase(), LH.x, signY, { width: 200 });
  BANK_BLOCK.forEach((line, idx) => {
    doc.text(line, LH.x, signY + 14 + idx * 13, { width: 200, lineBreak: false });
  });

  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('Thanks & Regards', 262, signY, { width: 120, align: 'center', lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor('#222222');
  doc.text(company?.name || 'Panju Intext', 262, signY + 13, { width: 120, align: 'center' });
  doc.fillColor('#000000');
}

module.exports = { renderQuotationPdf };
