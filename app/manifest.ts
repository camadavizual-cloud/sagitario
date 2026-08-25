import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sagitário — Montador de Propostas",
    short_name: "Sagitário",
    description: "Selecione serviços, compare valores e monte sua proposta.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f3ed",
    theme_color: "#171916",
    orientation: "portrait-primary",
    icons: [
      { src: "/sagitario-logo.png", sizes: "1254x1254", type: "image/png", purpose: "any" },
      { src: "/sagitario-logo.png", sizes: "1254x1254", type: "image/png", purpose: "maskable" },
    ],
  };
}
