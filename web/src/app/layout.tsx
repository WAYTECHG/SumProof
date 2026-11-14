import type { Metadata } from "next";
import { IBM_Plex_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { Shell } from "@/components/Shell";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "SumProof",
  description:
    "Receipt AI that checks the numbers add up, and evidence search over 12,013 pages of real SEC filings. Explorer for the real evaluation results.",
};

// Applies the saved theme before first paint, so the page never flashes the wrong colours.
const themeScript = `try{var q=new URLSearchParams(location.search).get('theme');if(q==='light'||q==='dark')localStorage.setItem('sumproof-theme',q);var t=localStorage.getItem('sumproof-theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${jakarta.variable} ${plexMono.variable} backdrop`}>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
