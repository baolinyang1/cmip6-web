import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CMIP6 Ecoregion Explorer",
  description: "Explore CMIP6 temperature and precipitation projections by Level III ecoregion."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
