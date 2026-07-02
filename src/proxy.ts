import { auth } from "@/auth";
import { NextResponse } from "next/server";

export const proxy = auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;
  const userRole = req.auth?.user?.role;

  const isLoginPage = nextUrl.pathname === "/login";
  const isApiAuthRoute = nextUrl.pathname.startsWith("/api/auth");
  const isAdminRoute = nextUrl.pathname.startsWith("/admin");

  // 1. Always allow NextAuth API endpoints
  if (isApiAuthRoute) {
    return NextResponse.next();
  }

  // 2. Redirect logged-in users away from /login to /dashboard
  if (isLoginPage) {
    if (isLoggedIn) {
      return NextResponse.redirect(new URL("/dashboard", nextUrl));
    }
    return NextResponse.next();
  }

  // 3. Enforce general login checks on protected routes
  if (!isLoggedIn) {
    let callbackUrl = nextUrl.pathname;
    if (nextUrl.search) {
      callbackUrl += nextUrl.search;
    }
    const encodedCallbackUrl = encodeURIComponent(callbackUrl);
    
    return NextResponse.redirect(
      new URL(`/login?callbackUrl=${encodedCallbackUrl}`, nextUrl)
    );
  }

  // 4. Role-based Guard: Only DIREKTOR is allowed to access routes under /admin/*
  if (isAdminRoute && userRole !== "DIREKTOR") {
    return NextResponse.redirect(new URL("/dashboard", nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  // Protect all paths except NextAuth API, Next.js static compiler assets, and favicon
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
