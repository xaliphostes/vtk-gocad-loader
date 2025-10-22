/**
 * Create a hash key for a 3D position.
 * This version properly handles coincident vertices (vertices at the same position
 * that are duplicated in the position array). It uses spatial hashing to identify
 * and average normals for all vertices at the same location.
 * 
 * @param x X coordinate
 * @param y Y coordinate  
 * @param z Z coordinate
 * @param epsilon Precision for hashing (vertices within epsilon are considered coincident)
 */
export function getPositionHash(x: number, y: number, z: number, epsilon: number): string {
    // Round to epsilon precision and create string key
    const scale = 1.0 / epsilon;
    const ix = Math.round(x * scale);
    const iy = Math.round(y * scale);
    const iz = Math.round(z * scale);
    return `${ix},${iy},${iz}`;
}

/**
 * Compute face normal from three points
 */
export function computeFaceNormal(p1: number[], p2: number[], p3: number[]): number[] {
    const v1 = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]];
    const v2 = [p3[0] - p1[0], p3[1] - p1[1], p3[2] - p1[2]];

    const nx = v1[1] * v2[2] - v1[2] * v2[1];
    const ny = v1[2] * v2[0] - v1[0] * v2[2];
    const nz = v1[0] * v2[1] - v1[1] * v2[0];

    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-10) return [0, 0, 1];

    return [nx / len, ny / len, nz / len];
}

/**
 * Compute smooth vertex normals by welding coincident vertices
 * This creates smooth shading across iso-bands by properly averaging normals
 * at vertices that share the same spatial position.
 * 
 * @param positions Flat array of vertex positions [x,y,z, x,y,z, ...]
 * @param indices Triangle indices (3 per triangle)
 * @param epsilon Distance threshold for considering vertices coincident (default: 1e-6)
 * @returns Flat array of vertex normals [nx,ny,nz, nx,ny,nz, ...]
 */
export function computeSmoothNormalsWithWelding(
    positions: number[],
    indices: number[],
    epsilon: number = 1e-6
): number[] {
    const vertexCount = positions.length / 3;

    // Step 1: Build spatial hash to find coincident vertices
    const spatialMap = new Map<string, number[]>(); // hash -> list of vertex indices

    for (let i = 0; i < vertexCount; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];

        // Create hash key for this position (rounded to epsilon precision)
        const key = getPositionHash(x, y, z, epsilon);

        if (!spatialMap.has(key)) {
            spatialMap.set(key, []);
        }
        spatialMap.get(key)!.push(i);
    }

    console.log(`Vertex welding: ${vertexCount} vertices collapsed to ${spatialMap.size} unique positions`);

    // Step 2: Compute face normals and accumulate to vertices
    const normalAccum = new Float32Array(vertexCount * 3);
    const normalCount = new Float32Array(vertexCount);

    for (let i = 0; i < indices.length; i += 3) {
        const i0 = indices[i];
        const i1 = indices[i + 1];
        const i2 = indices[i + 2];

        // Get triangle vertices
        const p0 = [positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]];
        const p1 = [positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]];
        const p2 = [positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]];

        // Compute face normal
        const faceNormal = computeFaceNormal(p0, p1, p2);

        // Accumulate to all three vertices
        for (const idx of [i0, i1, i2]) {
            normalAccum[idx * 3] += faceNormal[0];
            normalAccum[idx * 3 + 1] += faceNormal[1];
            normalAccum[idx * 3 + 2] += faceNormal[2];
            normalCount[idx] += 1;
        }
    }

    // Step 3: Average normals across coincident vertices (welding)
    const finalNormals = new Float32Array(vertexCount * 3);
    const processed = new Set<number>();

    for (const [_hash, vertexIndices] of spatialMap.entries()) {
        if (vertexIndices.length === 1) {
            // Single vertex at this position - just normalize its accumulated normal
            const idx = vertexIndices[0];
            if (processed.has(idx)) continue;

            const count = normalCount[idx];
            if (count > 0) {
                let nx = normalAccum[idx * 3] / count;
                let ny = normalAccum[idx * 3 + 1] / count;
                let nz = normalAccum[idx * 3 + 2] / count;

                const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                if (len > 1e-10) {
                    nx /= len;
                    ny /= len;
                    nz /= len;
                } else {
                    nx = 0; ny = 0; nz = 1;
                }

                finalNormals[idx * 3] = nx;
                finalNormals[idx * 3 + 1] = ny;
                finalNormals[idx * 3 + 2] = nz;
            } else {
                finalNormals[idx * 3] = 0;
                finalNormals[idx * 3 + 1] = 0;
                finalNormals[idx * 3 + 2] = 1;
            }
            processed.add(idx);
        } else {
            // Multiple vertices at the same position - average their normals together
            let sumX = 0, sumY = 0, sumZ = 0;
            let totalCount = 0;

            for (const idx of vertexIndices) {
                const count = normalCount[idx];
                if (count > 0) {
                    sumX += normalAccum[idx * 3];
                    sumY += normalAccum[idx * 3 + 1];
                    sumZ += normalAccum[idx * 3 + 2];
                    totalCount += count;
                }
            }

            // Normalize the averaged normal
            let nx = 0, ny = 0, nz = 1;
            if (totalCount > 0) {
                nx = sumX / totalCount;
                ny = sumY / totalCount;
                nz = sumZ / totalCount;

                const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                if (len > 1e-10) {
                    nx /= len;
                    ny /= len;
                    nz /= len;
                } else {
                    nx = 0; ny = 0; nz = 1;
                }
            }

            // Apply the same averaged normal to ALL coincident vertices
            for (const idx of vertexIndices) {
                if (processed.has(idx)) continue;

                finalNormals[idx * 3] = nx;
                finalNormals[idx * 3 + 1] = ny;
                finalNormals[idx * 3 + 2] = nz;
                processed.add(idx);
            }
        }
    }

    return Array.from(finalNormals);
}

/**
 * Alternative: Use the normals passed from IsoSegment (your original approach)
 * This version uses the interpolated normals from the segments but still applies welding
 * 
 * @param positions Flat array of vertex positions
 * @param indices Triangle indices  
 * @param providedNormals The normals from IsoSegment.n1, n2, etc.
 * @param epsilon Distance threshold for welding
 */
export function blendProvidedNormalsWithWelding(
    positions: number[],
    // indices: number[],
    providedNormals: number[],
    epsilon: number = 1e-6
): number[] {
    const vertexCount = positions.length / 3;

    // Build spatial hash
    const spatialMap = new Map<string, number[]>();

    for (let i = 0; i < vertexCount; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        const key = getPositionHash(x, y, z, epsilon);

        if (!spatialMap.has(key)) {
            spatialMap.set(key, []);
        }
        spatialMap.get(key)!.push(i);
    }

    // Average normals at coincident vertices
    const finalNormals = new Float32Array(vertexCount * 3);
    const processed = new Set<number>();

    for (const [_hash, vertexIndices] of spatialMap.entries()) {
        // Average all normals at this spatial position
        let sumX = 0, sumY = 0, sumZ = 0;

        for (const idx of vertexIndices) {
            sumX += providedNormals[idx * 3];
            sumY += providedNormals[idx * 3 + 1];
            sumZ += providedNormals[idx * 3 + 2];
        }

        // Normalize
        const count = vertexIndices.length;
        let nx = sumX / count;
        let ny = sumY / count;
        let nz = sumZ / count;

        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len > 1e-10) {
            nx /= len;
            ny /= len;
            nz /= len;
        } else {
            nx = 0; ny = 0; nz = 1;
        }

        // Apply to all vertices at this position
        for (const idx of vertexIndices) {
            if (processed.has(idx)) continue;

            finalNormals[idx * 3] = nx;
            finalNormals[idx * 3 + 1] = ny;
            finalNormals[idx * 3 + 2] = nz;
            processed.add(idx);
        }
    }

    return Array.from(finalNormals);
}