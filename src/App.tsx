// App.tsx – Updated to use VTK IColorMapPreset interface
// Uses the same loading schema as ModelLoader with VTK preset-based coloring

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

    // pipelines
    const [surfaceCTF] = useState(() => vtkColorTransferFunction.newInstance());
    const [surfaceMapper] = useState(() => vtkMapper.newInstance());
    const [surfaceActor] = useState(() => vtkActor.newInstance());

    // iso-contour pipeline
    const [isoFilter] = useState(() => (vtkIsoContoursFilled as any).newInstance?.({}) ?? null);
    const [isoMapper] = useState(() => vtkMapper.newInstance());
    const [isoActor] = useState(() => vtkActor.newInstance());

    const [bandsEnabled, setBandsEnabled] = useState(false);
    const [bandCount, setBandCount] = useState(20);

    // data state
    const [polyData, setPolyData] = useState<VtkPolyData | null>(null);
    const [properties, setProperties] = useState<{ name: string; size?: number }[]>([]);

    // UI state
    const [selectedProp, setSelectedProp] = useState('');
    const [preset, setPreset] = useState('Viridis (matplotlib)');

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

        surfaceMapper.setLookupTable(surfaceCTF);
        surfaceMapper.setUseLookupTableScalarRange(true);
        surfaceMapper.setScalarVisibility(false);
        surfaceActor.setMapper(surfaceMapper);
        ren.addActor(surfaceActor);

        if (isoFilter) {
            isoMapper.setInputConnection(isoFilter.getOutputPort());
            isoMapper.setColorModeToDirectScalars();
            isoMapper.setColorByArrayName('IsoBandColor');
            isoMapper.setScalarVisibility(true);
            isoActor.setMapper(isoMapper);
            isoActor.setVisibility(false);       // hidden by default
            ren.addActor(isoActor);
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


        // checkDimensions();
    }, []);

    // iso contours
    useEffect(() => {
        if (!polyData || !isoFilter) return;
        const arr = selectedProp ? polyData.getPointData().getArrayByName(selectedProp) : null;

        if (!bandsEnabled || !arr) {
            isoActor.setVisibility(false);
            surfaceActor.setVisibility(true);
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
        if (presetObj) {
            isoFilter.setPreset(presetObj);
        }
        isoFilter.setNumberOfColors(256);

        surfaceActor.setVisibility(false);
        isoActor.setVisibility(true);
        rwRef.current?.render();
    }, [bandsEnabled, bandCount, selectedProp, preset, polyData]);

    // color updates
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

            {/* Minimal panel: Property + Color map + File loader */}
            <div
                style={{
                    position: 'absolute', top: 12, left: 12, zIndex: 10,
                    background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(6px)',
                    padding: '10px 12px', borderRadius: 10, boxShadow: '0 2px 8px rgba(0,0,0,.12)',
                    display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
                }}
            >
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, color: '#333' }}>Property</span>
                    <select value={selectedProp} onChange={(e) => setSelectedProp(e.target.value)} style={{ fontSize: 13, padding: '6px 8px' }}>
                        {propOptions}
                    </select>
                </label>

                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, color: '#333' }}>Color map</span>
                    <select value={preset} onChange={(e) => setPreset(e.target.value)} style={{ fontSize: 13, padding: '6px 8px' }}>
                        {presetOptions}
                    </select>
                </label>

                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, color: '#333' }}>Load file</span>
                    <input type="file" accept=".tsurf,.ts,.txt" onChange={onPickFile} />
                </label>

                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <input
                        type="checkbox"
                        checked={bandsEnabled}
                        onChange={(e) => setBandsEnabled(e.target.checked)}
                    />
                    <span style={{ fontSize: 12, color: '#333' }}>Filled iso-bands</span>
                </label>

                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, color: '#333' }}>Bands</span>
                    <input
                        type="number"
                        min={2}
                        max={32}
                        value={bandCount}
                        onChange={(e) => setBandCount(parseInt(e.target.value))}
                        style={{ width: 60 }}
                    />
                </label>
            </div>
        </div>
    );
}