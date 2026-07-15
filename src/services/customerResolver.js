const customerRepository = require('../repositories/customer.repository');
const settingsRepository = require('../repositories/settings.repository');
const { generateCustomerCode } = require('./numberGenerator');

/**
 * Resolves the customer for a new quotation/bill: reuses an existing customerId, reuses an
 * existing customer matched by mobile number (repeat customer), or creates a brand-new customer
 * inline — so admins can capture a first-time walk-in's details directly on the form, matching
 * how the paper books work (name/phone/address written straight onto the document).
 */
async function resolveOrCreateCustomer({ customerId, customer }) {
  if (customerId) return Number(customerId);

  const existing = await customerRepository.findByMobile(customer.mobile);
  if (existing) return existing.id;

  const settings = await settingsRepository.get();
  const customerCode = await generateCustomerCode(settings?.customerPrefix || 'CUS');
  const created = await customerRepository.create({
    customerCode,
    name: customer.name,
    mobile: customer.mobile,
    altMobile: customer.altMobile || null,
    email: customer.email || null,
    address: customer.address,
    // City/state/pincode are optional on the forms; state defaults to the company's own state
    // so GST stays intra-state (CGST/SGST) unless explicitly told otherwise.
    city: customer.city || '',
    state: customer.state || settings?.state || 'Tamil Nadu',
    pincode: customer.pincode || '',
    gstNumber: customer.gstNumber || null,
    customerType: customer.customerType || 'Individual',
  });
  return created.id;
}

module.exports = { resolveOrCreateCustomer };
