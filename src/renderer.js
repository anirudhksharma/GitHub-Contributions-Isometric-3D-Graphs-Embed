/**
 * Isometric Contribution Graph Renderer
 * Generates isometric 3D visualization from contribution data
 */

import { createCanvas, registerFont } from "canvas";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";
import {
  calculateStats,
  getCubeColor,
  getStyleConfig,
  layoutChart,
  obelisk,
} from "./layout.js";

// Layout, statistics and the theme default live in layout.js so the SVG
// renderer can use them without loading canvas. Re-exported for callers that
// import them from here.
export {
  calculateStats,
  getCubeColor,
  getStyleConfig,
  layoutChart,
  setTheme,
} from "./layout.js";

// Get directory paths
const __dirname = dirname(fileURLToPath(import.meta.url));
const fontsDir = join(__dirname, "..", "fonts");

// Register Segoe UI fonts from local fonts directory
try {
  registerFont(join(fontsDir, "Segoe UI.ttf"), {
    family: "Segoe UI",
    weight: "normal",
  });
  registerFont(join(fontsDir, "Segoe UI Bold.ttf"), {
    family: "Segoe UI",
    weight: "600",
  });
  registerFont(join(fontsDir, "Segoe UI Bold.ttf"), {
    family: "Segoe UI",
    weight: "bold",
  });
  // Segoe UI has no arrow glyphs (used in date ranges). Without this, each
  // host falls back to whatever system font it has, so PNGs differ between
  // Windows and Linux. The file is Segoe UI Symbol subset to U+2190-2193,
  // used by fillTextWithArrows() and by the SVG renderer.
  registerFont(join(fontsDir, "Segoe UI Symbol Arrows.ttf"), {
    family: "Segoe UI Symbol",
  });
  console.log("✓ Registered Segoe UI fonts");
} catch (e) {
  console.warn("⚠ Could not register Segoe UI fonts:", e.message);
}

// Create a browser-like environment for obelisk, which creates canvases
// through document.createElement
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Image = dom.window.Image;
globalThis.HTMLCanvasElement = dom.window.HTMLCanvasElement;

// Patch canvas element creation to use node-canvas
const originalCreateElement = globalThis.document.createElement.bind(
  globalThis.document,
);
globalThis.document.createElement = function (tagName) {
  if (tagName.toLowerCase() === "canvas") {
    const canvas = createCanvas(1, 1);
    // Add setAttribute method that node-canvas doesn't have
    canvas.setAttribute = function (attr, value) {
      if (attr === "width") this.width = Number.parseInt(value, 10);
      else if (attr === "height") this.height = Number.parseInt(value, 10);
    };
    // Add getAttribute method
    canvas.getAttribute = function (attr) {
      if (attr === "width") return this.width;
      if (attr === "height") return this.height;
      return null;
    };
    return canvas;
  }
  return originalCreateElement(tagName);
};

/**
 * Render isometric contribution graph to canvas
 * @param {Array} days - Array of day objects with {date, count, color, week}
 * @param {Object} options - Rendering options
 * @param {number} options.width - Canvas width (default: 1000)
 * @param {number} options.height - Canvas height (default: 600)
 * @param {string} options.username - Username to display as credit (optional)
 * @param {Object} options.theme - Theme to render with (default: the theme set by setTheme)
 * @returns {Canvas} Canvas with rendered graph
 */
export function renderIsometricChart(days, options = {}) {
  const {
    width = 1000,
    height = 600,
    username = null,
    theme = getStyleConfig(),
  } = options;
  const { cubeSize, offsetX, offsetY, cubes } = layoutChart(days, {
    ...options,
    theme,
  });

  // Create canvas
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Enable antialiasing for smoother rendering
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.antialias = "subpixel";

  // Clear canvas with transparent background
  ctx.clearRect(0, 0, width, height);

  // Setup obelisk with scaled position
  const point = new obelisk.Point(offsetX, offsetY);
  const pixelView = new obelisk.PixelView(canvas, point);

  for (const cube of cubes) {
    const dimension = new obelisk.CubeDimension(
      cubeSize,
      cubeSize,
      cube.height,
    );
    const shape = new obelisk.Cube(dimension, getCubeColor(cube.color), false);
    const p3d = new obelisk.Point3D(cube.x, cube.y, 0);
    pixelView.renderObject(shape, p3d);
  }

  // Draw username credit if provided
  if (username) {
    drawUsernameCredit(ctx, theme, username, canvas.width, canvas.height);
  }

  return canvas;
}

/**
 * Export canvas to PNG buffer
 * @param {Canvas} canvas - Canvas object
 * @returns {Buffer} PNG image buffer
 */
export function exportToPNG(canvas) {
  return canvas.toBuffer("image/png");
}

/**
 * Export canvas to SVG string
 * Note: SVG export requires a different approach since canvas is raster
 * This is a placeholder for future SVG implementation
 * @param {Canvas} canvas - Canvas object
 * @returns {string} Data URL of the canvas
 */
export function exportToDataURL(canvas) {
  return canvas.toDataURL();
}

/**
 * Render contribution graph with stats overlay
 * @param {Array} days - Array of day objects
 * @param {Object} options - Rendering options (same as renderIsometricChart)
 * @returns {Canvas} Canvas with graph and stats
 */
export function renderWithStats(days, options = {}) {
  // Extract username before passing to renderIsometricChart to avoid double rendering
  const { username, theme = getStyleConfig(), ...chartOptions } = options;
  const canvas = renderIsometricChart(days, { ...chartOptions, theme });
  const stats = calculateStats(days);

  const ctx = canvas.getContext("2d");

  // Calculate scale factor based on canvas size (base size: 1000x600)
  const scaleFactor = Math.min(canvas.width / 1000, canvas.height / 600);

  // Draw contributions box (top right) - scaled and positioned
  const contributionsBoxWidth =
    theme.dimensions.contributionsBoxWidth * scaleFactor;
  const margin = 25 * scaleFactor;
  drawContributionsBox(
    ctx,
    theme,
    stats,
    canvas.width - contributionsBoxWidth - margin,
    margin,
    scaleFactor,
  );

  // Draw streaks box (bottom left) - scaled and positioned
  const streaksBoxHeight =
    theme.dimensions.streaksBoxHeight +
    theme.dimensions.titleHeight +
    theme.dimensions.averageBottomMargin;
  drawStreaksBox(
    ctx,
    theme,
    stats,
    margin,
    canvas.height - streaksBoxHeight * scaleFactor - margin,
    scaleFactor,
  );

  // Draw username credit if provided
  if (username) {
    drawUsernameCredit(ctx, theme, username, canvas.width, canvas.height);
  }

  return canvas;
}

/**
 * Draw contributions statistics box
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} theme - Theme configuration object
 * @param {Object} stats - Statistics object
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} scale - Scale factor for responsive sizing
 */
function drawContributionsBox(ctx, theme, stats, x, y, scale = 1) {
  const boxWidth = theme.dimensions.contributionsBoxWidth * scale;
  const boxHeight = theme.dimensions.contributionsBoxHeight * scale;
  const titleHeight = theme.dimensions.titleHeight * scale;

  // Title (outside, above the box) - aligned with left border of box
  ctx.fillStyle = theme.title.color;
  const titleFontSize = theme.title.fontSize * scale;
  ctx.font = `${theme.title.fontWeight} ${titleFontSize}px "${theme.title.fontFamily}", sans-serif`;
  ctx.fillText("Contributions", x, y + 16 * scale);

  // Box starts below title
  const boxY = y + titleHeight;

  // Drop shadow
  ctx.shadowColor = theme.box.shadowColor;
  ctx.shadowBlur = theme.box.shadowBlur * scale;
  ctx.shadowOffsetX = theme.box.shadowOffsetX * scale;
  ctx.shadowOffsetY = theme.box.shadowOffsetY * scale;

  // Box background (transparent/semi-transparent)
  ctx.fillStyle = theme.box.backgroundColor;
  ctx.beginPath();
  ctx.roundRect(
    x,
    boxY,
    boxWidth,
    boxHeight,
    theme.box.borderRadius * scale,
  );
  ctx.fill();

  // Reset shadow
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // Border
  ctx.strokeStyle = theme.box.borderColor;
  ctx.lineWidth = theme.box.borderWidth * scale;
  ctx.stroke();

  // Stats row
  const itemY = boxY + 12 * scale;

  // Total
  drawFlexStatItem(
    ctx,
    theme,
    stats.countTotal.toString(),
    "Total",
    stats.datesTotal,
    x + 16 * scale,
    itemY,
    scale,
  );

  // This week
  drawFlexStatItem(
    ctx,
    theme,
    stats.weekCountTotal.toString(),
    "This week",
    stats.weekDatesTotal,
    x + 130 * scale,
    itemY,
    scale,
  );

  // Best day
  const bestDayDate = stats.dateBest.includes(" ")
    ? stats.dateBest.split(" ").slice(0, 2).join(" ")
    : stats.dateBest;
  drawFlexStatItem(
    ctx,
    theme,
    stats.maxCount.toString(),
    "Best day",
    bestDayDate,
    x + 250 * scale,
    itemY,
    scale,
  );

  // Average (outside, below the box, right-aligned)
  const avgY =
    boxY + boxHeight + theme.dimensions.averageBottomMargin * scale;
  const avgTextFontSize = theme.averageText.fontSize * scale;
  const avgValueFontSize = theme.averageValue.fontSize * scale;
  const avgUnitFontSize = theme.averageUnit.fontSize * scale;

  ctx.fillStyle = theme.averageText.color;
  ctx.font = `${theme.averageText.fontWeight} ${avgTextFontSize}px "${theme.averageText.fontFamily}", sans-serif`;
  const avgText = "Average:";
  const avgNumText = stats.averageCount.toString();
  const dayText = "/ day";

  const dayWidth = ctx.measureText(dayText).width;
  ctx.font = `${theme.averageValue.fontWeight} ${avgValueFontSize}px "${theme.averageValue.fontFamily}", sans-serif`;
  const numWidth = ctx.measureText(avgNumText).width;
  ctx.font = `${theme.averageText.fontWeight} ${avgTextFontSize}px "${theme.averageText.fontFamily}", sans-serif`;
  const avgWidth = ctx.measureText(avgText).width;

  const spacing = 4 * scale;
  const totalWidth = avgWidth + spacing + numWidth + spacing + dayWidth;
  const startX = x + boxWidth - totalWidth;

  ctx.fillText(avgText, startX, avgY);

  ctx.fillStyle = theme.averageValue.color;
  ctx.font = `${theme.averageValue.fontWeight} ${avgValueFontSize}px "${theme.averageValue.fontFamily}", sans-serif`;
  ctx.fillText(avgNumText, startX + avgWidth + spacing, avgY);

  ctx.fillStyle = theme.averageUnit.color;
  ctx.font = `${theme.averageUnit.fontWeight} ${avgUnitFontSize}px "${theme.averageUnit.fontFamily}", sans-serif`;
  ctx.fillText(dayText, startX + avgWidth + spacing + numWidth + spacing, avgY);
}

/**
 * Draw streaks statistics box
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} theme - Theme configuration object
 * @param {Object} stats - Statistics object
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} scale - Scale factor for responsive sizing
 */
function drawStreaksBox(ctx, theme, stats, x, y, scale = 1) {
  const boxWidth = theme.dimensions.streaksBoxWidth * scale;
  const boxHeight = theme.dimensions.streaksBoxHeight * scale;
  const titleHeight = theme.dimensions.titleHeight * scale;

  // Title (outside, above the box) - aligned with left border of box
  ctx.fillStyle = theme.title.color;
  const titleFontSize = theme.title.fontSize * scale;
  ctx.font = `${theme.title.fontWeight} ${titleFontSize}px "${theme.title.fontFamily}", sans-serif`;
  ctx.fillText("Streaks", x, y + 16 * scale);

  // Box starts below title
  const boxY = y + titleHeight;

  // Drop shadow
  ctx.shadowColor = theme.box.shadowColor;
  ctx.shadowBlur = theme.box.shadowBlur * scale;
  ctx.shadowOffsetX = theme.box.shadowOffsetX * scale;
  ctx.shadowOffsetY = theme.box.shadowOffsetY * scale;

  // Box background (transparent/semi-transparent)
  ctx.fillStyle = theme.box.backgroundColor;
  ctx.beginPath();
  ctx.roundRect(
    x,
    boxY,
    boxWidth,
    boxHeight,
    theme.box.borderRadius * scale,
  );
  ctx.fill();

  // Reset shadow
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // Border
  ctx.strokeStyle = theme.box.borderColor;
  ctx.lineWidth = theme.box.borderWidth * scale;
  ctx.stroke();

  // Stats row
  const itemY = boxY + 12 * scale;

  // Longest
  const longestDays = stats.streakLongest === 1 ? "day" : "days";
  const longestValue = `${stats.streakLongest} ${longestDays}`;
  drawFlexStatItem(
    ctx,
    theme,
    longestValue,
    "Longest",
    stats.datesLongest,
    x + 16 * scale,
    itemY,
    scale,
  );

  // Current
  const currentDays = stats.streakCurrent === 1 ? "day" : "days";
  const currentValue =
    stats.streakCurrent === 0
      ? "0 days"
      : `${stats.streakCurrent} ${currentDays}`;
  const currentSubtext =
    stats.streakCurrent === 0 ? "No current streak" : stats.datesCurrent;
  drawFlexStatItem(
    ctx,
    theme,
    currentValue,
    "Current",
    currentSubtext,
    x + 145 * scale,
    itemY,
    scale,
  );
}

/**
 * Draw a flex stat item (vertical stack: value → label → subtext)
 * Matches HTML structure: d-block f2 text-bold → d-block text-small text-bold → d-block text-small color-fg-muted
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} theme - Theme configuration object
 * @param {string} value - Main value (large, green, bold)
 * @param {string} label - Label text (small, bold, white)
 * @param {string} subtext - Subtext (small, gray, date range)
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} scale - Scale factor for responsive sizing
 */
function drawFlexStatItem(
  ctx,
  theme,
  value,
  label,
  subtext,
  x,
  y,
  scale = 1,
) {
  // Value (large number)
  ctx.fillStyle = theme.value.color;
  const valueFontSize = theme.value.fontSize * scale;
  ctx.font = `${theme.value.fontWeight} ${valueFontSize}px "${theme.value.fontFamily}", sans-serif`;
  ctx.fillText(value, x, y + 22 * scale);

  // Label (Total, This week, etc.)
  ctx.fillStyle = theme.label.color;
  const labelFontSize = theme.label.fontSize * scale;
  ctx.font = `${theme.label.fontWeight} ${labelFontSize}px "${theme.label.fontFamily}", sans-serif`;
  ctx.fillText(label, x, y + 38 * scale);

  // Subtext (date range) - single line
  if (subtext && subtext.length > 0) {
    ctx.fillStyle = theme.subtext.color;
    const subtextFontSize = theme.subtext.fontSize * scale;
    const font = `${theme.subtext.fontWeight} ${subtextFontSize}px "${theme.subtext.fontFamily}", sans-serif`;
    const arrowFont = `${subtextFontSize}px "Segoe UI Symbol", sans-serif`;
    fillTextWithArrows(ctx, subtext, x, y + 54 * scale, font, arrowFont);
  }
}

/**
 * Draw text, switching to the bundled Segoe UI Symbol face for arrows.
 * Segoe UI has no arrow glyphs and canvas would otherwise pick a fallback
 * from whatever fonts the host has installed.
 */
function fillTextWithArrows(ctx, text, x, y, font, arrowFont) {
  let cursor = x;
  for (const run of text.split(/([←-↓]+)/)) {
    if (!run) continue;
    ctx.font = /^[←-↓]+$/.test(run) ? arrowFont : font;
    ctx.fillText(run, cursor, y);
    cursor += ctx.measureText(run).width;
  }
}

/**
 * Draw username credit in bottom right corner
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} theme - Theme configuration object
 * @param {string} username - GitHub username
 * @param {number} canvasWidth - Canvas width
 * @param {number} canvasHeight - Canvas height
 */
function drawUsernameCredit(
  ctx,
  theme,
  username,
  canvasWidth,
  canvasHeight,
) {
  // Save context state
  ctx.save();

  // Calculate scale factor based on canvas size
  const scaleFactor = Math.min(canvasWidth / 1000, canvasHeight / 600);

  // Discrete styling - small, subtle text with scaling
  const fontSize = 11 * scaleFactor;
  const fontFamily = theme.subtext?.fontFamily || "Segoe UI";
  ctx.font = `${fontSize}px "${fontFamily}", sans-serif`;

  // Very subtle color with low opacity
  const baseColor = theme.subtext?.color || "#768390";
  ctx.fillStyle = baseColor;
  ctx.globalAlpha = 0.5; // Make it more discrete

  // Position in bottom right with padding
  const padding = 12 * scaleFactor;
  const text = `@${username}`;
  const textWidth = ctx.measureText(text).width;
  const x = canvasWidth - textWidth - padding;
  const y = canvasHeight - padding;

  ctx.fillText(text, x, y);

  // Restore context state
  ctx.restore();
}