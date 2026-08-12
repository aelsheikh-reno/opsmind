import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient({ datasources: { db: { url: "file:./prisma/dev.db" } } });

async function main() {
  const email    = process.argv[2] || "admin@opsmind.local";
  const password = process.argv[3] || "changeme123";
  const name     = process.argv[4] || "Admin";

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`User ${email} already exists (role: ${existing.role}).`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { email, name, passwordHash, role: "admin", isActive: true },
  });
  console.log(`Created admin user: ${user.email} (id: ${user.id})`);
  console.log(`Password: ${password}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
