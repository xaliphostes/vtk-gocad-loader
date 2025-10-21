// import vtkPolyData from 'vtk.js/Sources/Common/DataModel/PolyData';
// import vtkPoints from 'vtk.js/Sources//Common/Core/Points';
// import vtkDataArray from 'vtk.js/Sources//Common/Core/DataArray';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkPoints from '@kitware/vtk.js/Common/Core/Points';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkPolyDataNormals from '@kitware/vtk.js/Filters/Core/PolyDataNormals';

export type TSurfParseOptions = {
    computeNormals?: boolean;
    /** If true, ATOM newId shares the same VTK point index as refId (no duplication). */
    shareAtomPoints?: boolean;
    /** Replace any declared NO_DATA value(s) with NaN in arrays. Default: true */
    noDataToNaN?: boolean;
};

export type TSurfPropertyMeta = {
    name: string;
    unit?: string;
    kind?: string;
    size?: number;            // number of components (default 1)
    noData?: number | null;          // a single no-data sentinel (common case)
};

export type TSurfParseResult = {
    polyData: vtkPolyData;
    properties: TSurfPropertyMeta[];
    stats: {
        nVertices: number;
        nTriangles: number;
        skippedTriangles: number;
    };
};

/**
 * Parse a GOCAD TSurf ASCII text and build vtkPolyData with per-vertex properties.
 * Supports VRTX/PVRTX (+ optional property columns), ATOM, and TRGL.
 * Metadata supported: PROPERTIES, PROPERTY_CLASS_HEADER (unit, kind), NO_DATA_VALUES, ESIZES.
 * @example
 * ```ts
 * // Setup scene ...
 * const fs = vtkFullScreenRenderWindow.newInstance();
 * const ren = fs.getRenderer();
 * const rw = fs.getRenderWindow();
 * 
 * // ---------------------------------------------------------------------
 * // Load text (e.g., from file input or fetch)
 * const tsurfText = await fetch('/data/surface.tsurf').then(r => r.text());
 * 
 * const { polyData, properties } = vtkPolyDataFromGocadTSurf(tsurfText, {
 *   computeNormals: true,
 *   noDataToNaN: true,
 * });
 * 
 * // Choose a scalar (first scalar property with size=1)
 * const scalarProp = properties.find(p => (p.size ?? 1) === 1)?.name;
 * // ---------------------------------------------------------------------
 * 
 * const mapper = vtkMapper.newInstance();
 * mapper.setInputData(polyData);
 * mapper.setResolveCoincidentTopologyToPolygonOffset();
 * 
 * // Map by point field data
 * if (scalarProp) {
 *   mapper.setScalarModeToUsePointFieldData();
 *   mapper.setColorModeToMapScalars();
 *   mapper.setArrayName(scalarProp);
 * 
 *   // Compute range ignoring NaNs
 *   const arr = polyData.getPointData().getArrayByName(scalarProp);
 *   if (arr) {
 *     const vals = (arr.getData() as Float32Array);
 *     let min = +Infinity, max = -Infinity;
 *     for (let i = 0; i < vals.length; i++) {
 *       const v = vals[i];
 *       if (Number.isNaN(v)) continue;
 *       if (v < min) min = v;
 *       if (v > max) max = v;
 *     }
 *     if (Number.isFinite(min) && Number.isFinite(max)) {
 *       mapper.setScalarRange(min, max);
 *     }
 *   }
 * }
 * 
 * const actor = vtkActor.newInstance();
 * actor.setMapper(mapper);
 * actor.getProperty().setEdgeVisibility(true);
 * actor.getProperty().setEdgeColor(0.1, 0.1, 0.1);
 * 
 * ren.addActor(actor);
 * ren.resetCamera();
 * rw.render();
 */
export function vtkPolyDataFromGocadTSurf(
    text: string,
    opts: TSurfParseOptions = {}
): TSurfParseResult {
    const {
        computeNormals = false,
        shareAtomPoints = true,
        noDataToNaN = true,
    } = opts;

    // --- metadata containers ---
    let propertyNames: string[] = [];
    let propertyUnits: (string | undefined)[] = [];
    let propertyKinds: (string | undefined)[] = [];
    let propertySizes: (number | undefined)[] = []; // ESIZES
    let noDataValuesList: number[] | null = null;   // can be one per property

    // Parse PROPERTY_CLASS_HEADER blocks to capture units/kind by property name
    const headerUnits = new Map<string, string>();
    const headerKinds = new Map<string, string>();

    // --- geometry containers ---
    const idToIndex = new Map<number, number>(); // GOCAD vertex id -> VTK point index
    const pts: number[] = [];
    const tris: number[] = [];
    let skippedTriangles = 0;

    // --- property value buffers (one array per property, flattened by components) ---
    // We don't know property count until we see PROPERTIES or the first PVRTX with extra columns.
    let propBuffers: number[][] | null = null;     // length = nProps; each holds flat values (components handled below)
    let nPropComponents = 0;                       // sum of ESIZES (or nProps if all size=1)
    let propCompOffsets: number[] = [];            // for multi-component properties: running offsets

    const lines = text.replace(/\r/g, '').split('\n');

    // Helpers -------------------------------------------------
    const addPoint = (x: number, y: number, z: number): number => {
        const idx = (pts.length / 3) | 0;
        pts.push(x, y, z);
        // If properties buffers exist, push placeholders for this new point
        if (propBuffers) {
            for (let p = 0; p < propBuffers.length; p++) {
                const compCount = propertySizes[p] ?? 1;
                for (let c = 0; c < compCount; c++) {
                    propBuffers[p].push(NaN);
                }
            }
        }
        return idx;
    };

    // Prepare property buffers once we know names and sizes
    const ensurePropBuffers = (maybeValueCount?: number) => {
        if (propBuffers) return;

        // If PROPERTIES not declared yet but data columns exist, auto-name: prop_1..N
        if (propertyNames.length === 0 && maybeValueCount && maybeValueCount > 0) {
            propertyNames = Array.from({ length: maybeValueCount }, (_, i) => `prop_${i + 1}`);
        }

        // Default sizes -> 1
        if (propertySizes.length === 0) {
            propertySizes = propertyNames.map(() => 1);
        } else if (propertySizes.length !== propertyNames.length) {
            // If ESIZES count mismatches properties count, normalize
            const n = propertyNames.length;
            propertySizes = Array.from({ length: n }, (_, i) => propertySizes[i] ?? 1);
        }

        // Units/kinds arrays aligned to propertyNames
        if (propertyUnits.length !== propertyNames.length) {
            propertyUnits = propertyNames.map((n, _i) => headerUnits.get(n));
        }
        if (propertyKinds.length !== propertyNames.length) {
            propertyKinds = propertyNames.map((n, _i) => headerKinds.get(n));
        }

        // Precompute total components and offsets
        propCompOffsets = [];
        nPropComponents = 0;
        for (let i = 0; i < propertyNames.length; i++) {
            propCompOffsets.push(nPropComponents);
            nPropComponents += propertySizes[i] ?? 1;
        }

        // init buffers
        propBuffers = propertyNames.map(() => []);

        // If points already exist (e.g., VRTX were parsed before PROPERTIES),
        // backfill NaNs for existing vertices
        const existingPts = (pts.length / 3) | 0;
        if (existingPts > 0) {
            for (let p = 0; p < propBuffers.length; p++) {
                const compCount = propertySizes[p] ?? 1;
                propBuffers[p].length = existingPts * compCount;
                propBuffers[p].fill(NaN);
            }
        }
    };

    // Fill property values for a point index from an array of numbers following z
    const setPropValuesForPoint = (ptIdx: number, values: number[]) => {
        if (!propBuffers) {
            ensurePropBuffers(values.length);
        }
        if (!propBuffers) return; // defensive

        // If we had fewer declared properties than values, extend names
        if (values.length > propertyNames.length) {
            const start = propertyNames.length;
            for (let i = start; i < values.length; i++) {
                propertyNames.push(`prop_${i + 1}`);
                propertySizes.push(1);
                propertyUnits.push(undefined);
                propertyKinds.push(undefined);
                propBuffers.push([]);
            }
            // Backfill existing points for the new properties
            const existingPts = (pts.length / 3) | 0;
            for (let p = start; p < propertyNames.length; p++) {
                propBuffers[p].length = existingPts; // size=1
                propBuffers[p].fill(NaN);
            }
        }

        // Write values (respecting ESIZES per property)
        let cursor = 0;
        for (let p = 0; p < propertyNames.length; p++) {
            const compCount = propertySizes[p] ?? 1;
            for (let c = 0; c < compCount; c++) {
                const val = values[cursor++];
                const arr = propBuffers[p];
                const offset = ptIdx * compCount + c;
                // Ensure length
                if (arr.length <= offset) {
                    arr.length = offset + 1;
                }
                arr[offset] = val;
            }
        }
    };

    // Parse PROPERTY_CLASS_HEADER {...}
    const parsePropertyClassHeader = (line: string, idx: number) => {
        // Example:
        // PROPERTY_CLASS_HEADER Z {
        //   is_z: on
        //   unit: m
        // }
        const m = /^PROPERTY_CLASS_HEADER\s+(\S+)/i.exec(line);
        if (!m) return idx;
        const propName = m[1];
        // Scan subsequent lines until a closing "}" or next header
        let i = idx + 1;
        while (i < lines.length) {
            const L = lines[i].trim();
            if (L.includes('}')) break;
            const unit = /^(unit)\s*:\s*(.+)$/i.exec(L);
            if (unit) headerUnits.set(propName, unit[2]);
            const kind = /^(kind|kind:)\s*:\s*(.+)$/i.exec(L);
            if (kind) headerKinds.set(propName, kind[2]);
            i++;
        }
        return i;
    };

    // --- main loop ---
    for (let li = 0; li < lines.length; li++) {
        const raw = lines[li];
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        if (line === 'END') break;

        // Metadata
        if (/^PROPERTIES\b/i.test(line)) {
            const parts = line.split(/\s+/).slice(1);
            if (parts.length) propertyNames = parts.slice();
            continue;
        }
        if (/^PROPERTY_CLASSES\b/i.test(line)) {
            // Often same list as PROPERTIES; can ignore or use as fallback names
            const parts = line.split(/\s+/).slice(1);
            if (!propertyNames.length && parts.length) propertyNames = parts.slice();
            continue;
        }
        if (/^NO_DATA_VALUES?\b/i.test(line)) {
            const parts = line.split(/\s+/).slice(1).map(parseFloat).filter(Number.isFinite);
            if (parts.length) noDataValuesList = parts as number[];
            continue;
        }
        if (/^ESIZES\b/i.test(line)) {
            const parts = line.split(/\s+/).slice(1).map((s) => parseInt(s, 10));
            if (parts.length) propertySizes = parts.map((v) => (Number.isFinite(v) && v > 0 ? v : 1));
            continue;
        }
        if (/^PROPERTY_CLASS_HEADER\b/i.test(line)) {
            li = parsePropertyClassHeader(line, li);
            continue;
        }

        // VRTX / PVRTX
        if (/^(VRTX|PVRTX)\b/i.test(line)) {
            const parts = line.split(/\s+/);
            if (parts.length >= 5) {
                const id = parseInt(parts[1], 10);
                const x = parseFloat(parts[2]);
                const y = parseFloat(parts[3]);
                const z = parseFloat(parts[4]);
                if ([id, x, y, z].every(Number.isFinite)) {
                    const idx = addPoint(x, y, z);
                    idToIndex.set(id, idx);

                    // Remaining tokens are property columns (if any)
                    if (parts.length > 5) {
                        const vals = parts.slice(5).map(parseFloat).map((v) => (Number.isFinite(v) ? v : NaN));
                        setPropValuesForPoint(idx, vals);
                    } else {
                        // Ensure prop buffers exist if metadata already declared
                        if (propertyNames.length && !propBuffers) ensurePropBuffers();
                    }
                }
            }
            continue;
        }

        // ATOM newId refId
        if (/^ATOM\b/i.test(line)) {
            const parts = line.split(/\s+/);
            if (parts.length >= 3) {
                const id = parseInt(parts[1], 10);
                const ref = parseInt(parts[2], 10);
                const refIdx = idToIndex.get(ref);
                if (refIdx !== undefined) {
                    if (shareAtomPoints) {
                        idToIndex.set(id, refIdx);
                    } else {
                        const px = pts[refIdx * 3 + 0];
                        const py = pts[refIdx * 3 + 1];
                        const pz = pts[refIdx * 3 + 2];
                        const newIdx = addPoint(px, py, pz);
                        idToIndex.set(id, newIdx);
                        // Duplicate property values if we manage props
                        if (propBuffers) {
                            for (let p = 0; p < (propBuffers as number[][]).length; p++) {
                                const comp = propertySizes[p] ?? 1;
                                for (let c = 0; c < comp; c++) {
                                    const src = propBuffers[p][refIdx * comp + c];
                                    propBuffers[p][newIdx * comp + c] = src;
                                }
                            }
                        }
                    }
                }
            }
            continue;
        }

        // TRGL a b c
        if (/^TRGL\b/i.test(line)) {
            const parts = line.split(/\s+/);
            if (parts.length >= 4) {
                const a = idToIndex.get(parseInt(parts[1], 10));
                const b = idToIndex.get(parseInt(parts[2], 10));
                const c = idToIndex.get(parseInt(parts[3], 10));
                if (
                    a !== undefined &&
                    b !== undefined &&
                    c !== undefined &&
                    a !== b &&
                    b !== c &&
                    c !== a
                ) {
                    tris.push(a, b, c);
                } else {
                    skippedTriangles++;
                }
            }
            continue;
        }

        // ignore other records (HEADER, TFACE, BSTONE, BORDER, etc.)
    }

    if (pts.length === 0) throw new Error('TSurf parse: no vertices found (need VRTX/PVRTX).');
    if (tris.length === 0) throw new Error('TSurf parse: no triangles found (need TRGL).');

    // If metadata declared but we never saw any property values, still init arrays
    if (propertyNames.length && !propBuffers) ensurePropBuffers();

    // Replace no-data with NaN if requested
    if (noDataToNaN && propBuffers && noDataValuesList) {
        // If only one value provided, apply to all properties
        const perPropNoData =
            noDataValuesList.length === propertyNames.length
                ? noDataValuesList
                : propertyNames.map(() => noDataValuesList![0]);

        for (let p = 0; p < (propBuffers as number[][]).length; p++) {
            const nd = perPropNoData[p];
            if (Number.isFinite(nd)) {
                const arr = propBuffers[p];
                for (let i = 0; i < (arr as number[]).length; i++) {
                    if (arr[i] === nd) (arr[i] as number) = NaN;
                }
            }
        }
    }

    // Build vtkPolyData
    const polyData = vtkPolyData.newInstance();

    const vtkPts = vtkPoints.newInstance();
    vtkPts.setData(Float32Array.from(pts), 3);
    polyData.setPoints(vtkPts);

    const nTri = tris.length / 3;
    const cells = new Uint32Array(nTri * 4);
    for (let t = 0; t < nTri; t++) {
        const base = t * 4;
        cells[base] = 3;
        cells[base + 1] = tris[t * 3 + 0];
        cells[base + 2] = tris[t * 3 + 1];
        cells[base + 3] = tris[t * 3 + 2];
    }
    polyData.getPolys().setData(cells);

    // Attach point-data arrays
    if (propBuffers && propertyNames.length) {
        for (let p = 0; p < propertyNames.length; p++) {
            const name = propertyNames[p];
            const size = propertySizes[p] ?? 1;
            const values = Float32Array.from(propBuffers[p]);
            const da = vtkDataArray.newInstance({
                name,
                numberOfComponents: size,
                values,
            });
            // You may set unit/kind as "information keys" on the array if needed
            // (vtk.js doesn't have a built-in unit field; you can store on metadata)
            // (da as any).unit = propertyUnits[p];
            // (da as any).kind = propertyKinds[p];
            polyData.getPointData().addArray(da);

            // Convenience: set first scalar array as active if components = 1
            if (p === 0 && size === 1) {
                polyData.getPointData().setScalars(da);
            }
        }
    }

    if (computeNormals) {
        const normals = vtkPolyDataNormals.newInstance({
            splitting: true,
            featureAngle: 45,
            consistency: true,
            nonManifoldTraversal: true,
            computePointNormals: true,
            computeCellNormals: false,
        });
        normals.setInputData(polyData);
        polyData.shallowCopy(normals.getOutputData());
    }

    // Prepare property meta to return
    const properties: TSurfPropertyMeta[] = propertyNames.map((name, i) => ({
        name,
        unit: propertyUnits[i],
        kind: propertyKinds[i],
        size: propertySizes[i] ?? 1,
        noData:
            noDataValuesList && (noDataValuesList.length === propertyNames.length
                ? noDataValuesList[i]
                : noDataValuesList[0]),
    }));

    return {
        polyData,
        properties,
        stats: {
            nVertices: vtkPts.getNumberOfPoints(),
            nTriangles: nTri,
            skippedTriangles,
        },
    };
}
