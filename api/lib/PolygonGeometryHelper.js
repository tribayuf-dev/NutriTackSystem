/**
 * NutriTrack System - Polygon Geometry & Porsimetry Helper
 * 
 * Implementasi:
 * 1. Rumus Luas Poligon Gauss (Shoelace Formula)
 * 2. Perhitungan Titik Tengah Poligon (Centroid [cx, cy])
 * 3. Konversi Luas Kontur (cm2) ke Volume (cm3) dan Berat Massa (gram) via Densitas Semu
 * 4. Fallback Smooth Elliptical Contour Generator dari Bounding Box [ymin, xmin, ymax, xmax]
 * 5. Standar Palet Warna Kategori Gizi PRD (Biru, Oranye, Kuning Emas, Hijau Mint, Ungu)
 */

export const CATEGORY_COLORS = Object.freeze({
  carbohydrate: '#1A73E8',     // Biru (Karbohidrat)
  animal_protein: '#FA903E',   // Oranye (Protein Hewani)
  plant_protein: '#FCC934',    // Kuning Emas (Protein Nabati)
  vegetable: '#81C995',        // Hijau Mint (Sayuran)
  fruit: '#81C995',            // Hijau Mint (Buah)
  fat_sauce: '#C58AF9',        // Ungu (Lemak, Saus, Sambal)
  beverage: '#C58AF9',         // Ungu (Minuman)
  snack: '#FA903E',            // Oranye (Camilan)
  general: '#1A73E8',          // Biru Default
});

/**
 * Dapatkan warna highlight heksadesimal berdasarkan kategori makanan
 */
export function getCategoryHighlightColor(category) {
  if (!category) return CATEGORY_COLORS.general;
  const key = String(category).toLowerCase().trim();
  return CATEGORY_COLORS[key] || CATEGORY_COLORS.general;
}

/**
 * Hitung Luas Area Kontur Poligon Ternormalisasi (0 - 1000000) menggunakan Shoelace Formula
 * 
 * A_norm = 0.5 * | ∑ (x_i * y_{i+1} - x_{i+1} * y_i) |
 * 
 * @param {Array<Array<number>>} points - Array titik [[x1, y1], [x2, y2], ...] dalam skala 0 - 1000
 * @returns {number} Luas poligon ternormalisasi
 */
export function calculateShoelaceArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0.0;

  const n = points.length;
  let sum = 0.0;

  for (let i = 0; i < n; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % n];

    const x1 = Number(p1[0]) || 0;
    const y1 = Number(p1[1]) || 0;
    const x2 = Number(p2[0]) || 0;
    const y2 = Number(p2[1]) || 0;

    sum += (x1 * y2) - (x2 * y1);
  }

  return Math.abs(sum) * 0.5;
}

/**
 * Hitung Titik Tengah Poligon (Centroid [cx, cy])
 * 
 * C_x = (1 / 6A) * ∑ (x_i + x_{i+1}) * (x_i * y_{i+1} - x_{i+1} * y_i)
 * C_y = (1 / 6A) * ∑ (y_i + y_{i+1}) * (x_i * y_{i+1} - x_{i+1} * y_i)
 * 
 * @param {Array<Array<number>>} points - Array titik [[x1, y1], [x2, y2], ...] dalam skala 0 - 1000
 * @returns {Array<number>} [cx, cy] dalam skala 0 - 1000
 */
export function calculateCentroid(points) {
  if (!Array.isArray(points) || points.length === 0) return [500, 500];
  if (points.length < 3) {
    // Fallback rata-rata aritmetika
    const avgX = points.reduce((acc, p) => acc + (Number(p[0]) || 0), 0) / points.length;
    const avgY = points.reduce((acc, p) => acc + (Number(p[1]) || 0), 0) / points.length;
    return [Math.round(avgX), Math.round(avgY)];
  }

  const n = points.length;
  let signedArea = 0.0;
  let cxSum = 0.0;
  let cySum = 0.0;

  for (let i = 0; i < n; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % n];

    const x1 = Number(p1[0]) || 0;
    const y1 = Number(p1[1]) || 0;
    const x2 = Number(p2[0]) || 0;
    const y2 = Number(p2[1]) || 0;

    const cross = (x1 * y2) - (x2 * y1);
    signedArea += cross;
    cxSum += (x1 + x2) * cross;
    cySum += (y1 + y2) * cross;
  }

  signedArea *= 0.5;

  if (Math.abs(signedArea) < 0.001) {
    // Poligon sangat tipis / segaris -> fallback rata-rata
    const avgX = points.reduce((acc, p) => acc + (Number(p[0]) || 0), 0) / points.length;
    const avgY = points.reduce((acc, p) => acc + (Number(p[1]) || 0), 0) / points.length;
    return [Math.round(avgX), Math.round(avgY)];
  }

  const factor = 1.0 / (6.0 * signedArea);
  const cx = Math.max(0, Math.min(1000, Math.round(cxSum * factor)));
  const cy = Math.max(0, Math.min(1000, Math.round(cySum * factor)));

  return [cx, cy];
}

/**
 * Hitung Bounding Box [ymin, xmin, ymax, xmax] dari daftar titik poligon
 */
export function calculateBoundingBox(points) {
  if (!Array.isArray(points) || points.length === 0) return [0, 0, 1000, 1000];

  let minX = 1000, maxX = 0;
  let minY = 1000, maxY = 0;

  for (const pt of points) {
    const x = Number(pt[0]) || 0;
    const y = Number(pt[1]) || 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  return [
    Math.max(0, Math.min(1000, minY)),
    Math.max(0, Math.min(1000, minX)),
    Math.max(0, Math.min(1000, maxY)),
    Math.max(0, Math.min(1000, maxX)),
  ];
}

/**
 * Buat Fallback Polygon Mask (12-16 titik lekuk elips) dari koordinat Bounding Box [ymin, xmin, ymax, xmax]
 * Digunakan jika AI hanya mengembalikan box_2d atau koneksi fallback
 */
export function generateFallbackPolygonFromBox(box2d, numPoints = 14) {
  const [ymin, xmin, ymax, xmax] = Array.isArray(box2d) && box2d.length === 4
    ? box2d.map(Number)
    : [200, 200, 800, 800];

  const cx = (xmin + xmax) / 2.0;
  const cy = (ymin + ymax) / 2.0;
  const rx = Math.max(20, (xmax - xmin) / 2.0);
  const ry = Math.max(20, (ymax - ymin) / 2.0);

  const points = [];
  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * 2 * Math.PI;
    // Berikan sedikit variasi lekuk natural (+-3%) agar tidak kaku
    const wobble = 1.0 + (Math.sin(angle * 3) * 0.035);
    const px = Math.max(0, Math.min(1000, Math.round(cx + (Math.cos(angle) * rx * wobble))));
    const py = Math.max(0, Math.min(1000, Math.round(cy + (Math.sin(angle) * ry * wobble))));
    points.push([px, py]);
  }

  return points;
}

/**
 * Konversi Luas Poligon Ternormalisasi ke Luas Fisik (cm2) Berdasarkan Skala Piring Standar
 * 
 * Standar Piring: Diameter ~25cm, Luas Piring = π * (12.5)^2 ≈ 490.87 cm2.
 * Dalam citra standar makanan, piring umumnya mengisi ~70% bidang gambar (luas ~550.000 unit ternormalisasi).
 * 
 * @param {number} shoelaceAreaNorm - Luas ternormalisasi dari calculateShoelaceArea()
 * @param {number} plateDiameterCm - Diameter piring acuan (default 25.0 cm)
 * @returns {number} Luas estimasi dalam cm2 (dibulatkan ke 1 desimal)
 */
export function estimatePhysicalAreaCm2(shoelaceAreaNorm, plateDiameterCm = 25.0) {
  const areaNorm = Math.max(0, Number(shoelaceAreaNorm) || 0);
  if (areaNorm <= 0) return 0.0;

  // Luas piring acuan (cm2)
  const radiusCm = (Number(plateDiameterCm) || 25.0) / 2.0;
  const plateAreaCm2 = Math.PI * radiusCm * radiusCm; // ~490.87 cm2

  // Acuan normalisasi: Piring standar mengisi ~55% luas citra (550.000 / 1.000.000)
  const plateAreaNormRef = 550000.0;
  const cm2PerNormUnit = plateAreaCm2 / plateAreaNormRef;

  const physicalAreaCm2 = areaNorm * cm2PerNormUnit;
  return Math.round(physicalAreaCm2 * 10) / 10;
}

/**
 * Kalkulasi Volume (cm3 / cc) dan Berat Massa (gram) berdasarkan Luas Poligon, Tinggi, & Densitas
 * 
 * Volume = Area_cm2 * Height_cm
 * Weight_g = Volume_cc * ApparentDensity_g_cc
 */
export function calculateVolumeAndWeight(areaCm2, heightCm = 2.5, apparentDensity = 1.0) {
  const area = Math.max(0.1, Number(areaCm2) || 0.1);
  const height = Math.max(0.5, Number(heightCm) || 2.0);
  const density = Math.max(0.1, Number(apparentDensity) || 1.0);

  const volumeCc = Math.round(area * height * 10) / 10;
  const weightG = Math.round(volumeCc * density * 10) / 10;

  return {
    volumeCc,
    weightG,
  };
}
