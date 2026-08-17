// ============================================
// BIT SOFTWARE — Visitor Activity helpers
// ============================================

export const pathnameOnly = (path: string) => String(path || '').split('?')[0];

export const isDashboardPath = (path: string) => {
  const clean = pathnameOnly(path);
  return clean === '/dashboard' || clean.startsWith('/dashboard/');
};

export const isCheckoutPath = (path: string) => {
  const p = pathnameOnly(path);
  return p === '/cart' || p.includes('checkout');
};

export const detectIntent = (path: string) => {
  const p = pathnameOnly(path);
  if (isCheckoutPath(p)) return 'checkout';
  if (p.startsWith('/contact')) return 'contact';
  if (p.startsWith('/auth')) return 'auth';
  if (p.startsWith('/services')) return 'service';
  if (p.startsWith('/my-account')) return 'account';
  return 'browse';
};

export const parseDevice = (ua?: string) => {
  const u = String(ua || '').toLowerCase();
  const device = /mobile|android|iphone|ipod|webos/.test(u) && !/ipad/.test(u)
    ? 'mobile'
    : /ipad|tablet/.test(u)
      ? 'tablet'
      : 'desktop';
  let browser = 'Other';
  if (u.includes('edg/')) browser = 'Edge';
  else if (u.includes('opr/') || u.includes('opera')) browser = 'Opera';
  else if (u.includes('chrome') && !u.includes('edg/')) browser = 'Chrome';
  else if (u.includes('firefox')) browser = 'Firefox';
  else if (u.includes('safari')) browser = 'Safari';
  return { device, browser };
};

const utmFromPath = (path: string) => {
  try {
    const q = new URL(path, 'https://example.com').searchParams;
    return {
      source: q.get('utm_source') || undefined,
      medium: q.get('utm_medium') || undefined,
      campaign: q.get('utm_campaign') || undefined,
    };
  } catch {
    return {};
  }
};

const isInternalHost = (host: string) => {
  const h = host.replace(/^www\./, '').toLowerCase();
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h.endsWith('bitsoftwareanditsolution.com')
  );
};

export const classifySource = (referrer?: string, path?: string) => {
  const utm = utmFromPath(path || '');
  if (utm.source) return { source: utm.source.toLowerCase().slice(0, 80), utm };

  if (!referrer) return { source: 'direct', utm };

  try {
    const url = new URL(referrer);
    if (isInternalHost(url.hostname)) return { source: 'direct', utm };
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (host.includes('google')) return { source: 'google', utm };
    if (host.includes('facebook') || host.includes('fb.com')) return { source: 'facebook', utm };
    if (host.includes('instagram')) return { source: 'instagram', utm };
    if (host.includes('whatsapp') || host.includes('wa.me')) return { source: 'whatsapp', utm };
    if (host.includes('bing')) return { source: 'bing', utm };
    if (host.includes('yahoo')) return { source: 'yahoo', utm };
    return { source: host.slice(0, 80), utm };
  } catch {
    return { source: 'direct', utm };
  }
};
