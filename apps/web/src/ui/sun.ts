// Today's sunset, for U3's Daylight card. Ra keeps no location, so the place is
// the phone's time zone: a city for the zones we know, else the zone's own
// meridian on the equator. Good to a few minutes, which is all a "Ray at dusk" needs.

const PLACES: Record<string, [lat: number, lon: number]> = {
  "Africa/Nairobi": [-1.29, 36.82],
  "Africa/Kampala": [0.35, 32.58],
  "Africa/Dar_es_Salaam": [-6.79, 39.21],
  "Africa/Kigali": [-1.95, 30.06],
  "Africa/Addis_Ababa": [9.03, 38.74],
  "Africa/Lagos": [6.52, 3.38],
  "Africa/Accra": [5.6, -0.19],
  "Africa/Johannesburg": [-26.2, 28.05],
  "Africa/Cairo": [30.04, 31.24],
  "Africa/Casablanca": [33.57, -7.59],
  "Africa/Dakar": [14.72, -17.47],
  "Africa/Kinshasa": [-4.44, 15.27],
  "Europe/London": [51.51, -0.13],
  "Europe/Paris": [48.86, 2.35],
  "Europe/Madrid": [40.42, -3.7],
  "Europe/Lisbon": [38.72, -9.14],
  "Europe/Berlin": [52.52, 13.4],
  "America/New_York": [40.71, -74.01],
  "America/Chicago": [41.88, -87.63],
  "America/Denver": [39.74, -104.99],
  "America/Los_Angeles": [34.05, -118.24],
  "America/Sao_Paulo": [-23.55, -46.63],
  "America/Mexico_City": [19.43, -99.13],
  "Asia/Kolkata": [28.61, 77.21],
  "Asia/Dubai": [25.2, 55.27],
  "Asia/Riyadh": [24.71, 46.68],
  "Asia/Singapore": [1.35, 103.82],
  "Asia/Tokyo": [35.68, 139.69],
};

function place(when: Date): [number, number] {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return PLACES[zone] ?? [0, -when.getTimezoneOffset() / 4];
}

/** Sunset on `when`'s local day, or null where the sun doesn't set (polar day or night). */
export function sunset(when = new Date()): Date | null {
  const [lat, lon] = place(when);
  const rad = Math.PI / 180;
  const start = Date.UTC(when.getFullYear(), 0, 1);
  const day = Math.floor((Date.UTC(when.getFullYear(), when.getMonth(), when.getDate()) - start) / 86_400_000) + 1;
  const g = ((2 * Math.PI) / 365) * (day - 1);
  // Equation of time (minutes) and declination (radians), NOAA's short series.
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const cosH = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl);
  if (cosH < -1 || cosH > 1) return null;
  const minutesUtc = 720 - 4 * (lon - Math.acos(cosH) / rad) - eqt;
  return new Date(Date.UTC(when.getFullYear(), when.getMonth(), when.getDate()) + minutesUtc * 60_000);
}

/** "18:34", in the phone's time. */
export function clock(d: Date): string {
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}
