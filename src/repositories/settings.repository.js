const prisma = require('../config/db');

async function get() {
  const settings = await prisma.companySettings.findFirst();
  return settings;
}

async function update(data) {
  const existing = await prisma.companySettings.findFirst();
  if (!existing) {
    return prisma.companySettings.create({ data });
  }
  return prisma.companySettings.update({ where: { id: existing.id }, data });
}

module.exports = { get, update };
