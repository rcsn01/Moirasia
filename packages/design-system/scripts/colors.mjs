// CSS Color 4 OKLab matrices: https://www.w3.org/TR/css-color-4/#color-conversion-code
// Gamut policy: convert to encoded sRGB, then clamp channels to [0, 1].
const clamp = value => Math.min(1, Math.max(0, value))
const number = "[+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?"
const oklch = new RegExp(`^oklch\\((${number})\\s+(${number})\\s+(${number})(?:\\s*\\/\\s*(${number})(%)?)?\\)$`)
const rgba = new RegExp(`^rgba\\(\\s*(${number})\\s*,\\s*(${number})\\s*,\\s*(${number})\\s*,\\s*(${number})\\s*\\)$`)

export function colorToSrgb(value) {
  if (typeof value !== "string") throw new Error(`Unsupported color: ${JSON.stringify(value)}`)
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value)
  if (hex) return [0, 2, 4].map(offset => parseInt(hex[1].slice(offset, offset + 2), 16) / 255).concat(hex[2] ? parseInt(hex[2], 16) / 255 : 1)
  const rgb = rgba.exec(value)
  if (rgb) {
    const channels = rgb.slice(1).map(Number)
    if (channels.slice(0, 3).some(channel => channel < 0 || channel > 255) || channels[3] < 0 || channels[3] > 1) throw new Error(`Color channels out of range: ${value}`)
    return channels.map((channel, index) => index < 3 ? channel / 255 : channel)
  }
  const match = oklch.exec(value)
  if (!match) throw new Error(`Unsupported color expression: ${value}`)
  const [L, C, h] = match.slice(1, 4).map(Number)
  const alpha = match[4] === undefined ? 1 : Number(match[4]) / (match[5] ? 100 : 1)
  if (![L, C, h, alpha].every(Number.isFinite) || L < 0 || L > 1 || C < 0 || alpha < 0 || alpha > 1) throw new Error(`Color channels out of range: ${value}`)
  const angle = (h % 360) * Math.PI / 180
  const a = C * Math.cos(angle)
  const b = C * Math.sin(angle)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const linear = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
  if (!linear.every(Number.isFinite)) throw new Error(`Color conversion overflow: ${value}`)
  const encode = channel => channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055
  return linear.map(channel => clamp(encode(channel))).concat(alpha)
}

export function opaqueColor(value, surface) {
  const foreground = colorToSrgb(value)
  const background = colorToSrgb(surface)
  if (background[3] !== 1) throw new Error("Opaque color composition requires an opaque surface")
  return foreground.slice(0, 3).map((channel, index) => channel * foreground[3] + background[index] * (1 - foreground[3])).concat(1)
}
