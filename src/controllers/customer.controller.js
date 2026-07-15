const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const customerRepository = require('../repositories/customer.repository');
const settingsRepository = require('../repositories/settings.repository');
const { generateCustomerCode } = require('../services/numberGenerator');
const { exportToExcel } = require('../services/excelExporter');

const list = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const { search } = req.query;

  const { rows, total } = await customerRepository.list({
    search,
    skip: (page - 1) * limit,
    take: limit,
  });

  res.json({
    success: true,
    data: rows,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

const getOne = asyncHandler(async (req, res) => {
  const customer = await customerRepository.findById(Number(req.params.id));
  if (!customer) throw new ApiError(404, 'Customer not found');
  res.json({ success: true, data: customer });
});

const create = asyncHandler(async (req, res) => {
  const settings = await settingsRepository.get();
  const customerCode = await generateCustomerCode(settings?.customerPrefix || 'CUS');

  const customer = await customerRepository.create({
    ...req.body,
    customerCode,
    city: req.body.city || '',
    state: req.body.state || '',
    pincode: req.body.pincode || '',
  });
  res.status(201).json({ success: true, data: customer });
});

const update = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await customerRepository.findById(id);
  if (!existing) throw new ApiError(404, 'Customer not found');

  const { name, mobile, altMobile, email, address, city, state, pincode, gstNumber, customerType } = req.body;

  const customer = await customerRepository.update(id, {
    name,
    mobile,
    altMobile: altMobile || null,
    email: email || null,
    address,
    city: city || '',
    state: state || '',
    pincode: pincode || '',
    gstNumber: gstNumber || null,
    customerType,
  });
  res.json({ success: true, data: customer });
});

const remove = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await customerRepository.findById(id);
  if (!existing) throw new ApiError(404, 'Customer not found');

  await customerRepository.remove(id);
  res.json({ success: true, message: 'Customer deleted' });
});

const exportExcel = asyncHandler(async (req, res) => {
  const { search } = req.query;
  const { rows } = await customerRepository.list({ search, skip: 0, take: 100000 });

  await exportToExcel(res, {
    filename: 'customers.xlsx',
    sheetName: 'Customers',
    columns: [
      { header: 'Customer Code', key: 'customerCode', width: 16 },
      { header: 'Name', key: 'name', width: 24 },
      { header: 'Mobile', key: 'mobile', width: 16 },
      { header: 'Email', key: 'email', width: 24 },
      { header: 'City', key: 'city', width: 16 },
      { header: 'State', key: 'state', width: 16 },
      { header: 'GST Number', key: 'gstNumber', width: 20 },
      { header: 'Type', key: 'customerType', width: 14 },
      { header: 'Quotations', key: 'quotationCount', width: 12 },
    ],
    rows: rows.map((c) => ({ ...c, quotationCount: c._count?.quotations || 0 })),
  });
});

module.exports = { list, getOne, create, update, remove, exportExcel };
