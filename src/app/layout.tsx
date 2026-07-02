import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

import { Toaster } from "@/components/ui/sonner";

const geistSans = localFont({
  src: [
    { path: "./fonts/geist-100.ttf", weight: "100", style: "normal" },
    { path: "./fonts/geist-200.ttf", weight: "200", style: "normal" },
    { path: "./fonts/geist-300.ttf", weight: "300", style: "normal" },
    { path: "./fonts/geist-400.ttf", weight: "400", style: "normal" },
    { path: "./fonts/geist-500.ttf", weight: "500", style: "normal" },
    { path: "./fonts/geist-600.ttf", weight: "600", style: "normal" },
    { path: "./fonts/geist-700.ttf", weight: "700", style: "normal" },
    { path: "./fonts/geist-800.ttf", weight: "800", style: "normal" },
    { path: "./fonts/geist-900.ttf", weight: "900", style: "normal" },
  ],
  variable: "--font-geist-sans",
});

const geistMono = localFont({
  src: [
    { path: "./fonts/geist-mono-100.ttf", weight: "100", style: "normal" },
    { path: "./fonts/geist-mono-200.ttf", weight: "200", style: "normal" },
    { path: "./fonts/geist-mono-300.ttf", weight: "300", style: "normal" },
    { path: "./fonts/geist-mono-400.ttf", weight: "400", style: "normal" },
    { path: "./fonts/geist-mono-500.ttf", weight: "500", style: "normal" },
    { path: "./fonts/geist-mono-600.ttf", weight: "600", style: "normal" },
    { path: "./fonts/geist-mono-700.ttf", weight: "700", style: "normal" },
    { path: "./fonts/geist-mono-800.ttf", weight: "800", style: "normal" },
    { path: "./fonts/geist-mono-900.ttf", weight: "900", style: "normal" },
  ],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "Kurumsal Satış Tahmin Takip Sistemi",
  description: "Şirket içi satış tahminleri ve gerçekleşen satışların karşılaştırmalı analizi.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="tr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
