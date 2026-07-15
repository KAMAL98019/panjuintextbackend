const path = require('path');

const PAGE_WIDTH = 595.28; // A4 in points
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

// The real Panju Intext printed letterhead (extracted from the company's Word template).
// Header curve + brand-logo strip down the right + footer address bar are all part of the artwork,
// so pages using it must keep content inside the free zone defined below.
const LETTERHEAD_PATH = path.join(__dirname, '..', '..', 'assets', 'letterhead-a4.png');
const LH = {
  x: 45, // left edge of the free content zone
  right: 385, // the lime divider of the brand-logo strip sits at ~389pt
  top: 115, // below the "PANJU INTEXT" title block
  bottom: 745, // above the footer address bar
};

/** Paints the full-page letterhead artwork and positions the cursor at the top of the content zone. */
function drawLetterhead(doc) {
  doc.image(LETTERHEAD_PATH, 0, 0, { width: PAGE_WIDTH, height: PAGE_HEIGHT });
  doc.fillColor('#000000');
  doc.y = LH.top;
}

// Printed on the quotation footer exactly like the physical pad (user-approved 14 Jul 2026,
// reversing the earlier bank-details exclusion — documents only, never in Settings).
const BANK_BLOCK = [
  'A/c. No : 510101000385645',
  'UNION BANK of INDIA',
  'IFSC : UBIN 0817767',
  'FIVE ROADS - SALEM BRANCH',
];

const NAVY = '#0f1f4d';
const LIME = '#c4d600';
const GREY = '#666666';
const LIGHT_GREY = '#f2f2f2';
const BORDER = '#d9d9d9';

function formatCurrency(amount) {
  const n = Number(amount || 0);
  return `Rs. ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(date) {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Company letterhead header shared by every document type. */
function drawHeader(doc, company, docTitle, docMeta = []) {
  doc.rect(0, 0, PAGE_WIDTH, 90).fill(NAVY);

  doc.fillColor('#ffffff').fontSize(18).font('Helvetica-Bold');
  doc.text(company?.name?.toUpperCase() || 'PANJU INTEXT', MARGIN, 24, { continued: false });

  doc.fontSize(8).font('Helvetica').fillColor('#d7dcf0');
  doc.text(company?.address || '', MARGIN, 48, { width: 300 });
  doc.text(
    `Ph: ${company?.phone || '-'}  |  Email: ${company?.email || '-'}`,
    MARGIN,
    68,
    { width: 300 }
  );

  doc.fillColor(LIME).fontSize(16).font('Helvetica-Bold');
  doc.text(docTitle, MARGIN, 24, { width: CONTENT_WIDTH, align: 'right' });

  doc.fillColor('#ffffff').fontSize(8).font('Helvetica');
  let metaY = 48;
  docMeta.forEach((line) => {
    doc.text(line, MARGIN, metaY, { width: CONTENT_WIDTH, align: 'right' });
    metaY += 12;
  });

  doc.fillColor('#000000');
  doc.y = 105;
}

/** Two-column info block, e.g. Billed To / Shipped To or Quotation Ref / Customer. */
function drawTwoColumnBlock(doc, leftTitle, leftLines, rightTitle, rightLines) {
  const colWidth = CONTENT_WIDTH / 2 - 10;
  const startY = doc.y;

  doc.font('Helvetica-Bold').fontSize(9).fillColor(GREY).text(leftTitle.toUpperCase(), MARGIN, startY);
  doc.font('Helvetica').fontSize(10).fillColor('#000000');
  doc.text(leftLines.join('\n'), MARGIN, startY + 14, { width: colWidth });

  const rightX = MARGIN + colWidth + 20;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(GREY).text(rightTitle.toUpperCase(), rightX, startY);
  doc.font('Helvetica').fontSize(10).fillColor('#000000');
  doc.text(rightLines.join('\n'), rightX, startY + 14, { width: colWidth });

  doc.moveDown(2);
  doc.y = Math.max(doc.y, startY + 14 + doc.heightOfString(leftLines.join('\n'), { width: colWidth }) + 10);
}

/**
 * Draws a simple bordered table.
 * columns: [{ label, width, align }]
 * rows: array of arrays of cell strings (same order as columns)
 */
function drawTable(doc, { columns, rows, startY }) {
  const rowHeight = 22;
  let y = startY !== undefined ? startY : doc.y;
  const tableWidth = columns.reduce((sum, c) => sum + c.width, 0);

  // header
  doc.rect(MARGIN, y, tableWidth, rowHeight).fill(NAVY);
  let x = MARGIN;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff');
  columns.forEach((col) => {
    doc.text(col.label, x + 4, y + 7, { width: col.width - 8, align: col.align || 'left' });
    x += col.width;
  });
  y += rowHeight;

  doc.font('Helvetica').fontSize(9).fillColor('#000000');
  rows.forEach((row, idx) => {
    const bg = idx % 2 === 0 ? '#ffffff' : LIGHT_GREY;
    doc.rect(MARGIN, y, tableWidth, rowHeight).fill(bg);
    doc.strokeColor(BORDER).lineWidth(0.5).rect(MARGIN, y, tableWidth, rowHeight).stroke();

    x = MARGIN;
    doc.fillColor('#000000');
    row.forEach((cell, colIdx) => {
      const col = columns[colIdx];
      doc.text(String(cell), x + 4, y + 7, { width: col.width - 8, align: col.align || 'left' });
      x += col.width;
    });
    y += rowHeight;
  });

  doc.strokeColor(BORDER).lineWidth(0.5).rect(MARGIN, startY !== undefined ? startY : doc.y, tableWidth, y - (startY !== undefined ? startY : doc.y)).stroke();

  doc.y = y + 12;
  return y;
}

/** Right-aligned totals summary box (Subtotal/Discount/Tax/Grand Total). */
function drawTotalsBox(doc, lines, grandTotalLabel, grandTotalValue) {
  const boxWidth = 230;
  const x = MARGIN + CONTENT_WIDTH - boxWidth;
  let y = doc.y;

  doc.font('Helvetica').fontSize(9.5).fillColor('#000000');
  lines.forEach(([label, value]) => {
    doc.text(label, x, y, { width: boxWidth - 100 });
    doc.text(value, x + boxWidth - 100, y, { width: 100, align: 'right' });
    y += 16;
  });

  doc.rect(x, y, boxWidth, 26).fill(NAVY);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11);
  doc.text(grandTotalLabel, x + 8, y + 7, { width: boxWidth - 108 });
  doc.text(grandTotalValue, x + boxWidth - 100, y + 7, { width: 92, align: 'right' });

  doc.fillColor('#000000');
  doc.y = y + 40;
}

function drawSignatureBlock(doc, leftLabel, rightLabel) {
  const y = doc.y + 20;
  doc.strokeColor(BORDER).lineWidth(0.5);
  doc.moveTo(MARGIN, y).lineTo(MARGIN + 160, y).stroke();
  doc.moveTo(MARGIN + CONTENT_WIDTH - 160, y).lineTo(MARGIN + CONTENT_WIDTH, y).stroke();

  doc.font('Helvetica').fontSize(9).fillColor(GREY);
  doc.text(leftLabel, MARGIN, y + 4, { width: 160, align: 'center' });
  doc.text(rightLabel, MARGIN + CONTENT_WIDTH - 160, y + 4, { width: 160, align: 'center' });
  doc.fillColor('#000000');
  doc.y = y + 30;
}

function drawFootNote(doc, text) {
  doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(GREY);
  doc.text(text, MARGIN, doc.y + 10, { width: CONTENT_WIDTH, align: 'center' });
  doc.fillColor('#000000');
}

module.exports = {
  PAGE_WIDTH,
  PAGE_HEIGHT,
  MARGIN,
  CONTENT_WIDTH,
  NAVY,
  LIME,
  GREY,
  BORDER,
  LH,
  BANK_BLOCK,
  drawLetterhead,
  formatCurrency,
  formatDate,
  drawHeader,
  drawTwoColumnBlock,
  drawTable,
  drawTotalsBox,
  drawSignatureBlock,
  drawFootNote,
};
