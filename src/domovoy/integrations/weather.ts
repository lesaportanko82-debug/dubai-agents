/**
 * Weather integration for Domovoy.
 *
 * Uses OpenWeatherMap API (free tier: 1000 calls/day).
 * When OPENWEATHER_API_KEY is not set, returns demo data for showcase.
 *
 * Proactive weather-triggered tasks:
 *  - Rain coming → "забери бельё с балкона" / "bring laundry in"
 *  - Extreme heat → "полей цветы" / "water the plants"
 *  - Cold snap → "закрой окна" / "close the windows"
 *  - Storm → "убери вещи с балкона" / "secure balcony items"
 */

export interface WeatherData {
  temp: number;          // °C
  feelsLike: number;
  humidity: number;      // %
  description: string;
  icon: string;          // e.g. "10d" for rain
  windSpeed: number;     // m/s
  rainMm?: number;       // mm in next 3h
  forecast: ForecastSlot[];
}

export interface ForecastSlot {
  dt: string;            // ISO
  temp: number;
  description: string;
  icon: string;
  rainMm?: number;
  windSpeed: number;
}

export interface WeatherAlert {
  type: 'rain_coming' | 'extreme_heat' | 'cold_snap' | 'storm' | 'snow';
  severity: 'info' | 'warning' | 'urgent';
  taskSuggestion: { ru: string; en: string };
  minutes: number;       // estimated minutes for the task
  skills: string[];
  kidSafe: boolean;
}

const DEMO_WEATHER: WeatherData = {
  temp: 34, feelsLike: 38, humidity: 55, description: 'Partly cloudy',
  icon: '02d', windSpeed: 4.2, rainMm: 0,
  forecast: [
    { dt: '', temp: 32, description: 'Light rain', icon: '10d', rainMm: 2.5, windSpeed: 6.1 },
    { dt: '', temp: 30, description: 'Moderate rain', icon: '10d', rainMm: 8.0, windSpeed: 7.3 },
    { dt: '', temp: 28, description: 'Cloudy', icon: '04d', rainMm: 0, windSpeed: 3.5 },
    { dt: '', temp: 33, description: 'Sunny', icon: '01d', rainMm: 0, windSpeed: 2.0 },
  ],
};

/** Fetch current weather + 12h forecast for a city/coordinates. */
export async function getWeather(opts: { lat?: number; lon?: number; city?: string }): Promise<WeatherData> {
  const key = process.env.OPENWEATHER_API_KEY;
  if (!key) {
    // Demo mode: return realistic Dubai weather with rain in forecast
    const now = new Date();
    return {
      ...DEMO_WEATHER,
      forecast: DEMO_WEATHER.forecast.map((f, i) => ({
        ...f,
        dt: new Date(now.getTime() + (i + 1) * 3 * 3_600_000).toISOString(),
      })),
    };
  }

  const q = opts.lat && opts.lon
    ? `lat=${opts.lat}&lon=${opts.lon}`
    : `q=${encodeURIComponent(opts.city ?? 'Dubai')}`;

  // Current weather
  const curRes = await fetch(`https://api.openweathermap.org/data/2.5/weather?${q}&units=metric&appid=${key}`);
  if (!curRes.ok) throw new Error(`Weather API error: ${curRes.status}`);
  const cur = await curRes.json() as any;

  // 5-day/3h forecast (take next 12h = 4 slots)
  const fcRes = await fetch(`https://api.openweathermap.org/data/2.5/forecast?${q}&units=metric&cnt=4&appid=${key}`);
  const fc = fcRes.ok ? (await fcRes.json() as any) : { list: [] };

  return {
    temp: Math.round(cur.main.temp),
    feelsLike: Math.round(cur.main.feels_like),
    humidity: cur.main.humidity,
    description: cur.weather?.[0]?.description ?? '',
    icon: cur.weather?.[0]?.icon ?? '',
    windSpeed: cur.wind?.speed ?? 0,
    rainMm: cur.rain?.['3h'] ?? cur.rain?.['1h'] ?? 0,
    forecast: (fc.list ?? []).map((s: any) => ({
      dt: new Date(s.dt * 1000).toISOString(),
      temp: Math.round(s.main.temp),
      description: s.weather?.[0]?.description ?? '',
      icon: s.weather?.[0]?.icon ?? '',
      rainMm: s.rain?.['3h'] ?? 0,
      windSpeed: s.wind?.speed ?? 0,
    })),
  };
}

/** Analyze weather data and return proactive task alerts. */
export function analyzeWeatherAlerts(weather: WeatherData): WeatherAlert[] {
  const alerts: WeatherAlert[] = [];

  // Rain in next 6h
  const rainSlots = weather.forecast.filter(f => (f.rainMm ?? 0) > 1);
  if (rainSlots.length > 0) {
    const heavy = rainSlots.some(f => (f.rainMm ?? 0) > 5);
    alerts.push({
      type: 'rain_coming',
      severity: heavy ? 'warning' : 'info',
      taskSuggestion: {
        ru: heavy ? 'Сильный дождь скоро — забери бельё и закрой окна' : 'Скоро дождь — забери бельё с балкона',
        en: heavy ? 'Heavy rain coming — bring laundry in and close windows' : 'Rain coming — bring laundry in from the balcony',
      },
      minutes: 10,
      skills: ['household'],
      kidSafe: true,
    });
  }

  // Storm: wind > 15 m/s in forecast
  const stormSlots = weather.forecast.filter(f => f.windSpeed > 15);
  if (stormSlots.length > 0) {
    alerts.push({
      type: 'storm',
      severity: 'urgent',
      taskSuggestion: {
        ru: 'Штормовое предупреждение — убери вещи с балкона и закрой окна',
        en: 'Storm warning — secure balcony items and close windows',
      },
      minutes: 15,
      skills: ['household'],
      kidSafe: false,
    });
  }

  // Extreme heat: > 40°C
  if (weather.temp > 40 || weather.forecast.some(f => f.temp > 40)) {
    alerts.push({
      type: 'extreme_heat',
      severity: 'warning',
      taskSuggestion: {
        ru: 'Сильная жара — полей цветы и проверь воду у питомцев',
        en: 'Extreme heat — water the plants and check pets\' water',
      },
      minutes: 10,
      skills: ['water_plants'],
      kidSafe: true,
    });
  }

  // Cold snap: temp drops > 10°C in forecast
  if (weather.forecast.length >= 2) {
    const drop = weather.temp - Math.min(...weather.forecast.map(f => f.temp));
    if (drop > 10) {
      alerts.push({
        type: 'cold_snap',
        severity: 'info',
        taskSuggestion: {
          ru: 'Резкое похолодание — закрой окна и достань тёплые вещи',
          en: 'Temperature dropping — close windows and get warm clothes ready',
        },
        minutes: 10,
        skills: ['household'],
        kidSafe: true,
      });
    }
  }

  return alerts;
}

/** Format weather summary for the agent's tool output. */
export function formatWeatherForAgent(weather: WeatherData, alerts: WeatherAlert[]): string {
  const lines = [
    `Current: ${weather.temp}°C (feels ${weather.feelsLike}°C), ${weather.description}, humidity ${weather.humidity}%, wind ${weather.windSpeed} m/s`,
  ];
  if (weather.rainMm) lines.push(`Rain now: ${weather.rainMm}mm`);
  if (weather.forecast.length) {
    lines.push('Forecast (next 12h):');
    for (const f of weather.forecast) {
      lines.push(`  ${f.dt.slice(11, 16)}: ${f.temp}°C, ${f.description}${f.rainMm ? `, rain ${f.rainMm}mm` : ''}, wind ${f.windSpeed} m/s`);
    }
  }
  if (alerts.length) {
    lines.push('⚠️ ALERTS:');
    for (const a of alerts) {
      lines.push(`  [${a.severity}] ${a.type}: ${a.taskSuggestion.en}`);
    }
  }
  return lines.join('\n');
}
