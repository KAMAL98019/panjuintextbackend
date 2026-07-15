const PDFDocument = require('pdfkit');
const { MARGIN, NAVY, GREY, BORDER, formatDate } = require('./helpers');

const PAGE_HEIGHT = 841.89; // A4 in points
const BOTTOM_MARGIN = 50;
const CELL_PAD = 5;

/**
 * Streams a paginated tabular list (e.g. the filtered Quotations export) as a PDF.
 * Row heights are measured per row so long values wrap inside their cell instead of
 * spilling over the row border.
 */
function exportListToPdf(res, { filename, title, columns, rows }) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);

  const tableWidth = columns.reduce((sum, c) => sum + c.width, 0);

  const measureRow = (cells, font, size) => {
    doc.font(font).fontSize(size);
    return Math.max(
      16,
      ...columns.map((col, idx) => {
        const value = cells[idx];
        if (value === null || value === undefined || value === '') return 0;
        return doc.heightOfString(String(value), { width: col.width - CELL_PAD * 2 }) + CELL_PAD * 2;
      })
    );
  };

  const drawCells = (cells, y, height, { font, size, color }) => {
    doc.font(font).fontSize(size).fillColor(color);
    let x = MARGIN;
    columns.forEach((col, idx) => {
      const value = cells[idx];
      if (value !== null && value !== undefined && value !== '') {
        doc.text(String(value), x + CELL_PAD, y + CELL_PAD, { width: col.width - CELL_PAD * 2, align: col.align || 'left' });
      }
      x += col.width;
    });
  };

  const drawTitle = () => {
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(16).text(title, MARGIN, MARGIN);
    doc.fillColor(GREY).font('Helvetica').fontSize(8).text(`Generated ${formatDate(new Date())} — ${rows.length} record(s)`, MARGIN, MARGIN + 20);
    doc.y = MARGIN + 40;
  };

  const headerCells = columns.map((c) => c.header);
  const drawHeaderRow = () => {
    const height = measureRow(headerCells, 'Helvetica-Bold', 8);
    const y = doc.y;
    doc.rect(MARGIN, y, tableWidth, height).fill(NAVY);
    drawCells(headerCells, y, height, { font: 'Helvetica-Bold', size: 8, color: '#ffffff' });
    doc.y = y + height;
  };

  drawTitle();
  drawHeaderRow();

  rows.forEach((row, idx) => {
    const cells = columns.map((col) => row[col.key]);
    const height = measureRow(cells, 'Helvetica', 8);

    if (doc.y + height > PAGE_HEIGHT - BOTTOM_MARGIN) {
      doc.addPage();
      doc.y = MARGIN;
      drawHeaderRow();
    }

    const y = doc.y;
    doc.rect(MARGIN, y, tableWidth, height).fill(idx % 2 === 0 ? '#ffffff' : '#f2f2f2');
    doc.strokeColor(BORDER).lineWidth(0.5).rect(MARGIN, y, tableWidth, height).stroke();

    // vertical separators
    let x = MARGIN;
    columns.forEach((col, colIdx) => {
      if (colIdx < columns.length - 1) {
        doc.moveTo(x + col.width, y).lineTo(x + col.width, y + height).stroke();
      }
      x += col.width;
    });

    drawCells(cells, y, height, { font: 'Helvetica', size: 8, color: '#000000' });
    doc.y = y + height;
  });

  doc.end();
}

module.exports = { exportListToPdf };
