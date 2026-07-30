import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "../node_modules/next/dist/next-devtools/server/font/geist-latin.woff2",
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = localFont({
  src: "../node_modules/next/dist/next-devtools/server/font/geist-mono-latin.woff2",
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "Technical Paper AI Search Assistant",
  description: "Source-grounded hybrid search and AI synthesis across a curated technical-paper library.",
  applicationName: "Technical Paper AI Search Assistant",
  keywords: ["technical papers", "hybrid search", "RAG", "source-grounded AI"],
  authors: [{ name: "Jeremy Burke" }],
  openGraph: {
    title: "Technical Paper AI Search Assistant",
    description: "Search technical literature and trace every answer to its paper and page.",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#f5f4ef",
};

// Cloudflare Web Analytics beacon, gated to the deployed hostname so local dev
// and CI runs never send pageviews. The token is domain-locked, not a secret.
const WEB_ANALYTICS_SNIPPET = `
if (location.hostname === "technical-paper-ai-search.jeremy-burke024.workers.dev") {
  var beacon = document.createElement("script");
  beacon.src = "https://static.cloudflareinsights.com/beacon.min.js";
  beacon.defer = true;
  beacon.setAttribute("data-cf-beacon", '{"token": "2aa421bfec524e378131a9939d0fc968"}');
  document.head.appendChild(beacon);
}
`.trim();

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        {children}
        <script dangerouslySetInnerHTML={{ __html: WEB_ANALYTICS_SNIPPET }} />
      </body>
    </html>
  );
}
