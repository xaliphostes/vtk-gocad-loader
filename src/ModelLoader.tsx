/* eslint-disable @typescript-eslint/no-explicit-any */
import { vtkPolyDataFromGocadTSurf } from './filters/vtkPolyDataFromGocadTSurf';

export interface ModelProperty {
    name: string;
    size?: number; // 1 for scalar
    location?: 'point' | 'cell';
    range?: [number, number];
}

export interface LoadResult {
    polyData: any; // vtkPolyData
    properties: ModelProperty[];
}

export default class ModelLoader {
    // Load from a browser File object
    async loadFromFile(file: File): Promise<LoadResult> {
        const text = await file.text();
        return this.loadFromText(text);
    }

    // Alias commonly used name
    async load(file: File): Promise<LoadResult> {
        return this.loadFromFile(file);
    }

    // Parse directly from text
    async loadFromText(text: string): Promise<LoadResult> {
        try {
            // Your parser may accept options; computeNormals is often useful for shading
            const parsed: any = (vtkPolyDataFromGocadTSurf as any)(text, { computeNormals: true });

            const polyData = parsed?.polyData ?? parsed?.dataset ?? parsed?.polydata;
            if (!polyData) throw new Error('Parser did not return a vtkPolyData.');

            // Normalize properties to a very small schema used by the UI
            const properties: ModelProperty[] = (parsed?.properties ?? parsed?.arrays ?? [])
                .map((p: any) => ({
                    name: p.name ?? p.arrayName ?? String(p.key ?? ''),
                    size: p.size ?? p.numberOfComponents ?? 1,
                    location: (p.location ?? p.association) as 'point' | 'cell' | undefined,
                    range: (p.range ?? p.dataRange) as [number, number] | undefined,
                }))
                // Keep only scalar properties by default; adjust in the UI if you want vectors
                .filter((p: ModelProperty) => (p.size ?? 1) === 1 && !!p.name);

            return { polyData, properties };
        } catch (err) {
            const msg = (err as Error)?.message || 'Failed to parse TSurf';
            throw new Error(`ModelLoader.loadFromText: ${msg}`);
        }
    }

    // Synchronous alias for some call sites that expect parse()
    parse(text: string): Promise<LoadResult> {
        return this.loadFromText(text);
    }
}
