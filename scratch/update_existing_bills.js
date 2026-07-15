const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const bills = await prisma.bill.findMany();
  console.log(`Found ${bills.length} bills.`);
  
  const updates = [];
  for (const bill of bills) {
    const original = bill.billNumber;
    // Format is like: PREFIX-YEAR-PADNUMBER or PREFIX-DEMO-PADNUMBER
    const parts = original.split('-');
    if (parts.length >= 3) {
      const prefix = parts[0]; // e.g. INV or MEMO
      const lastPart = parts[parts.length - 1]; // e.g. 0016
      const seq = parseInt(lastPart, 10);
      if (!isNaN(seq)) {
        const newNumber = `${prefix}-${seq}`;
        updates.push({ id: bill.id, original, newNumber });
      } else {
        console.log(`Could not parse sequence from: ${original}`);
      }
    } else {
      console.log(`Unrecognized format for bill number: ${original}`);
    }
  }

  console.log('Proposed updates (first 50):');
  console.log(updates.slice(0, 50));

  // Perform updates
  console.log(`Performing ${updates.length} updates...`);
  for (const update of updates) {
    try {
      await prisma.bill.update({
        where: { id: update.id },
        data: { billNumber: update.newNumber }
      });
      console.log(`Updated ID ${update.id}: ${update.original} -> ${update.newNumber}`);
    } catch (err) {
      console.error(`Failed to update ID ${update.id} (${update.original}): ${err.message}`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
