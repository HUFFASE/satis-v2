import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prismaClientSingleton = () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
};

declare const globalThis: {
  prismaGlobal: ReturnType<typeof prismaClientSingleton> | undefined;
} & typeof global;

let prisma = globalThis.prismaGlobal ?? prismaClientSingleton();

// Ensure hot-reloaded dev client includes all generated model delegates
if (prisma && !("salesManagerScorecard" in prisma)) {
  prisma = prismaClientSingleton();
}

export default prisma;

if (process.env.NODE_ENV !== "production") globalThis.prismaGlobal = prisma;
