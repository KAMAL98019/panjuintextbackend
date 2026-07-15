const prisma = require('../config/db');

function findByEmail(email) {
  return prisma.admin.findUnique({ where: { email } });
}

function findById(id) {
  return prisma.admin.findUnique({ where: { id } });
}

function updatePassword(id, passwordHash) {
  return prisma.admin.update({ where: { id }, data: { passwordHash } });
}

module.exports = { findByEmail, findById, updatePassword };
