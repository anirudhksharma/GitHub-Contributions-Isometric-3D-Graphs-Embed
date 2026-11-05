/**
 * Chart layout and statistics shared by the PNG and SVG renderers.
 *
 * Kept free of native modules (canvas) and jsdom so the SVG renderer can run
 * where they aren't installed, e.g. on Vercel's serverless functions.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  calculateStreaks,
  datesDayDifference,
  precisionRound,
  sameDay,
} from "./utils.js";
import { GITHUB_THEME } from "./theme-config.js";

// STYLING CONFIGURATION
// Import different themes from theme-config.js or customize here
// Available themes: GITHUB_THEME, DARK_THEME, LIGHT_THEME, NEON_THEME, MINIMAL_THEME, OCEAN_THEME
let STYLE_CONFIG = { ...GITHUB_THEME };

/**
 * Set the default theme, used by render calls that don't pass options.theme.
 * Handy for the CLI scripts. Concurrent callers (the API server) must pass
 * options.theme instead: this is shared module state, so a theme set before
 * an await can be replaced by another request before the render runs.
 * @param {Object} theme - Theme configuration object
 */
export function setTheme(theme) {
  STYLE_CONFIG = { ...theme };
}

/**
 * Get current theme configuration
 * @returns {Object} Current STYLE_CONFIG
 */
export function getStyleConfig() {
  return STYLE_CONFIG;
}

// Load obelisk.js. It only needs `window` to attach itself to; `document` is
// touched only when it creates a canvas, which only the PNG renderer does
// (renderer.js sets up a jsdom document for that).
const __dirname = dirname(fileURLToPath(import.meta.url));
const obeliskCode = readFileSync(join(__dirname, "obelisk.min.js"), "utf8");
const obeliskHost = {};
// biome-ignore lint/security/noGlobalEval: Required for loading obelisk library
new Function("window", obeliskCode)(obeliskHost);
export const obelisk = obeliskHost.obelisk;

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/**
 * Lay out the isometric cubes for a set of days. Shared by the PNG and SVG
 * renderers so both place every cube identically.
 * @param {Array} days - Array of day objects with {date, count, color, week}
 * @param {Object} options
 * @param {number} options.width - Image width (default: 1000)
 * @param {number} options.height - Image height (default: 600)
 * @param {Object} options.theme - Theme for cube colors (default: the theme set by setTheme)
 * @returns {Object} {cubeSize, cubeScale, offsetX, offsetY, cubes}, where each
 *   cube is {day, weekIndex, dayIndex, x, y, height, level, color} with x/y in
 *   obelisk 3D space and color as a "#rrggbb" string from the theme
 */
export function layoutChart(days, options = {}) {
  const { width = 1000, height = 600, theme = STYLE_CONFIG } = options;

  // Scale cube size based on canvas dimensions (base size 16 for 1000x600)
  const baseWidth = 1000;
  const baseHeight = 600;
  const baseCubeSize = 16;
  const scale = Math.min(width / baseWidth, height / baseHeight);
  const rawCubeSize = baseCubeSize * scale;
  const cubeSize = Math.max(6, Math.round(rawCubeSize / 2) * 2);
  const cubeScale = cubeSize / baseCubeSize;
  const maxHeight = 100 * cubeScale;

  // Calculate max count for scaling
  const maxCount = Math.max(...days.map((d) => d.count));

  // Group days by week
  const weeks = Object.values(
    days.reduce((acc, day) => {
      const key = day.week;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(day);
      return acc;
    }, {}),
  );

  // Calculate proper offsets so the tallest cube never gets clipped at top.
  // obelisk projection: screen_y_top = floor(x3d/2 + y3d/2) - cubeHeight + offsetY
  // The worst case (min screen_y_top) is week 0 / day 0 at maximum height.
  const GH_OFFSET_base = 14 * cubeScale;
  const x3d_first = cubeSize * (GH_OFFSET_base / (GH_OFFSET_base + 1));
  const actualMaxCubeHeight =
    Math.round(3 * cubeScale) + (maxCount > 0 ? Math.round(maxHeight) : 0);
  const topMargin = Math.round(8 * cubeScale);
  const minOffsetY =
    topMargin + actualMaxCubeHeight - Math.floor(x3d_first / 2);

  const offsetX = width * 0.13;
  const offsetY = Math.max(height * 0.15, minOffsetY);

  // Scale the offsets to match cube size scaling
  const GH_OFFSET = GH_OFFSET_base;
  const DAY_OFFSET = 13 * cubeScale;
  let transform = GH_OFFSET;

  const cubes = [];
  weeks.forEach((week, weekIndex) => {
    const x = transform / (GH_OFFSET + 1);
    transform += GH_OFFSET;
    let dayOffsetY = 0;

    week.forEach((day, dayIndex) => {
      const y = dayOffsetY / GH_OFFSET;
      dayOffsetY += DAY_OFFSET;

      let cubeHeight = Math.round(3 * cubeScale);
      if (maxCount > 0) {
        cubeHeight += Math.round((maxHeight / maxCount) * day.count);
      }
      cubeHeight = Math.max(cubeHeight, 3);

      // Get color from theme based on contribution level
      const level = day.level || 0;
      const color = theme.graph?.colors?.[`level${level}`] || day.color;

      cubes.push({
        day,
        weekIndex,
        dayIndex,
        x: cubeSize * x,
        y: cubeSize * y,
        height: cubeHeight,
        level,
        color,
      });
    });
  });

  return { cubeSize, cubeScale, offsetX, offsetY, cubes };
}

/**
 * Get obelisk's shaded face colors for a cube's base (top) color
 * @param {string} hexColor - "#rrggbb"
 * @returns {Object} obelisk CubeColor with 32-bit ARGB face colors
 */
export function getCubeColor(hexColor) {
  return new obelisk.CubeColor().getByHorizontalColor(
    Number.parseInt(hexColor.replace("#", ""), 16),
  );
}

/**
 * Calculate statistics from contribution data
 * @param {Array} days - Array of day objects
 * @returns {Object} Statistics object
 */
export function calculateStats(days) {
  if (!days || days.length === 0) {
    return {
      yearTotal: 0,
      maxCount: 0,
      averageCount: 0,
      bestDay: null,
      dateBest: "No activity found",
      streakLongest: 0,
      datesLongest: "No longest streak",
      streakCurrent: 0,
      datesCurrent: "No current streak",
      countTotal: "0",
      datesTotal: "",
      weekTotal: 0,
      weekCountTotal: "0",
      weekDatesTotal: "",
    };
  }

  const firstDay = days[0].date;
  // Find today's date in the data, or use the last day if today is not in the data
  const todayDate = new Date();
  const todayEntry = days.find((d) => {
    const dayDate = d.date instanceof Date ? d.date : new Date(d.date);
    return sameDay(dayDate, todayDate);
  });
  const lastDay = todayEntry?.date ?? days.at(-1).date;

  // Calculate streaks
  const stats = calculateStreaks(days);

  // Calculate totals
  const yearTotal = stats.yearTotal;
  const maxCount = stats.maxCount;
  const bestDay = stats.bestDay;

  // Format dates
  const dateFirst = dateFormat.format(firstDay);
  const dateLast = dateFormat.format(lastDay);
  const datesTotal = `${dateFirst} → ${dateLast}`;

  // Average contributions per day
  const dayDifference = datesDayDifference(firstDay, lastDay);
  const averageCount =
    dayDifference > 0 ? precisionRound(yearTotal / dayDifference, 2) : 0;

  // Best day
  const dateBest = bestDay ? dateFormat.format(bestDay) : "No activity found";

  // Format streak dates
  let datesLongest = "No longest streak";
  if (stats.streakLongest > 0) {
    const longestStart = dateFormat.format(stats.longestStreakStart);
    const longestEnd = dateFormat.format(stats.longestStreakEnd);
    datesLongest = `${longestStart} → ${longestEnd}`;
  }

  let datesCurrent = "No current streak";
  if (stats.streakCurrent > 0) {
    const currentStart = dateFormat.format(stats.currentStreakStart);
    const currentEnd = dateFormat.format(stats.currentStreakEnd);
    datesCurrent = `${currentStart} → ${currentEnd}`;
  }

  // Week total (current calendar week - from Sunday to today)
  const currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);

  // Get the start of the current week (Sunday)
  const currentWeekStart = new Date(currentDate);
  const dayOfWeek = currentWeekStart.getDay(); // 0 = Sunday, 1 = Monday, etc.
  currentWeekStart.setDate(currentWeekStart.getDate() - dayOfWeek); // Go back to Sunday
  currentWeekStart.setHours(0, 0, 0, 0);

  const currentWeekDays = days.filter((d) => {
    const dayDate = d.date instanceof Date ? d.date : new Date(d.date);
    const normalizedDay = new Date(dayDate);
    normalizedDay.setHours(0, 0, 0, 0);
    return normalizedDay >= currentWeekStart && normalizedDay <= currentDate;
  });

  let weekTotal = 0;
  for (const d of currentWeekDays) {
    weekTotal += d.count;
  }

  // The range always shows the calendar week (Sunday to today), even when the
  // data has no days in it, e.g. a graph for a past year. dateFormat is UTC,
  // so format the local calendar dates as UTC dates to avoid a day shift.
  const asUTCDate = (d) =>
    new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const weekDatesTotal = `${dateFormat.format(asUTCDate(currentWeekStart))} → ${dateFormat.format(asUTCDate(currentDate))}`;

  return {
    yearTotal,
    countTotal: yearTotal.toLocaleString(),
    datesTotal,
    maxCount,
    dateBest,
    averageCount,
    streakLongest: stats.streakLongest,
    datesLongest,
    streakCurrent: stats.streakCurrent,
    datesCurrent,
    weekTotal,
    weekCountTotal: weekTotal.toLocaleString(),
    weekDatesTotal,
  };
}
