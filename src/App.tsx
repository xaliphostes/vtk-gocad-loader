// App.tsx – Updated to use VTK IColorMapPreset interface
// Supports both filled bands and contour lines

/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useMemo, useRef, useState } from 'react';

// vtk.js
import '@kitware/vtk.js/Rendering/Profiles/Geometry';
import vtkFullScreenRenderWindow from '@kitware/vtk.js/Rendering/Misc/FullScreenRenderWindow';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkColorMaps from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';

import vtkIsoContoursFilled from './contours/vtkIsoContoursFilled';
import vtkIsoContoursLines from './contours/vtkIsoContoursLines';

// Loader (single responsibility: turn a file/text into { polyData, properties })
import ModelLoader from './ModelLoader';

import type { IColorMapPreset } from './types/vtkColorMapPreset';

// --- types ---
type VtkPolyData = any;

// --- helpers ---
function listPresetNames(): string[] {
    const names = (vtkColorMaps as any).rgbPresetNames as string[];
    return Array.isArray(names) && names.length
        ? names
        : ['Viridis (matplotlib)', 'Plasma (matplotlib)', 'Inferno (matplotlib)', 'Magma (matplotlib)', 'Turbo'];
}

function getPresetByName(name: string): IColorMapPreset | null {
    return (vtkColorMaps as any).getPresetByName?.(name) || null;
}

function applyPreset(ctf: any, name: string, range?: [number, number]) {
    const preset = getPresetByName(name);
    if (preset) ctf.applyColorMap(preset);
    if (range) {
        ctf.setMappingRange(range[0], range[1]);
        ctf.updateRange();
    }
}

function finiteRangeOfArray(arr: any): [number, number] {
    const data: number[] = arr.getData?.() ?? [];
    let min = +Infinity, max = -Infinity;
    for (const v of data) {
        if (Number.isNaN(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
    }
    return [min, max];
}

// --- component ---
export default function App() {
    const vtkRootRef = useRef<HTMLDivElement | null>(null);
    const renRef = useRef<any>(null);
    const rwRef = useRef<any>(null);

    // Surface pipeline
    const [surfaceCTF] = useState(() => vtkColorTransferFunction.newInstance());
    const [surfaceMapper] = useState(() => vtkMapper.newInstance());
    const [surfaceActor] = useState(() => vtkActor.newInstance());

    // Iso-contour filled bands pipeline
    const [isoFilter] = useState(() => (vtkIsoContoursFilled as any).newInstance?.({}) ?? null);
    const [isoMapper] = useState(() => vtkMapper.newInstance());
    const [isoActor] = useState(() => vtkActor.newInstance());

    // Iso-contour lines pipeline
    const [isoLinesFilter] = useState(() => (vtkIsoContoursLines as any).newInstance?.({}) ?? null);
    const [isoLinesMapper] = useState(() => vtkMapper.newInstance());
    const [isoLinesActor] = useState(() => vtkActor.newInstance());

    // UI state
    const [bandsEnabled, setBandsEnabled] = useState(false);
    const [bandCount, setBandCount] = useState(13);
    const [linesEnabled, setLinesEnabled] = useState(false);
    const [lineCount, setLineCount] = useState(10);
    const [smoothNormals, setSmoothNormals] = useState(true);

    // data state
    const [polyData, setPolyData] = useState<VtkPolyData | null>(null);
    const [properties, setProperties] = useState<{ name: string; size?: number }[]>([]);

    // UI state
    const [selectedProp, setSelectedProp] = useState('');
    const [preset, setPreset] = useState('rainbow');

    // Single instance of the loader
    const loaderRef = useRef<any>(null);
    if (!loaderRef.current) loaderRef.current = new (ModelLoader as any)();

    // init vtk
    useEffect(() => {
        if (!vtkRootRef.current) return;

        // Ensure the container has dimensions before initializing VTK
        const container = vtkRootRef.current;

        if (container.clientWidth === 0 || container.clientHeight === 0) {
            console.warn('Container has no dimensions, delaying VTK initialization');
            return;
        }

        const fsrw = vtkFullScreenRenderWindow.newInstance({
            container: container,
            containerStyle: { position: 'relative', width: '100%', height: '100%' },
        });
        const ren = fsrw.getRenderer();
        const rw = fsrw.getRenderWindow();
        const interactor = rw.getInteractor();

        // Ensure interactor is properly initialized
        if (interactor && container) {
            interactor.setView(fsrw.getApiSpecificRenderWindow());
            interactor.initialize();
        }

        ren.setBackground(0.5, 0.5, 0.5);

        // Setup surface actor
        surfaceMapper.setLookupTable(surfaceCTF);
        surfaceMapper.setUseLookupTableScalarRange(true);
        surfaceMapper.setScalarVisibility(false);
        surfaceActor.setMapper(surfaceMapper);
        ren.addActor(surfaceActor);

        // Setup iso-bands actor
        if (isoFilter) {
            isoMapper.setInputConnection(isoFilter.getOutputPort());
            isoMapper.setColorModeToDirectScalars();
            isoMapper.setColorByArrayName('IsoBandColor');
            isoMapper.setScalarVisibility(true);
            isoActor.setMapper(isoMapper);
            isoActor.setVisibility(false);

            // CRITICAL: Configure for smooth shading
            const property = isoActor.getProperty();
            property.setInterpolationToPhong();  // or .setInterpolationToGouraud()
            property.setLighting(true);
            property.setAmbient(0.2);
            property.setDiffuse(0.8);
            property.setSpecular(0.1);
            property.setSpecularPower(20);

            ren.addActor(isoActor);
        }

        // Setup iso-lines actor
        if (isoLinesFilter) {
            isoLinesMapper.setInputConnection(isoLinesFilter.getOutputPort());
            isoLinesMapper.setColorModeToDirectScalars();
            isoLinesMapper.setColorByArrayName('IsoLineColor');
            isoLinesMapper.setScalarVisibility(true);

            // Add polygon offset to prevent z-fighting with bands
            isoLinesMapper.setResolveCoincidentTopologyToPolygonOffset();
            isoLinesMapper.setResolveCoincidentTopologyPolygonOffsetParameters(2, 1);

            isoLinesActor.setMapper(isoLinesMapper);
            isoLinesActor.getProperty().setLineWidth(1);
            isoLinesActor.setVisibility(false);
            ren.addActor(isoLinesActor);
        }

        renRef.current = ren;
        rwRef.current = rw;

        const onResize = () => {
            if (fsrw && fsrw.resize) {
                fsrw.resize();
            }
        };

        // Add a small delay to ensure DOM is fully ready
        const resizeTimeout = setTimeout(() => {
            onResize();
        }, 100);

        window.addEventListener('resize', onResize);
        return () => {
            clearTimeout(resizeTimeout);
            window.removeEventListener('resize', onResize);
            if (fsrw && fsrw.delete) {
                fsrw.delete();
            }
        };
    }, []);

    // 🟢 Auto-load default model once at startup
    useEffect(() => {
        const modelPath = import.meta.env.BASE_URL + 'models/mnt-tet-fault.ts';
        // const modelPath = '/models/mnt-tet-fault.ts';

        async function loadDefaultModel() {
            try {
                const resp = await fetch(modelPath);
                if (!resp.ok) throw new Error(`Failed to load ${modelPath}`);
                const text = await resp.text();

                // use the loader’s text API
                const { polyData: pd, properties: props } =
                    await loaderRef.current.loadFromText(text);

                // feed into your existing pipeline
                setPolyData(pd);
                setProperties(props);
                // e.g. your mapper setup:
                // surfaceMapper.setInputData(pd);
                renRef.current?.resetCamera();
                rwRef.current?.render();

                console.log(`Loaded default model: ${modelPath}`);
            } catch (err) {
                console.error('Error loading default model:', err);
            }
        }

        loadDefaultModel();
    }, []);

    // Synchronize line count with band count when bands are enabled
    useEffect(() => {
        if (bandsEnabled) {
            setLineCount(bandCount);
        }
    }, [bandsEnabled, bandCount]);

    // iso contour filled bands
    useEffect(() => {
        if (!polyData || !isoFilter) return;
        const arr = selectedProp ? polyData.getPointData().getArrayByName(selectedProp) : null;

        if (!bandsEnabled || !arr) {
            isoActor.setVisibility(false);
            // Show surface only if lines are also disabled
            if (!linesEnabled) {
                surfaceActor.setVisibility(true);
            }
            rwRef.current?.render();
            return;
        }

        const [mn, mx] = finiteRangeOfArray(arr);
        const isoValues = makeUniformIsoValues(mn, mx, bandCount);

        // Get the VTK preset object
        const presetObj = getPresetByName(preset);

        isoFilter.setScalarArrayName(selectedProp);
        isoFilter.setScalarRange([mn, mx]);
        isoFilter.setIsoValues(isoValues);
        isoFilter.setSmooth(smoothNormals)
        isoFilter.modified()
        if (presetObj) {
            isoFilter.setPreset(presetObj);
        }
        isoFilter.setNumberOfColors(256);

        surfaceActor.setVisibility(false);
        isoActor.setVisibility(true);
        rwRef.current?.render();
    }, [bandsEnabled, bandCount, selectedProp, preset, polyData, linesEnabled, smoothNormals]);

    // iso contour lines
    useEffect(() => {
        if (!polyData || !isoLinesFilter) return;
        const arr = selectedProp ? polyData.getPointData().getArrayByName(selectedProp) : null;

        if (!linesEnabled || !arr) {
            isoLinesActor.setVisibility(false);
            if (!bandsEnabled) {
                surfaceActor.setVisibility(true);
            }
            rwRef.current?.render();
            return;
        }

        const [mn, mx] = finiteRangeOfArray(arr);
        const isoValues = makeUniformIsoValues(mn, mx, lineCount);

        // Get the VTK preset object
        // If bands are enabled, use black/grayscale preset, otherwise use selected preset
        const presetName = bandsEnabled ? 'Grayscale' : preset;
        const presetObj = getPresetByName(presetName);

        isoLinesFilter.setScalarArrayName(selectedProp);
        isoLinesFilter.setIsoValues(isoValues);
        if (presetObj) {
            isoLinesFilter.setPreset(presetObj);
        }
        isoLinesFilter.setNumberOfColors(256);

        // If bands are enabled, use constant black color
        if (bandsEnabled) {
            isoLinesMapper.setScalarVisibility(false);
            isoLinesActor.getProperty().setColor(0, 0, 0); // Black
        } else {
            isoLinesMapper.setScalarVisibility(true);
        }

        surfaceActor.setVisibility(false);
        isoLinesActor.setVisibility(true);
        rwRef.current?.render();
    }, [linesEnabled, lineCount, selectedProp, preset, polyData, bandsEnabled]);

    // color updates for surface
    useEffect(() => {
        if (!polyData) return;
        const pd = polyData as any;
        const arr = selectedProp ? pd.getPointData?.().getArrayByName?.(selectedProp) : null;
        if (!selectedProp || !arr) {
            surfaceMapper.setScalarVisibility(false);
            surfaceActor.getProperty().setColor(0.85, 0.85, 0.85);
            const p = surfaceActor.getProperty();

            p.setLighting(true);
            p.setAmbient(0.25);
            p.setDiffuse(0.9);
            p.setSpecular(0.0);

            rwRef.current?.render();
            return;
        }
        const [mn, mx] = finiteRangeOfArray(arr);
        if (!Number.isFinite(mn) || !Number.isFinite(mx) || mn === mx) {
            surfaceMapper.setScalarVisibility(false);
            surfaceActor.getProperty().setColor(0.85, 0.85, 0.85);
            rwRef.current?.render();
            return;
        }
        applyPreset(surfaceCTF, preset, [mn, mx]);

        surfaceMapper.setColorByArrayName(selectedProp);
        surfaceMapper.setScalarRange(mn, mx);
        surfaceMapper.setScalarVisibility(true);
        rwRef.current?.render();
    }, [selectedProp, preset, polyData]);

    // --- loader bridge ---
    async function callLoaderWithFile(file: File) {
        const L: any = loaderRef.current;
        let result: any = null;
        if (typeof L.loadFromFile === 'function') result = await L.loadFromFile(file);
        else if (typeof L.load === 'function') result = await L.load(file);
        else {
            // fallback: read text and try text-based API
            const text = await file.text();
            if (typeof L.loadFromText === 'function') result = await L.loadFromText(text);
            else if (typeof L.parse === 'function') result = await L.parse(text);
            else throw new Error('ModelLoader lacks loadFromFile/load/loadFromText/parse');
        }
        return result;
    }

    function makeUniformIsoValues(min: number, max: number, bands: number) {
        const vals: number[] = [];
        for (let i = 1; i < bands; i++) vals.push(min + (i * (max - min)) / bands);
        return vals;
    }

    async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
        const f = e.target.files?.[0];
        if (!f) return;
        try {
            const { polyData: pd, properties: props } = await callLoaderWithFile(f);
            setPolyData(pd);
            setProperties((props || []).filter((p: any) => (p.size ?? 1) === 1));
            surfaceMapper.setInputData(pd);

            if (isoFilter) isoFilter.setInputData(pd);
            if (isoLinesFilter) isoLinesFilter.setInputData(pd);

            renRef.current?.resetCamera();
            rwRef.current?.render();
            // default to first property if none chosen
            setSelectedProp((props && props[0]?.name) || '');
        } catch (err) {
            // eslint-disable-next-line no-alert
            alert((err as Error).message || 'Failed to load model');
        }
    }

    // --- UI ---
    const presetOptions = useMemo(
        () => listPresetNames().map((n) => (
            <option key={n} value={n}>
                {n}
            </option>
        )),
        []
    );
    const propOptions = useMemo(
        () => [
            <option key="-none-" value="">
                — none —
            </option>,
            ...properties.map((p) => (
                <option key={p.name} value={p.name}>
                    {p.name}
                </option>
            )),
        ],
        [properties]
    );

    return (
        <div style={{ height: '100vh', position: 'relative', overflow: 'hidden' }}>
            <div ref={vtkRootRef} style={{ position: 'absolute', inset: 0 }} />

            {/* Control panel */}
            <div
                style={{
                    position: 'absolute', top: 12, left: 12, zIndex: 10,
                    background: 'rgba(255,255,255,0.5)', backdropFilter: 'blur(6px)',
                    padding: '10px 12px', borderRadius: 10, boxShadow: '0 2px 8px rgba(0,0,0,.12)',
                    display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap'
                }}
            >

                <label className="field">
                    <span className="label">Load file</span>
                    <input className="select select--small" type="file" accept=".tsurf,.ts,.txt" onChange={onPickFile} />
                </label>

                <label className="field">
                    <span className="label">Property</span>
                    <select className="select" value={selectedProp} onChange={(e) => setSelectedProp(e.target.value)}>
                        {propOptions}
                    </select>
                </label>

                <label className="field">
                    <span className="label">Color map</span>
                    <select className="select select--small" value={preset} onChange={(e) => setPreset(e.target.value)}>
                        {presetOptions}
                    </select>
                </label>

                {/* Separator */}
                <div style={{ width: 1, height: 24, background: '#ddd' }} />

                {/* Contour lines controls */}
                <label className="field">
                    <input className="checkbox"
                        type="checkbox"
                        checked={linesEnabled}
                        onChange={(e) => setLinesEnabled(e.target.checked)}
                    />
                    <span style={{ fontSize: 12, color: '#333' }}>Contour lines</span>
                </label>

                {/* Filled bands controls */}
                <label className="field">
                    <input className="checkbox" type="checkbox" checked={bandsEnabled} onChange={(e) => setBandsEnabled(e.target.checked)} />
                    <span className="label">Filled iso-bands</span>
                </label>

                {bandsEnabled && (
                    <label className="field">
                        <span className="label">Bands</span>
                        <input
                            className="checkbox select--small"
                            style={{ width: 40, textAlign: 'right' }}
                            type="number" min={2} max={32}
                            value={bandCount}
                            onChange={(e) => setBandCount(parseInt(e.target.value))}
                        />
                    </label>
                )}

                {bandsEnabled && (
                    <label className="field">
                        <input
                            className="checkbox"
                            type="checkbox"
                            checked={smoothNormals}
                            onChange={(e) => setSmoothNormals(e.target.checked)}
                        />
                        Smooth shading
                    </label>
                )}

            </div>
        </div>
    );
}