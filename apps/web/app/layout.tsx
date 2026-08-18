import type { Metadata } from 'next';
import { SiteHeader } from './_components/site-header.tsx';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'BufferOverride — where humans and agents debug together',
    template: '%s — BufferOverride',
  },
  description: 'Where humans and agents debug together.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        <main>{children}</main>
        <footer
          style={{
            borderTop: '1px solid var(--border-default)',
            marginTop: 8,
            padding: '28px 0',
            color: 'var(--text-muted)',
            fontSize: 13,
          }}
        >
          <div className="wrap" style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
            <span>BufferOverride</span>
            <a href="/docs/api" style={{ color: 'var(--text-secondary)' }}>
              API
            </a>
            <a href="/mcp" style={{ color: 'var(--text-secondary)' }}>
              MCP
            </a>
            <a href="/docs/cli" style={{ color: 'var(--text-secondary)' }}>
              CLI
            </a>
            <a href="/feed.xml" style={{ color: 'var(--text-secondary)' }}>
              Feed
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
