// vtkIsoContoursFilled.ts
// A vtk.js filter that wraps your custom iso-contour band filling algorithm
// from IsoContoursFilled.ts and exposes it as a vtk.js pipeline component.

// import macro from 'vtk.js/Sources//macros'
// import vtkPolyData from 'vtk.js/Sources/Common/DataModel/PolyData'
// import vtkDataArray from 'vtk.js/Sources/Common/Core/DataArray'
// import vtkPoints from 'vtk.js/Sources/Common/Core/Points'

import macro from '@kitware/vtk.js/macros'
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkPoints from '@kitware/vtk.js/Common/Core/Points';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
//import vtkPolyDataNormals from '@kitware/vtk.js/Filters/Core/PolyDataNormals';

// Your algo (provided in the upload). We use it as a black box here.
import { createIsoContoursFilled } from './IsoContoursFilled';
import { BufferGeometry, BufferAttribute, Uint32BufferAttribute } from './attributes';

export interface IsoContoursFilledModel {
    classHierarchy: string[];
    isoValues: number[];
    scalarArrayName?: string;
    scalarRange?: [number, number] | null;
    lut?: string;
    numberOfColors?: number;
}

export interface IsoContoursFilledPublicAPI {
    getIsoValues: () => number[];
    setIsoValues: (vals: number[]) => void;
    getScalarArrayName: () => string | undefined;
    setScalarArrayName: (name: string) => void;
    getScalarRange: () => [number, number] | null | undefined;
    setScalarRange: (range: [number, number] | null) => void;
    getLut: () => string | undefined;
    setLut: (lut: string) => void;
    getNumberOfColors: () => number | undefined;
    setNumberOfColors: (n: number) => void;

    // vtkAlgo hooks (macro.algo will add these at runtime)
    getInputData: () => vtkPolyData | null;
    setInputData: (pd: vtkPolyData) => void;
    getOutputData?: () => vtkPolyData | null;
    getOutputPort?: () => any;
    // The pipeline callback we define below
    requestData?: (inData: any, outData: any) => void;
    modified?: () => void;
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
function vtkIsoContoursFilled(publicAPI: IsoContoursFilledPublicAPI, model: Partial<IsoContoursFilledModel>) {
    // Defaults
    const defaults: IsoContoursFilledModel = {
        classHierarchy: [],
        isoValues: [],
        scalarArrayName: undefined,
        scalarRange: null,
        lut: 'Rainbow',
        numberOfColors: 256,
    } as any;

    Object.assign(model, defaults, model);

    // Base vtk object API (adds `modified`, events, etc.)
    macro.obj(publicAPI as any, model as any);

    // 1 input, 1 output
    macro.algo(publicAPI as any, model as any, 1, 1);
    model.classHierarchy!.push('vtkIsoContoursFilled');

    // Expose setters/getters
    macro.setGet(publicAPI as any, model as any, ['isoValues']);
    macro.setGet(publicAPI as any, model as any, ['scalarArrayName', 'lut', 'numberOfColors']);
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

        // Build our lightweight BufferGeometry wrapper expected by your algo
        const geom = new BufferGeometry(
            new BufferAttribute(new Float32Array(posArray), 3),
            new Uint32BufferAttribute(new Uint32Array(triIndices), 1)
        );

        const opts: { min?: number; max?: number; lut?: string; nbColors?: number } = {};
        if (model.scalarRange && model.scalarRange.length === 2) {
            opts.min = model.scalarRange[0];
            opts.max = model.scalarRange[1];
        }
        if (model.lut) opts.lut = model.lut;
        if (model.numberOfColors) opts.nbColors = model.numberOfColors;

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

        outData[0] = output;
    };
}

// ----------------------------------------------------------------------------
// Object factory
// ----------------------------------------------------------------------------
export function extend(publicAPI: any, model: Partial<IsoContoursFilledModel> = {}) {
    vtkIsoContoursFilled(publicAPI as any, model);
}

export const newInstance = macro.newInstance(extend, 'vtkIsoContoursFilled');

export default { newInstance, extend };

/*
USAGE EXAMPLE
-------------

import vtkPolyData from 'vtk.js/Sources/Common/DataModel/PolyData';
import vtkMapper from 'vtk.js/Sources/Rendering/Core/Mapper';
import vtkActor from 'vtk.js/Sources/Rendering/Core/Actor';
import vtkIsoContoursFilled, { newInstance as newIsoBands } from './vtkIsoContoursFilled';

const bands = newIsoBands({
  isoValues: [0.1, 0.2, 0.3, 0.4, 0.5],
  scalarArrayName: 'Temperature',
  scalarRange: [min, max],
  lut: 'Rainbow',
  numberOfColors: 128,
});

bands.setInputData(myTriangulatedPolyDataWithPointScalars);

const mapper = vtkMapper.newInstance({ scalarMode: 0, colorByArrayName: 'IsoBandColor' });
mapper.setInputConnection(bands.getOutputPort());
const actor = vtkActor.newInstance();
actor.setMapper(mapper);
*/
