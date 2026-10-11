import { NAMED_HEX } from "./color-names.mjs";

export const COLOR_KEYWORDS = new Set([...Object.keys(NAMED_HEX), "transparent", "currentcolor"]);
export const COLOR_FUNCTIONS = new Set([
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "hwb",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "color",
]);
export const HEX_DIGITS = /^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function fromHex(digits) {
  const full = digits.length <= 4 ? [...digits].map((digit) => digit + digit).join("") : digits;
  const channel = (index) => parseInt(full.slice(index, index + 2), 16) / 255;
  return { r: channel(0), g: channel(2), b: channel(4), alpha: full.length === 8 ? channel(6) : 1 };
}

function number(part, percentScale = 1) {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|grad|rad|turn)?$/i.exec(part);
  if (!match) return part.toLowerCase() === "none" ? 0 : null;
  const value = Number(match[1]);
  switch (match[2]?.toLowerCase()) {
    case "%":
      return (value / 100) * percentScale;
    case "grad":
      return value * 0.9;
    case "rad":
      return (value * 180) / Math.PI;
    case "turn":
      return value * 360;
    default:
      return value;
  }
}

function hslToRgb(hue, saturation, lightness) {
  const h = (((hue % 360) + 360) % 360) / 30;
  const a = saturation * Math.min(lightness, 1 - lightness);
  const f = (n) => {
    const k = (n + h) % 12;
    return lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return { r: f(0), g: f(8), b: f(4) };
}

function linearToSrgb(value) {
  return value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
}

function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function oklabToRgb(lightness, a, b) {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

export function toOklab({ r, g, b }) {
  const [lr, lg, lb] = [r, g, b].map(srgbToLinear);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function channels(args) {
  const parts = args
    .replace(/\//g, " / ")
    .split(/[\s,]+/)
    .filter(Boolean);
  const slash = parts.indexOf("/");
  if (slash !== -1) return { values: parts.slice(0, slash), alpha: parts.slice(slash + 1) };
  return { values: parts.slice(0, 3), alpha: parts.slice(3) };
}

function fromFunction(name, args) {
  const { values, alpha } = channels(args);
  if (values.length !== 3 || alpha.length > 1) return null;
  const opacity = alpha.length ? number(alpha[0], 1) : 1;
  if (opacity === null) return null;
  const color = channelsFor(name, values);
  return color ? { ...color, alpha: opacity } : null;
}

function channelsFor(name, values) {
  switch (name) {
    case "rgb":
    case "rgba": {
      const [r, g, b] = values.map((part) => number(part, 255));
      return [r, g, b].includes(null) ? null : { r: r / 255, g: g / 255, b: b / 255 };
    }
    case "hsl":
    case "hsla": {
      const [h, s, l] = [number(values[0]), number(values[1], 100), number(values[2], 100)];
      return [h, s, l].includes(null) ? null : hslToRgb(h, s / 100, l / 100);
    }
    case "hwb": {
      const [h, white, black] = [number(values[0]), number(values[1], 100), number(values[2], 100)];
      if ([h, white, black].includes(null)) return null;
      const [w, b] = [white / 100, black / 100];
      if (w + b >= 1) return { r: w / (w + b), g: w / (w + b), b: w / (w + b) };
      const pure = hslToRgb(h, 1, 0.5);
      const mix = (c) => c * (1 - w - b) + w;
      return { r: mix(pure.r), g: mix(pure.g), b: mix(pure.b) };
    }
    case "oklab": {
      const [l, a, b] = [number(values[0], 1), number(values[1], 0.4), number(values[2], 0.4)];
      return [l, a, b].includes(null) ? null : oklabToRgb(l, a, b);
    }
    case "oklch": {
      const [l, c, h] = [number(values[0], 1), number(values[1], 0.4), number(values[2])];
      if ([l, c, h].includes(null)) return null;
      const radians = (h * Math.PI) / 180;
      return oklabToRgb(l, c * Math.cos(radians), c * Math.sin(radians));
    }
    default:
      return null;
  }
}

// Returns sRGB channels in 0..1 for the colour forms whose nearest token can be computed, else null.
export function parseColor(text) {
  const value = text.trim().toLowerCase();
  if (value.startsWith("#"))
    return HEX_DIGITS.test(value.slice(1)) ? fromHex(value.slice(1)) : null;
  if (Object.hasOwn(NAMED_HEX, value)) return fromHex(NAMED_HEX[value]);
  if (value === "transparent") return { r: 0, g: 0, b: 0, alpha: 0 };
  const call = /^([a-z]+)\(([^()]*)\)$/.exec(value);
  return call ? fromFunction(call[1], call[2]) : null;
}

export function colorDistance(left, right) {
  const [a, b] = [toOklab(left), toOklab(right)];
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function nearestToken(color, palette) {
  let best = null;
  for (const entry of palette) {
    const distance = colorDistance(color, entry.color);
    if (best === null || distance < best.distance)
      best = { name: entry.name, distance, alpha: entry.color.alpha };
  }
  return best;
}
