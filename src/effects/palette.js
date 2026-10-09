// Cosine palette shared by all effects (same formula as the GLSL `palette()`).
export const PALETTE_GLSL = /* glsl */ `
vec3 palette(float t) { return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67))); }
`;

// Writes into `out[offset..offset+2]` to avoid allocations.
export function paletteInto(t, out, offset) {
  const k = 6.28318;
  out[offset] = 0.5 + 0.5 * Math.cos(k * t);
  out[offset + 1] = 0.5 + 0.5 * Math.cos(k * (t + 0.33));
  out[offset + 2] = 0.5 + 0.5 * Math.cos(k * (t + 0.67));
}
