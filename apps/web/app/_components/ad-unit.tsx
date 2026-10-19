'use client';

import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import styles from './ad-unit.module.css';

/** CrawlProof ad slot for bufferoverride.com. Manage it at https://crawlproof.com/ads/slots */
const AD_SLOT = '76f0e1df-7d63-4298-9d01-114d55802219';
const AD_SCRIPT_SRC = 'https://crawlproof.com/ad.js';

/** A 728x90 needs the full column; anything narrower gets the fluid text_link. */
const LEADERBOARD_QUERY = '(min-width: 768px)';

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
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || el.dataset.slot) return;
    // Race-free: the div renders without data-slot, so ad.js's own pass skips
    // it. One format from the viewport, then slot, then scan: fills once.
    el.dataset.format = window.matchMedia(LEADERBOARD_QUERY).matches ? 'banner_728x90' : 'text_link';
    el.dataset.slot = AD_SLOT;
    return requestAdScan();
  }, []);
  return <div ref={ref} data-cp-ad="" className={styles.unit} />;
}

/** One CrawlProof unit above the footer; a fresh unit per page view. */
export function AdUnit() {
  const pathname = usePathname() ?? '/';
  if (NO_AD_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;
  return (
    <div className={styles.wrap}>
      <Unit key={pathname} />
      <Script src={AD_SCRIPT_SRC} strategy="afterInteractive" />
    </div>
  );
}
