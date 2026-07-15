const asyncHandler = require('../utils/asyncHandler');
const notificationRepository = require('../repositories/notification.repository');

const list = asyncHandler(async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const { rows, total, unreadCount } = await notificationRepository.list({ skip: (page - 1) * limit, take: limit });
  res.json({ success: true, data: rows, unreadCount, pagination: { page, limit, total } });
});

const markRead = asyncHandler(async (req, res) => {
  const notification = await notificationRepository.markRead(Number(req.params.id));
  res.json({ success: true, data: notification });
});

const markAllRead = asyncHandler(async (req, res) => {
  await notificationRepository.markAllRead();
  res.json({ success: true });
});

module.exports = { list, markRead, markAllRead };
