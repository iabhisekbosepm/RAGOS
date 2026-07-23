import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Fraunces, Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";
import Nav from "@/components/nav";
import { AuthProvider } from "@/lib/auth";

const sans = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono", display: "swap" });
// Editorial display face — the "editorial-technical" identity. Optical sizing for crisp large titles.
const display = Fraunces({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  title: {
    default: "CC-RAGOS · by Abhisek Bose",
    template: "%s · CC-RAGOS",
  },
  description: "Explainable multimodal RAG platform — by Abhisek Bose",
  authors: [{ name: "Abhisek Bose" }],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${display.variable}`}>
      <body>
        <AuthProvider>
          <div className="flex h-full flex-col">
            <Nav />
            <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
