const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const productRepository = require('../repositories/product.repository');

const list = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const { search, category, status } = req.query;

  const { rows, total } = await productRepository.list({
    search,
    category,
    status,
    skip: (page - 1) * limit,
    take: limit,
  });

  res.json({
    success: true,
    data: rows,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

const categoryCounts = asyncHandler(async (req, res) => {
  const counts = await productRepository.categoryCounts();
  res.json({ success: true, data: counts });
});

const getOne = asyncHandler(async (req, res) => {
  const product = await productRepository.findById(Number(req.params.id));
  if (!product) throw new ApiError(404, 'Product not found');
  res.json({ success: true, data: product });
});

const create = asyncHandler(async (req, res) => {
  const product = await productRepository.create(req.body);
  res.status(201).json({ success: true, data: product });
});

const update = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await productRepository.findById(id);
  if (!existing) throw new ApiError(404, 'Product not found');

  const product = await productRepository.update(id, req.body);
  res.json({ success: true, data: product });
});

const remove = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await productRepository.findById(id);
  if (!existing) throw new ApiError(404, 'Product not found');

  await productRepository.remove(id);
  res.json({ success: true, message: 'Product deleted' });
});

module.exports = { list, getOne, create, update, remove, categoryCounts };
