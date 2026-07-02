import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import prisma from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth-utils";
import { checkRateLimit, registerFailedAttempt, resetAttempts } from "@/lib/rate-limit";
import { headers } from "next/headers";

class CustomAuthError extends CredentialsSignin {
  code: string;
  constructor(code: string) {
    super();
    this.code = code;
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Şifre", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = credentials.email as string;
        const password = credentials.password as string;

        // Extract client IP address for rate-limiting using Next.js async headers API
        const clientHeaders = await headers();
        const ip = clientHeaders.get("x-forwarded-for")?.split(",")[0] || "127.0.0.1";
        const rateLimitKey = `${email}:${ip}`;

        // Verify if the user is rate-limited
        const limit = checkRateLimit(rateLimitKey);
        if (!limit.allowed) {
          throw new CustomAuthError("rate_limit_exceeded");
        }

        // Retrieve user from the database
        const user = await prisma.user.findUnique({
          where: { email },
        });

        // Fail if user does not exist or has no password hash
        if (!user || !user.passwordHash) {
          registerFailedAttempt(rateLimitKey);
          throw new CustomAuthError("invalid_credentials");
        }

        // Fail if the user is deactivated
        if (!user.isActive) {
          registerFailedAttempt(rateLimitKey);
          throw new CustomAuthError("user_inactive");
        }

        // Verify the provided password against the hash
        const isValid = await verifyPassword(password, user.passwordHash);
        if (!isValid) {
          registerFailedAttempt(rateLimitKey);
          throw new CustomAuthError("invalid_credentials");
        }

        // Successful authentication: Reset attempts and return user context
        resetAttempts(rateLimitKey);
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role;
        token.name = user.name;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.role = token.role as any;
        session.user.name = token.name as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
