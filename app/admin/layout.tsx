import type { ReactNode } from "react";

// Keep the protected catalog shell from being served as a stale prerendered
// document after a deployment. The client page still handles the session.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
