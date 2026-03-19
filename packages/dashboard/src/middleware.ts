import { auth } from "./lib/auth";
import { NextResponse } from "next/server";

const publicRoutes = ["/signin", "/api/auth"];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Allow public routes
  if (publicRoutes.some((r) => pathname.startsWith(r))) {
    return NextResponse.next();
  }

  // Allow static assets
  if (pathname.startsWith("/_next") || pathname === "/favicon.ico" || pathname.endsWith(".svg") || pathname.endsWith(".png") || pathname.endsWith(".ico")) {
    return NextResponse.next();
  }

  // Redirect unauthenticated users to sign-in
  if (!req.auth) {
    const signInUrl = new URL("/signin", req.nextUrl.origin);
    signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }

  // Allow the onboarding route, email-action API, and templates route through
  if (pathname.startsWith("/onboarding") || pathname.startsWith("/api/email-action") || pathname.startsWith("/templates")) {
    return NextResponse.next();
  }

  // Redirect users who need onboarding to the onboarding flow
  const session = req.auth as { needsOnboarding?: boolean; apiKey?: string };
  if (session.needsOnboarding && pathname !== "/onboarding") {
    return NextResponse.redirect(new URL("/onboarding", req.nextUrl.origin));
  }

  // If user is authenticated but has no API key (provision failed),
  // redirect to onboarding so they can retry — not to a broken dashboard
  if (!session.apiKey && pathname !== "/onboarding") {
    return NextResponse.redirect(new URL("/onboarding", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
