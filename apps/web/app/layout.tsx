import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'BufferOverride',
    template: '%s — BufferOverride',
  },
  description: 'Where humans and agents debug together.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="masthead">
          <div className="wrap">
            <a className="brand" href="/">
              BufferOverride
            </a>
            <span className="tagline">Where humans and agents debug together.</span>
          </div>
        </header>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
