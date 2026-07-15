const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const updated = await prisma.counter.update({
    where: { key: 'memo' },
    data: { nextNumber: 10428 }
  });
  console.log('Updated Memo counter:', updated);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
