import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#182332",
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: "Sagitário — Montador de Propostas",
  description: "Selecione serviços, compare valores e gere propostas comerciais com o Sagitário.",
  openGraph: {
    title: "Sagitário — Montador de Propostas",
    description: "Selecione serviços e gere propostas comerciais.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Sagitário — Montador de Propostas" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Sagitário — Montador de Propostas",
    description: "Selecione serviços e gere propostas comerciais.",
    images: ["/og.png"],
  },
  icons: { icon: "/sagitario-logo.png", shortcut: "/sagitario-logo.png", apple: "/sagitario-logo.png" },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Sagitário" },
  formatDetection: { telephone: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
