import prisma from "../src/lib/prisma";
import { hashPassword } from "../src/lib/auth-utils";
import { getFiscalContext } from "../src/lib/fiscal";
import { ensureFiscalPeriod } from "../src/lib/fiscal-db";

async function main() {
  // 1. Seed Initial User
  const email = "admin@sales.local";
  const hashedPassword = await hashPassword("Admin123!");

  const adminUser = await prisma.user.upsert({
    where: { email },
    update: {
      name: "System Director",
      passwordHash: hashedPassword,
      role: "DIREKTOR",
      isActive: true,
    },
    create: {
      email,
      name: "System Director",
      passwordHash: hashedPassword,
      role: "DIREKTOR",
      isActive: true,
    },
  });

  console.log(`Seed user created/updated: ${adminUser.email} (${adminUser.role})`);

  // 2. Seed Fiscal Periods (Previous and Current Fiscal Years, Quarters 1-4)
  const currentYear = getFiscalContext(new Date()).fiscalYear;
  const targetYears = [currentYear - 1, currentYear];
  const quarters = [1, 2, 3, 4];

  console.log("Seeding fiscal periods...");
  for (const year of targetYears) {
    for (const q of quarters) {
      const period = await ensureFiscalPeriod(year, q);
      console.log(
        `- Fiscal Period ensured: FY${period.fiscalYear} - Q${period.quarter} (${period.startDate.toLocaleDateString(
          "tr-TR"
        )} - ${period.endDate.toLocaleDateString("tr-TR")})`
      );
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
