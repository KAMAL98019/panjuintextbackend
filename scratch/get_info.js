const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const counters = await prisma.counter.findMany();
  console.log('Counters:', counters);
  const bills = await prisma.bill.findMany({
    take: 10,
    orderBy: { id: 'desc' }
  });
  console.log('Recent Bills:', bills.map(b => ({
    id: b.id,
    billNumber: b.billNumber,
    billType: b.billType,
    createdAt: b.createdAt
  })));
  
  const quotations = await prisma.quotation.findMany({
    take: 5,
    orderBy: { id: 'desc' }
  });
  console.log('Recent Quotations:', quotations.map(q => ({
    id: q.id,
    quotationNumber: q.quotationNumber
  })));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
