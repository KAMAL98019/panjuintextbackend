const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const prisma = require('../config/db');
const settingsRepository = require('../repositories/settings.repository');

const get = asyncHandler(async (req, res) => {
  const settings = await settingsRepository.get();
  const counter = await prisma.counter.findUnique({ where: { key: 'quotation' } });
  res.json({ success: true, data: { ...settings, nextQuotationNumber: counter?.nextNumber ?? 1 } });
});

// Bank details are intentionally never accepted here — they print on documents but are
// not stored/editable in Settings.
const update = asyncHandler(async (req, res) => {
  const {
    name, address, gstin, pan, email, phone, state, ownerWhatsapp,
    quotationPrefix, orderPrefix, invoicePrefix, memoPrefix, customerPrefix,
    nextQuotationNumber,
  } = req.body;

  const data = {
    name, address, gstin, pan, email, phone, state, ownerWhatsapp,
    quotationPrefix, orderPrefix, invoicePrefix, memoPrefix, customerPrefix,
  };

  if (req.file) {
    data.logoUrl = `/uploads/${req.file.filename}`;
  }

  // The admin chooses where quotation numbering starts/continues (e.g. 131 → QTN-131).
  if (nextQuotationNumber !== undefined && nextQuotationNumber !== '') {
    const next = Number(nextQuotationNumber);
    if (!Number.isInteger(next) || next < 1) throw new ApiError(422, 'Next quotation number must be a positive whole number');
    await prisma.counter.upsert({
      where: { key: 'quotation' },
      update: { nextNumber: next },
      create: { key: 'quotation', nextNumber: next },
    });
  }

  const settings = await settingsRepository.update(data);
  const counter = await prisma.counter.findUnique({ where: { key: 'quotation' } });
  res.json({ success: true, data: { ...settings, nextQuotationNumber: counter?.nextNumber ?? 1 } });
});

module.exports = { get, update };
