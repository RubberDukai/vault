'use strict';
/* Vault almanac — sun and moon from arithmetic alone.
   Sunrise, sunset and twilight from the NOAA solar equations; the sun's
   bearing and height at any moment; the moon's phase from its period.
   No tables, no data files, no network. Accurate to about a minute for
   the sun and a few hours for the moon, which is all a navigator needs. */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Julian day for a JS Date (UTC). */
function julianDay(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

/** The pieces of the NOAA solar position calculation for a given instant. */
function solarBasis(date) {
  const jc = (julianDay(date) - 2451545) / 36525;
  const meanLong = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360;
  const meanAnom = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const eccent = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const centre = Math.sin(meanAnom * RAD) * (1.914602 - jc * (0.004817 + 0.000014 * jc))
    + Math.sin(2 * meanAnom * RAD) * (0.019993 - 0.000101 * jc)
    + Math.sin(3 * meanAnom * RAD) * 0.000289;
  const trueLong = meanLong + centre;
  const omega = 125.04 - 1934.136 * jc;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const meanObliq = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(omega * RAD);
  const declination = Math.asin(Math.sin(obliq * RAD) * Math.sin(appLong * RAD)) * DEG;
  const y = Math.tan((obliq / 2) * RAD) ** 2;
  const eqTime = 4 * DEG * (
    y * Math.sin(2 * meanLong * RAD)
    - 2 * eccent * Math.sin(meanAnom * RAD)
    + 4 * eccent * y * Math.sin(meanAnom * RAD) * Math.cos(2 * meanLong * RAD)
    - 0.5 * y * y * Math.sin(4 * meanLong * RAD)
    - 1.25 * eccent * eccent * Math.sin(2 * meanAnom * RAD)
  );
  return { declination, eqTime };
}

/**
 * Sunrise, sunset and civil twilight for a calendar day at a position.
 * Returns local Date objects, or null where the sun does not rise or set.
 */
function sunTimes(date, lat, lon) {
  // Work from local noon so the day is the one the user means.
  const noonLocal = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
  const { declination, eqTime } = solarBasis(noonLocal);

  const hourAngle = (zenith) => {
    const cosH = Math.cos(zenith * RAD) / (Math.cos(lat * RAD) * Math.cos(declination * RAD))
      - Math.tan(lat * RAD) * Math.tan(declination * RAD);
    if (cosH > 1 || cosH < -1) return null; // polar day or night
    return Math.acos(cosH) * DEG;
  };

  const midnightLocal = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
  const tzMinutes = -midnightLocal.getTimezoneOffset();
  const solarNoonMinutes = 720 - 4 * lon - eqTime + tzMinutes; // minutes after local midnight
  const at = (minutes) => new Date(midnightLocal.getTime() + minutes * 60000);

  const ha = hourAngle(90.833);          // the sun's upper limb at the horizon, with refraction
  const haCivil = hourAngle(96);         // civil twilight: sun 6° below

  return {
    solarNoon: at(solarNoonMinutes),
    sunrise: ha === null ? null : at(solarNoonMinutes - ha * 4),
    sunset: ha === null ? null : at(solarNoonMinutes + ha * 4),
    dawn: haCivil === null ? null : at(solarNoonMinutes - haCivil * 4),
    dusk: haCivil === null ? null : at(solarNoonMinutes + haCivil * 4),
    dayLengthMinutes: ha === null ? (declination * lat > 0 ? 1440 : 0) : ha * 8,
    declination,
    polar: ha === null ? (declination * lat > 0 ? 'day' : 'night') : null,
  };
}

/** Where the sun is right now from a position: bearing and height in degrees. */
function sunPosition(date, lat, lon) {
  const { declination, eqTime } = solarBasis(date);
  const minutesLocal = date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
  const tzMinutes = -date.getTimezoneOffset();
  let trueSolar = (minutesLocal + eqTime + 4 * lon - tzMinutes) % 1440;
  if (trueSolar < 0) trueSolar += 1440;
  const hourAngle = trueSolar / 4 < 0 ? trueSolar / 4 + 180 : trueSolar / 4 - 180;

  const cosZenith = Math.sin(lat * RAD) * Math.sin(declination * RAD)
    + Math.cos(lat * RAD) * Math.cos(declination * RAD) * Math.cos(hourAngle * RAD);
  const zenith = Math.acos(Math.max(-1, Math.min(1, cosZenith))) * DEG;
  const altitude = 90 - zenith;

  let azimuth;
  const denom = Math.cos(lat * RAD) * Math.sin(zenith * RAD);
  if (Math.abs(denom) < 1e-9) {
    azimuth = 180;
  } else {
    const cosAz = ((Math.sin(lat * RAD) * Math.cos(zenith * RAD)) - Math.sin(declination * RAD)) / denom;
    const az = Math.acos(Math.max(-1, Math.min(1, cosAz))) * DEG;
    azimuth = hourAngle > 0 ? (az + 180) % 360 : (540 - az) % 360;
  }
  return { altitude, azimuth };
}

const SYNODIC_MONTH = 29.530588853;
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14, 0);

/** The moon's phase: age in days, fraction of the cycle, illumination, and a name. */
function moonPhase(date) {
  const days = (date.getTime() - KNOWN_NEW_MOON) / 86400000;
  let age = days % SYNODIC_MONTH;
  if (age < 0) age += SYNODIC_MONTH;
  const fraction = age / SYNODIC_MONTH;
  const illumination = (1 - Math.cos(fraction * 2 * Math.PI)) / 2;

  const names = [
    'New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous',
    'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent',
  ];
  // Each named phase is a slice of the cycle centred on its exact moment.
  const index = Math.floor(((fraction * 8) + 0.5) % 8);
  const nextFull = new Date(date.getTime() + ((0.5 - fraction + 1) % 1) * SYNODIC_MONTH * 86400000);
  const nextNew = new Date(date.getTime() + ((1 - fraction) % 1) * SYNODIC_MONTH * 86400000);

  return {
    age,
    fraction,
    illumination,
    name: names[index],
    waxing: fraction < 0.5,
    nextFull,
    nextNew,
    glyph: ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'][index],
  };
}

function compassPoint(bearing) {
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return points[Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16];
}

function formatTime(date) {
  if (!date) return '—';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

window.vaultAlmanac = { sunTimes, sunPosition, moonPhase, compassPoint, formatTime, formatDuration };
