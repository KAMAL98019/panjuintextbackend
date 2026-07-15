const prisma = require('../config/db');

function listTemplates(purpose) {
  return prisma.messageTemplate.findMany({ where: { purpose }, orderBy: { createdAt: 'desc' } });
}

function createTemplate({ purpose, name, body, isDefault }) {
  return prisma.messageTemplate.create({ data: { purpose, name, body, isDefault: !!isDefault } });
}

function updateTemplate(id, { name, body, isDefault }) {
  return prisma.messageTemplate.update({ where: { id }, data: { name, body, isDefault } });
}

function removeTemplate(id) {
  return prisma.messageTemplate.delete({ where: { id } });
}

function logMessage({ purpose, quotationId, customerId, toNumber, documentType, status, error }) {
  return prisma.messageLog.create({
    data: { purpose, quotationId, customerId, toNumber, documentType, status, error },
  });
}

function listLogs({ purpose, since, take = 100 }) {
  return prisma.messageLog.findMany({
    where: { purpose, ...(since ? { createdAt: { gte: new Date(since) } } : {}) },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

module.exports = { listTemplates, createTemplate, updateTemplate, removeTemplate, logMessage, listLogs };
