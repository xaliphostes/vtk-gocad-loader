/**
 * Iso-contour filled band generation
 * VTK-agnostic implementation using IColorMapPreset interface
 */

import { BufferAttribute, BufferGeometry, Uint32BufferAttribute } from "./attributes";
import type { IColorMapPreset } from "../types/vtkColorMapPreset";
import { 
    valueToColor, 
    createLookupTable, 
    sampleLookupTable,
    DEFAULT_PRESET,
    type RGBColor 
} from "./vtkColorUtils";

export type IsoFillReturnedType = {
    position: number[],
    index: number[],
    color: number[],
    normal?: number[]
}

/**
 * Create filled iso-contour bands from geometry and scalar attribute
 * @param geometry BufferGeometry with positions and optional normals
 * @param attr Scalar attribute values (one per vertex)
 * @param isoList Array of iso-values defining band boundaries
 * @param options Configuration options
 * @returns Geometry data for colored bands or undefined if no iso-values
 */
export function createIsoContoursFilled(
    geometry: BufferGeometry, 
    attr: number[], 
    isoList: number[], 
    {
        min = undefined,
        max = undefined,
        preset = DEFAULT_PRESET,
        nbColors = 256,
    }: { 
        min?: number, 
        max?: number, 
        preset?: IColorMapPreset, 
        nbColors?: number 
    } = {}
): IsoFillReturnedType | undefined {
    const isoContours = new IsoContoursFilled(preset, nbColors, isoList);
    return isoContours.run(geometry, attr, min, max);
}

export class IsoContoursFilled {
    attr: Array<number> | undefined;
    nodes_: BufferAttribute | undefined;
    segment_list_: Array<IsoSegment> = [];
    vmin_ = 0;
    vmax_ = 1;
    defaultColor_: RGBColor = [0, 0, 0];
    lookupTable_: RGBColor[] = [];

    position_: Array<number> = [];
    index_: Array<number> = [];
    colors_: Array<number> = [];
    isoValues_: Array<number> = [];
    normals_: Array<number> = [];
    nnormals_: BufferAttribute | undefined;

    get position() { return this.position_; }
    get index() { return this.index_; }
    get color() { return this.colors_; }

    /**
     * @param preset VTK color map preset
     * @param nbColors Number of colors in lookup table
     * @param isoList Array of iso-values to generate bands
     */
    constructor(preset: IColorMapPreset, nbColors: number, isoList: number[]) {
        this.defaultColor_ = [0, 0, 0];
        this.lookupTable_ = createLookupTable(preset, nbColors);
        this.isoValues_ = isoList;
    }

    /**
     * Generate iso-contour bands
     * @param geometry Input geometry
     * @param attr Scalar attribute values
     * @param min Minimum value (computed if undefined)
     * @param max Maximum value (computed if undefined)
     * @returns Geometry data or undefined if no iso-values
     */
    run(
        geometry: BufferGeometry, 
        attr: number[], 
        min: number | undefined, 
        max: number | undefined
    ): IsoFillReturnedType | undefined {
        this.attr = attr;

        const minmax = this.computeMinMax(this.attr);
        this.vmin_ = min !== undefined ? min : minmax[0];
        this.vmax_ = max !== undefined ? max : minmax[1];

        if (this.isoValues_.length === 0) {
            return {
                position: [],
                index: [],
                color: [],
                normal: []
            };
        }

        const index = geometry.getIndices() as Uint32BufferAttribute;
        const a = index.array;
        this.nodes_ = geometry.getPositions() as BufferAttribute;
        this.nnormals_ = geometry.getAttribute('normal') as BufferAttribute;

        if (this.nnormals_ === undefined) {
            geometry.computeVertexNormals();
            this.nnormals_ = geometry.getAttribute('normal') as BufferAttribute;
        }

        // Main algorithm: process each triangle
        for (let i = 0; i < a.length; i += 3) {
            this.classify(a[i], a[i + 1], a[i + 2]);
        }

        return {
            position: this.position_,
            index: this.index_,
            color: this.colors_,
            normal: this.normals_
        };
    }

    private computeMinMax(array: number[]): [number, number] {
        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;
        for (const v of array) {
            if (v < min) min = v;
            if (v > max) max = v;
        }
        return [min, max];
    }

    private normalizeAttr(v: number): number {
        return (v - this.vmin_) / (this.vmax_ - this.vmin_);
    }

    private getNode(i: number): number[] {
        return (this.nodes_ as BufferAttribute).get(i);
    }

    private getNormal(i: number): number[] {
        return (this.nnormals_ as BufferAttribute).get(i);
    }

    private getAttr(i: number): number {
        return (this.attr as number[])[i];
    }

    private getColorForValue(normalizedValue: number): RGBColor {
        return sampleLookupTable(normalizedValue, this.lookupTable_);
    }

    private classify(n0: number, n1: number, n2: number): void {
        const t = new TriInfo();

        t.v1 = this.getAttr(n0);
        t.p1 = this.getNode(n0);
        t.n1 = this.getNormal(n0);

        t.v2 = this.getAttr(n1);
        t.p2 = this.getNode(n1);
        t.n2 = this.getNormal(n1);

        t.v3 = this.getAttr(n2);
        t.p3 = this.getNode(n2);
        t.n3 = this.getNormal(n2);

        let nn1: number[], nn2: number[], nn3: number[];
        let vv1: number[], vv2: number[], vv3: number[];
        let hh1 = 0, hh2 = 0, hh3 = 0;

        // Sort vertices by attribute value
        if (t.v1 <= t.v2 && t.v1 <= t.v3) {
            vv1 = t.p1; hh1 = t.v1; nn1 = t.n1;
            if (t.v2 <= t.v3) {
                vv2 = t.p2; vv3 = t.p3;
                hh2 = t.v2; hh3 = t.v3;
                nn2 = t.n2; nn3 = t.n3;
            } else {
                vv2 = t.p3; vv3 = t.p2;
                hh2 = t.v3; hh3 = t.v2;
                nn2 = t.n3; nn3 = t.n2;
                t.reversed = true;
            }
        } else if (t.v2 <= t.v1 && t.v2 <= t.v3) {
            vv1 = t.p2; hh1 = t.v2; nn1 = t.n2;
            if (t.v1 <= t.v3) {
                vv2 = t.p1; vv3 = t.p3;
                hh2 = t.v1; hh3 = t.v3;
                nn2 = t.n1; nn3 = t.n3;
                t.reversed = true;
            } else {
                vv2 = t.p3; vv3 = t.p1;
                hh2 = t.v3; hh3 = t.v1;
                nn2 = t.n3; nn3 = t.n1;
            }
        } else if (t.v3 <= t.v1 && t.v3 <= t.v2) {
            vv1 = t.p3; hh1 = t.v3; nn1 = t.n3;
            if (t.v1 <= t.v2) {
                vv2 = t.p1; vv3 = t.p2;
                hh2 = t.v1; hh3 = t.v2;
                nn2 = t.n1; nn3 = t.n2;
            } else {
                vv2 = t.p2; vv3 = t.p1;
                hh2 = t.v2; hh3 = t.v1;
                nn2 = t.n2; nn3 = t.n1;
                t.reversed = true;
            }
        } else {
            return;
        }

        t.p1 = vv1; t.p2 = vv2; t.p3 = vv3;
        t.v1 = hh1; t.v2 = hh2; t.v3 = hh3;
        t.n1 = nn1; t.n2 = nn2; t.n3 = nn3;

        this.createSegmentList(t);
        this.createPolygons(t);
    }

    private createSegmentList(t: TriInfo): void {
        this.segment_list_ = [];
        t.notIntersectedPolygonValue = this.vmin_;

        for (const iso of this.isoValues_) {
            if (iso >= t.v3) break;
            if (iso > t.v1) {
                this.addSegment(iso, t);
            } else {
                t.notIntersectedPolygonValue = iso;
            }
        }
    }

    private addSegment(iso: number, t: TriInfo): void {
        const segment = new IsoSegment();
        segment.iso = iso;
        const v1 = t.v1;
        const v2 = t.v2;
        const v3 = t.v3;
        const p1 = t.p1;
        const p2 = t.p2;
        const p3 = t.p3;

        if (iso < t.v2) {
            const w1 = isoValue(v1, v2, iso);
            const w2 = isoValue(v1, v3, iso);
            segment.p1 = createPoint(p1, p2, w1);
            segment.p2 = createPoint(p1, p3, w2);
            segment.n1 = createPoint(t.n1, t.n2, w1);
            segment.n2 = createPoint(t.n1, t.n3, w2);
        } else {
            const w1 = isoValue(v2, v3, iso);
            const w2 = isoValue(v1, v3, iso);
            segment.p1 = createPoint(p2, p3, w1);
            segment.p2 = createPoint(p1, p3, w2);
            segment.n1 = createPoint(t.n2, t.n3, w1);
            segment.n2 = createPoint(t.n1, t.n3, w2);
        }

        this.segment_list_.push(segment);
    }

    private createPolygons(t: TriInfo): void {
        if (
            (t.v1 < this.vmin_ || t.v1 > this.vmax_) &&
            (t.v2 < this.vmin_ || t.v2 > this.vmax_) &&
            (t.v3 < this.vmin_ || t.v3 > this.vmax_)
        ) {
            return;
        }

        const negate = (n: number[]) => [-n[0], -n[1], -n[2]];

        let bypass = false;
        if (t.reversed) {
            if (this.segment_list_.length === 0) {
                this.addTri(
                    t.p1, t.p3, t.p2,
                    t.n1, t.n3, t.n2,
                    t.notIntersectedPolygonValue
                );
                return;
            }

            let seg = front(this.segment_list_);

            if (seg.iso < t.v2) {
                this.addTri(
                    t.p1, seg.p2, seg.p1,
                    t.n1, seg.n2, seg.n1,
                    t.notIntersectedPolygonValue
                );
            } else {
                bypass = true;
                this.addQuad(
                    t.p1, seg.p2, seg.p1, t.p2,
                    t.n1, seg.n2, seg.n1, t.n2,
                    t.notIntersectedPolygonValue
                );
            }

            for (let i = 1; i < this.segment_list_.length; ++i) {
                const seg1 = this.segment_list_[i];

                if (seg1.iso < t.v2) {
                    this.addQuad(
                        seg.p1, seg1.p1, seg1.p2, seg.p2,
                        negate(seg.n1), negate(seg1.n1), negate(seg1.n2), negate(seg.n2),
                        seg.iso
                    );
                } else {
                    if (bypass) {
                        this.addQuad(
                            seg.p1, seg.p2, seg1.p2, seg1.p1,
                            seg.n1, seg.n2, seg1.n2, seg1.n1,
                            seg.iso
                        );
                    } else {
                        bypass = true;
                        this.addPoly(
                            t.p2, seg.p1, seg.p2, seg1.p2, seg1.p1,
                            t.n2, seg.n1, seg.n2, seg1.n2, seg1.n1,
                            seg.iso
                        );
                    }
                }
                seg = seg1;
            }

            seg = back(this.segment_list_);
            if (bypass) {
                this.addTri(
                    seg.p1, seg.p2, t.p3,
                    seg.n1, seg.n2, t.n3,
                    seg.iso
                );
            } else {
                this.addQuad(
                    t.p2, seg.p1, seg.p2, t.p3,
                    t.n2, seg.n1, seg.n2, t.n3,
                    seg.iso
                );
            }
        } else {
            // Forward orientation
            if (this.segment_list_.length === 0) {
                this.addTri(
                    t.p1, t.p2, t.p3,
                    t.n1, t.n2, t.n3,
                    t.notIntersectedPolygonValue
                );
                return;
            }

            let seg = front(this.segment_list_);

            if (seg.iso < t.v2) {
                this.addTri(
                    t.p1, seg.p1, seg.p2,
                    t.n1, seg.n1, seg.n2,
                    t.notIntersectedPolygonValue
                );
            } else {
                bypass = true;
                this.addQuad(
                    t.p1, t.p2, seg.p1, seg.p2,
                    t.n1, t.n2, seg.n1, seg.n2,
                    t.notIntersectedPolygonValue
                );
            }

            for (let i = 1; i < this.segment_list_.length; ++i) {
                const seg1 = this.segment_list_[i];
                if (seg1.iso < t.v2) {
                    this.addQuad(
                        seg.p1, seg1.p1, seg1.p2, seg.p2,
                        seg.n1, seg1.n1, seg1.n2, seg.n2,
                        seg.iso
                    );
                } else {
                    if (bypass) {
                        this.addQuad(
                            seg.p1, seg1.p1, seg1.p2, seg.p2,
                            seg.n1, seg1.n1, seg1.n2, seg.n2,
                            seg.iso
                        );
                    } else {
                        bypass = true;
                        this.addPoly(
                            t.p2, seg1.p1, seg1.p2, seg.p2, seg.p1,
                            t.n2, seg1.n1, seg1.n2, seg.n2, seg.n1,
                            seg.iso
                        );
                    }
                }
                seg = seg1;
            }

            seg = back(this.segment_list_);
            if (bypass) {
                this.addTri(
                    seg.p1, t.p3, seg.p2,
                    seg.n1, t.n3, seg.n2,
                    seg.iso
                );
            } else {
                this.addQuad(
                    t.p2, t.p3, seg.p2, seg.p1,
                    t.n2, t.n3, seg.n2, seg.n1,
                    seg.iso
                );
            }
        }
    }

    private addTri(
        point1: number[],
        point2: number[],
        point3: number[],
        n1: number[],
        n2: number[],
        n3: number[],
        iso: number
    ): void {
        if (iso < this.vmin_ || iso > this.vmax_) return;
        
        const c = this.getColorForValue(this.normalizeAttr(iso));
        const id = this.position_.length / 3;
        
        this.position_.push(...point1, ...point2, ...point3);
        this.index_.push(id, id + 1, id + 2);
        this.colors_.push(...c, ...c, ...c);
        this.normals_.push(...n1, ...n2, ...n3);
    }

    private addQuad(
        point1: number[],
        point2: number[],
        point3: number[],
        point4: number[],
        n1: number[],
        n2: number[],
        n3: number[],
        n4: number[],
        iso: number
    ): void {
        if (iso < this.vmin_ || iso > this.vmax_) return;
        
        const c = this.getColorForValue(this.normalizeAttr(iso));
        const id = this.position_.length / 3;
        
        this.position_.push(...point1, ...point2, ...point3, ...point4);
        this.index_.push(
            id, id + 1, id + 2,
            id, id + 2, id + 3
        );
        this.colors_.push(...c, ...c, ...c, ...c);
        this.normals_.push(...n1, ...n2, ...n3, ...n4);
    }

    private addPoly(
        point1: number[],
        point2: number[],
        point3: number[],
        point4: number[],
        point5: number[],
        n1: number[],
        n2: number[],
        n3: number[],
        n4: number[],
        n5: number[],
        iso: number
    ): void {
        if (iso < this.vmin_ || iso > this.vmax_) return;
        
        const c = this.getColorForValue(this.normalizeAttr(iso));
        const id = this.position_.length / 3;
        
        this.position_.push(...point1, ...point2, ...point3, ...point4, ...point5);
        this.index_.push(
            id, id + 1, id + 2,
            id, id + 2, id + 3,
            id, id + 3, id + 4
        );
        this.colors_.push(...c, ...c, ...c, ...c, ...c);
        this.normals_.push(...n1, ...n2, ...n3, ...n4, ...n5);
    }
}

// Helper classes and functions

class IsoSegment {
    p1 = [0, 0, 0];
    p2 = [0, 0, 0];
    n1 = [0, 0, 1];
    n2 = [0, 0, 1];
    iso = 0;
}

class TriInfo {
    reversed = false;
    p1 = [0, 0, 0];
    p2 = [0, 0, 0];
    p3 = [0, 0, 0];
    n1 = [1, 0, 0];
    n2 = [1, 0, 0];
    n3 = [1, 0, 0];
    v1 = 0;
    v2 = 0;
    v3 = 0;
    notIntersectedPolygonValue = 0;
}

const front = (container: Array<any>) => container[0];
const back = (container: Array<any>) => container[container.length - 1];

function createPoint(p1: number[], p2: number[], w: number): number[] {
    const W = 1 - w;
    return [
        w * p1[0] + W * p2[0],
        w * p1[1] + W * p2[1],
        w * p1[2] + W * p2[2]
    ];
}

function isoValue(v1: number, v2: number, iso: number): number {
    return 1 - (Math.abs(iso - v1) / Math.abs(v2 - v1));
}