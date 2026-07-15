const prisma = require('../config/db');

function create({ type, title, message, quotationId }) {
  return prisma.notification.create({ data: { type, title, message, quotationId } });
}

async function list({ skip = 0, take = 20 }) {
  const [rows, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({ orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.notification.count(),
    prisma.notification.count({ where: { isRead: false } }),
  ]);
  return { rows, total, unreadCount };
}

function markRead(id) {
  return prisma.notification.update({ where: { id }, data: { isRead: true } });
}

function markAllRead() {
  return prisma.notification.updateMany({ where: { isRead: false }, data: { isRead: true } });
}

module.exports = { create, list, markRead, markAllRead };
