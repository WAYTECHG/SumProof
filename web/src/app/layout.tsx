import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import { Shell } from "@/components/Shell";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "SumProof",
  description:
    "Receipt AI that checks the numbers add up, and evidence search over 12,013 pages of real SEC filings. Explorer for the real evaluation results.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${plexMono.variable}`}>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
