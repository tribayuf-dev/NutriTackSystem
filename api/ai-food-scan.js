/**
 * NutriTrack – AI Food Vision API (Vercel Serverless)
 * Endpoint: POST /api/ai-food-scan
 *
 * Mengimplementasikan 2 Fitur Utama Berdasarkan Standar PRD:
 * 1. mode "food"  → Two-Step Nutritionist Pipeline: Visual Decomposition, Scale Calibration,
 *                    Densitas Fisik (Kemenkes URT), Serapan Minyak/Santan, & Hybrid DB Matching.
 * 2. mode "label" → OCR Tabel Informasi Nilai Gizi (ING) Standar BPOM (Multi-format),
 *                    diikuti normalisasi via NutritionNormalizerService (basis 100g & validasi Atwater).
 */

import { normalizeAndValidateNutritionData } from './lib/NutritionNormalizerService.js';
import { STAPLE_FOODS_SEED, PHYSICAL_DENSITIES_SEED } from './lib/seedData.js';
import {
  calculateShoelaceArea,
  calculateCentroid,
  calculateBoundingBox,
  calculateTagAnchorPosition,
  generateFallbackPolygonFromBox,
  estimatePhysicalAreaCm2,
  calculateVolumeAndWeight,
  getCategoryHighlightColor,
  normalizePolygonPoints,
} from './lib/PolygonGeometryHelper.js';
import {
  calculateTrue3DVolumeFromPolygon,
  DEFAULT_CAMERA_INTRINSICS,
} from './lib/LiDARVolumeCalculatorService.js';

export const config = {
  api: { bodyParser: { sizeLimit: '8mb' } },
};

// ─── System Prompts Standar PRD ─────────────────────────────────────────────

const SYSTEM_PROMPT_FOOD_DECOMPOSITION = `Anda adalah Ahli Gizi Klinis Indonesia dan Spesialis Computer Vision 3D RGB-D & Instance Segmentation Porsimetri Pangan.

Tugas Anda adalah menganalisis foto makanan dari pengguna, mengekstrak kontur poligon (polygon_mask) yang mengikuti lekuk bentuk asli setiap komponen makanan, serta menghitung berat massanya dalam satuan gram (g) dan Ukuran Rumah Tangga (URT) Indonesia.

SISTEM INI MENDUKUNG 2 MODE INPUT KAMERA (ADAPTIVE DUAL-MODE):

- MODE 1 (capture_mode: "LIDAR_RGBD_3D"):
Perangkat pengguna memiliki sensor 3D LiDAR (Apple ARKit sceneDepth 256x192). Anda akan menerima foto RGB beserta metadata pengukuran fisik 3D (lidar_depth_context seperti jarak kamera ke piring dalam cm, luas kontur metrik cm2, tinggi rata-rata makanan cm, tinggi puncak cm, atau volume voxel dalam cm3).
ATURAN WAJIB MODE LIDAR: Anda DILARANG mengarang atau menebak ulang ukuran piring maupun ketebalan makanan jika nilai metrik 3D dari sensor LiDAR sudah tersedia. Gunakan volume_cc dan ukuran metrik dari sensor LiDAR sebagai kebenaran fisik absolut (ground-truth geometry), lalu kalikan langsung dengan apparent_density_used (g/cm3) sesuai jenis makanannya.

- MODE 2 (capture_mode: "STANDARD_2D_RGB"):
Perangkat pengguna hanya mengirimkan foto 2D biasa tanpa data LiDAR. Gunakan kalibrasi referensi objek di foto (diameter piring makan standar ~24-26 cm, mangkuk ~15-17 cm, sendok makan ~6 cm) untuk menaksir luas kontur (estimated_area_cm2) dan ketebalan makanan (estimated_height_cm).

IKUTI PROSEDUR SEGMENTASI KONTUR & FISIKA PANGAN BERIKUT SECARA KETAT:

1. Dekomposisi & Ekstraksi Kontur Poligon (Pixel-Level Polygon Segmentation):
- Pecah hidangan di dalam foto menjadi daftar komponen makanan tunggal yang terpisah (contoh: pisahkan antara Nasi Putih, Ayam Goreng, Tempe Goreng, Tumis Sayur, dan Sambal).
- Untuk setiap item makanan, buat visual_segmentation.polygon_mask berupa array berurutan titik koordinat [x, y] (minimal 10 hingga 24 titik sudut) yang menelusuri tepi/lekuk bentuk asli makanan secara presisi (BUKAN kotak persegi empat).
- Seluruh koordinat x dan y pada polygon_mask WAJIB dinormalisasi ke dalam rentang bilangan bulat 0 hingga 1000 ([0, 0] pojok kiri atas, [1000, 1000] pojok kanan bawah).
- Sertakan box_2d [ymin, xmin, ymax, xmax] (skala 0-1000) dan centroid [cx, cy] (titik tengah poligon untuk penempatan badge UI).
- Berikan highlight_color_hex sesuai kategori:
  - Karbohidrat (carbohydrate): "#1A73E8" (Biru)
  - Protein Hewani (animal_protein): "#FA903E" (Oranye)
  - Protein Nabati (plant_protein): "#FCC934" (Kuning Emas)
  - Sayuran & Buah (vegetable / fruit): "#81C995" (Hijau Mint)
  - Lemak, Saus, Sambal, Minuman, Camilan (fat_sauce / beverage / snack): "#C58AF9" (Ungu) atau "#FA903E"

2. Koreksi Rongga Udara (Porosity / Void Factor) & Densitas Semu (g/cm3):
- Pada pemindaian 3D LiDAR maupun 2D, gundukan makanan bertekstur acak (seperti kerupuk, kentang goreng, selada/lalapan, atau potongan ayam bertulang) memiliki ruang udara di bawah permukaan atasnya.
- Kalikan volume (estimated_volume_cc) dengan konstanta massa jenis semu (apparent_density_used dalam g/cm3) yang telah memperhitungkan faktor rongga udara dan acuan URT Kemenkes RI berikut:
  - Nasi putih / nasi goreng: densitas ~0.70 g/cm3 (Acuan URT: 1 centong magiccom = 100g)
  - Mie / spageti / bihun: densitas ~0.67 g/cm3 (Acuan URT: 1 porsi sedang = 150-240g, 1 gelas mie = 100g)
  - Roti tawar / roti panggang: densitas ~0.276 g/cm3 (Acuan URT: 1 iris = 20-25g, 3 iris = 60-70g)
  - Tempe / tahu: densitas ~0.80 g/cm3 (Acuan URT: 1 potong sedang tempe = 25g, 2 potong sedang = 50g; 1 potong sedang tahu = 50g)
  - Ikan / daging ayam / daging sapi / sosis: densitas ~0.86 - 1.05 g/cm3 (Acuan URT: 1 potong sedang ikan = 40g, 1 potong sedang ayam = 55-65g; jika ayam bertulang, kurangi ~20-25% volume untuk tulang)
  - Telur (orak-arik / dadar / rebus): densitas ~1.123 g/cm3 (Acuan URT: 1 butir = 55-60g)
  - Sayuran daun mentah / salad / lalapan: densitas sangat rendah ~0.316 g/cm3
  - Sayuran masak / tumis (tanpa kuah): Acuan URT 1 centong sayur = 15g, 1 gelas sayur ditiriskan = 100g
  - Kentang goreng / kerupuk / gorengan berongga: densitas ~0.241 g/cm3
  - Saus / sambal / selai / kecap: densitas ~1.10 - 1.30 g/cm3 (Acuan URT: 1 sdm = 10-15g, 1 sdt = 5g)
  - Minuman cair (susu, jus, soda, kuah): densitas ~0.973 - 1.027 g/cm3 (Acuan URT: 1 gelas = 200-225ml)

3. Identifikasi Metode Pemasakan & Lemak Tersembunyi:
Klasifikasikan ke dalam steamed_boiled, fried_deep, stir_fried, coconut_milk_curry, grilled_roasted, atau raw_fresh, serta hitung hidden_oil_or_coconut_milk_g dalam gram.

KEMBALIKAN OUTPUT HANYA DALAM FORMAT RAW JSON VALID SESUAI SKEMA BERIKUT TANPA TEKS TAMBAHAN:
{
  "capture_mode_used": "LIDAR_RGBD_3D | STANDARD_2D_RGB",
  "scale_reference_detected": "string (contoh: Sensor LiDAR ARKit jarak 32.4 cm / Piring makan ~25 cm)",
  "camera_to_plate_distance_cm": 32.4,
  "overall_confidence": 0.97,
  "detected_items": [
    {
      "item_name_id": "Nasi Putih",
      "food_category": "carbohydrate",
      "cooking_method": "steamed_boiled",
      "visual_segmentation": {
        "polygon_mask": [
          [210, 320], [265, 280], [340, 275], [410, 300],
          [445, 360], [430, 440], [380, 495], [295, 510],
          [230, 470], [195, 395]
        ],
        "box_2d": [275, 195, 510, 445],
        "centroid": [320, 392],
        "highlight_color_hex": "#1A73E8",
        "label_short": "Nasi Putih • 135g (LiDAR 3D)"
      },
      "geometry_3d_metrics": {
        "measurement_source": "LIDAR_VOXEL_INTEGRATION | MONOCULAR_2D_SHOELACE",
        "estimated_area_cm2": 64.2,
        "mean_height_cm": 3.0,
        "max_peak_height_cm": 4.2,
        "estimated_volume_cc": 192.8,
        "edible_volume_factor": 1.0
      },
      "apparent_density_used": 0.70,
      "estimated_weight_g": 135.0,
      "urt_amount": 1.35,
      "urt_unit": "centong magiccom",
      "urt_display_label": "1.35 centong magiccom (135g)",
      "hidden_oil_or_coconut_milk_g": 0.0,
      "fallback_nutrition_for_estimated_weight": {
        "energy_kcal": 236.2,
        "protein_g": 5.4,
        "fat_total_g": 0.7,
        "carb_total_g": 54.0,
        "sugar_total_g": 0.0,
        "dietary_fiber_g": 0.7,
        "sodium_mg": 6.8
      }
    }
  ]
}`;

const SYSTEM_PROMPT_LABEL_OCR = `Anda adalah Sistem AI Ekstraksi Data Pangan dan Spesialis Regulasi Label Informasi Nilai Gizi (ING) BPOM Indonesia.

Tugas Anda adalah membaca foto label kemasan makanan/minuman dan mengekstrak seluruh informasi produk serta Tabel Informasi Nilai Gizi menjadi struktur JSON baku untuk pembuatan Master Data Makanan baru secara otomatis.

IKUTI ATURAN EKSTRAKSI & REGULASI BPOM BERIKUT SECARA KETAT:
1. Dukungan Multi-Format Tabel BPOM:
   Baca dengan teliti baik format tabel Vertikal, format Horizontal Tabular, maupun format Linear (kalimat bersambung tanpa garis tabel).
2. Identitas & Prediksi Kategori:
   Ekstrak nama makanan (product_name), merek (brand), dan nomor barcode jika terlihat. Jika nama produk terpotong, prediksikan secara logis berdasarkan makronutrisi dan daftar bahan.
3. Pemisahan Berat Bersih vs Takaran Saji:
   net_weight_metric: Berat bersih total kemasan (g atau ml).
   serving_size_metric: Berat metrik 1 takaran saji (g atau ml).
   serving_size_urt_amount & serving_size_urt_unit: Satuan URT (contoh: "3" "keping", "1" "gelas", "1" "bungkus").
   servings_per_package: Jumlah sajian per kemasan.
4. Deteksi Basis Kuantitas Tabel (basis_type):
   Tentukan apakah basis adalah "per_serving", "per_100g", atau "per_package".
5. Normalisasi Nilai Kosong & Satuan:
   - WAJIB mengganti seluruh atribut nutrisi yang tidak tercantum dengan angka 0 (DILARANG null).
   - WAJIB mengonversi nilai Garam (Natrium), Kalium, Kalsium, Besi, dan Kolesterol ke satuan miligram (mg). Jika tertulis 0.15g garam/natrium, ubah menjadi 150.
   - Ekstrak persentase % AKG (acuan 2150 kkal) pada objek akg_percentages_as_labeled.

KEMBALIKAN OUTPUT HANYA DALAM FORMAT RAW JSON VALID SESUAI SKEMA BERIKUT:
{
  "product_metadata": {
    "product_name": "string",
    "brand": "string",
    "barcode_ean": "string",
    "category": "string",
    "food_type": "packaged",
    "base_unit": "g",
    "net_weight_metric": 0.0
  },
  "serving_info": {
    "basis_type": "per_serving",
    "serving_size_metric": 0.0,
    "serving_size_urt_amount": 1.0,
    "serving_size_urt_unit": "sajian",
    "servings_per_package": 1.0
  },
  "nutrients_as_labeled": {
    "energy_kcal": 0.0,
    "energy_from_fat_kcal": 0.0,
    "protein_g": 0.0,
    "fat_total_g": 0.0,
    "fat_saturated_g": 0.0,
    "fat_trans_g": 0.0,
    "cholesterol_mg": 0.0,
    "carb_total_g": 0.0,
    "dietary_fiber_g": 0.0,
    "sugar_total_g": 0.0,
    "sugar_added_g": 0.0,
    "sodium_mg": 0.0,
    "potassium_mg": 0.0,
    "calcium_mg": 0.0,
    "iron_mg": 0.0,
    "vit_a_mcg": 0.0,
    "vit_c_mg": 0.0,
    "vit_d_mcg": 0.0
  },
  "akg_percentages_as_labeled": {
    "protein_akg_pct": 0.0,
    "fat_total_akg_pct": 0.0,
    "fat_saturated_akg_pct": 0.0,
    "carb_total_akg_pct": 0.0,
    "dietary_fiber_akg_pct": 0.0,
    "sodium_akg_pct": 0.0
  },
  "ocr_confidence": 0.95,
  "extraction_notes": "string"
}`;

// ─── Helper: Call Gemini API with dynamic model discovery & JSON mode ─────────

async function callGeminiVision(apiKey, systemInstruction, base64Image, mimeType, extraPromptText = '') {
  const candidateModels = [
    'gemini-3.8-flash',
    'gemini-3.5-flash',
    'gemini-3-flash',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash',
  ];

  let targetModels = [...candidateModels];

  try {
    const listResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (listResp.ok) {
      const listData = await listResp.json();
      const validNames = (listData.models || [])
        .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
        .map(m => m.name.replace(/^models\//, ''))
        .filter(m => m.includes('flash') || m.includes('gemini'));

      validNames.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

      if (validNames.length > 0) {
        targetModels = [...new Set([...validNames, ...candidateModels])];
      }
    }
  } catch (e) {
    console.warn('ListModels warning:', e.message);
  }

  const parts = [{ text: systemInstruction }];
  if (extraPromptText) {
    parts.push({ text: extraPromptText });
  }
  parts.push({ inline_data: { mime_type: mimeType || 'image/jpeg', data: base64Image } });

  const payload = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.3,
      responseMimeType: 'application/json',
      maxOutputTokens: 3000,
    },
  };

  const tried = new Set();
  let lastError = null;

  for (let i = 0; i < targetModels.length; i++) {
    const model = targetModels[i];
    if (tried.has(model)) continue;
    tried.add(model);

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(payload),
      });

      if (resp.ok) {
        const data = await resp.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (text) return text.trim();
      }

      const errText = await resp.text();
      lastError = new Error(`Gemini API (${model}) error ${resp.status}: ${errText.slice(0, 200)}`);

      const recMatch = errText.match(/models\/([a-zA-Z0-9._-]+)/);
      if (recMatch && recMatch[1] && !tried.has(recMatch[1])) {
        targetModels.splice(i + 1, 0, recMatch[1]);
      }

      if (resp.status === 404) continue;
      throw lastError;
    } catch (err) {
      lastError = err;
      if (!err.message || !err.message.includes('404')) throw err;
    }
  }

  throw lastError || new Error('Tidak ada model Gemini yang dapat digunakan.');
}

function parseJsonClean(text) {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  return JSON.parse(cleaned);
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY belum dikonfigurasi di Environment Variables Vercel.' });
  }

  const {
    mode,
    image,
    mimeType,
    capture_mode = 'STANDARD_2D_RGB',
    depth_map_256x192 = null,
    confidence_map = null,
    camera_intrinsics = null,
    gravity_vector = null,
    camera_to_plate_distance_cm = null,
    lidar_depth_context = null,
  } = req.body || {};

  if (!image) return res.status(400).json({ error: 'Gambar tidak ditemukan di request.' });
  if (!['food', 'label'].includes(mode)) {
    return res.status(400).json({ error: 'mode harus "food" atau "label".' });
  }

  try {
    // ═════════════════════════════════════════════════════════════════════════
    // FITUR 1: AI FOTO MAKANAN & ESTIMASI BERAT MASSA (Two-Step Pipeline)
    // ═════════════════════════════════════════════════════════════════════════
    if (mode === 'food') {
      let extraContext = '';
      if (capture_mode === 'LIDAR_RGBD_3D') {
        extraContext = `INFORMASI METRIK SENSOR PERANGKAT:
capture_mode: "LIDAR_RGBD_3D" (Apple ARKit sceneDepth Sensor Aktif).
Jarak Kamera ke Piring: ${camera_to_plate_distance_cm ? camera_to_plate_distance_cm + ' cm' : 'Terdeteksi via LiDAR (25-45 cm optimal)'}.
${lidar_depth_context ? 'Metadata Fisik 3D: ' + JSON.stringify(lidar_depth_context) : ''}
ATURAN WAJIB: Perlakukan data 3D LiDAR ini sebagai kebenaran fisik absolut (ground-truth geometry).`;
      }

      const rawText = await callGeminiVision(apiKey, SYSTEM_PROMPT_FOOD_DECOMPOSITION, image, mimeType, extraContext);
      let step1Output;
      try {
        step1Output = parseJsonClean(rawText);
      } catch (err) {
        console.error('Failed to parse Step 1 JSON:', rawText);
        return res.status(422).json({
          error: 'Gagal memproses analisis foto makanan. Pastikan foto makanan terlihat jelas dan pencahayaan memadai.',
          raw: rawText.slice(0, 300),
        });
      }

      const detectedItems = Array.isArray(step1Output?.detected_items) ? step1Output.detected_items : [];

      // Step 2: Hybrid Database Matching, Integrasi Voxel 3D LiDAR & Serapan Minyak/Santan
      const enrichedItems = detectedItems.map((item, idx) => {
        const itemName = (item.item_name_id || 'Makanan').trim();
        const cookingMethod = item.cooking_method || 'steamed_boiled';
        const hiddenOil = Number(item.hidden_oil_or_coconut_milk_g) || 0.0;

        // Cari kecocokan di database lokal (STAPLE_FOODS_SEED)
        const matchedStaple = STAPLE_FOODS_SEED.find(s => {
          const sName = s.food.name.toLowerCase();
          const target = itemName.toLowerCase();
          return sName.includes(target) || target.includes(sName);
        });

        const seg = item.visual_segmentation || {};
        let rawPolygon = seg.polygon_mask || item.polygon_mask || seg.polygon || item.polygon || seg.contour || item.contour || seg.mask || item.mask || seg.points || item.points;
        let box2d = null;
        const rawBox = seg.box_2d || item.box_2d || seg.box || item.box || seg.bbox || item.bbox;

        if (Array.isArray(rawBox) && rawBox.length === 4) {
          const [ymin, xmin, ymax, xmax] = rawBox.map(Number);
          if (!isNaN(ymin) && !isNaN(xmin) && !isNaN(ymax) && !isNaN(xmax)) {
            box2d = [
              Math.max(0, Math.min(1000, Math.round(ymin))),
              Math.max(0, Math.min(1000, Math.round(xmin))),
              Math.max(0, Math.min(1000, Math.round(ymax))),
              Math.max(0, Math.min(1000, Math.round(xmax))),
            ];
          }
        }

        let polygonMask = normalizePolygonPoints(rawPolygon, box2d);

        // Jika polygon_mask belum tersedia, hasilkan smooth organic polygon dari box2d
        if (!polygonMask || polygonMask.length < 3) {
          polygonMask = generateFallbackPolygonFromBox(box2d || [200, 200, 800, 800], 16);
        }

        const shoelaceArea = calculateShoelaceArea(polygonMask);
        const centroid = (Array.isArray(seg.centroid) && seg.centroid.length === 2 && !isNaN(seg.centroid[0]))
          ? [Math.max(0, Math.min(1000, Math.round(seg.centroid[0]))), Math.max(0, Math.min(1000, Math.round(seg.centroid[1])))]
          : calculateCentroid(polygonMask);

        if (!box2d) {
          box2d = calculateBoundingBox(polygonMask);
        }

        const categoryKey = item.food_category || 'carbohydrate';
        const highlightColor = seg.highlight_color_hex || getCategoryHighlightColor(categoryKey);

        const plateDiameter = Number(step1Output.plate_diameter_cm_estimated) || 25.0;
        let areaCm2 = Number(item.estimated_area_cm2) || estimatePhysicalAreaCm2(shoelaceArea, plateDiameter);
        let heightCm = Number(item.estimated_height_cm) || 2.5;
        let volumeCc = Number(item.estimated_volume_cc) || Math.round(areaCm2 * heightCm * 10) / 10;
        let estWeight = Number(item.estimated_weight_g) || 100.0;
        let densityUsed = item.apparent_density_used || (matchedStaple?.physical_density?.apparent_density_g_cc) || 0.70;
        let lidar3D = null;
        let isLiDAR = (capture_mode === 'LIDAR_RGBD_3D');

        // INTEGRASI SENSOR 3D LIDAR (VOXEL CALCULATION) JIKA DATA KEDALAMAN TERSEDIA
        if (depth_map_256x192 && polygonMask && polygonMask.length >= 3) {
          try {
            const depthMapInput = Array.isArray(depth_map_256x192) ? new Float32Array(depth_map_256x192) : depth_map_256x192;
            const confidenceMapInput = Array.isArray(confidence_map) ? new Uint8Array(confidence_map) : confidence_map;
            lidar3D = calculateTrue3DVolumeFromPolygon({
              polygonMask,
              depthMap256x192: depthMapInput,
              confidenceMap: confidenceMapInput,
              cameraIntrinsics: camera_intrinsics || DEFAULT_CAMERA_INTRINSICS,
              gravityVector: gravity_vector || [0, 0, -1],
              apparentDensity: densityUsed,
            });

            if (lidar3D && lidar3D.true_volume_cc > 0) {
              isLiDAR = true;
              volumeCc = lidar3D.true_volume_cc;
              areaCm2 = lidar3D.surface_area_true_cm2;
              heightCm = lidar3D.mean_height_cm;
              estWeight = lidar3D.estimated_weight_g;
            }
          } catch (e) {
            console.warn('LiDAR Voxel Calculation warning:', e.message);
          }
        }

        let itemNutrition;
        let dataSource = isLiDAR ? 'LIDAR_RGBD_3D_SENSOR' : 'VISION_AI_ESTIMATE';

        if (matchedStaple) {
          // Deterministic calculation from DB basis per 100g
          const factor = estWeight / 100.0;
          const baseNutr = matchedStaple.nutrients_100;

          // Kompensasi serapan minyak goreng (1g minyak ~ 9 kkal, 1g lemak)
          // atau santan (1g santan ~ 2 kkal, 0.2g lemak)
          const isCoconut = cookingMethod === 'coconut_milk_curry';
          const oilKcal = isCoconut ? (hiddenOil * 2.0) : (hiddenOil * 9.0);
          const oilFat = isCoconut ? (hiddenOil * 0.2) : (hiddenOil * 1.0);

          itemNutrition = {
            energy_kcal: Math.round((baseNutr.energy_kcal * factor) + oilKcal),
            protein_g: Math.round(((baseNutr.protein_g * factor)) * 10) / 10,
            fat_total_g: Math.round(((baseNutr.fat_total_g * factor) + oilFat) * 10) / 10,
            carb_total_g: Math.round(((baseNutr.carb_total_g * factor)) * 10) / 10,
            dietary_fiber_g: Math.round(((baseNutr.dietary_fiber_g * factor)) * 10) / 10,
            sugar_total_g: Math.round(((baseNutr.sugar_total_g * factor)) * 10) / 10,
            sodium_mg: Math.round(baseNutr.sodium_mg * factor),
          };
          dataSource = isLiDAR ? `LIDAR_3D+${matchedStaple.food.data_source}` : matchedStaple.food.data_source;
        } else {
          // Fallback dari Vision LLM Step 1 disesuaikan rasio bobot aktual
          const fb = item.fallback_nutrition_for_estimated_weight || {};
          const origWeight = Number(item.estimated_weight_g) || 100.0;
          const scaleRatio = origWeight > 0 ? (estWeight / origWeight) : 1.0;

          itemNutrition = {
            energy_kcal: Math.round((Number(fb.energy_kcal) || 0) * scaleRatio),
            protein_g: Math.round(((Number(fb.protein_g) || 0) * scaleRatio) * 10) / 10,
            fat_total_g: Math.round(((Number(fb.fat_total_g) || 0) * scaleRatio) * 10) / 10,
            carb_total_g: Math.round(((Number(fb.carb_total_g) || 0) * scaleRatio) * 10) / 10,
            dietary_fiber_g: Math.round(((Number(fb.dietary_fiber_g) || 0) * scaleRatio) * 10) / 10,
            sugar_total_g: Math.round(((Number(fb.sugar_total_g) || 0) * scaleRatio) * 10) / 10,
            sodium_mg: Math.round((Number(fb.sodium_mg) || 0) * scaleRatio),
          };
        }

        const tagAnchor = calculateTagAnchorPosition(polygonMask || box2d);
        const labelShort = isLiDAR
          ? `${itemName} • ${Math.round(estWeight)}g (LiDAR 3D)`
          : (seg.label_short || `${itemName} • ${Math.round(estWeight)}g`);

        const urtUnit = item.urt_unit || 'porsi';
        const baseUrtAmount = Number(item.urt_amount) || 1.0;
        const urtAmount = Number(item.estimated_weight_g) > 0
          ? Math.round((estWeight / (Number(item.estimated_weight_g) / baseUrtAmount)) * 10) / 10
          : baseUrtAmount;
        const urtDisplay = item.urt_display_label
          ? `${urtAmount} ${urtUnit} (${Math.round(estWeight)}g)`
          : `${Math.round(estWeight)}g`;

        const geometry3DMetrics = {
          measurement_source: isLiDAR ? 'LIDAR_VOXEL_INTEGRATION' : 'MONOCULAR_2D_SHOELACE',
          estimated_area_cm2: areaCm2,
          mean_height_cm: heightCm,
          max_peak_height_cm: lidar3D?.max_peak_height_cm || (Number(item.geometry_3d_metrics?.max_peak_height_cm) || Math.round(heightCm * 1.35 * 10) / 10),
          estimated_volume_cc: volumeCc,
          edible_volume_factor: 1.0,
        };

        return {
          id: `item_${idx}_${Date.now()}`,
          item_name_id: itemName,
          food_category: categoryKey,
          cooking_method: cookingMethod,
          visual_segmentation: {
            polygon_mask: polygonMask,
            box_2d: box2d,
            centroid: centroid,
            tag_anchor: tagAnchor,
            highlight_color_hex: highlightColor,
            label_short: labelShort,
            shoelace_area_norm: shoelaceArea,
          },
          polygon_mask: polygonMask,
          box_2d: box2d,
          centroid: centroid,
          tag_anchor: tagAnchor,
          highlight_color_hex: highlightColor,
          geometry_3d_metrics: geometry3DMetrics,
          estimated_area_cm2: areaCm2,
          estimated_height_cm: heightCm,
          estimated_volume_cc: volumeCc,
          apparent_density_used: densityUsed,
          estimated_weight_g: estWeight,
          urt_amount: urtAmount,
          urt_unit: urtUnit,
          urt_display_label: urtDisplay,
          hidden_oil_or_coconut_milk_g: hiddenOil,
          nutrition: itemNutrition,
          data_source: dataSource,
          lidar_verified: isLiDAR,
          lidar_details: lidar3D,
        };
      });

      // Ringkasan total piring
      const totalSummary = enrichedItems.reduce((acc, curr) => ({
        calories: acc.calories + (curr.nutrition.energy_kcal || 0),
        protein: Math.round((acc.protein + (curr.nutrition.protein_g || 0)) * 10) / 10,
        carbs: Math.round((acc.carbs + (curr.nutrition.carb_total_g || 0)) * 10) / 10,
        fat: Math.round((acc.fat + (curr.nutrition.fat_total_g || 0)) * 10) / 10,
        sodium: acc.sodium + (curr.nutrition.sodium_mg || 0),
      }), { calories: 0, protein: 0, carbs: 0, fat: 0, sodium: 0 });

      // Format legacy results untuk kompatibilitas frontend eksisting jika dibutuhkan
      const legacyResults = enrichedItems.map(item => ({
        name: item.item_name_id,
        gram: item.estimated_weight_g,
        confidence: step1Output.overall_confidence > 0.8 ? 'tinggi' : 'sedang',
        aliases: [item.item_name_id.toLowerCase()],
        urt_label: item.urt_display_label,
        cooking_method: item.cooking_method,
        nutrition: item.nutrition,
        polygon_mask: item.polygon_mask,
        box_2d: item.box_2d,
        centroid: item.centroid,
        highlight_color_hex: item.highlight_color_hex,
        lidar_verified: item.lidar_verified,
        geometry_3d_metrics: item.geometry_3d_metrics,
      }));

      const finalDistanceCm = Number(camera_to_plate_distance_cm) ||
        (enrichedItems[0]?.lidar_details?.camera_to_plate_distance_cm) ||
        Number(step1Output.camera_to_plate_distance_cm) ||
        (capture_mode === 'LIDAR_RGBD_3D' ? 32.4 : null);

      return res.status(200).json({
        success: true,
        mode: 'food',
        capture_mode_used: capture_mode,
        scale_reference_detected: step1Output.scale_reference_detected || (capture_mode === 'LIDAR_RGBD_3D' ? `Sensor LiDAR ARKit jarak ${finalDistanceCm || 35} cm` : 'Piring makan standar (~25 cm)'),
        camera_to_plate_distance_cm: finalDistanceCm,
        plate_diameter_cm_estimated: step1Output.plate_diameter_cm_estimated || 25.0,
        overall_confidence: step1Output.overall_confidence || 0.95,
        detected_items: enrichedItems,
        summary: totalSummary,
        results: legacyResults, // Backward compatibility
      });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // FITUR 2 (Lapis 3): OCR TABEL NILAI GIZI & STANDAR BPOM
    // ═════════════════════════════════════════════════════════════════════════
    if (mode === 'label') {
      const rawText = await callGeminiVision(apiKey, SYSTEM_PROMPT_LABEL_OCR, image, mimeType);
      let ocrExtracted;
      try {
        ocrExtracted = parseJsonClean(rawText);
      } catch (err) {
        console.error('Failed to parse Label OCR JSON:', rawText);
        return res.status(422).json({
          error: 'Tabel Informasi Nilai Gizi tidak terdeteksi atau tidak terbaca. Pastikan foto tegak lurus dan teks angka terlihat tajam.',
          raw: rawText.slice(0, 300),
        });
      }

      // Normalisasi & validasi BPOM via NutritionNormalizerService
      const normalizedData = normalizeAndValidateNutritionData(ocrExtracted);

      // Kembalikan struktur lengkap Master Data + Legacy nutrition format untuk backward compatibility
      const legacyNutrition = {
        productName: normalizedData.master_food.name,
        brand: normalizedData.master_food.brand,
        barcode: normalizedData.master_food.barcode_ean,
        calories: normalizedData.food_nutrients_100.energy_kcal,
        protein: normalizedData.food_nutrients_100.protein_g,
        carbs: normalizedData.food_nutrients_100.carb_total_g,
        fat: normalizedData.food_nutrients_100.fat_total_g,
        fiber: normalizedData.food_nutrients_100.dietary_fiber_g,
        sugar: normalizedData.food_nutrients_100.sugar_total_g,
        sodium: normalizedData.food_nutrients_100.sodium_mg,
        servingName: normalizedData.food_serving_units[0]?.unit_name || 'sajian',
        servingGram: normalizedData.food_serving_units[0]?.gram_equivalent || 100,
        servingsPerPackage: ocrExtracted.serving_info?.servings_per_package || 1,
        needsReview: normalizedData.validation_meta.needs_review,
        reviewReasons: normalizedData.validation_meta.review_reasons,
      };

      return res.status(200).json({
        success: true,
        mode: 'label',
        normalized: normalizedData,
        nutrition: legacyNutrition, // Backward compatibility dengan UI saat ini
      });
    }
  } catch (err) {
    console.error('AI Food Scan Handler Error:', err);
    return res.status(500).json({ error: 'Terjadi kesalahan sistem: ' + err.message });
  }
}
