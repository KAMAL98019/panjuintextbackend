const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.bill.update({
    where: { id: 26 },
    data: { billNumber: 'MEMO-DEMO-1' }
  });
  console.log('Updated ID 26 to MEMO-DEMO-1');

  await prisma.bill.update({
    where: { id: 27 },
    data: { billNumber: 'INV-DEMO-1' }
  });
  console.log('Updated ID 27 to INV-DEMO-1');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
