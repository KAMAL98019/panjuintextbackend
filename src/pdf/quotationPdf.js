const path = require('path');
const { NAVY, LH, BANK_BLOCK, drawLetterhead, isLumpSumLine } = require('./helpers');
const { groupByGstRate, quotedTotalOf } = require('../services/gstCalculator');

// Column layout copied from the paper quotation book: description | qty | unit | rate | = | amount.
// A column-name header row heads the table (repeated on a continuation page); no HSN/GST% columns —
// GST appears only as grouped total lines ("GST 5%", "GST 18%").
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
const HEADER_CELLS = ['Description', 'Qty', 'Unit', 'Rate', '', 'Amount'];
const HEADER_FILL = '#e8ecf5';

// Right edge of the QT number/date block — just left of the header curve at that height
const QT_RIGHT = 488;
const QT_WIDTH = 120;

// Bold = 12pt, regular = 11pt throughout — matches the reference layout.
const BOLD_SIZE = 12;
const REG_SIZE = 11;

// Space kept free under the note for the company/bank block + "Thanks & Regards" footer.
const FOOTER_HEIGHT = 90;
const FOOTER_GAP = 12;
// Tightest row spacing allowed before items continue on a second letterhead page.
const MIN_SCALE = 0.3;

/**
 * Table spacing at a given tightness — 1 is the pad's normal layout. Text always stays at the
 * normal 12/11pt size; only the cell padding / row height tightens so more items fit on page 1.
 * Beyond the tightest spacing, rows simply continue onto a second letterhead page.
 */
function sizesFor(scale) {
  const pad = 5 * scale;
  return {
    bold: BOLD_SIZE,
    reg: REG_SIZE,
    pad,
    rowHeight: Math.max(ROW_HEIGHT * scale, BOLD_SIZE * 1.25 + pad * 2),
    gap: 16 * Math.max(scale, 0.6),
  };
}
const CALIBRI = path.join(__dirname, '..', '..', 'assets', 'fonts', 'Calibri-Regular.ttf');
const CALIBRI_BOLD = path.join(__dirname, '..', '..', 'assets', 'fonts', 'Calibri-Bold.ttf');

// registerFont is per-PDFDocument instance, not global — must be called fresh for every doc.
function registerFonts(doc) {
  doc.registerFont('Calibri', CALIBRI);
  doc.registerFont('Calibri-Bold', CALIBRI_BOLD);
}

/** Pad-style date: 21.10.2026 */
function dotDate(date) {
  const d = new Date(date || Date.now());
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
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

/** Row height grows with the tallest wrapped cell (long descriptions wrap onto extra lines). */
function measureRow(doc, cells, sz, bold = true) {
  doc.font(bold ? 'Calibri-Bold' : 'Calibri').fontSize(bold ? sz.bold : sz.reg);
  return Math.max(
    sz.rowHeight,
    ...COLS.map((col, idx) => {
      const cell = cells[idx];
      if (cell === null || cell === undefined || cell === '') return 0;
      return doc.heightOfString(String(cell), { width: col.width - 8 }) + sz.pad * 2;
    })
  );
}

function drawRow(doc, cells, { bold = true, color = '#000000', fill, bodyOnly, shiftX = 0, sz = sizesFor(1) } = {}) {
  const rowHeight = measureRow(doc, cells, sz, bold);

  ensureSpace(doc, rowHeight, bodyOnly);
  const y = doc.y;
  let x = LH.x + shiftX;

  if (fill) doc.save().rect(LH.x + shiftX, y, TABLE_WIDTH, rowHeight).fill(fill).restore();
  doc.strokeColor('#8a8a8a').lineWidth(0.6);
  doc.rect(LH.x + shiftX, y, TABLE_WIDTH, rowHeight).stroke();

  doc.fillColor(color);
  COLS.forEach((col, idx) => {
    const cell = cells[idx];
    if (cell !== null && cell !== undefined && cell !== '') {
      // Description column stays top-aligned (can wrap to multiple lines).
      // All other columns (qty, unit, rate, =, amount) hold a single value — vertically center them.
      const fontSize = bold ? sz.bold : sz.reg;
      const textY = col.key === 'desc'
        ? y + sz.pad
        : y + Math.max(sz.pad - 1, (rowHeight - fontSize - 2) / 2);
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
function drawTotalsRow(doc, label, amount, { bold = true, color = NAVY, bodyOnly, shiftX = 0, sz = sizesFor(1) } = {}) {
  const ROW_HEIGHT = sz.rowHeight;
  const textY = Math.max(sz.pad - 1, (ROW_HEIGHT - (bold ? sz.bold : sz.reg) - 2) / 2);
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

  doc.font(bold ? 'Calibri-Bold' : 'Calibri').fontSize(bold ? sz.bold : sz.reg).fillColor(color);
  doc.text(label, x0 + 4, y + textY, { width: labelWidth - 12, align: 'center', lineBreak: false });
  doc.text('=', eqX + 2, y + textY, { width: COLS[4].width - 4, align: 'center', lineBreak: false });
  doc.text(money(amount), amountX + 4, y + textY, { width: COLS[5].width - 8, align: 'right', lineBreak: false });
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

  // TO block like the pad: "TO:" on its own line, the customer's name/address indented below it;
  // QTN number + date as a centred pair at the top-right, just inside the letterhead's curve.
  const blockY = LH.top + 32 + bodyTopOffset;
  doc.font('Calibri-Bold').fontSize(BOLD_SIZE).fillColor('#000000').text('TO:', x, blockY);
  doc.text(customer.name || ' ', x + 32, blockY + 18, { width: 220 });
  doc.font('Calibri').fontSize(REG_SIZE).fillColor('#222222');
  // Address and phone are optional on the quotation form — print only the lines that were filled in
  const addressText = [customer.address, `${customer.city || ''}${customer.pincode ? ' - ' + customer.pincode : ''}`].filter(Boolean).join('\n');
  if (addressText) doc.text(addressText, x + 32, doc.y + 1, { width: 220 });
  if (customer.mobile) doc.text(`ph.no: ${customer.mobile}`, x + 32, doc.y + 1, { width: 220 });
  const leftBlockEnd = doc.y;

  doc.font('Calibri-Bold').fontSize(BOLD_SIZE).fillColor('#000000');
  doc.text(quotation.quotationNumber, QT_RIGHT - QT_WIDTH, blockY, { width: QT_WIDTH, align: 'center', lineBreak: false });
  doc.font('Calibri').fontSize(REG_SIZE).fillColor('#222222');
  doc.text(dotDate(quotation.createdAt), QT_RIGHT - QT_WIDTH, blockY + 16, { width: QT_WIDTH, align: 'center', lineBreak: false });

  doc.y = Math.max(leftBlockEnd, blockY + 36) + 18;

  // SUB line — the work type is bold, like "Quotation for **Wallpaper & Blinds** reg." on the pad
  const subject = quotation.remarks || 'Quotation for interior furnishing works';
  const subParts = subject.match(/^(Quotation for\s+)(.+?)(\s+reg\.?)?$/i);
  doc.font('Calibri-Bold').fontSize(BOLD_SIZE).fillColor('#000000');
  doc.text('SUB:  ', x, doc.y, { continued: true, width: rightEdge - x });
  if (subParts) {
    doc.font('Calibri').fontSize(REG_SIZE).text(subParts[1], { continued: true });
    doc.font('Calibri-Bold').fontSize(REG_SIZE).text(subParts[2], { continued: !!subParts[3] });
    if (subParts[3]) doc.font('Calibri').fontSize(REG_SIZE).text(subParts[3]);
  } else {
    doc.font('Calibri').fontSize(REG_SIZE).text(subject, { width: rightEdge - x });
  }
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
  const itemRows = quotation.items.map((item) => {
    const taxable = item.quantity * item.unitPrice * (1 - (item.discountPercent || 0) / 100);
    return [
      item.description,
      isLumpSumLine(item) ? '' : Number(item.quantity).toLocaleString('en-IN', { maximumFractionDigits: 2 }),
      isLumpSumLine(item) ? '' : item.unit || '',
      money(item.unitPrice, { decimals: false }),
      '=',
      money(taxable),
    ];
  });
  const gstGroups = isGst ? groupByGstRate(quotation.items) : [];
  const totalsRowCount = 2 + (quotation.discountAmount > 0 ? 1 : 0) + gstGroups.length;
  const noteText = quotation.terms ||
    `All prices quoted are valid for ${quotation.validityDays} days from the date of stated on the quotation. 70% advance for the order confirmation.`;

  // Keep everything on one page when possible by tightening the row spacing (never the text size);
  // if even the tightest rows don't fit, the remaining rows continue on a second letterhead page.
  const available = LH.bottom - FOOTER_HEIGHT - FOOTER_GAP - doc.y;
  const heightAt = (sz) => {
    const rows = itemRows.reduce((sum, cells) => sum + measureRow(doc, cells, sz), 0);
    doc.font('Calibri-Bold').fontSize(sz.bold);
    // +1 line: the continued "Note :" label renders a line taller than heightOfString predicts
    const note = doc.heightOfString(`Note :  ${noteText}`, { width: rightEdge - x }) + doc.currentLineHeight(true);
    return measureRow(doc, HEADER_CELLS, sz) + rows + totalsRowCount * sz.rowHeight + sz.gap + note;
  };
  let scale = 1;
  while (scale > MIN_SCALE && heightAt(sizesFor(scale)) > available) scale = Math.round((scale - 0.01) * 1000) / 1000;
  const fitsOnePage = heightAt(sizesFor(scale)) <= available;
  // Too many items for one page even when tight: use the normal spacing across two pages instead
  const sz = fitsOnePage ? sizesFor(scale) : sizesFor(1);

  // Plan the page breaks up front: fill each page with rows, and if the totals + note + footer
  // wouldn't fit after the last row, carry the last row over with them — so a page is never left
  // holding only the footer.
  const pageBreaks = new Set();
  if (!fitsOnePage) {
    doc.font('Calibri-Bold').fontSize(sz.bold);
    const noteHeight = doc.heightOfString(`Note :  ${noteText}`, { width: rightEdge - x }) + doc.currentLineHeight(true);
    const tailHeight = totalsRowCount * sz.rowHeight + sz.gap + noteHeight + FOOTER_GAP + FOOTER_HEIGHT;
    const headerHeight = measureRow(doc, HEADER_CELLS, sz);
    let y = doc.y + headerHeight;
    itemRows.forEach((cells, idx) => {
      const h = measureRow(doc, cells, sz);
      if (y + h > LH.bottom) { pageBreaks.add(idx); y = LH.top + headerHeight; }
      y += h;
    });
    if (y + tailHeight > LH.bottom && itemRows.length > 0) pageBreaks.add(itemRows.length - 1);
  }

  const drawHeader = () => drawRow(doc, HEADER_CELLS, { color: NAVY, fill: HEADER_FILL, bodyOnly, sz });
  drawHeader();
  itemRows.forEach((cells, idx) => {
    if (pageBreaks.has(idx)) {
      doc.addPage();
      drawLetterhead(doc, { bodyOnly });
      drawHeader(); // column names repeat on the continuation page
    }
    drawRow(doc, cells, { bodyOnly, sz });
  });

  // Totals rows continue the same table grid
  drawTotalsRow(doc, 'Gross Total', quotation.subtotal, { bodyOnly, sz });
  if (quotation.discountAmount > 0) {
    drawTotalsRow(doc, 'Discount', -quotation.discountAmount, { color: '#000000', bodyOnly, sz });
  }
  gstGroups.forEach((g) => {
    drawTotalsRow(doc, `GST ${g.rate} %`, g.taxAmount, { color: '#000000', bodyOnly, sz });
  });

  // The quotation's own Grand Total — settlement discounts / corrections after confirmation
  // change only the final amount payable, never what the quotation document says.
  drawTotalsRow(doc, 'Grand Total', quotedTotalOf(quotation), { bodyOnly, sz });

  doc.y += sz.gap;

  // Validity / advance note — entire line in bold (label + body)
  ensureSpace(doc, 40, bodyOnly);
  doc.font('Calibri-Bold').fontSize(sz.bold).fillColor('#000000');
  doc.text('Note :  ', x, doc.y, { continued: true, width: rightEdge - x });
  doc.text(noteText, { width: rightEdge - x });
  doc.fillColor('#000000');

  // Footer exactly like the pad: company + bank block bottom-left, Thanks & Regards on the right
  ensureSpace(doc, FOOTER_HEIGHT + FOOTER_GAP, bodyOnly);
  const signY = Math.min(doc.y + 30, LH.bottom - FOOTER_HEIGHT);
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
