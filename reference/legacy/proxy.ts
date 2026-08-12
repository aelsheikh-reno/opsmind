import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify, importSPKI } from "jose";
import type { KeyLike } from "jose";

// ── License check ─────────────────────────────────────────────────────────────

let _cachedLicenseKey: KeyLike | null = null;

async function getLicensePublicKey(): Promise<KeyLike | null> {
  if (_cachedLicenseKey) return _cachedLicenseKey;
  const raw = process.env.LICENSE_PUBLIC_KEY;
  if (!raw) return null;
  try {
    _cachedLicenseKey = await importSPKI(raw.replace(/\\n/g, "\n"), "RS256");
    return _cachedLicenseKey;
  } catch {
    return null;
  }
}

async function checkLicense(request: NextRequest): Promise<NextResponse | null> {
  // In dev, skip unless LICENSE_FORCE_CHECK=true (for local testing)
  const forceCheck = process.env.LICENSE_FORCE_CHECK === "true";
  if (process.env.NODE_ENV === "development" && !forceCheck) return null;

  const licenseKey = process.env.LICENSE_KEY;
  if (!licenseKey) return NextResponse.redirect(new URL("/suspended", request.url));

  const publicKey = await getLicensePublicKey();
  if (!publicKey) return NextResponse.redirect(new URL("/suspended", request.url));

  try {
    await jwtVerify(licenseKey, publicKey);
    return null; // valid
  } catch {
    return NextResponse.redirect(new URL("/suspended", request.url));
  }
}

// ── Proxy ─────────────────────────────────────────────────────────────────────

const WIZARD_BYPASS = ["/onboarding", "/api"];
const PUBLIC_PATHS  = ["/claim", "/api/claim", "/suspended"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  // License gate — runs before auth so expired license blocks everything
  const licenseBlock = await checkLicense(request);
  if (licenseBlock) return licenseBlock;

  const session = await auth();

  if (!session) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Session callback does a live DB lookup — isActive reflects current DB state
  if (session.user?.isActive === false) {
    const loginUrl = new URL("/login", request.url);
    const res = NextResponse.redirect(loginUrl);
    res.cookies.delete("authjs.session-token");
    res.cookies.delete("__Secure-authjs.session-token");
    return res;
  }

  const role = session.user.role;

  if (pathname.startsWith("/team") && role !== "admin") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (pathname.startsWith("/settings") && role !== "admin") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Wizard check — fast path via cookie, DB fallback
  if (!WIZARD_BYPASS.some((p) => pathname.startsWith(p))) {
    if (request.cookies.get("opsmind_setup")?.value !== "1") {
      const setting = await prisma.setting.findUnique({ where: { key: "wizardCompleted" } });
      if (setting?.value !== "true") {
        return NextResponse.redirect(new URL("/onboarding", request.url));
      }
      // Wizard done but cookie was cleared — restore it
      const response = NextResponse.next();
      response.cookies.set("opsmind_setup", "1", {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
      return response;
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/auth|api/cron|api/inbound-email|api/webhooks|_next/static|_next/image|favicon\\.ico|login).*)"],
};
