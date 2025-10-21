// vtkIsoContoursLines.ts
// A vtk.js filter that wraps the custom iso-contour line algorithm
// and exposes it as a vtk.js pipeline component.

/* eslint-disable @typescript-eslint/no-explicit-any */
import vtkColorMaps from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';
import macro from '@kitware/vtk.js/macros';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkPoints from '@kitware/vtk.js/Common/Core/Points';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

// Algorithm implementation
import { createIsoContourLines } from './IsoContoursLines';
import { BufferGeometry, BufferAttribute, Uint32BufferAttribute } from './attributes';

import type { IColorMapPreset } from '../types/vtkColorMapPreset';

export interface IsoLinesOptions {
    classHierarchy: string[];
    isoValues: number[];
    scalarArrayName?: string;
    preset?: IColorMapPreset;
    numberOfColors?: number;
}

export interface IsoContoursLinesPublicAPI {
    getIsoValues: () => number[];
    setIsoValues: (vals: number[]) => void;
    getScalarArrayName: () => string | undefined;
    setScalarArrayName: (name: string) => void;
    getPreset: () => IColorMapPreset | undefined;
    setPreset: (preset: IColorMapPreset) => void;
    getNumberOfColors: () => number | undefined;
    setNumberOfColors: (n: number) => void;

    // vtkAlgo hooks
    getInputData: () => vtkPolyData | null;
    setInputData: (pd: vtkPolyData) => void;
    getOutputData?: () => vtkPolyData | null;
    getOutputPort?: () => any;
    requestData?: (inData: any, outData: any) => void;
    modified?: () => void;
}

/**
 * Get a VTK preset by name
 */
function getPresetByName(name: string): IColorMapPreset | null {
    return (vtkColorMaps as any).getPresetByName?.(name) ?? null;
}

/**
 * Get default Rainbow preset
 */
function getDefaultPreset(): IColorMapPreset {
    return getPresetByName('Rainbow') || {
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
}

/**
 * List available preset names
 */
export function listIsoLinePresetNames(): string[] {
    return (vtkColorMaps as any).rgbPresetNames as string[];
}

/**
 * List all available presets
 */
export function listIsoLinePresets(): IColorMapPreset[] {
    return listIsoLinePresetNames()
        .map((n) => getPresetByName(n))
        .filter((p): p is IColorMapPreset => p !== null);
}

// ----------------------------------------------------------------------------
// Helper: extract triangles from vtkPolyData polys connectivity
// ----------------------------------------------------------------------------
function polysToTriangles(polys: Uint32Array | number[]): number[] {
    const out: number[] = [];
    let i = 0;
    const a = polys as any;
    while (i < a.length) {
        const n = a[i++];
        if (n === 3) {
            const i0 = a[i++];
            const i1 = a[i++];
            const i2 = a[i++];
            out.push(i0, i1, i2);
        } else if (n > 3) {
            // fan triangulation
            const v0 = a[i++];
            let prev = a[i++];
            for (let k = 2; k < n; k += 1) {
                const vk = a[i++];
                out.push(v0, prev, vk);
                prev = vk;
            }
        } else {
            // skip degenerate
            for (let k = 0; k < n; k += 1) i++;
        }
    }
    return out;
}

// ----------------------------------------------------------------------------
// vtk class implementation
// ----------------------------------------------------------------------------
function vtkIsoContoursLines(publicAPI: IsoContoursLinesPublicAPI, model: Partial<IsoLinesOptions>) {
    // Defaults
    const defaults: IsoLinesOptions = {
        classHierarchy: [],
        isoValues: [],
        scalarArrayName: undefined,
        preset: getDefaultPreset(),
        numberOfColors: 128,
    } as any;

    Object.assign(model, defaults, model);

    // Base vtk object API
    macro.obj(publicAPI as any, model as any);

    // 1 input, 1 output
    macro.algo(publicAPI as any, model as any, 1, 1);
    model.classHierarchy!.push('vtkIsoContoursLines');

    // Expose setters/getters
    macro.setGet(publicAPI as any, model as any, ['isoValues', 'scalarArrayName', 'preset', 'numberOfColors']);

    // --------------------------------------------------------------------------
    // Core execution
    // --------------------------------------------------------------------------
    publicAPI.requestData = (_inData: any, outData: any) => {
        const input: vtkPolyData = publicAPI.getInputData() as vtkPolyData;
        if (!input) {
            outData[0] = vtkPolyData.newInstance();
            return;
        }

        const points = input.getPoints();
        const polys = input.getPolys();

        if (!points || !polys) {
            outData[0] = vtkPolyData.newInstance();
            return;
        }

        // Scalars: prefer named array, else use active
        let scalars = null as any;
        const pd = input.getPointData();
        if (model.scalarArrayName) {
            scalars = pd.getArrayByName(model.scalarArrayName);
        }
        if (!scalars) scalars = pd.getScalars();
        if (!scalars) {
            // No scalars => nothing to do
            outData[0] = vtkPolyData.newInstance();
            return;
        }

        const posArray = (points.getData() as Float32Array) || new Float32Array(0);
        const triIndices = polysToTriangles((polys.getData() as Uint32Array) || new Uint32Array(0));
        const scalarValues = Array.from((scalars.getData() as Float32Array | Uint16Array | Uint32Array));

        // Build BufferGeometry wrapper
        const geom = new BufferGeometry(
            new BufferAttribute(new Float32Array(posArray), 3),
            new Uint32BufferAttribute(new Uint32Array(triIndices), 1)
        );

        const opts: { preset?: IColorMapPreset; nbColors?: number } = {};
        if (model.preset) opts.preset = model.preset;
        if (model.numberOfColors) opts.nbColors = model.numberOfColors;

        const result = createIsoContourLines(
            geom,
            scalarValues,
            model.isoValues || [],
            opts
        );

        const output = vtkPolyData.newInstance();

        if (!result || !result.positions || result.positions.length === 0) {
            outData[0] = output; // empty
            return;
        }

        // Points
        const outPoints = vtkPoints.newInstance();
        outPoints.setData(Float32Array.from(result.positions), 3);
        output.setPoints(outPoints);

        // Lines (pairs of points)
        const numPoints = result.positions.length / 3;
        const numLines = Math.floor(numPoints / 2);

        // Create line cells: [2, id0, id1, 2, id2, id3, ...]
        const lines = new Uint32Array(numLines * 3);
        for (let i = 0; i < numLines; i++) {
            lines[i * 3] = 2;
            lines[i * 3 + 1] = i * 2;
            lines[i * 3 + 2] = i * 2 + 1;
        }
        output.getLines().setData(lines);

        // Colors as point data if available
        if (result.color && result.color.length > 0) {
            // Expand colors to per-point (currently one color per iso-value)
            const pointColors = new Float32Array(numPoints * 3);
            const numIsoValues = result.color.length / 3;

            if (numIsoValues > 0) {
                const pointsPerIso = Math.floor(numPoints / numIsoValues);
                for (let i = 0; i < numIsoValues; i++) {
                    const colorR = result.color[i * 3];
                    const colorG = result.color[i * 3 + 1];
                    const colorB = result.color[i * 3 + 2];

                    const startPoint = i * pointsPerIso;
                    const endPoint = (i === numIsoValues - 1) ? numPoints : (i + 1) * pointsPerIso;

                    for (let p = startPoint; p < endPoint; p++) {
                        pointColors[p * 3] = colorR;
                        pointColors[p * 3 + 1] = colorG;
                        pointColors[p * 3 + 2] = colorB;
                    }
                }
            }

            const colorDA = vtkDataArray.newInstance({
                name: 'IsoLineColor',
                numberOfComponents: 3,
                values: pointColors,
            });
            output.getPointData().setScalars(colorDA);
        }

        outData[0] = output;
    };
}

// ----------------------------------------------------------------------------
// Object factory
// ----------------------------------------------------------------------------
export function extend(publicAPI: any, model: Partial<IsoLinesOptions> = {}) {
    vtkIsoContoursLines(publicAPI as any, model);
}

export const newInstance = macro.newInstance(extend, 'vtkIsoContoursLines');

export default { newInstance, extend };

/*
USAGE EXAMPLE
-------------

import vtkPolyData from 'vtk.js/Sources/Common/DataModel/PolyData';
import vtkMapper from 'vtk.js/Sources/Rendering/Core/Mapper';
import vtkActor from 'vtk.js/Sources/Rendering/Core/Actor';
import vtkColorMaps from 'vtk.js/Sources/Rendering/Core/ColorTransferFunction/ColorMaps';
import vtkIsoContoursLines, { newInstance as newIsoLines } from './vtkIsoContoursLines';

// Get a VTK preset
const viridisPreset = vtkColorMaps.getPresetByName('Viridis (matplotlib)');

const lines = newIsoLines({
  isoValues: [0.1, 0.2, 0.3, 0.4, 0.5],
  scalarArrayName: 'Temperature',
  preset: viridisPreset,
  numberOfColors: 128,
});

lines.setInputData(myTriangulatedPolyDataWithPointScalars);

const mapper = vtkMapper.newInstance();
mapper.setInputConnection(lines.getOutputPort());
mapper.setColorModeToDirectScalars();

const actor = vtkActor.newInstance();
actor.setMapper(mapper);
actor.getProperty().setLineWidth(2);
*/