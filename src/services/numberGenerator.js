const prisma = require('../config/db');

const YEAR = () => new Date().getFullYear();

/**
 * Atomically increments a named counter and returns the next number.
 * Uses an upsert inside so first-use auto-creates the counter at 1.
 */
async function nextSequence(key) {
  const counter = await prisma.counter.upsert({
    where: { key },
    update: { nextNumber: { increment: 1 } },
    create: { key, nextNumber: 2 },
  });
  // On create, the row is inserted with nextNumber 2 and we hand out 1.
  // On update, prisma returns the row AFTER increment, so subtract 1 to get the issued number.
  return counter.nextNumber - 1;
}

function pad(num) {
  return String(num).padStart(4, '0');
}

// Plain running number like the physical pad ("QTN - 131"), no year, no zero padding.
async function generateQuotationNumber(prefix) {
  const seq = await nextSequence('quotation');
  return `${prefix}-${seq}`;
}

async function generateOrderNumber(prefix) {
  const seq = await nextSequence('order');
  return `${prefix}-${YEAR()}-${pad(seq)}`;
}

async function generateBillNumber(prefix, billType) {
  const key = billType === 'Memo' ? 'memo' : 'invoice';
  const seq = await nextSequence(key);
  return `${prefix}-${seq}`;
}

async function generateCustomerCode(prefix) {
  const seq = await nextSequence('customer');
  return `${prefix}-${pad(seq)}`;
}

module.exports = {
  generateQuotationNumber,
  generateOrderNumber,
  generateBillNumber,
  generateCustomerCode,
};
