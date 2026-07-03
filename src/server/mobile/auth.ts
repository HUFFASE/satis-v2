import { createHmac, timingSafeEqual } from "crypto";
import type { Role } from "@prisma/client";
import prisma from "@/lib/prisma";

interface MobileTokenPayload {
  sub: string;
  email: string;
  name: string;
  role: Role;
  iat: number;
  exp: number;
}

export interface MobileSessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

const TOKEN_TTL_SECONDS = 60 * 60 * 12;

function getMobileTokenSecret() {
  const secret = process.env.MOBILE_API_JWT_SECRET ?? process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("Mobil API token secret tanımlı değil.");
  }
  return secret;
}

function base64UrlEncode(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlJson(value: unknown) {
  return base64UrlEncode(JSON.stringify(value));
}

function signTokenPart(data: string, secret: string) {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function createMobileToken(user: MobileSessionUser) {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "HS256",
    typ: "JWT",
  };
  const payload: MobileTokenPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };
  const encodedHeader = base64UrlJson(header);
  const encodedPayload = base64UrlJson(payload);
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const signature = signTokenPart(unsignedToken, getMobileTokenSecret());

  return {
    token: `${unsignedToken}.${signature}`,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    tokenType: "Bearer" as const,
  };
}

function parseMobileToken(token: string): MobileTokenPayload {
  const [encodedHeader, encodedPayload, signature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !signature) {
    throw new Error("Geçersiz token.");
  }

  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = signTokenPart(unsignedToken, getMobileTokenSecret());
  const signatureBuffer = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !== expectedSignatureBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedSignatureBuffer)
  ) {
    throw new Error("Token imzası geçersiz.");
  }

  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as MobileTokenPayload;
  if (!payload.sub || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Token süresi dolmuş veya geçersiz.");
  }

  return payload;
}

export async function authenticateMobileRequest(request: Request): Promise<MobileSessionUser> {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new Error("Mobil API için Bearer token gerekli.");
  }

  const payload = parseMobileToken(match[1]);
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
    },
  });

  if (!user || !user.isActive) {
    throw new Error("Kullanıcı aktif değil veya bulunamadı.");
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}
