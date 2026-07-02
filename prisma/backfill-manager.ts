import "dotenv/config";
import prisma from "../src/lib/prisma";

/**
 * One-time backfill: populate Vendor.managerId from existing UserVendor rows.
 * Idempotent - re-running only fills vendors that still have managerId === null.
 * For vendors with multiple UserVendor rows, picks the earliest by createdAt and logs a warning.
 */
async function main() {
  const vendors = await prisma.vendor.findMany({
    select: {
      id: true,
      name: true,
      managerId: true,
      users: {
        orderBy: { createdAt: "asc" },
        select: { userId: true, createdAt: true },
      },
    },
  });

  let updated = 0;
  let skippedAlreadySet = 0;
  let leftNull = 0;
  const multiManagerWarnings: { vendorId: string; vendorName: string; managerCount: number }[] = [];

  for (const vendor of vendors) {
    if (vendor.managerId) {
      skippedAlreadySet += 1;
      continue;
    }

    if (vendor.users.length === 0) {
      leftNull += 1;
      continue;
    }

    if (vendor.users.length > 1) {
      multiManagerWarnings.push({
        vendorId: vendor.id,
        vendorName: vendor.name,
        managerCount: vendor.users.length,
      });
    }

    const earliest = vendor.users[0];
    await prisma.vendor.update({
      where: { id: vendor.id },
      data: { managerId: earliest.userId },
    });
    updated += 1;
  }

  console.log("--- Backfill Summary ---");
  console.log(`Vendors with manager set: ${updated}`);
  console.log(`Vendors already had managerId set (skipped): ${skippedAlreadySet}`);
  console.log(`Vendors left with managerId = null (no UserVendor rows): ${leftNull}`);

  if (multiManagerWarnings.length > 0) {
    console.warn(`\nWARNING: ${multiManagerWarnings.length} vendor(s) had multiple UserVendor rows. Earliest manager was kept; review these manually:`);
    for (const w of multiManagerWarnings) {
      console.warn(`  - ${w.vendorName} (${w.vendorId}): ${w.managerCount} managers found`);
    }
  } else {
    console.log("No vendors had multiple managers.");
  }
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
