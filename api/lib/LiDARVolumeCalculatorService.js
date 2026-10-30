/**
 * NutriTrack System – LiDAR 3D Volume Calculator Service
 *
 * Mengimplementasikan Spesifikasi Bagian 5 PRD:
 * 1. Pemetaan koordinat polygon_mask (0..1000) ke grid depth ARKit (256 x 192).
 * 2. Estimasi bidang dasar piring / meja (Z_plate_plane) via least-squares ring plane fitting.
 * 3. Integrasi Voxel 3D mikro-kolom: delta_h(u, v) * delta_area(u, v).
 * 4. Koreksi sudut kemiringan kamera (tilt angle correction) via gravity_vector.
 * 5. Perhitungan metrik morfologi fisik 3D: true_volume_cc, surface_area_cm2,
 *    mean_height_cm, max_peak_height_cm, dan berat massa (gram) berbasis densitas semu.
 */

export const DEPTH_GRID_WIDTH = 256;
export const DEPTH_GRID_HEIGHT = 192;

/**
 * Matriks Intrinsik Kamera Default Apple LiDAR (scaled to 256x192)
 * iPhone 12 Pro s/d iPhone 16 Pro standar ARFrame.sceneDepth
 */
export const DEFAULT_CAMERA_INTRINSICS = Object.freeze({
  fx: 196.5,
  fy: 196.5,
  cx: 128.0,
  cy: 96.0,
  width: DEPTH_GRID_WIDTH,
  height: DEPTH_GRID_HEIGHT,
});

/**
 * Point in polygon check using ray casting algorithm
 * @param {number} u - X coordinate in depth grid (0..255)
 * @param {number} v - Y coordinate in depth grid (0..191)
 * @param {Array<Array<number>>} poly - Array of [u, v] points
 * @returns {boolean}
 */
export function isPointInPolygon(u, v, poly) {
  if (!poly || poly.length < 3) return false;
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersect = ((yi > v) !== (yj > v)) &&
      (u < (xj - xi) * (v - yi) / (yj - yi + 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Fit bidang datar piring Z(u, v) = a*u + b*v + c menggunakan Least Squares Regression
 * @param {Array<{u: number, v: number, z: number}>} samples - Titik sampel permukaan piring
 * @returns {{a: number, b: number, c: number, medianZ: number}}
 */
export function fitPlaneToPoints(samples) {
  if (!samples || samples.length === 0) {
    return { a: 0, b: 0, c: 35.0, medianZ: 35.0 }; // Fallback default distance 35 cm
  }

  // Hitung median Z sebagai fallback yang kokoh
  const zVals = samples.map(s => s.z).sort((x, y) => x - y);
  const medianZ = zVals[Math.floor(zVals.length / 2)];

  if (samples.length < 6) {
    return { a: 0, b: 0, c: medianZ, medianZ };
  }

  // Least Squares: [u, v, 1] * [a, b, c]^T = z
  let sumU = 0, sumV = 0, sumZ = 0;
  let sumUU = 0, sumVV = 0, sumUV = 0;
  let sumUZ = 0, sumVZ = 0;
  const N = samples.length;

  for (let i = 0; i < N; i++) {
    const { u, v, z } = samples[i];
    sumU += u;
    sumV += v;
    sumZ += z;
    sumUU += u * u;
    sumVV += v * v;
    sumUV += u * v;
    sumUZ += u * z;
    sumVZ += v * z;
  }

  // Matrix 3x3 solution using Cramer's rule / Gaussian elimination
  const m00 = sumUU, m01 = sumUV, m02 = sumU;
  const m10 = sumUV, m11 = sumVV, m12 = sumV;
  const m20 = sumU,  m21 = sumV,  m22 = N;

  const det =
    m00 * (m11 * m22 - m12 * m21) -
    m01 * (m10 * m22 - m12 * m20) +
    m02 * (m10 * m21 - m11 * m20);

  if (Math.abs(det) < 1e-7) {
    return { a: 0, b: 0, c: medianZ, medianZ };
  }

  const detA =
    sumUZ * (m11 * m22 - m12 * m21) -
    m01 * (sumVZ * m22 - m12 * sumZ) +
    m02 * (sumVZ * m21 - m11 * sumZ);

  const detB =
    m00 * (sumVZ * m22 - m12 * sumZ) -
    sumUZ * (m10 * m22 - m12 * m20) +
    m02 * (m10 * sumZ - sumVZ * m20);

  const detC =
    m00 * (m11 * sumZ - sumVZ * m21) -
    m01 * (m10 * sumZ - sumVZ * m20) +
    sumUZ * (m10 * m21 - m11 * m20);

  const a = detA / det;
  const b = detB / det;
  const c = detC / det;

  return { a, b, c, medianZ };
}

/**
 * Hitung sudut kemiringan kamera terhadap sumbu gravitasi
 * @param {Array<number>} gravityVector - [gx, gy, gz] dari ARKit IMU
 * @returns {number} Faktor koreksi cosinus kemiringan (0.5 s/d 1.0)
 */
export function calculateTiltCorrection(gravityVector) {
  if (!Array.isArray(gravityVector) || gravityVector.length < 3) return 1.0;
  const [gx, gy, gz] = gravityVector.map(Number);
  const mag = Math.sqrt(gx * gx + gy * gy + gz * gz);
  if (mag <= 1e-4) return 1.0;
  // Jika ponsel menghadap ke bawah memotret piring, gz mendekati -1.0 atau 1.0
  const cosTheta = Math.abs(gz) / mag;
  // Batasi rentang cosinus logis (minimal 0.65 untuk sudut memotret hingga ~50 derajat)
  return Math.max(0.65, Math.min(1.0, cosTheta));
}

/**
 * Helper untuk membaca nilai Z (dalam cm) dari depth map buffer (bisa Float32Array atau nested array)
 */
function getDepthCmAt(depthMap, u, v, width = DEPTH_GRID_WIDTH, height = DEPTH_GRID_HEIGHT) {
  if (u < 0 || u >= width || v < 0 || v >= height) return 0;
  let rawVal = 0;
  if (Array.isArray(depthMap)) {
    if (Array.isArray(depthMap[0])) {
      rawVal = Number(depthMap[v]?.[u]) || 0;
    } else {
      rawVal = Number(depthMap[v * width + u]) || 0;
    }
  } else if (depthMap && typeof depthMap.length === 'number') {
    rawVal = Number(depthMap[v * width + u]) || 0;
  }
  if (!Number.isFinite(rawVal) || rawVal <= 0) return 0;
  // Jika nilai < 10, kemungkinan dalam satuan meter (standar ARKit: 0.25 - 5.0 meter) -> ubah ke cm
  return rawVal < 10.0 ? rawVal * 100.0 : rawVal;
}

/**
 * Helper untuk membaca confidence level (0: low, 1: medium, 2: high)
 */
function getConfidenceAt(confMap, u, v, width = DEPTH_GRID_WIDTH) {
  if (!confMap) return 2; // Default high
  let raw = 2;
  if (Array.isArray(confMap)) {
    if (Array.isArray(confMap[0])) {
      raw = Number(confMap[v]?.[u]);
    } else {
      raw = Number(confMap[v * width + u]);
    }
  } else if (confMap && typeof confMap.length === 'number') {
    raw = Number(confMap[v * width + u]);
  }
  return Number.isFinite(raw) ? raw : 2;
}

/**
 * Core Algorithm: Integrasi Voxel 3D dari Polygon Mask & Depth Map LiDAR
 *
 * @param {Object} params
 * @param {Array<Array<number>>} params.polygonMask - Array [x, y] ternormalisasi 0..1000
 * @param {Array|Float32Array} params.depthMap256x192 - Depth map dari ARKit sceneDepth
 * @param {Array|Uint8Array} [params.confidenceMap] - Confidence map dari ARKit
 * @param {Object} [params.cameraIntrinsics] - { fx, fy, cx, cy }
 * @param {Array<number>} [params.gravityVector] - [gx, gy, gz]
 * @param {number} [params.apparentDensity=0.70] - Densitas semu g/cm3
 * @returns {Object} Hasil kalkulasi metrik fisik 3D
 */
export function calculateTrue3DVolumeFromPolygon({
  polygonMask,
  depthMap256x192,
  confidenceMap = null,
  cameraIntrinsics = DEFAULT_CAMERA_INTRINSICS,
  gravityVector = [0, 0, -1],
  apparentDensity = 0.70,
}) {
  if (!polygonMask || polygonMask.length < 3) {
    return {
      measurement_source: 'MONOCULAR_2D_SHOELACE',
      true_volume_cc: 0,
      surface_area_true_cm2: 0,
      mean_height_cm: 0,
      max_peak_height_cm: 0,
      estimated_weight_g: 0,
      camera_to_plate_distance_cm: 35.0,
      voxel_count: 0,
    };
  }

  const width = cameraIntrinsics?.width || DEPTH_GRID_WIDTH;
  const height = cameraIntrinsics?.height || DEPTH_GRID_HEIGHT;
  const fx = cameraIntrinsics?.fx || DEFAULT_CAMERA_INTRINSICS.fx;
  const fy = cameraIntrinsics?.fy || DEFAULT_CAMERA_INTRINSICS.fy;

  // 1. Pemetaan koordinat poligon dari skala 0..1000 ke grid depth (256 x 192)
  const gridPoly = polygonMask.map(pt => {
    const rawX = Array.isArray(pt) ? pt[0] : (pt.x ?? 0);
    const rawY = Array.isArray(pt) ? pt[1] : (pt.y ?? 0);
    const u = Math.max(0, Math.min(width - 1, (Number(rawX) || 0) * (width / 1000)));
    const v = Math.max(0, Math.min(height - 1, (Number(rawY) || 0) * (height / 1000)));
    return [u, v];
  });

  // Hitung bounding box poligon di grid space
  let minU = width, maxU = 0, minV = height, maxV = 0;
  for (const [u, v] of gridPoly) {
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  minU = Math.max(0, Math.floor(minU));
  maxU = Math.min(width - 1, Math.ceil(maxU));
  minV = Math.max(0, Math.floor(minV));
  maxV = Math.min(height - 1, Math.ceil(maxV));

  // 2. Estimasi Bidang Dasar Piring (Z_plate_plane) dari Cincin Luar (Dilation Ring)
  const ringSamples = [];
  const ringMarginMin = 3; // 3 piksel di luar kontur
  const ringMarginMax = 7; // hingga 7 piksel di luar kontur
  const scanMargin = 8;
  const rMinU = Math.max(0, minU - scanMargin);
  const rMaxU = Math.min(width - 1, maxU + scanMargin);
  const rMinV = Math.max(0, minV - scanMargin);
  const rMaxV = Math.min(height - 1, maxV + scanMargin);

  for (let v = rMinV; v <= rMaxV; v += 2) {
    for (let u = rMinU; u <= rMaxU; u += 2) {
      if (isPointInPolygon(u, v, gridPoly)) continue; // Abaikan titik di dalam makanan

      // Cek jarak ke tepi terdekat poligon
      let distSq = Infinity;
      for (const [pu, pv] of gridPoly) {
        const d = (u - pu) * (u - pu) + (v - pv) * (v - pv);
        if (d < distSq) distSq = d;
      }
      const dist = Math.sqrt(distSq);
      if (dist >= ringMarginMin && dist <= ringMarginMax) {
        const conf = getConfidenceAt(confidenceMap, u, v, width);
        if (conf >= 1) { // Hanya confidence medium / high
          const zCm = getDepthCmAt(depthMap256x192, u, v, width, height);
          if (zCm >= 20.0 && zCm <= 100.0) { // Batas fisik realistis piring makan
            ringSamples.push({ u, v, z: zCm });
          }
        }
      }
    }
  }

  const platePlane = fitPlaneToPoints(ringSamples);
  const tiltCos = calculateTiltCorrection(gravityVector);

  // 3. Integrasi Voxel per Piksel di Dalam Kontur Makanan
  let totalVolumeCc = 0.0;
  let totalAreaCm2 = 0.0;
  let heightSum = 0.0;
  let maxPeakCm = 0.0;
  let validVoxelCount = 0;

  for (let v = minV; v <= maxV; v++) {
    for (let u = minU; u <= maxU; u++) {
      if (!isPointInPolygon(u, v, gridPoly)) continue;

      let zFood = getDepthCmAt(depthMap256x192, u, v, width, height);
      const conf = getConfidenceAt(confidenceMap, u, v, width);

      // Jika depth 0 atau confidence low, gunakan interpolasi dari bidang piring dikurangi estimasi tinggi
      if (zFood <= 0 || conf === 0) {
        zFood = Math.max(15.0, (platePlane.a * u + platePlane.b * v + platePlane.c) - 2.5);
      }

      // Jarak bidang piring di bawah piksel (u, v)
      const zPlateAtPixel = platePlane.a * u + platePlane.b * v + platePlane.c;

      // Tinggi makanan: delta_h = max(0, Z_plate - Z_food) * cos(theta)
      const rawHeight = zPlateAtPixel - zFood;
      const deltaH = Math.max(0.0, rawHeight * tiltCos);

      // Luas fisik 1 piksel pada kedalaman Z_food: delta_area = (Z / fx) * (Z / fy)
      const pixelAreaCm2 = (zFood / fx) * (zFood / fy);

      // Volume mikro kolom (voxel): delta_h * delta_area
      const voxelVolume = deltaH * pixelAreaCm2;

      totalVolumeCc += voxelVolume;
      totalAreaCm2 += pixelAreaCm2;

      if (deltaH > 0.05) {
        heightSum += deltaH;
        validVoxelCount++;
        if (deltaH > maxPeakCm) {
          maxPeakCm = deltaH;
        }
      }
    }
  }

  const meanHeightCm = validVoxelCount > 0 ? (heightSum / validVoxelCount) : 0.0;
  const finalVolumeCc = Math.max(0.0, Math.round(totalVolumeCc * 10) / 10);
  const finalAreaCm2 = Math.max(0.0, Math.round(totalAreaCm2 * 10) / 10);
  const finalMeanHeightCm = Math.round(meanHeightCm * 10) / 10;
  const finalMaxPeakCm = Math.round(maxPeakCm * 10) / 10;

  // Hitung berat massa: m = V * rho
  const weightGram = Math.round(finalVolumeCc * apparentDensity * 10) / 10;

  return {
    measurement_source: 'LIDAR_VOXEL_INTEGRATION',
    true_volume_cc: finalVolumeCc,
    surface_area_true_cm2: finalAreaCm2,
    mean_height_cm: finalMeanHeightCm,
    max_peak_height_cm: finalMaxPeakCm,
    apparent_density_used: apparentDensity,
    estimated_weight_g: weightGram,
    camera_to_plate_distance_cm: Math.round(platePlane.medianZ * 10) / 10,
    tilt_correction_factor: Math.round(tiltCos * 100) / 100,
    voxel_count: validVoxelCount,
    ring_samples_count: ringSamples.length,
  };
}

/**
 * Generator Synthetic Depth Map untuk Pengujian / Simulasi Mode LiDAR
 *
 * @param {Array<{polygon: Array<Array<number>>, peakHeightCm: number}>} foodMounds
 * @param {number} [plateDistanceCm=35.0]
 * @param {number} [tiltDegrees=15.0]
 * @returns {{depthMap: Float32Array, confidenceMap: Uint8Array, intrinsics: Object, gravityVector: Array<number>}}
 */
export function createSyntheticDepthMap(
  foodMounds = [],
  plateDistanceCm = 35.0,
  tiltDegrees = 15.0
) {
  const width = DEPTH_GRID_WIDTH;
  const height = DEPTH_GRID_HEIGHT;
  const totalPixels = width * height;
  const depthMap = new Float32Array(totalPixels);
  const confidenceMap = new Uint8Array(totalPixels);

  // Kemiringan piring terhadap bidang kamera
  const rad = (tiltDegrees * Math.PI) / 180.0;
  const slopeY = Math.tan(rad);
  const a = 0.0;
  const b = (slopeY * 30.0) / height;
  const c = plateDistanceCm;

  // Isi bidang piring dasar
  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      const idx = v * width + u;
      const plateZ = a * u + b * (v - height / 2) + c;
      depthMap[idx] = plateZ / 100.0; // Dalam satuan meter (standar ARKit)
      confidenceMap[idx] = 2; // High confidence
    }
  }

  // Tumpuk gundukan makanan (Gaussian / Paraboloid 3D) di dalam poligon
  for (const mound of foodMounds) {
    const { polygon, peakHeightCm = 3.5 } = mound;
    if (!polygon || polygon.length < 3) continue;

    // Convert polygon to grid
    const gridPoly = polygon.map(p => [
      Math.max(0, Math.min(width - 1, (p[0] * width) / 1000)),
      Math.max(0, Math.min(height - 1, (p[1] * height) / 1000)),
    ]);

    // Centroid of mound
    let cx = 0, cy = 0;
    for (const [u, v] of gridPoly) {
      cx += u;
      cy += v;
    }
    cx /= gridPoly.length;
    cy /= gridPoly.length;

    // Radius approx
    let maxR = 1;
    for (const [u, v] of gridPoly) {
      const d = Math.sqrt((u - cx) * (u - cx) + (v - cy) * (v - cy));
      if (d > maxR) maxR = d;
    }

    for (let v = 0; v < height; v++) {
      for (let u = 0; u < width; u++) {
        if (!isPointInPolygon(u, v, gridPoly)) continue;
        const idx = v * width + u;
        const distFromCenter = Math.sqrt((u - cx) * (u - cx) + (v - cy) * (v - cy));
        const normalizedDist = Math.min(1.0, distFromCenter / maxR);
        // Cosine dome curve
        const moundHeightCm = peakHeightCm * Math.cos((normalizedDist * Math.PI) / 2);
        const currentPlateZ = (depthMap[idx] * 100.0);
        const foodZCm = Math.max(10.0, currentPlateZ - moundHeightCm);
        depthMap[idx] = foodZCm / 100.0; // Dalam satuan meter
      }
    }
  }

  const gravityVector = [0, Math.sin(rad), -Math.cos(rad)];

  return {
    depthMap,
    confidenceMap,
    intrinsics: DEFAULT_CAMERA_INTRINSICS,
    gravityVector,
  };
}
