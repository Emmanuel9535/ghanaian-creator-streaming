import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MoMo Ledger",
    short_name: "MoMo Ledger",
    description: "Mobile money business control for Ghanaian vendors.",
    start_url: "/auth",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f4f7f8",
    theme_color: "#00556f",
    categories: ["business", "finance"],
    icons: [
      { src: "/icons/momo-ledger-icon-192-v2.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/momo-ledger-icon-192-v2.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/momo-ledger-icon-512-v2.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/momo-ledger-icon-512-v2.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
