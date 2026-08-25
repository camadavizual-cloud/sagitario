import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, createAdminToken, getAdminPassword, isAdminAuthorized, safeEqual } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const configured = Boolean(getAdminPassword());
  return NextResponse.json({ configured, authenticated: configured && await isAdminAuthorized() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const configuredPassword = getAdminPassword();
  if (!configuredPassword) return NextResponse.json({ message: "Cadastre ADMIN_PASSWORD nas variáveis da Hostinger." }, { status: 503 });
  const body = await request.json().catch(() => ({})) as { password?: string };
  if (!body.password || !safeEqual(body.password, configuredPassword)) {
    return NextResponse.json({ message: "Senha incorreta." }, { status: 401 });
  }
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE, createAdminToken(configuredPassword), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return NextResponse.json({ authenticated: true });
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_COOKIE);
  return NextResponse.json({ authenticated: false });
}
