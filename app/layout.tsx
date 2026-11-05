import type { Metadata, Viewport } from "next";
import { Inter, Inter_Tight, Instrument_Serif } from "next/font/google";
import { Analytics } from "@/components/Analytics";
import { PALETTE, PALETTE_DARK } from "@/lib/palette";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, siteUrl } from "./site";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin", "latin-ext"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: SITE_TITLE, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    locale: "en_US",
    alternateLocale: ["tr_TR"],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: PALETTE.ivory },
    { media: "(prefers-color-scheme: dark)", color: PALETTE_DARK.ivory },
  ],
  colorScheme: "light dark",
  // The keyboard shrinks the page, so the home composer rises above it.
  interactiveWidget: "resizes-content",
};

// Sets a stored light/dark choice before first paint; "system" needs no attribute.
const THEME_INIT = `try{var t=localStorage.getItem("verdict-theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t;document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){m.content=t==="dark"?"${PALETTE_DARK.ivory}":"${PALETTE.ivory}"})}}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${interTight.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
