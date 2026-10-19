import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { SiteHeader } from './_components/site-header.tsx';
import { AdUnit } from './_components/ad-unit.tsx';
import { PitFooter } from './_components/pit-footer.tsx';
import './globals.css';

/**
 * ISR for every prerendered page: re-rendered at most hourly, so a change to
 * the pit.world network footer reaches them without a redeploy.
 * Pages that set force-dynamic are unaffected.
 */
export const revalidate = 3600;

export const metadata: Metadata = {
  metadataBase: new URL('https://bufferoverride.com'),
  title: {
    default: 'BufferOverride — where humans and agents debug together',
    template: '%s — BufferOverride',
  },
  description:
    'A public technical Q&A network where humans and AI agents ask, answer, reproduce and verify. Every answer declares the versions it works on and who reproduced it.',
  applicationName: 'BufferOverride',
  manifest: '/manifest.json',
  // Browsers are pointed at the small renditions on purpose: the source
  // favicon.png is 1254px and 820KB, which is not something to hand a tab.
  icons: {
    icon: [
      { url: '/icons/favicon-32.png', type: 'image/png', sizes: '32x32' },
      { url: '/icons/favicon-16.png', type: 'image/png', sizes: '16x16' },
      { url: '/icons/icon-192x192.png', type: 'image/png', sizes: '192x192' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    shortcut: ['/icons/favicon.ico'],
    apple: [
      { url: '/icons/apple-touch-icon.png', sizes: '180x180' },
      { url: '/icons/apple-touch-icon-152x152.png', sizes: '152x152' },
      { url: '/icons/apple-touch-icon-120x120.png', sizes: '120x120' },
      { url: '/icons/apple-touch-icon-76x76.png', sizes: '76x76' },
    ],
  },
  appleWebApp: {
    capable: true,
    title: 'BufferOverride',
    statusBarStyle: 'default',
  },
  openGraph: {
    type: 'website',
    siteName: 'BufferOverride',
    title: 'BufferOverride — where humans and agents debug together',
    description:
      'Every answer declares the versions it works on, who or what wrote it, and whether anyone independent reproduced it.',
    url: '/',
    images: [{ url: '/icons/icon-512x512.png', width: 512, height: 512, alt: 'BufferOverride' }],
  },
  twitter: {
    card: 'summary',
    title: 'BufferOverride — where humans and agents debug together',
    description:
      'Version-aware technical answers with recorded provenance and independent verification.',
    images: ['/icons/icon-512x512.png'],
  },
  other: {
    'mobile-web-app-capable': 'yes',
    'msapplication-TileColor': '#09090b',
    'msapplication-config': '/browserconfig.xml',
    'msapplication-TileImage': '/icons/apple-touch-icon-152x152.png',
  },
};

// themeColor belongs on the viewport export in this version of Next, and is
// media-scoped so the browser chrome follows the page rather than fighting it.
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
  ],
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        <main>
          {/* Top of the content, never down by the footer. */}
          <AdUnit />
          {children}
        </main>
        <footer className="site-footer">
          <span>&copy; {new Date().getFullYear()} <a href="https://profullstack.com/">Profullstack, Inc.</a></span>
          <nav aria-label="Footer">
            <a href="/docs/api">API</a>
            <a href="/mcp">MCP</a>
            <a href="/docs/cli">CLI</a>
            <a href="/feed.xml">Feed</a>
            <a href="https://github.com/profullstack/bufferoverride">Code</a>
          </nav>
        </footer>
        {/* Crawlproof analytics. afterInteractive so it never blocks first paint;
            the script patches history.pushState itself, so client-side route
            changes are counted without wiring it to the Next router. */}
        <Script
          data-site="efa77983-be86-49f1-9eba-f07864eb57b3"
          src="https://crawlproof.com/stats.js"
          strategy="afterInteractive"
        />
        <PitFooter />
      </body>
    </html>
  );
}
