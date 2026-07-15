const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const adminRepository = require('../repositories/admin.repository');

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const admin = await adminRepository.findByEmail(email);
  if (!admin) {
    throw new ApiError(401, 'Invalid email or password');
  }

  const isMatch = await bcrypt.compare(password, admin.passwordHash);
  if (!isMatch) {
    throw new ApiError(401, 'Invalid email or password');
  }

  const token = jwt.sign(
    { id: admin.id, email: admin.email, name: admin.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  res.json({
    success: true,
    data: {
      token,
      admin: { id: admin.id, email: admin.email, name: admin.name },
    },
  });
});

const me = asyncHandler(async (req, res) => {
  const admin = await adminRepository.findById(req.admin.id);
  if (!admin) throw new ApiError(404, 'Admin not found');
  res.json({ success: true, data: { id: admin.id, email: admin.email, name: admin.name } });
});

const resetPassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const admin = await adminRepository.findById(req.admin.id);
  if (!admin) throw new ApiError(404, 'Admin not found');

  const isMatch = await bcrypt.compare(currentPassword, admin.passwordHash);
  if (!isMatch) throw new ApiError(400, 'Current password is incorrect');

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await adminRepository.updatePassword(admin.id, passwordHash);

  res.json({ success: true, message: 'Password updated successfully' });
});

module.exports = { login, me, resetPassword };
