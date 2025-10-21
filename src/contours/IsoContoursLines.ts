/**
 * Iso-contour line generation
 * VTK-agnostic implementation using IColorMapPreset interface
 */

import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from "./attributes";
import type { IColorMapPreset } from "../types/vtkColorMapPreset";
import {
    createLookupTable,
    sampleLookupTable,
    DEFAULT_PRESET,
} from "./vtkColorUtils";
import { MarchingTriangles } from "./MarchingTriangle";

export type IsoLineReturnedType = {
    positions: number[],
    color?: number[]
}

/**
 * Create iso-contour lines from geometry and scalar attribute
 * @param mesh BufferGeometry with positions and indices
 * @param attribute Scalar attribute values (one per vertex)
 * @param isoList Array of iso-values for contour lines
 * @param options Configuration options
 * @returns Line positions and colors
 */
export function createIsoContourLines(
    mesh: BufferGeometry,
    attribute: number[],
    isoList: number[],
    {
        preset = DEFAULT_PRESET,
        nbColors = 128
    }: {
        preset?: IColorMapPreset,
        nbColors?: number
    } = {}
): IsoLineReturnedType {
    if (mesh === undefined) {
        throw new Error('mesh is undefined');
    }

    if (mesh.getPositions() === undefined) {
        throw new Error('mesh.positions is undefined');
    }

    if (mesh.getIndices() === undefined) {
        throw new Error('mesh.indices is undefined');
    }

    if (attribute === undefined) {
        throw new Error('attribute is undefined');
    }

    // Compute min/max
    const mm = minMax(attribute);
    const vmin = mm[0];
    const vmax = mm[1];

    // Create lookup table from preset
    const lookupTable = createLookupTable(preset, nbColors);

    const isoValues = isoList;

    const algo = new MarchingTriangles();
    algo.setup(mesh.getIndices() as Uint32BufferAttribute, [vmin, vmax]);

    const vertices = mesh.getPositions() as Float32BufferAttribute;
    const positions: number[] = [];
    const colors: number[] = [];

    const normalizeAttr = (v: number) => (v - vmin) / (vmax - vmin);

    for (let i = 0; i < isoValues.length; ++i) {
        const result = algo.isolines(attribute, isoValues[i]);

        // Get color for this iso-value
        const normalizedValue = normalizeAttr(isoValues[i]);
        const c = sampleLookupTable(normalizedValue, lookupTable);
        colors.push(...c);

        for (let k = 0; k < result[0].length; ++k) {
            for (let l = 0; l < result[0][k].length - 2; l += 2) {
                const i1 = result[0][k][l];
                const i2 = result[0][k][l + 1];
                const c = result[1][k][l / 2];

                const v1 = vertices.get(i1);
                const v2 = vertices.get(i2);
                const v1x = v1[0];
                const v1y = v1[1];
                const v1z = v1[2];
                const v2x = v2[0];
                const v2y = v2[1];
                const v2z = v2[2];

                positions.push(
                    v1x + c * (v2x - v1x),
                    v1y + c * (v2y - v1y),
                    v1z + c * (v2z - v1z)
                );
            }
        }
    }

    return {
        positions: positions,
        color: colors
    };
}

/**
 * Compute the minimum and maximum value of an array in one pass
 */
function minMax(array: Array<number>): Array<number> {
    let m = Number.POSITIVE_INFINITY;
    let M = Number.NEGATIVE_INFINITY;
    const n = array.length;
    for (let i = 0; i < n; ++i) {
        const a = array[i];
        if (a < m) m = a;
        if (a > M) M = a;
    }
    return [m, M];
}