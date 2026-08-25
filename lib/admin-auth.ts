import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "sagitario_admin";

const cleanEnv = (input?: string) => input?.trim().replace(/^(["'])(.*)\1$/, "$2").trim();

export function getAdminPassword() {
  return cleanEnv(process.env.ADMIN_PASSWORD);
}

export function createAdminToken(password: string) {
  return createHmac("sha256", password).update("sagitario-admin-session-v1").digest("base64url");
}

export function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export async function isAdminAuthorized() {
  const password = getAdminPassword();
  if (!password) return false;
  const cookieStore = await cookies();
  const session = cookieStore.get(ADMIN_COOKIE)?.value || "";
  return safeEqual(session, createAdminToken(password));
}
