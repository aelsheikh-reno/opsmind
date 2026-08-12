import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const user = await prisma.user.findUnique({
          where: { email: String(credentials.email) },
        });
        if (!user) return null;
        if (!user.isActive) return null;
        const valid = await bcrypt.compare(String(credentials.password), user.passwordHash);
        if (!valid) return null;
        prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => {});
        return { id: user.id, email: user.email, name: user.name, role: user.role, permissions: user.permissions };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.name = user.name;
        token.role = (user as { role: string }).role;
        token.permissions = (user as { permissions: string | null }).permissions ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id          = token.id   as string;
      session.user.name        = token.name as string;
      session.user.role        = token.role as string;
      session.user.permissions = (token.permissions ?? null) as string | null;
      session.user.isActive    = true;
      // Pull fresh role, permissions, and isActive from DB so changes take effect without re-login
      if (token.id) {
        try {
          const fresh = await prisma.user.findUnique({
            where:  { id: token.id as string },
            select: { role: true, permissions: true, isActive: true },
          });
          if (fresh) {
            session.user.role        = fresh.role;
            session.user.permissions = fresh.permissions;
            session.user.isActive    = fresh.isActive;
          }
        } catch { /* DB unavailable — fall back to token values already set above */ }
      }
      return session;
    },
  },
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
});
