'use client';

import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import styles from './ad-unit.module.css';

/**
 * CrawlProof ad.network slot for bufferoverride.com (publishers workspace).
 * Manage it at https://crawlproof.com/ads/slots. The slot serves only
 * banner_300x250 and text_link; we use only the low-profile text_link line.
 */
const AD_SLOT = '821367ac-566c-4b55-a5bb-eefe41ce4864';
const AD_NETWORK = 'tOBZMpdTr-2jI6f9';
const AD_FORMAT = 'text_link';
const AD_SCRIPT_SRC = 'https://crawlproof.com/ad.js';

/** Sign-in, account and moderation flows never carry an ad. */
const NO_AD_PREFIXES = ['/login', '/signup', '/account', '/moderation', '/notifications', '/ask'];

declare global {
  interface Window {
    crawlproofAds?: { scan: () => void };
  }
}

/**
 * ad.js scans once at DOMContentLoaded; a unit whose slot is set later must ask
 * for a rescan. Bounded retry, because ad.js loads afterInteractive and an ad
 * blocker may keep it from ever arriving. fill() guards on data-cp-filled.
 */
function requestAdScan(): () => void {
  let cancelled = false;
  let tries = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = () => {
    if (cancelled) return;
    if (window.crawlproofAds) {
      window.crawlproofAds.scan();
      return;
    }
    if (++tries > 25) return;
    timer = setTimeout(tick, 200);
  };
  tick();
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}

function Unit() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || el.dataset.slot) return;
    // Race-free: the div renders without data-slot, so ad.js's own pass skips
    // it. Format, then slot, then scan: fills once.
    el.dataset.format = AD_FORMAT;
    el.dataset.slot = AD_SLOT;
    return requestAdScan();
  }, []);
  return <aside ref={ref} data-ad-network={AD_NETWORK} data-cp-ad="" className={styles.unit} />;
}

/** One CrawlProof unit at the top of the content; a fresh unit per page view.
 *  The homepage carries no ad. */
export function AdUnit() {
  const pathname = usePathname() ?? '/';
  if (pathname === '/') return null;
  if (NO_AD_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;
  return (
    <div className={styles.wrap}>
      <Unit key={pathname} />
      <Script src={AD_SCRIPT_SRC} strategy="afterInteractive" />
    </div>
  );
}
