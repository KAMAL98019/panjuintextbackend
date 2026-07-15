const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const prisma = require('../config/db');
const whatsappService = require('../services/whatsappService');
const whatsappRepository = require('../repositories/whatsapp.repository');
const settingsRepository = require('../repositories/settings.repository');
const quotationRepository = require('../repositories/quotation.repository');
const billController = require('./bill.controller');

const PURPOSES = ['CustomerDocs', 'Greetings'];

function validatePurpose(purpose) {
  if (!PURPOSES.includes(purpose)) throw new ApiError(400, 'Invalid WhatsApp purpose');
}

const getStatus = asyncHandler(async (req, res) => {
  validatePurpose(req.params.purpose);
  const status = await whatsappService.getStatus(req.params.purpose);
  res.json({ success: true, data: status });
});

/** Starts the login flow — a QR code will show up on the next status poll once WhatsApp emits it. */
const connect = asyncHandler(async (req, res) => {
  validatePurpose(req.params.purpose);
  whatsappService.ensureClient(req.params.purpose);
  res.json({ success: true, message: 'Session starting — poll status for the QR code' });
});

const logout = asyncHandler(async (req, res) => {
  validatePurpose(req.params.purpose);
  await whatsappService.logout(req.params.purpose);
  res.json({ success: true });
});

/** Tears the session's browser down and starts fresh — produces a brand-new QR. */
const refreshQr = asyncHandler(async (req, res) => {
  validatePurpose(req.params.purpose);
  await whatsappService.refreshQR(req.params.purpose);
  res.json({ success: true, message: 'Restarting session — a fresh QR will appear shortly' });
});

const listTemplates = asyncHandler(async (req, res) => {
  validatePurpose(req.params.purpose);
  const templates = await whatsappRepository.listTemplates(req.params.purpose);
  res.json({ success: true, data: templates });
});

const createTemplate = asyncHandler(async (req, res) => {
  validatePurpose(req.params.purpose);
  const { name, body, isDefault } = req.body;
  if (!name || !body) throw new ApiError(422, 'Template name and body are required');
  const template = await whatsappRepository.createTemplate({ purpose: req.params.purpose, name, body, isDefault });
  res.status(201).json({ success: true, data: template });
});

const updateTemplate = asyncHandler(async (req, res) => {
  const { name, body, isDefault } = req.body;
  const template = await whatsappRepository.updateTemplate(Number(req.params.id), { name, body, isDefault });
  res.json({ success: true, data: template });
});

const removeTemplate = asyncHandler(async (req, res) => {
  await whatsappRepository.removeTemplate(Number(req.params.id));
  res.json({ success: true });
});

const listLogs = asyncHandler(async (req, res) => {
  validatePurpose(req.params.purpose);
  const logs = await whatsappRepository.listLogs({ purpose: req.params.purpose, since: req.query.since });
  res.json({ success: true, data: logs });
});

function fillTemplate(body, vars) {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

/** Sends a quotation/Memo/GST bill PDF to the owner and/or the customer over WhatsApp. */
const sendDocument = asyncHandler(async (req, res) => {
  const { quotationId, documentType, billId, sendToOwner, sendToCustomer, extraNumbers, message } = req.body;
  if (!quotationId && !billId) throw new ApiError(422, 'Either quotationId or billId is required');
  if (!documentType) throw new ApiError(422, 'documentType is required');

  let quotation = null;
  let customer = null;
  let docNumber = '';

  if (billId) {
    const billRepository = require('../repositories/bill.repository');
    const bill = await billRepository.findById(Number(billId));
    if (!bill) throw new ApiError(404, 'Bill not found');
    customer = bill.customer;
    docNumber = bill.billNumber;
    if (bill.order?.quotation) {
      quotation = bill.order.quotation;
    }
  }

  if (quotationId && !quotation) {
    quotation = await quotationRepository.findById(Number(quotationId));
    if (!quotation) throw new ApiError(404, 'Quotation not found');
    customer = quotation.customer;
    docNumber = quotation.quotationNumber;
  }

  if (!customer) throw new ApiError(404, 'Customer not found');

  const settings = await settingsRepository.get();
  const { buffer, filename } = await billController.renderDocumentBuffer({ documentType, quotation, billId });

  const caption = message || `${documentType} for ${customer.name} — ${docNumber}`;
  const targets = [];
  if (sendToOwner) {
    if (!settings?.ownerWhatsapp) {
      throw new ApiError(422, "Set the Owner WhatsApp Number in Settings first — that's where documents get sent");
    }
    targets.push({ number: settings.ownerWhatsapp, label: 'owner' });
  }
  if (sendToCustomer && customer.mobile) targets.push({ number: customer.mobile, label: 'customer' });
  // Any extra numbers the admin typed/saved on the share dialog
  (Array.isArray(extraNumbers) ? extraNumbers : []).forEach((num) => {
    const digits = String(num).replace(/\D/g, '');
    if (digits.length >= 10) targets.push({ number: digits, label: digits });
  });
  if (targets.length === 0) throw new ApiError(422, 'Select at least one recipient');

  const results = [];
  for (const target of targets) {
    try {
      await whatsappService.sendDocument('CustomerDocs', target.number, buffer, filename, caption);
      await whatsappRepository.logMessage({
        purpose: 'CustomerDocs',
        quotationId: quotation ? quotation.id : null,
        customerId: customer.id,
        toNumber: target.number,
        documentType,
        status: 'Sent',
      });
      results.push({ ...target, status: 'Sent' });
    } catch (err) {
      await whatsappRepository.logMessage({
        purpose: 'CustomerDocs',
        quotationId: quotation ? quotation.id : null,
        customerId: customer.id,
        toNumber: target.number,
        documentType,
        status: 'Failed',
        error: err.message,
      });
      results.push({ ...target, status: 'Failed', error: err.message });
    }
  }

  res.json({ success: true, data: results });
});

/**
 * Broadcasts a festival-greeting template to a set of customers. Runs sequentially with a delay
 * between sends (rather than firing all at once) to keep the sending pattern closer to organic
 * usage — WhatsApp Web automation carries an inherent ban/rate-limit risk for bulk sends, and this
 * throttling only reduces (never eliminates) it. The request returns immediately with the target
 * count; progress is visible via GET /:purpose/logs.
 */
const broadcastGreeting = asyncHandler(async (req, res) => {
  const { message, customerIds, delayMs = 6000 } = req.body;
  if (!message) throw new ApiError(422, 'message is required');

  const customers = await prisma.customer.findMany({
    where: Array.isArray(customerIds) && customerIds.length > 0 ? { id: { in: customerIds.map(Number) } } : undefined,
  });
  if (customers.length === 0) throw new ApiError(422, 'No customers to send to');

  // Push all to the database queue in batches of 5 with a cooldown!
  const now = new Date();
  const batchSize = 5;
  const intraBatchDelay = 2000; // 2 seconds delay between sends in a batch
  const batchCooldown = 30000;  // 30 seconds cooldown between batches of 5

  const queueItems = customers.map((customer, index) => {
    const text = fillTemplate(message, { customerName: customer.name });
    const batchNumber = Math.floor(index / batchSize);
    const indexWithinBatch = index % batchSize;
    const delayOffset = (batchNumber * batchCooldown) + (indexWithinBatch * intraBatchDelay);

    return {
      purpose: 'Greetings',
      toNumber: customer.mobile,
      message: text,
      customerId: customer.id,
      status: 'Pending',
      scheduledAt: new Date(now.getTime() + delayOffset)
    };
  });

  await prisma.whatsappQueueItem.createMany({
    data: queueItems
  });

  res.json({
    success: true,
    message: `Broadcast queued for ${customers.length} customers. Messages will send sequentially in the background.`,
    total: customers.length
  });
});

module.exports = {
  getStatus, connect, logout, refreshQr,
  listTemplates, createTemplate, updateTemplate, removeTemplate,
  listLogs, sendDocument, broadcastGreeting,
};
