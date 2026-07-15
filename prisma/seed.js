require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const adminEmail = 'admin@panjuintext.com';
  const adminPassword = 'Admin@123';

  const existingAdmin = await prisma.admin.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    await prisma.admin.create({
      data: {
        email: adminEmail,
        passwordHash,
        name: 'Super Admin',
      },
    });
    console.log(`Seeded admin: ${adminEmail} / ${adminPassword}`);
  } else {
    console.log('Admin already exists, skipping.');
  }

  const existingSettings = await prisma.companySettings.findFirst();
  if (!existingSettings) {
    await prisma.companySettings.create({
      data: {
        name: 'Panju Intext',
        address: '3/28, Sabari Complex, Iyyer Line, Near SKC\'s Silks, Swarnapuri, Salem - 636004',
        gstin: '33BKGPS8143B1ZA',
        pan: 'BKGPS8143B',
        email: 'panjuintext@gmail.com',
        phone: '0427-2444366',
        state: 'Tamil Nadu',
        quotationPrefix: 'QT',
        orderPrefix: 'ORD',
        invoicePrefix: 'INV',
        memoPrefix: 'MEMO',
        customerPrefix: 'CUS',
      },
    });
    console.log('Seeded default company settings.');
  } else {
    console.log('Company settings already exist, skipping.');
  }

  const counterKeys = ['quotation', 'order', 'invoice', 'memo', 'customer'];
  for (const key of counterKeys) {
    await prisma.counter.upsert({
      where: { key },
      update: {},
      create: { key, nextNumber: 1 },
    });
  }
  console.log('Ensured counters exist.');

  await seedExampleOrder();
  await seedUnbilledOrder();
  await seedFreshTestOrder();
  await seedRevisedQuotation();
  await seedTwoPageQuotation();
}

/**
 * Seeds one fully-worked example: customer -> GST quotation (mixed 0%/5%/18% items, matching the
 * paper quotation book) -> confirmed order -> a Memo bill and a GST bill already generated on it.
 * Lets a fresh checkout be clicked into immediately to see the Memo/GST Bill pages with real data
 * instead of starting from an empty database. Idempotent — skipped if the demo customer exists.
 */
async function seedExampleOrder() {
  const demoMobile = '9000000001';
  const existing = await prisma.customer.findFirst({ where: { mobile: demoMobile } });
  if (existing) {
    console.log('Example order already seeded, skipping.');
    return;
  }

  const customer = await prisma.customer.create({
    data: {
      customerCode: 'CUS-DEMO',
      name: 'Example Customer',
      mobile: demoMobile,
      address: '12 Gandhi Street, Fairlands',
      city: 'Salem',
      state: 'Tamil Nadu',
      pincode: '636016',
      customerType: 'Individual',
    },
  });

  const items = [
    { description: 'Hall Zebra Blinds', hsnCode: '6303', quantity: 105.5, unit: 'sqft', unitPrice: 180, discountPercent: 0, gstPercent: 18, amount: 22408.2 },
    { description: 'Bed Room Zebra Blinds', hsnCode: '6303', quantity: 69.75, unit: 'sqft', unitPrice: 180, discountPercent: 0, gstPercent: 18, amount: 14814.9 },
    { description: 'Screen Cloth (Arch)', hsnCode: '6303', quantity: 21, unit: 'Mtrs', unitPrice: 285, discountPercent: 0, gstPercent: 5, amount: 6284.25 },
    { description: 'Stitching Part', hsnCode: null, quantity: 8, unit: 'part', unitPrice: 180, discountPercent: 0, gstPercent: 0, amount: 1440 },
    { description: 'Installation', hsnCode: '9954', quantity: 1, unit: 'job', unitPrice: 2600, discountPercent: 0, gstPercent: 0, amount: 2600 },
  ];
  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  const gstAmount = items.reduce((sum, i) => sum + i.quantity * i.unitPrice * (i.gstPercent / 100), 0);
  const cgst = gstAmount / 2;
  const sgst = gstAmount / 2;
  const total = Math.round((subtotal + gstAmount) * 100) / 100;

  const quotation = await prisma.quotation.create({
    data: {
      quotationNumber: 'QT-DEMO-0001',
      customerId: customer.id,
      status: 'Confirmed',
      quotationType: 'GST',
      subtotal: Math.round(subtotal * 100) / 100,
      discountAmount: 0,
      cgst: Math.round(cgst * 100) / 100,
      sgst: Math.round(sgst * 100) / 100,
      igst: 0,
      gstAmount: Math.round(gstAmount * 100) / 100,
      total,
      remarks: 'Quotation for Curtains & Mosquito net reg.',
      validityDays: 7,
      items: { create: items },
    },
  });

  const order = await prisma.order.create({
    data: {
      orderNumber: 'ORD-DEMO-0001',
      quotationId: quotation.id,
      assignedStaff: 'Venkatesh',
      currentStatus: 'AdvancePaid',
    },
  });

  const advance = Math.round(total * 0.5 * 100) / 100;
  await prisma.payment.create({
    data: { orderId: order.id, type: 'Advance', amount: advance, paymentMode: 'UPI', remarks: '50% advance on booking' },
  });

  await prisma.bill.create({
    data: {
      billNumber: 'MEMO-DEMO-0001',
      orderId: order.id,
      billType: 'Memo',
      snapshotJson: JSON.stringify({
        quotation: { quotationNumber: quotation.quotationNumber, quotationType: 'GST', subtotal: quotation.subtotal, discountAmount: 0, cgst: quotation.cgst, sgst: quotation.sgst, igst: 0, gstAmount: quotation.gstAmount, total, remarks: quotation.remarks, items },
        paymentInfo: { paid: advance, pending: Math.round((total - advance) * 100) / 100, status: 'Partially Paid' },
        customFields: { materialsDeliveryDate: null, jobExecutionPeriod: '15 working days', remarks: 'Deliver before month end' },
      }),
    },
  });

  await prisma.bill.create({
    data: {
      billNumber: 'INV-DEMO-0001',
      orderId: order.id,
      billType: 'GST',
      snapshotJson: JSON.stringify({
        quotation: { quotationNumber: quotation.quotationNumber, quotationType: 'GST', subtotal: quotation.subtotal, discountAmount: 0, cgst: quotation.cgst, sgst: quotation.sgst, igst: 0, gstAmount: quotation.gstAmount, total, remarks: quotation.remarks, items },
        paymentInfo: { paid: advance, pending: Math.round((total - advance) * 100) / 100, status: 'Partially Paid' },
        customFields: { placeOfSupply: 'Tamil Nadu', dateOfSupply: new Date().toISOString().slice(0, 10), dueDate: null, modeOfTransport: 'Own Vehicle', vehicleNo: '', transporterName: '' },
      }),
    },
  });

  console.log(`Seeded example: customer ${customer.customerCode}, quotation ${quotation.quotationNumber}, order ${order.orderNumber} (with Memo + GST bill already generated).`);
}

/**
 * Seeds a second example: customer -> GST quotation -> confirmed order, but with NO Memo or GST
 * bill generated yet. Lets the "Memo" / "GST Bill" buttons be clicked in their true first-time
 * state — a blank customization popup to fill in yourself, rather than one pre-filled from an
 * existing bill. Idempotent — skipped if the demo customer exists.
 */
async function seedUnbilledOrder() {
  const demoMobile = '9000000002';
  const existing = await prisma.customer.findFirst({ where: { mobile: demoMobile } });
  if (existing) {
    console.log('Unbilled example order already seeded, skipping.');
    return;
  }

  const customer = await prisma.customer.create({
    data: {
      customerCode: 'CUS-DEMO2',
      name: 'Fresh Order Customer',
      mobile: demoMobile,
      address: '45 Bazaar Street, Hasthampatti',
      city: 'Salem',
      state: 'Tamil Nadu',
      pincode: '636007',
      customerType: 'Individual',
    },
  });

  const items = [
    { description: 'Mosquito Net - Main Door', hsnCode: '5608', quantity: 24.5, unit: 'sqft', unitPrice: 350, discountPercent: 0, gstPercent: 18, amount: 10118.5 },
    { description: 'Mosquito Net - Window Frame', hsnCode: '5608', quantity: 14, unit: 'sqft', unitPrice: 230, discountPercent: 0, gstPercent: 18, amount: 3799.6 },
    { description: 'Installation', hsnCode: null, quantity: 1, unit: 'job', unitPrice: 1500, discountPercent: 0, gstPercent: 0, amount: 1500 },
  ];
  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  const gstAmount = items.reduce((sum, i) => sum + i.quantity * i.unitPrice * (i.gstPercent / 100), 0);
  const total = Math.round((subtotal + gstAmount) * 100) / 100;

  const quotation = await prisma.quotation.create({
    data: {
      quotationNumber: 'QT-DEMO-0002',
      customerId: customer.id,
      status: 'Confirmed',
      quotationType: 'GST',
      subtotal: Math.round(subtotal * 100) / 100,
      discountAmount: 0,
      cgst: Math.round((gstAmount / 2) * 100) / 100,
      sgst: Math.round((gstAmount / 2) * 100) / 100,
      igst: 0,
      gstAmount: Math.round(gstAmount * 100) / 100,
      total,
      remarks: 'Quotation for Mosquito Net reg.',
      validityDays: 7,
      items: { create: items },
    },
  });

  const order = await prisma.order.create({
    data: {
      orderNumber: 'ORD-DEMO-0002',
      quotationId: quotation.id,
      assignedStaff: 'Venkatesh',
      currentStatus: 'Confirmed',
    },
  });

  console.log(`Seeded example: customer ${customer.customerCode}, quotation ${quotation.quotationNumber}, order ${order.orderNumber} (confirmed, no bills generated yet).`);
}

/**
 * Seeds a third example, kept clean of any bills, specifically for manually testing the "fill in
 * the Memo/GST Bill form yourself" flow — the Memo/GST Bill customize popup opens with its item
 * list pre-loaded from this quotation's items, but nothing generated yet, so every field (including
 * adding/removing items from scratch) is yours to fill in and try. Idempotent — skipped if the demo
 * customer exists.
 */
async function seedFreshTestOrder() {
  const demoMobile = '9000000003';
  const existing = await prisma.customer.findFirst({ where: { mobile: demoMobile } });
  if (existing) {
    console.log('Fresh test order already seeded, skipping.');
    return;
  }

  const customer = await prisma.customer.create({
    data: {
      customerCode: 'CUS-DEMO3',
      name: 'Test Fill Customer',
      mobile: demoMobile,
      address: '7 Cherry Road, Suramangalam',
      city: 'Salem',
      state: 'Tamil Nadu',
      pincode: '636005',
      customerType: 'Individual',
    },
  });

  const items = [
    { description: 'Wallpaper - Living Room', hsnCode: '4814', quantity: 180, unit: 'sqft', unitPrice: 95, discountPercent: 0, gstPercent: 18, amount: 20178 },
    { description: 'Wallpaper Installation', hsnCode: null, quantity: 1, unit: 'job', unitPrice: 3000, discountPercent: 0, gstPercent: 0, amount: 3000 },
  ];
  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  const gstAmount = items.reduce((sum, i) => sum + i.quantity * i.unitPrice * (i.gstPercent / 100), 0);
  const total = Math.round((subtotal + gstAmount) * 100) / 100;

  const quotation = await prisma.quotation.create({
    data: {
      quotationNumber: 'QT-DEMO-0003',
      customerId: customer.id,
      status: 'Confirmed',
      quotationType: 'GST',
      subtotal: Math.round(subtotal * 100) / 100,
      discountAmount: 0,
      cgst: Math.round((gstAmount / 2) * 100) / 100,
      sgst: Math.round((gstAmount / 2) * 100) / 100,
      igst: 0,
      gstAmount: Math.round(gstAmount * 100) / 100,
      total,
      remarks: 'Quotation for Wallpaper reg.',
      validityDays: 7,
      items: { create: items },
    },
  });

  const order = await prisma.order.create({
    data: {
      orderNumber: 'ORD-DEMO-0003',
      quotationId: quotation.id,
      assignedStaff: 'Venkatesh',
      currentStatus: 'Confirmed',
    },
  });

  console.log(`Seeded example: customer ${customer.customerCode}, quotation ${quotation.quotationNumber}, order ${order.orderNumber} (confirmed, no bills — for you to fill in yourself).`);
}

/**
 * Seeds a quotation that's already been through two rounds of bargaining — matching the
 * "customer negotiates -> previous value ~1 lakh -> final amount ₹80,000" flow. Not confirmed yet,
 * so you can see Initial Price vs Final Price differ in the Quotations table, view the full
 * Negotiation / Bargaining History timeline on the detail page (both revisions kept, nothing
 * deleted), and then try Confirm Order yourself from there. Idempotent — skipped if the demo
 * customer exists.
 */
/**
 * Seeds a big whole-house quotation with 24 line items so the letterhead PDF overflows onto a
 * second page — for testing the multi-page flow (letterhead repeats, totals land on page 2).
 * Idempotent — skipped if the demo customer exists.
 */
async function seedTwoPageQuotation() {
  const demoMobile = '9000000005';
  const existing = await prisma.customer.findFirst({ where: { mobile: demoMobile } });
  if (existing) {
    console.log('Two-page quotation already seeded, skipping.');
    return;
  }

  const customer = await prisma.customer.create({
    data: {
      customerCode: 'CUS-DEMO5',
      name: 'Full House Project Customer',
      mobile: demoMobile,
      address: '42 Junction Main Road, Kondalampatti',
      city: 'Salem',
      state: 'Tamil Nadu',
      pincode: '636010',
      customerType: 'Individual',
    },
  });

  // 24 rooms/areas worth of work — enough rows to spill onto page 2 of the letterhead
  const catalogue = [
    ['Hall Zebra Blinds', 'sqft', 105.5, 180, 18],
    ['Bed Room 1 Zebra Blinds', 'sqft', 69.75, 180, 18],
    ['Bed Room 2 Roman Blinds Premium Blackout Fabric', 'sqft', 82, 210, 18],
    ['Kids Room Roller Blinds', 'sqft', 55, 165, 18],
    ['Screen Cloth (Arch)', 'Mtrs', 21, 285, 5],
    ['Balcony Mosquito Net (SS Frame)', 'sqft', 48, 240, 18],
    ['Kitchen Window Mosquito Net', 'sqft', 26, 220, 18],
    ['Main Door (small middle)', 'sqft', 24.5, 350, 18],
    ['Pooja Room Sliding Net Door', 'sqft', 18, 380, 18],
    ['M Track', 'Rft', 11, 230, 18],
    ['SS Sliding (outer channel)', 'sqft', 32, 480, 18],
    ['Window frame', 'sqft', 14, 230, 18],
    ['Living Room Wallpaper - Imported Texture', 'sqft', 190, 110, 18],
    ['Master Bedroom Wallpaper', 'sqft', 145, 95, 18],
    ['TV Unit Back Panel Wallpaper', 'sqft', 60, 130, 18],
    ['Staircase Wall Texture', 'sqft', 85, 90, 18],
    ['Hall Wooden Flooring - Laminate 8mm', 'sqft', 320, 145, 18],
    ['Bedroom Wooden Flooring - Laminate 8mm', 'sqft', 210, 145, 18],
    ['Flooring Underlay & Beading', 'sqft', 530, 18, 18],
    ['Curtain Rods - Antique Brass (Hall)', 'nos', 6, 850, 18],
    ['Curtain Rods - Standard (Bedrooms)', 'nos', 8, 550, 18],
    ['Curtain Fabric - Premium Jacquard', 'Mtrs', 46, 495, 5],
    ['Stitching part', 'part', 22, 180, 0],
    ['Installation', 'nos', 30, 200, 0],
  ];

  const items = catalogue.map(([description, unit, quantity, unitPrice, gstPercent]) => ({
    description,
    hsnCode: null,
    quantity,
    unit,
    unitPrice,
    discountPercent: 0,
    gstPercent,
    amount: Math.round(quantity * unitPrice * (1 + gstPercent / 100) * 100) / 100,
  }));

  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  const gstAmount = items.reduce((sum, i) => sum + i.quantity * i.unitPrice * (i.gstPercent / 100), 0);
  const total = Math.round((subtotal + gstAmount) * 100) / 100;

  const quotation = await prisma.quotation.create({
    data: {
      quotationNumber: 'QT-DEMO-0005',
      customerId: customer.id,
      status: 'Sent',
      quotationType: 'GST',
      subtotal: Math.round(subtotal * 100) / 100,
      discountAmount: 0,
      cgst: Math.round((gstAmount / 2) * 100) / 100,
      sgst: Math.round((gstAmount / 2) * 100) / 100,
      igst: 0,
      gstAmount: Math.round(gstAmount * 100) / 100,
      total,
      remarks: 'Quotation for Full House Interior Furnishing reg.',
      validityDays: 28,
      items: { create: items },
    },
  });

  console.log(`Seeded example: customer ${customer.customerCode}, quotation ${quotation.quotationNumber} (${items.length} items — quotation PDF spans two pages).`);
}

async function seedRevisedQuotation() {
  const demoMobile = '9000000004';
  const existing = await prisma.customer.findFirst({ where: { mobile: demoMobile } });
  if (existing) {
    console.log('Revised quotation example already seeded, skipping.');
    return;
  }

  const customer = await prisma.customer.create({
    data: {
      customerCode: 'CUS-DEMO4',
      name: 'Negotiated Deal Customer',
      mobile: demoMobile,
      address: '18 Trichy Road, Ammapet',
      city: 'Salem',
      state: 'Tamil Nadu',
      pincode: '636003',
      customerType: 'Individual',
    },
  });

  const items = [
    { description: 'Sofa Curtain Fabric - Premium', hsnCode: '6303', quantity: 40, unit: 'mtr', unitPrice: 2200, discountPercent: 0, gstPercent: 18, amount: 103840 },
  ];
  const subtotal = 88000; // 40 * 2200
  const gstAmount = 15840; // 18% of 88000
  const initialTotal = 103840; // subtotal + gstAmount, before any bargaining

  const quotation = await prisma.quotation.create({
    data: {
      quotationNumber: 'QT-DEMO-0004',
      customerId: customer.id,
      status: 'Revised',
      quotationType: 'GST',
      subtotal,
      discountAmount: 0,
      cgst: gstAmount / 2,
      sgst: gstAmount / 2,
      igst: 0,
      gstAmount,
      total: 80000, // final negotiated amount, after the two revisions below
      remarks: 'Quotation for Sofa Curtain Fabric reg.',
      validityDays: 7,
      items: { create: items },
      revisions: {
        create: [
          { previousAmount: initialTotal, newAmount: 92000, reason: 'Customer bargained for bulk discount', remarks: 'Requested 12% off the initial quote' },
          { previousAmount: 92000, newAmount: 80000, reason: 'Final negotiation to close the deal', remarks: 'Agreed after a site visit; customer ready to book' },
        ],
      },
    },
  });

  console.log(`Seeded example: customer ${customer.customerCode}, quotation ${quotation.quotationNumber} (revised twice: ${initialTotal} -> 92000 -> 80000, not yet confirmed).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
