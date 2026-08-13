// Venue display name -> site origin (for favicons when API data is unavailable).
export const SITE_ORIGINS = {
  'Barby (Tel Aviv)': 'https://barby.co.il',
  'Ozen (Tel Aviv)': 'https://ozentelaviv.com',
  'Hameretz 2 (Tel Aviv)': 'https://hameretz2.org',
  'Levontin 7 (Tel Aviv)': 'https://levontin7.com',
  'HaZor (Tel Aviv)': 'https://haezor.com',
  'Babe Bar (Hod Hasharon)': 'https://babebar.co.il',
  Papaito: 'https://papaito.co.il',
  'Shablul (Tel Aviv)': 'https://shablul.smarticket.co.il',
  'Gray Club (Yehud)': 'https://grayclub.co.il',
  'Gray Club (Modiin)': 'https://grayclub.co.il',
  'Gray Club (Tel Aviv)': 'https://grayclub.co.il',
  'Teder (Tel Aviv)': 'https://www.teder.fm',
  'Zappa Club': 'https://www.zappa-club.co.il',
  'Muzi (Center)': 'https://muzi.co.il',
};

export function resolveSiteOrigin(siteName, siteMeta = []) {
  const exactMeta = siteMeta.find((s) => s.name === siteName);
  if (exactMeta?.origin) return exactMeta.origin;

  if (SITE_ORIGINS[siteName]) return SITE_ORIGINS[siteName];

  const prefixMeta = siteMeta.find((s) => siteName.startsWith(s.name));
  if (prefixMeta?.origin) return prefixMeta.origin;

  const prefixEntry = Object.entries(SITE_ORIGINS).find(([name]) => siteName.startsWith(name));
  return prefixEntry?.[1] ?? null;
}

export function faviconUrl(origin) {
  try {
    const host = new URL(origin).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
  } catch {
    return null;
  }
}
