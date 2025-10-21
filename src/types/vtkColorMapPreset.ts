export interface IColorMapPreset {
    Name: string;
    Creator?: string;
    ColorSpace?: string;
    NanColor?: [number, number, number];
    RGBPoints: number[];
    IndexedColors?: number[];
    Annotations?: (number | string)[];
}

export type ScalarRange = [number, number];

export interface IsoFilledConfig {
  input?: unknown;                // (opaque here; vtkPolyData on the vtk side)
  arrayName?: string;
  isoValues?: number[];           // internal cuts (size = nBands-1)
  range?: ScalarRange;            // [min,max] of the scalar
  lut?: string | IColorMapPreset; // preset name or full vtk preset object
  numberOfColors?: number;        // 256 by default
}