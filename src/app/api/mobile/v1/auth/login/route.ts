import { NextRequest } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth-utils";
import { checkRateLimit, registerFailedAttempt, resetAttempts } from "@/lib/rate-limit";
import { createMobileToken } from "@/server/mobile/auth";
import { getErrorMessage, mobileError, mobileOk } from "@/server/mobile/responses";

const loginSchema = z.object({
  email: z.string().email("Geçerli bir email adresi giriniz."),
  password: z.string().min(1, "Şifre boş olamaz."),
});

function getClientIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0] ?? request.headers.get("x-real-ip") ?? "127.0.0.1";
}

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return mobileError("Geçerli bir JSON gövdesi gönderiniz.", 400, "invalid_json");
  }

  const validation = loginSchema.safeParse(body);
  if (!validation.success) {
    return mobileError(validation.error.issues[0].message, 400, "validation_error");
  }

  const { email, password } = validation.data;
  const rateLimitKey = `${email}:${getClientIp(request)}`;
  const limit = checkRateLimit(rateLimitKey);

  if (!limit.allowed) {
    return mobileError("Çok fazla hatalı giriş denemesi yapıldı. Lütfen daha sonra tekrar deneyin.", 429, "rate_limited");
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        passwordHash: true,
        isActive: true,
      },
    });

    if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      registerFailedAttempt(rateLimitKey);
      return mobileError("Email veya şifre hatalı.", 401, "invalid_credentials");
    }

    if (!user.isActive) {
      registerFailedAttempt(rateLimitKey);
      return mobileError("Kullanıcı aktif değil.", 403, "user_inactive");
    }

    resetAttempts(rateLimitKey);
    const token = createMobileToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });

    return mobileOk({
      ...token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error: unknown) {
    return mobileError(getErrorMessage(error, "Mobil giriş sırasında hata oluştu."), 500, "login_failed");
  }
}
