// vtkIsoContoursFilled.ts
// A vtk.js filter that wraps the custom iso-contour band filling algorithm
// FIXED VERSION: Properly adds normals to the output polydata

/* eslint-disable @typescript-eslint/no-explicit-any */
import vtkColorMaps from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';

import macro from '@kitware/vtk.js/macros';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkPoints from '@kitware/vtk.js/Common/Core/Points';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

// Updated algorithm using VTK preset interface
import { createIsoContoursFilled } from './IsoContoursFilled';
import { BufferGeometry, BufferAttribute, Uint32BufferAttribute } from './attributes';

import type { IColorMapPreset } from '../types/vtkColorMapPreset';

export interface IsoFilledOptions {
    classHierarchy: string[];
    isoValues: number[];
    scalarArrayName?: string;
    scalarRange?: [number, number] | null;
    preset?: IColorMapPreset;
    numberOfColors?: number;
    smooth: boolean;
}

export interface IsoContoursFilledPublicAPI {
    getIsoValues: () => number[];
    setIsoValues: (vals: number[]) => void;
    getScalarArrayName: () => string | undefined;
    setScalarArrayName: (name: string) => void;
    getScalarRange: () => [number, number] | null | undefined;
    setScalarRange: (range: [number, number] | null) => void;
    getSmooth: () => boolean
    setSmooth: (s: boolean) => void
    getPreset: () => IColorMapPreset | undefined;
    setPreset: (preset: IColorMapPreset) => void;
    getNumberOfColors: () => number | undefined;
    setNumberOfColors: (n: number) => void;

    // vtkAlgo hooks (macro.algo will add these at runtime)
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
 * List available preset names
 */
export function listIsoPresetNames(): string[] {
    return (vtkColorMaps as any).rgbPresetNames as string[];
}

/**
 * List all available presets
 */
export function listIsoPresets(): IColorMapPreset[] {
    return listIsoPresetNames()
        .map((n) => getPresetByName(n))
        .filter((p): p is IColorMapPreset => p !== null);
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

// ----------------------------------------------------------------------------
// Helper: extract triangles from vtkPolyData polys connectivity (n,id,id,id ...)
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
            // fan triangulation: (v0, v1, v2), (v0, v2, v3), ...
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
function vtkIsoContoursFilled(publicAPI: IsoContoursFilledPublicAPI, model: Partial<IsoFilledOptions>) {
    // Defaults
    const defaults: IsoFilledOptions = {
        classHierarchy: [],
        isoValues: [],
        scalarArrayName: undefined,
        scalarRange: null,
        preset: getDefaultPreset(),
        numberOfColors: 256,
        smooth: true
    } as any;

    Object.assign(model, defaults, model);

    // Base vtk object API (adds `modified`, events, etc.)
    macro.obj(publicAPI as any, model as any);

    // 1 input, 1 output
    macro.algo(publicAPI as any, model as any, 1, 1);
    model.classHierarchy!.push('vtkIsoContoursFilled');

    // Expose setters/getters
    macro.setGet(publicAPI as any, model as any, ['isoValues', 'scalarArrayName', 'preset', 'numberOfColors', "smooth"]);
    macro.setGetArray(publicAPI as any, model as any, ['scalarRange'], 2);

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
        let scalars = null as vtkDataArray | null;
        const pd = input.getPointData();
        if (model.scalarArrayName) {
            scalars = pd.getArrayByName(model.scalarArrayName) as vtkDataArray;
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

        // Build our lightweight BufferGeometry wrapper expected by the algorithm
        const geom = new BufferGeometry(
            new BufferAttribute(new Float32Array(posArray), 3),
            new Uint32BufferAttribute(new Uint32Array(triIndices), 1)
        );

        const opts: { min?: number; max?: number; preset?: IColorMapPreset; nbColors?: number, smooth?: boolean } = {};
        if (model.scalarRange && model.scalarRange.length === 2) {
            opts.min = model.scalarRange[0];
            opts.max = model.scalarRange[1];
        }
        if (model.preset) opts.preset = model.preset;
        if (model.numberOfColors) opts.nbColors = model.numberOfColors;
        if (model.smooth !== undefined) opts.smooth = model.smooth;

        const result = createIsoContoursFilled(
            geom,
            scalarValues,
            model.isoValues || [],
            opts
        );

        const output = vtkPolyData.newInstance();

        if (!result || !result.position || !result.index) {
            outData[0] = output; // empty
            return;
        }

        // Points
        const outPoints = vtkPoints.newInstance();
        outPoints.setData(Float32Array.from(result.position), 3);
        output.setPoints(outPoints);

        // Polys (triangles)
        const cells = new Uint32Array(result.index.length + Math.floor(result.index.length / 3));
        for (let i = 0, c = 0; i < result.index.length; i += 3) {
            cells[c++] = 3;
            cells[c++] = result.index[i];
            cells[c++] = result.index[i + 1];
            cells[c++] = result.index[i + 2];
        }
        output.getPolys().setData(cells);

        // Colors as point data (Float32 RGB 0..1)
        if (result.color && result.color.length) {
            const colorDA = vtkDataArray.newInstance({
                name: 'IsoBandColor',
                numberOfComponents: 3,
                values: Float32Array.from(result.color),
            });
            output.getPointData().setScalars(colorDA);
        }

        // CRITICAL FIX: Add normals to the output polydata!
        if (result.normal && result.normal.length > 0) {
            const normalDA = vtkDataArray.newInstance({
                name: 'Normals',
                numberOfComponents: 3,
                values: Float32Array.from(result.normal),
            });
            output.getPointData().setNormals(normalDA);
            console.log('✅ Normals added to output:', result.normal.length / 3, 'vertices');
        } else {
            console.warn('⚠️ No normals in result');
        }

        outData[0] = output;
    };
}

// ----------------------------------------------------------------------------
// Object factory
// ----------------------------------------------------------------------------
export function extend(publicAPI: any, model: Partial<IsoFilledOptions> = {}) {
    vtkIsoContoursFilled(publicAPI as any, model);
}

export const newInstance = macro.newInstance(extend, 'vtkIsoContoursFilled');

export default { newInstance, extend };