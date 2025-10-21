/**
 * Utility functions for working with VTK ColorMap Presets
 * VTK-agnostic implementation that works with the IColorMapPreset interface
 */

import type { IColorMapPreset } from '../types/vtkColorMapPreset';

/**
 * RGB color tuple [r, g, b] with values in range [0, 1]
 */
export type RGBColor = [number, number, number];

/**
 * Linearly interpolate between two colors
 * @param color1 First color [r, g, b]
 * @param color2 Second color [r, g, b]
 * @param t Interpolation factor [0, 1]
 * @returns Interpolated color [r, g, b]
 */
export function lerpColor(color1: RGBColor, color2: RGBColor, t: number): RGBColor {
    if (t < 0 || t > 1) {
        throw new Error(`Interpolation factor t must be between 0 and 1, got ${t}`);
    }
    return [
        color1[0] + (color2[0] - color1[0]) * t,
        color1[1] + (color2[1] - color1[1]) * t,
        color1[2] + (color2[2] - color1[2]) * t
    ];
}

/**
 * Convert a normalized value [0, 1] to an RGB color using a VTK preset
 * @param value Normalized value [0, 1]
 * @param preset VTK color map preset
 * @returns RGB color [r, g, b] in range [0, 1]
 */
export function valueToColor(value: number, preset: IColorMapPreset): RGBColor {
    if (value < 0 || value > 1) {
        throw new Error(`Value must be normalized to [0, 1], got ${value}`);
    }

    // Handle NaN with NanColor if provided
    if (Number.isNaN(value) && preset.NanColor) {
        return preset.NanColor;
    }

    const points = preset.RGBPoints;
    if (!points || points.length < 4) {
        throw new Error('Invalid preset: RGBPoints must have at least 4 values');
    }

    // RGBPoints format: [value1, r1, g1, b1, value2, r2, g2, b2, ...]
    const numPoints = points.length / 4;

    // Handle edge cases
    if (value <= points[0]) {
        return [points[1], points[2], points[3]];
    }
    if (value >= points[(numPoints - 1) * 4]) {
        const lastIdx = (numPoints - 1) * 4;
        return [points[lastIdx + 1], points[lastIdx + 2], points[lastIdx + 3]];
    }

    // Find the two control points that bracket this value
    for (let i = 0; i < numPoints - 1; i++) {
        const idx1 = i * 4;
        const idx2 = (i + 1) * 4;

        const val1 = points[idx1];
        const val2 = points[idx2];

        if (value >= val1 && value <= val2) {
            // Interpolate between these two points
            const t = (value - val1) / (val2 - val1);
            const color1: RGBColor = [points[idx1 + 1], points[idx1 + 2], points[idx1 + 3]];
            const color2: RGBColor = [points[idx2 + 1], points[idx2 + 2], points[idx2 + 3]];
            return lerpColor(color1, color2, t);
        }
    }

    // Fallback (should not reach here)
    return [0.5, 0.5, 0.5];
}

/**
 * Normalize RGBPoints to [0, 1] range
 * VTK presets may have RGBPoints with arbitrary value ranges
 * @param preset VTK color map preset
 * @returns New preset with normalized RGBPoints
 */
export function normalizePreset(preset: IColorMapPreset): IColorMapPreset {
    const points = preset.RGBPoints;
    if (!points || points.length < 4) {
        return preset;
    }

    const numPoints = points.length / 4;

    // Find min and max values
    let minVal = points[0];
    let maxVal = points[0];
    for (let i = 0; i < numPoints; i++) {
        const val = points[i * 4];
        if (val < minVal) minVal = val;
        if (val > maxVal) maxVal = val;
    }

    // Already normalized
    if (minVal === 0 && maxVal === 1) {
        return preset;
    }

    // Normalize values to [0, 1]
    const range = maxVal - minVal;
    if (range === 0) {
        return preset;
    }

    const normalizedPoints = new Array(points.length);
    for (let i = 0; i < numPoints; i++) {
        const idx = i * 4;
        normalizedPoints[idx] = (points[idx] - minVal) / range;
        normalizedPoints[idx + 1] = points[idx + 1];
        normalizedPoints[idx + 2] = points[idx + 2];
        normalizedPoints[idx + 3] = points[idx + 3];
    }

    return {
        ...preset,
        RGBPoints: normalizedPoints
    };
}

/**
 * Create a lookup table from a preset with specified number of colors
 * @param preset VTK color map preset
 * @param numberOfColors Number of discrete colors to generate
 * @returns Array of RGB colors
 */
export function createLookupTable(
    preset: IColorMapPreset,
    numberOfColors: number = 256
): RGBColor[] {
    const normalizedPreset = normalizePreset(preset);
    const lut: RGBColor[] = [];

    for (let i = 0; i < numberOfColors; i++) {
        const t = i / (numberOfColors - 1);
        lut.push(valueToColor(t, normalizedPreset));
    }

    return lut;
}

/**
 * Sample a color from a lookup table using a normalized value
 * @param value Normalized value [0, 1]
 * @param lut Lookup table (array of RGB colors)
 * @returns RGB color [r, g, b]
 */
export function sampleLookupTable(value: number, lut: RGBColor[]): RGBColor {
    if (value < 0 || value > 1) {
        throw new Error(`Value must be normalized to [0, 1], got ${value}`);
    }
    if (Number.isNaN(value)) {
        return [0.5, 0.5, 0.5]; // Default gray for NaN
    }

    const index = Math.round(value * (lut.length - 1));
    return lut[Math.min(index, lut.length - 1)];
}

/**
 * Default presets for fallback (basic Rainbow)
 */
export const DEFAULT_PRESET: IColorMapPreset = {
    Name: 'Rainbow',
    RGBPoints: [
        0.0, 1.0, 0.0, 0.0,  // Red
        0.2, 1.0, 0.98, 0.0, // Yellow
        0.4, 0.0, 1.0, 0.02, // Green
        0.6, 0.0, 0.98, 1.0, // Cyan
        0.8, 0.02, 0.0, 1.0, // Blue
        1.0, 0.96, 0.0, 1.0  // Magenta
    ]
};