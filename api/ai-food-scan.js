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
  generateFallbackPolygonFromBox,
  estimatePhysicalAreaCm2,
  calculateVolumeAndWeight,
  getCategoryHighlightColor,
} from './lib/PolygonGeometryHelper.js';

export const config = {
  api: { bodyParser: { sizeLimit: '8mb' } },
};

// ─── System Prompts Standar PRD ─────────────────────────────────────────────

const SYSTEM_PROMPT_FOOD_DECOMPOSITION = `Anda adalah Ahli Gizi Klinis Indonesia dan Spesialis Computer Vision Instance Segmentation Porsimetri Pangan.

Tugas Anda adalah menganalisis foto makanan dari pengguna, memisahkan setiap komponen makanan dengan membuat kontur poligon (segmentation mask) yang mengikuti lekuk bentuk asli makanan, serta mengestimasi berat massanya dalam satuan gram (g) dan Ukuran Rumah Tangga (URT) Indonesia.

IKUTI PROSEDUR SEGMENTASI KONTUR & FISIKA PANGAN BERIKUT SECARA KETAT:

1. Kalibrasi Referensi Skala:
Identifikasi objek referensi ukuran di dalam foto (Piring makan standar Indonesia berdiameter ~24-26 cm, mangkuk berdiameter ~15-17 cm, sendok makan panjang kepala ~6 cm). Gunakan objek tersebut untuk menetapkan rasio skala piksel ke sentimeter (cm).

2. Dekomposisi & Ekstraksi Kontur Poligon (Pixel-Level Polygon Segmentation):
- Pecah hidangan di dalam foto menjadi daftar komponen makanan tunggal yang terpisah (contoh: pisahkan antara Nasi Putih, Ayam Goreng, Tempe Goreng, Tumis Sayur, dan Sambal).
- Untuk setiap item makanan, buat polygon_mask berupa daftar berurutan titik koordinat [[x, y], [x, y], ...] (minimal 10 hingga 24 titik sudut) yang menelusuri tepi/lekuk bentuk asli makanan tersebut secara presisi (BUKAN kotak persegi empat).
- Seluruh koordinat x dan y pada polygon_mask WAJIB dinormalisasi ke dalam rentang bilangan bulat 0 hingga 1000 (di mana [0, 0] adalah pojok kiri atas gambar dan [1000, 1000] adalah pojok kanan bawah gambar).
- Sertakan juga box_2d dalam format [ymin, xmin, ymax, xmax] (skala 0-1000) dan centroid [cx, cy] (titik tengah kontur makanan untuk penempatan label UI).
- Berikan highlight_color_hex sesuai kategori:
  - Karbohidrat (carbohydrate): "#1A73E8" (Biru)
  - Protein Hewani (animal_protein): "#FA903E" (Oranye)
  - Protein Nabati (plant_protein): "#FCC934" (Kuning Emas)
  - Sayuran & Buah (vegetable / fruit): "#81C995" (Hijau Mint)
  - Lemak, Saus, Sambal, Minuman (fat_sauce / beverage): "#C58AF9" (Ungu)

3. Identifikasi Metode Pemasakan & Lemak Tersembunyi:
Klasifikasikan metode pemasakan setiap item ke dalam: steamed_boiled, fried_deep, stir_fried, coconut_milk_curry, grilled_roasted, atau raw_fresh. Jika digoreng, ditumis, atau bersantan, hitung taksiran berat serapan minyak/santan dalam gram pada atribut hidden_oil_or_coconut_milk_g (acuan: 1/2 sdm minyak = 5g, santan = 30-50g).

4. Kalkulasi Luas Kontur (cm2) -> Volume (cm3) -> Berat Massa (gram):
- Hitung luas permukaan nyata (estimated_area_cm2) dari bagian dalam kontur poligon makanan (tidak termasuk area piring kosong) dan kalikan dengan tinggi rata-rata makanan (estimated_height_cm) untuk mendapatkan estimated_volume_cc (cm3 atau ml).
- Kalikan volume tersebut dengan konstanta massa jenis semu (apparent_density_used dalam g/cm3) dan petakan ke acuan URT Kementerian Kesehatan RI berikut:
  - Nasi putih / nasi goreng: densitas ~0.70 g/cm3 (Acuan URT: 1 centong magiccom = 100g)
  - Mie / spageti / bihun: densitas ~0.67 g/cm3 (Acuan URT: 1 porsi sedang = 150-240g, 1 gelas mie = 100g)
  - Roti tawar / roti panggang: densitas ~0.276 g/cm3 (Acuan URT: 1 iris = 20-25g, 3 iris = 60-70g)
  - Tempe / tahu: densitas ~0.80 g/cm3 (Acuan URT: 1 potong sedang tempe = 25g, 2 potong sedang = 50g; 1 potong sedang tahu = 50g)
  - Ikan / daging ayam / daging sapi / sosis: densitas ~0.86 - 1.05 g/cm3 (Acuan URT: 1 potong sedang ikan = 40g, 1 potong sedang ayam = 55-65g)
  - Telur (orak-arik / dadar / rebus): densitas ~1.123 g/cm3 (Acuan URT: 1 butir = 55-60g)
  - Sayuran daun mentah / salad / lalapan: densitas sangat rendah ~0.316 g/cm3 karena berongga udara (jangan overestimate beratnya)
  - Sayuran masak / tumis (tanpa kuah): Acuan URT 1 centong sayur = 15g, 1 gelas sayur ditiriskan = 100g
  - Kentang goreng / kerupuk / gorengan berongga: densitas ~0.241 g/cm3
  - Saus / sambal / selai / kecap: densitas ~1.10 - 1.30 g/cm3 (Acuan URT: 1 sdm = 10-15g, 1 sdt = 5g)
  - Minuman cair (susu, jus, soda, kuah): densitas ~0.973 - 1.027 g/cm3 (Acuan URT: 1 gelas = 200-225ml)

KEMBALIKAN OUTPUT HANYA DALAM FORMAT RAW JSON VALID SESUAI SKEMA BERIKUT TANPA TEKS TAMBAHAN:
{
  "scale_reference_detected": "Piring makan bundar diameter ~25 cm",
  "plate_diameter_cm_estimated": 25.0,
  "overall_confidence": 0.95,
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
        "label_short": "Nasi Putih • 100g"
      },
      "estimated_area_cm2": 57.1,
      "estimated_height_cm": 2.5,
      "estimated_volume_cc": 142.8,
      "apparent_density_used": 0.70,
      "estimated_weight_g": 100.0,
      "urt_amount": 1.0,
      "urt_unit": "centong magiccom",
      "urt_display_label": "1 centong magiccom (100g)",
      "hidden_oil_or_coconut_milk_g": 0.0,
      "fallback_nutrition_for_estimated_weight": {
        "energy_kcal": 175.0,
        "protein_g": 4.0,
        "fat_total_g": 0.5,
        "carb_total_g": 40.0,
        "sugar_total_g": 0.0,
        "dietary_fiber_g": 0.5,
        "sodium_mg": 5.0
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

async function callGeminiVision(apiKey, systemInstruction, base64Image, mimeType) {
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

  const payload = {
    contents: [
      {
        parts: [
          { text: systemInstruction },
          { inline_data: { mime_type: mimeType || 'image/jpeg', data: base64Image } },
        ],
      },
    ],
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

  const { mode, image, mimeType } = req.body || {};

  if (!image) return res.status(400).json({ error: 'Gambar tidak ditemukan di request.' });
  if (!['food', 'label'].includes(mode)) {
    return res.status(400).json({ error: 'mode harus "food" atau "label".' });
  }

  try {
    // ═════════════════════════════════════════════════════════════════════════
    // FITUR 1: AI FOTO MAKANAN & ESTIMASI BERAT MASSA (Two-Step Pipeline)
    // ═════════════════════════════════════════════════════════════════════════
    if (mode === 'food') {
      const rawText = await callGeminiVision(apiKey, SYSTEM_PROMPT_FOOD_DECOMPOSITION, image, mimeType);
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

      // Step 2: Hybrid Database Matching & Serapan Minyak/Santan
      const enrichedItems = detectedItems.map((item, idx) => {
        const itemName = (item.item_name_id || 'Makanan').trim();
        const estWeight = Number(item.estimated_weight_g) || 100.0;
        const cookingMethod = item.cooking_method || 'steamed_boiled';
        const hiddenOil = Number(item.hidden_oil_or_coconut_milk_g) || 0.0;

        // Cari kecocokan di database lokal (STAPLE_FOODS_SEED)
        const matchedStaple = STAPLE_FOODS_SEED.find(s => {
          const sName = s.food.name.toLowerCase();
          const target = itemName.toLowerCase();
          return sName.includes(target) || target.includes(sName);
        });

        let itemNutrition;
        let dataSource = 'VISION_AI_ESTIMATE';

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
          dataSource = matchedStaple.food.data_source;
        } else {
          // Fallback dari Vision LLM Step 1
          const fb = item.fallback_nutrition_for_estimated_weight || {};
          itemNutrition = {
            energy_kcal: Math.round(Number(fb.energy_kcal) || 0),
            protein_g: Math.round((Number(fb.protein_g) || 0) * 10) / 10,
            fat_total_g: Math.round((Number(fb.fat_total_g) || 0) * 10) / 10,
            carb_total_g: Math.round((Number(fb.carb_total_g) || 0) * 10) / 10,
            dietary_fiber_g: Math.round((Number(fb.dietary_fiber_g) || 0) * 10) / 10,
            sugar_total_g: Math.round((Number(fb.sugar_total_g) || 0) * 10) / 10,
            sodium_mg: Math.round(Number(fb.sodium_mg) || 0),
          };
        }

        const seg = item.visual_segmentation || {};
        let rawPolygon = seg.polygon_mask || item.polygon_mask;
        let box2d = null;
        const rawBox = seg.box_2d || item.box_2d;

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

        let polygonMask = null;
        if (Array.isArray(rawPolygon) && rawPolygon.length >= 3) {
          polygonMask = rawPolygon
            .filter(pt => Array.isArray(pt) && pt.length >= 2 && !isNaN(pt[0]) && !isNaN(pt[1]))
            .map(pt => [
              Math.max(0, Math.min(1000, Math.round(Number(pt[0])))),
              Math.max(0, Math.min(1000, Math.round(Number(pt[1])))),
            ]);
        }

        // Jika polygon_mask belum tersedia, hasilkan smooth elliptical polygon dari box2d
        if (!polygonMask || polygonMask.length < 3) {
          polygonMask = generateFallbackPolygonFromBox(box2d || [200, 200, 800, 800], 14);
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
        const labelShort = seg.label_short || `${itemName} • ${Math.round(estWeight)}g`;

        const plateDiameter = Number(step1Output.plate_diameter_cm_estimated) || 25.0;
        const areaCm2 = Number(item.estimated_area_cm2) || estimatePhysicalAreaCm2(shoelaceArea, plateDiameter);
        const heightCm = Number(item.estimated_height_cm) || 2.5;
        const volumeCc = Number(item.estimated_volume_cc) || Math.round(areaCm2 * heightCm * 10) / 10;

        return {
          id: `item_${idx}_${Date.now()}`,
          item_name_id: itemName,
          food_category: categoryKey,
          cooking_method: cookingMethod,
          visual_segmentation: {
            polygon_mask: polygonMask,
            box_2d: box2d,
            centroid: centroid,
            highlight_color_hex: highlightColor,
            label_short: labelShort,
            shoelace_area_norm: shoelaceArea,
          },
          polygon_mask: polygonMask,
          box_2d: box2d,
          centroid: centroid,
          highlight_color_hex: highlightColor,
          estimated_area_cm2: areaCm2,
          estimated_height_cm: heightCm,
          estimated_volume_cc: volumeCc,
          apparent_density_used: item.apparent_density_used || 1.0,
          estimated_weight_g: estWeight,
          urt_amount: Number(item.urt_amount) || 1.0,
          urt_unit: item.urt_unit || 'porsi',
          urt_display_label: item.urt_display_label || `${estWeight}g`,
          hidden_oil_or_coconut_milk_g: hiddenOil,
          nutrition: itemNutrition,
          data_source: dataSource,
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
      }));

      return res.status(200).json({
        success: true,
        mode: 'food',
        scale_reference_detected: step1Output.scale_reference_detected || 'Piring makan standar (~25 cm)',
        plate_diameter_cm_estimated: step1Output.plate_diameter_cm_estimated || 25.0,
        overall_confidence: step1Output.overall_confidence || 0.9,
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
