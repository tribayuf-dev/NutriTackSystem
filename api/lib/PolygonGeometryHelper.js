/**
 * NutriTrack System - Polygon Geometry & Porsimetry Helper
 * 
 * Implementasi:
 * 1. Rumus Luas Poligon Gauss (Shoelace Formula)
 * 2. Perhitungan Titik Tengah Poligon (Centroid [cx, cy])
 * 3. Konversi Luas Kontur (cm2) ke Volume (cm3) dan Berat Massa (gram) via Densitas Semu
 * 4. Fallback Smooth Organic Contour Generator dari Bounding Box [ymin, xmin, ymax, xmax]
 * 5. Standar Palet Warna Kategori Gizi PRD (Biru, Oranye, Kuning Emas, Hijau Mint, Ungu)
 * 6. Normalisasi Robust Titik Kontur & Auto-Transpose [y, x] -> [x, y]
 * 7. Catmull-Rom to Cubic Bezier Curve Generator untuk SVG Path Mulus
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
 * Normalisasi dan validasi koordinat titik kontur poligon.
 * Mendukung format:
 * - [[x, y], [x, y], ...]
 * - [{x, y}, {x, y}, ...]
 * - [x1, y1, x2, y2, ...]
 * - Auto-transpose jika titik terdeteksi dalam format [y, x] berdasarkan box_2d
 * 
 * @param {any} rawPoints
 * @param {Array<number>|null} box2d [ymin, xmin, ymax, xmax]
 * @returns {Array<Array<number>>|null}
 */
export function normalizePolygonPoints(rawPoints, box2d = null) {
  if (!rawPoints) return null;

  let pts = [];

  // 1. Unwrap jika nested array (seperti GeoJSON [[[x,y],...]])
  let candidate = rawPoints;
  if (Array.isArray(candidate) && candidate.length === 1 && Array.isArray(candidate[0])) {
    candidate = candidate[0];
  }

  // 2. Parse format array of arrays atau array of objects atau flat array
  if (Array.isArray(candidate)) {
    if (candidate.length >= 6 && typeof candidate[0] === 'number' && typeof candidate[1] === 'number') {
      // Flat array [x1, y1, x2, y2, ...]
      for (let i = 0; i < candidate.length - 1; i += 2) {
        pts.push([Number(candidate[i]), Number(candidate[i + 1])]);
      }
    } else {
      for (const item of candidate) {
        if (Array.isArray(item) && item.length >= 2) {
          const x = Number(item[0]);
          const y = Number(item[1]);
          if (!isNaN(x) && !isNaN(y)) pts.push([x, y]);
        } else if (item && typeof item === 'object') {
          const x = Number(item.x ?? item.lng ?? item.c ?? item.X);
          const y = Number(item.y ?? item.lat ?? item.r ?? item.Y);
          if (!isNaN(x) && !isNaN(y)) pts.push([x, y]);
        }
      }
    }
  }

  if (pts.length < 3) return null;

  // Clamp seluruh titik ke rentang 0 - 1000
  pts = pts.map(p => [
    Math.max(0, Math.min(1000, Math.round(p[0]))),
    Math.max(0, Math.min(1000, Math.round(p[1]))),
  ]);

  // 3. Auto-transpose check terhadap box_2d [ymin, xmin, ymax, xmax]
  if (Array.isArray(box2d) && box2d.length === 4) {
    const [ymin, xmin, ymax, xmax] = box2d.map(Number);
    const boxW = Math.max(1, xmax - xmin);
    const boxH = Math.max(1, ymax - ymin);

    // Hitung bounding box aktual dari pts
    let minX = 1000, maxX = 0, minY = 1000, maxY = 0;
    for (const p of pts) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    const ptsSpreadX = Math.max(1, maxX - minX);
    const ptsSpreadY = Math.max(1, maxY - minY);

    // Cek apakah koordinat tertukar: [y, x]
    // Kondisi 1: Aspek rasio kontur berlawanan dengan box_2d
    const isTransposedAspectRatio = (boxW > boxH * 1.3 && ptsSpreadY > ptsSpreadX * 1.3) ||
                                    (boxH > boxW * 1.3 && ptsSpreadX > ptsSpreadY * 1.3);
    
    // Kondisi 2: Center koordinat lebih cocok bila ditranspose
    const boxCenterX = (xmin + xmax) / 2;
    const boxCenterY = (ymin + ymax) / 2;
    const ptsCenterX = (minX + maxX) / 2;
    const ptsCenterY = (minY + maxY) / 2;
    const directDiff = Math.abs(ptsCenterX - boxCenterX) + Math.abs(ptsCenterY - boxCenterY);
    const flippedDiff = Math.abs(ptsCenterY - boxCenterX) + Math.abs(ptsCenterX - boxCenterY);

    if (isTransposedAspectRatio || (flippedDiff + 60 < directDiff)) {
      // Koordinat tertukar [y, x] -> transpose balik menjadi [x, y]
      pts = pts.map(p => [p[1], p[0]]);
    }
  }

  return pts;
}

/**
 * Konversi daftar titik [x, y] menjadi SVG curved smooth path (Catmull-Rom to Cubic Bezier)
 * Menghasilkan kurva mulus tanpa sudut kaku (d="M ... C ... Z")
 * 
 * @param {Array<Array<number>>} pts - Array titik [[x, y], ...]
 * @param {number} tension - Ketegangan kurva (0.5 - 1.0, default 0.85)
 * @returns {string} SVG Path definition string d
 */
export function pointsToSmoothPath(pts, tension = 0.85) {
  if (!Array.isArray(pts) || pts.length < 3) return '';

  const n = pts.length;
  let d = `M ${Math.round(pts[0][0])} ${Math.round(pts[0][1])}`;

  for (let i = 0; i < n; i++) {
    const pPrev = pts[(i - 1 + n) % n];
    const pCurr = pts[i];
    const pNext = pts[(i + 1) % n];
    const pNext2 = pts[(i + 2) % n];

    const cp1x = Math.round(pCurr[0] + ((pNext[0] - pPrev[0]) / 6) * tension);
    const cp1y = Math.round(pCurr[1] + ((pNext[1] - pPrev[1]) / 6) * tension);
    const cp2x = Math.round(pNext[0] - ((pNext2[0] - pCurr[0]) / 6) * tension);
    const cp2y = Math.round(pNext[1] - ((pNext2[1] - pCurr[1]) / 6) * tension);

    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${Math.round(pNext[0])} ${Math.round(pNext[1])}`;
  }

  return `${d} Z`;
}

/**
 * Buat Fallback Polygon Mask (14-16 titik lekuk organik) dari koordinat Bounding Box [ymin, xmin, ymax, xmax]
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
  const count = Math.max(12, Math.min(32, numPoints));
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * 2 * Math.PI;
    // Variasi harmonik multi-frekuensi untuk kontur makanan alami organik
    const wobble = 1.0 + (Math.sin(angle * 3) * 0.03) + (Math.cos(angle * 5) * 0.018);
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
