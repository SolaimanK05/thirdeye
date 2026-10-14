import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, VT323 } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

const vt323 = VT323({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-vt323",
});

export const metadata: Metadata = {
  title: "Third Eye",
  description:
    "Self-hosted OSINT console: public data feeds on one 3D globe, with one search across all of them.",
};

export const viewport: Viewport = {
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${jetbrainsMono.variable} ${vt323.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
