/**
 * NutriTrack – AI Food Vision API (Vercel Serverless)
 * Endpoint: POST /api/ai-food-scan
 *
 * Mengimplementasikan 2 Fitur Utama Berdasarkan Standar PRD:
 * 1. mode "food"  → Two-Step Nutritionist Pipeline: Visual Decomposition, Scale Calibration,
 *                    Densitas Fisik (Kemenkes URT), Serapan Minyak/Santan, & Hybrid DB Matching.
 * 2. mode "label" → OCR Tabel Informasi Nilai Gizi (ING) Standar BPOM (Multi-format),
 *                    diikuti normalisasi via NutritionNormalizerService (basis 100g & validasi Atwater).
 *
 * Didukung Sistem Multi-Provider Vision Engine:
 * - Google Gemini (gemini-2.0-flash, gemini-1.5-flash)
 * - OpenAI (gpt-4o-mini, gpt-4o)
 * - Groq Vision (llama-3.2-11b-vision-preview)
 * - Anthropic Claude (claude-3-5-haiku, claude-3-5-sonnet)
 * - OpenRouter (multi-model)
 * Menjamin high-availability, zero single-point-of-failure, dan kecepatan tinggi (sub-2s latency).
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

const SYSTEM_PROMPT_FOOD_DECOMPOSITION = `Anda adalah Ahli Gizi Klinis Indonesia dan Spesialis Computer Vision Porsimetri Pangan & Instance Segmentation.

Tugas Anda adalah mendeteksi dan menganalisis seluruh hidangan/makanan/minuman yang terlihat pada foto pengguna, mengekstrak kontur poligon (polygon_mask) yang mengikuti lekuk bentuk asli setiap komponen makanan, serta menghitung berat massanya dalam satuan gram (g) dan Ukuran Rumah Tangga (URT) Indonesia.

PEDOMAN PENYAJIAN & DETEKSI WADAH (FLEKSIBEL & ADAPTIF):
1. Ragam Wadah & Penyajian Makanan:
   Makanan dapat disajikan di berbagai jenis wadah, antara lain:
   - Piring makan / piring ceper / piring keramik / piring seng
   - Mangkuk / piring cekung / piring sup
   - Kotak bekal / bento box / kotak mika / wadah plastik bening / Tupperware (seperti kotak bekal sekolah / kantor / catering)
   - Toples / gelas / cangkir / mangkok kaca
   - Kertas minyak / daun pisang / kotak kardus makanan / sterofoam
   - Bungkusan jajanan / snack kemasan (seperti Momogi, keripik, wafer, biskuit, cokelat, roti, burger bungkus kertas, dsb.)
   - Dipegang oleh tangan atau langsung di atas meja makan.
   Sistem WAJIB mengenali makanan di seluruh tipe penyajian tersebut!

2. Penanganan Kemasan Snack, Wadah Transparan, Tutup, dan Stiker / Label Merek:
   - Jika foto memperlihatkan bungkusan makanan ringan / snack kemasan (seperti Momogi, Taro, Chitato, roti, burger dalam kertas), kenali jenis makanan tersebut dari kemasannya dan buat polygon_mask pada area kemasan/makanan tersebut. Estimasikan beratnya sesuai ukuran standar jajanan tersebut (misal: Momogi 12-20g, burger 150-200g, roti 60-80g).
   - Jika makanan berada di dalam wadah transparan (misalnya kotak mika atau wadah plastik Tupperware) yang memiliki stiker, label merek, atau tulisan di tutupnya, ABAIKAN stiker/teks tersebut dan fokus identifikasi isi makanannya.
   - Jangan salah mengira makanan di dalam wadah sebagai benda non-makanan hanya karena wadahnya memiliki stiker atau kemasan.

3. Kasus Foto Benar-Benar Bukan Makanan:
   - Hanya jika objek di foto dipastikan 100% sama sekali BUKAN makanan (contoh: buku tulis kosong, remote TV, obeng, keyboard komputer murni tanpa ada makanan sedikit pun), kembalikan "detected_items": [] dan sertakan catatan singkat pada scale_reference_detected bahwa objek yang difoto bukan makanan.

4. Kalibrasi Skala & Dimensi Objek:
   - Gunakan referensi objek di dalam foto (diameter piring makan standar ~24-26 cm, mangkuk ~15-17 cm, kotak bekal ~16-20 cm, wadah plastik/Tupperware sedang ~12-18 cm, bungkus snack ~12-16 cm, sendok makan ~6 cm, atau tangan manusia yang memegang wadah) untuk menaksir luas fisik area (estimated_area_cm2) dan ketebalan makanan (estimated_height_cm).
   - Kalikan volume (estimated_volume_cc) dengan konstanta massa jenis semu (apparent_density_used dalam g/cm3) yang memperhitungkan porositas rongga udara dan acuan standar URT Kemenkes RI:
     - Nasi putih / nasi goreng: densitas ~0.70 g/cm3 (Acuan URT: 1 centong magiccom = 100g)
     - Mie / spageti / bihun: densitas ~0.67 g/cm3 (Acuan URT: 1 porsi sedang = 150-240g, 1 gelas mie = 100g)
     - Roti tawar / roti panggang / burger: densitas ~0.28 g/cm3 (Acuan URT: 1 burger lengkap = 150-200g, 1 iris roti = 20-25g)
     - Tempe / tahu: densitas ~0.80 g/cm3 (Acuan URT: 1 potong sedang tempe = 25g; 1 potong sedang tahu = 50g)
     - Ikan / daging ayam / daging sapi / sate: densitas ~0.86 - 1.05 g/cm3 (Acuan URT: 1 tusuk sate ayam = 15-20g, 5 tusuk sate = 75-100g)
     - Telur (orak-arik / dadar / rebus): densitas ~1.12 g/cm3 (Acuan URT: 1 butir = 55-60g)
     - Sayuran daun mentah / salad / lalapan: densitas ~0.32 g/cm3
     - Sayuran masak / tumis: Acuan URT 1 centong sayur = 15-25g, 1 porsi sedang = 100g
     - Snack kemasan / kerupuk / ekstrudat: densitas ~0.20 - 0.35 g/cm3 (Acuan: 1 bungkus Momogi/snack stick = 12-20g)
     - Saus / bumbu kacang / sambal / puding: densitas ~1.05 - 1.25 g/cm3 (Acuan URT: 1 sdm = 15g)
     - Minuman cair: densitas ~1.0 g/cm3 (Acuan URT: 1 gelas = 200-250ml)

5. Ekstraksi Kontur Poligon (Pixel-Level Polygon Segmentation):
   - Untuk setiap item makanan, buat visual_segmentation.polygon_mask berupa array berurutan titik koordinat [x, y] (cukup 8 hingga 14 titik sudut) yang menelusuri tepi/lekuk bentuk asli makanan secara presisi (BUKAN kotak persegi empat).
   - Seluruh koordinat x dan y pada polygon_mask WAJIB dinormalisasi ke rentang bilangan bulat 0 hingga 1000 ([0, 0] pojok kiri atas, [1000, 1000] pojok kanan bawah).
   - Sertakan box_2d [ymin, xmin, ymax, xmax] (skala 0-1000) dan centroid [cx, cy] (titik tengah poligon).
   - Berikan highlight_color_hex sesuai kategori:
     - Karbohidrat (carbohydrate): "#1A73E8" (Biru)
     - Protein Hewani (animal_protein): "#FA903E" (Oranye)
     - Protein Nabati (plant_protein): "#FCC934" (Kuning Emas)
     - Sayuran & Buah (vegetable / fruit): "#81C995" (Hijau Mint)
     - Lemak, Saus, Sambal, Camilan, Puding (fat_sauce / snack / dessert): "#C58AF9" (Ungu) atau "#FA903E"

6. Identifikasi Metode Pemasakan & Lemak Tersembunyi:
   Klasifikasikan ke dalam steamed_boiled, fried_deep, stir_fried, coconut_milk_curry, grilled_roasted, atau raw_fresh, serta hitung hidden_oil_or_coconut_milk_g dalam gram.

7. Efisiensi Output JSON:
   Kembalikan struktur JSON ringkas dan padat tanpa teks tambahan atau penjelasan pengantar/penutup agar transmisi data instan dan hemat kuota token.

KEMBALIKAN OUTPUT HANYA DALAM FORMAT RAW JSON VALID SESUAI SKEMA BERIKUT TANPA TEKS TAMBAHAN:
{
  "scale_reference_detected": "string (contoh: Wadah kotak plastik ~16 cm / Piring makan ~25 cm / Kemasan snack ~14 cm)",
  "overall_confidence": 0.95,
  "detected_items": [
    {
      "item_name_id": "Nama Makanan",
      "food_category": "carbohydrate | animal_protein | plant_protein | vegetable | fruit | fat_sauce | snack | beverage",
      "cooking_method": "steamed_boiled | fried_deep | stir_fried | coconut_milk_curry | grilled_roasted | raw_fresh",
      "visual_segmentation": {
        "polygon_mask": [
          [210, 320], [265, 280], [340, 275], [410, 300],
          [445, 360], [430, 440], [380, 495], [295, 510],
          [230, 470], [195, 395]
        ],
        "box_2d": [275, 195, 510, 445],
        "centroid": [320, 392],
        "highlight_color_hex": "#1A73E8",
        "label_short": "Nama • 100g"
      },
      "apparent_density_used": 0.70,
      "estimated_weight_g": 100.0,
      "urt_amount": 1.0,
      "urt_unit": "porsi / potong / centong / mangkuk / sdm / bungkus",
      "urt_display_label": "1 porsi (100g)",
      "hidden_oil_or_coconut_milk_g": 0.0,
      "fallback_nutrition_for_estimated_weight": {
        "energy_kcal": 150.0,
        "protein_g": 3.0,
        "fat_total_g": 2.0,
        "carb_total_g": 25.0,
        "sugar_total_g": 0.0,
        "dietary_fiber_g": 1.0,
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

// ─── AI Vision Providers (Multi-Engine & High Availability) ─────────────────

/**
 * 1. Google Gemini Vision Call
 * Menggunakan auto-discovery model aktif dari akun dengan caching 30 menit & fallback valid.
 */
// Dynamic Vision Model Discovery with Caching (1 Hour TTL)
let _geminiVisionCache = { targets: [], timestamp: 0 };
let _groqVisionCache = { models: [], timestamp: 0 };
const VISION_CACHE_TTL_MS = 60 * 60 * 1000;

const VERIFIED_GEMINI_TARGETS = [
  { ver: 'v1beta', model: 'gemini-1.5-flash' },
  { ver: 'v1',     model: 'gemini-1.5-flash' },
  { ver: 'v1beta', model: 'gemini-2.0-flash' },
  { ver: 'v1beta', model: 'gemini-2.0-flash-exp' },
  { ver: 'v1beta', model: 'gemini-1.5-flash-latest' },
  { ver: 'v1beta', model: 'gemini-1.5-flash-8b' },
  { ver: 'v1beta', model: 'gemini-1.5-pro' },
  { ver: 'v1',     model: 'gemini-1.5-pro' },
];

async function getAvailableGeminiVisionTargets(apiKey) {
  const now = Date.now();
  if (_geminiVisionCache.targets.length > 0 && (now - _geminiVisionCache.timestamp) < VISION_CACHE_TTL_MS) {
    return _geminiVisionCache.targets;
  }
  
  // SELALU mulai dengan target terverifikasi paling stabil di urutan teratas!
  // gemini-1.5-flash dan gemini-2.0-flash adalah model vision resmi Google yang aktif untuk semua pengguna.
  const targets = [...VERIFIED_GEMINI_TARGETS];

  // Jika ada custom model dari environment variable (selain model bermasalah/alias lambat)
  if (process.env.GEMINI_VISION_MODEL) {
    const envModel = process.env.GEMINI_VISION_MODEL.trim();
    if (envModel !== 'gemini-flash-latest' && !envModel.includes('2.5') && !envModel.includes('image')) {
      targets.unshift({ ver: 'v1beta', model: envModel });
    }
  }

  // Auto-discovery dari Google AI Studio: HANYA untuk menemukan model resmi tambahan
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(apiKey.trim()), {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const valid = (data.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map(m => m.name.replace(/^models\//, ''))
        .filter(id => {
          const low = id.toLowerCase();
          // Filter sangat ketat: SINGKIRKAN model preview 2.5 (no longer available to new users),
          // model image gen (flash-image), TTS, audio, realtime, embedding, tuning, thinking
          if (low.includes('2.5') || low.includes('image') || low.includes('imagen') ||
              low.includes('embedding') || low.includes('aqa') || low.includes('tts') ||
              low.includes('audio') || low.includes('realtime') || low.includes('search') ||
              low.includes('thinking') || low.includes('custom') || low.includes('tuning') ||
              low.includes('lite')) {
            return false;
          }
          return low.includes('flash') || low.includes('pro');
        });

      // Tambahkan model yang lolos filter ke BAGIAN BELAKANG (bukan di depan verified targets)
      for (const m of valid) {
        if (!targets.some(t => t.model === m)) {
          targets.push({ ver: 'v1beta', model: m });
        }
      }
    } else {
      const errBody = await res.text();
      console.warn(`[AI Food Scan] Gemini discovery status ${res.status}: ${errBody.slice(0, 100)}`);
    }
  } catch (err) {
    console.warn('[AI Food Scan] Gemini vision auto-discovery notice:', err.message);
  }

  _geminiVisionCache = { targets, timestamp: now };
  return targets;
}

async function callGeminiVision(apiKey, systemInstruction, cleanBase64, cleanMimeType, extraPromptText = '') {
  const attemptedErrors = [];
  const geminiTargets = await getAvailableGeminiVisionTargets(apiKey);

  const userPromptText = extraPromptText
    ? extraPromptText
    : 'Analisis foto makanan ini secara menyeluruh, lakukan segmentasi kontur lekuk porsimetri, dan kembalikan output murni JSON sesuai skema sistem.';

  const userParts = [
    { text: userPromptText },
    {
      inlineData: {
        mimeType: cleanMimeType,
        data: cleanBase64,
      },
    },
  ];

  for (const target of geminiTargets) {
    const controller = new AbortController();
    // 20 detik per model — cukup untuk inferensi multimodal beresolusi tinggi
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    try {
      const genConfig = {
        temperature: 0.2,
        maxOutputTokens: 2048,
      };
      if (target.ver === 'v1beta') {
        genConfig.responseMimeType = 'application/json';
      }

      const payload = {
        contents: [
          {
            role: 'user',
            parts: target.ver === 'v1beta'
              ? userParts
              : [{ text: systemInstruction }, ...userParts],
          },
        ],
        generationConfig: genConfig,
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
        ],
      };

      if (target.ver === 'v1beta') {
        payload.system_instruction = {
          parts: [{ text: systemInstruction }],
        };
      }

      const url = `https://generativelanguage.googleapis.com/${target.ver}/models/${target.model}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (resp.ok) {
        const data = await resp.json();
        const candidate = data?.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text || '';
        if (text && text.trim()) {
          return { text: text.trim(), model: target.model };
        }
        const finishReason = candidate?.finishReason || 'NO_TEXT';
        attemptedErrors.push(`${target.model} [${finishReason}]`);
      } else {
        const errText = await resp.text();
        let detail = '';
        try {
          const errObj = JSON.parse(errText);
          if (errObj?.error?.message) {
            detail = `: ${errObj.error.message.slice(0, 80)}`;
          }
        } catch (_) {
          if (errText) detail = `: ${errText.slice(0, 80)}`;
        }
        attemptedErrors.push(`${target.model} [${resp.status}${detail}]`);
        console.warn(`[Gemini] Model ${target.model} (${target.ver}) HTTP ${resp.status}: ${errText.slice(0, 100)}`);
        // Jika 429 beruntun, batasi percobaan agar cascade ke provider cadangan dapat langsung bekerja
        if (resp.status === 429 && attemptedErrors.filter(e => e.includes('[429')).length >= 2) {
          break;
        }
      }
    } catch (err) {
      clearTimeout(timeoutId);
      const msg = err.name === 'AbortError' ? 'timeout 20s' : err.message;
      attemptedErrors.push(`${target.model} [${msg}]`);
    }

    // Jika error adalah 404 (model tidak tersedia di akun), jangan hitung sebagai fatal timeout
    const fatalErrors = attemptedErrors.filter(e => !e.includes('[404'));
    if (fatalErrors.length >= 2 || attemptedErrors.length >= 6) {
      break;
    }
  }

  throw new Error(`Model Gemini gagal: ${attemptedErrors.slice(0, 4).join(', ')}`);
}

/**
 * 2. OpenAI GPT-4o Vision Call (Ultra Cepat & Stabil)
 */
async function callOpenAIVision(apiKey, systemInstruction, cleanBase64, cleanMimeType, extraPromptText = '') {
  const envModel = process.env.OPENAI_VISION_MODEL ? process.env.OPENAI_VISION_MODEL.trim() : '';
  const OPENAI_MODELS = [
    (envModel && envModel !== 'chatgpt-4o-latest') ? envModel : null,
    'gpt-4o-mini',
    'gpt-4o',
  ].filter(Boolean);
  const attemptedErrors = [];

  for (const model of OPENAI_MODELS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
    try {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 1500,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemInstruction },
            {
              role: 'user',
              content: [
                ...(extraPromptText ? [{ type: 'text', text: extraPromptText }] : []),
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${cleanMimeType};base64,${cleanBase64}`,
                    detail: 'high',
                  },
                },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (resp.ok) {
        const data = await resp.json();
        const text = data?.choices?.[0]?.message?.content || '';
        if (text && text.trim()) {
          return { text: text.trim(), model };
        }
      }

      const errText = await resp.text();
      let parsedMsg = errText.slice(0, 160);
      try {
        const parsed = JSON.parse(errText);
        if (parsed?.error?.message) {
          parsedMsg = parsed.error.message;
        }
      } catch (e) {}
      attemptedErrors.push(`${model} (${resp.status}): ${parsedMsg}`);
    } catch (err) {
      clearTimeout(timeoutId);
      const msg = err.name === 'AbortError' ? `${model} timeout (15s)` : err.message;
      attemptedErrors.push(`${model} err: ${msg}`);
    }
  }

  throw new Error(`OpenAI gagal: ${attemptedErrors.join(', ')}`);
}

/**
 * 3. Groq Vision Call (LPU Ultra-Fast Sub-Second Vision)
 */
const VERIFIED_GROQ_MODELS = [
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
];

async function getAvailableGroqVisionModels(apiKey) {
  const now = Date.now();
  if (_groqVisionCache.models.length > 0 && (now - _groqVisionCache.timestamp) < VISION_CACHE_TTL_MS) {
    return _groqVisionCache.models;
  }
  const models = [];
  if (process.env.GROQ_VISION_MODEL && !process.env.GROQ_VISION_MODEL.includes('qwen')) {
    models.push(process.env.GROQ_VISION_MODEL);
  }
  models.push('meta-llama/llama-4-scout-17b-16e-instruct');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { 'Authorization': 'Bearer ' + apiKey.trim() },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const list = (data.data || []).map(m => m.id);
      const activeVision = list.filter(id => {
        const low = id.toLowerCase();
        // Singkirkan model preview lama yang sudah didekomisioning dan model non-vision
        if (low.includes('llama-3.2-11b') || low.includes('llama-3.2-90b')) return false;
        if (low.includes('whisper') || low.includes('guard')) return false;
        // Prioritaskan model dengan vision capability (scout, maverick, vision)
        return low.includes('scout') || low.includes('maverick') || low.includes('vision');
      });
      for (const vm of activeVision) {
        if (!models.includes(vm)) models.push(vm);
      }
    }
  } catch (err) {
    console.warn('[AI Food Scan] Groq auto-discovery notice:', err.message);
  }

  for (const gm of VERIFIED_GROQ_MODELS) {
    if (!models.includes(gm)) models.push(gm);
  }

  _groqVisionCache = { models, timestamp: now };
  return models;
}

async function callGroqVision(apiKey, systemInstruction, cleanBase64, cleanMimeType, extraPromptText = '') {
  const groqModels = await getAvailableGroqVisionModels(apiKey);
  const attemptedErrors = [];

  for (const model of groqModels) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000); // 12s timeout
    try {
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          // PENTING: max_tokens dibatasi ke 380 agar tetap aman di bawah limit OTPM 1000 tier on_demand Groq
          max_tokens: 380,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemInstruction },
            {
              role: 'user',
              content: [
                ...(extraPromptText ? [{ type: 'text', text: extraPromptText }] : []),
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${cleanMimeType};base64,${cleanBase64}`,
                  },
                },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (resp.ok) {
        const data = await resp.json();
        const text = data?.choices?.[0]?.message?.content || '';
        if (text && text.trim()) {
          return { text: text.trim(), model };
        }
      }

      const errText = await resp.text();
      let parsedMsg = errText.slice(0, 160);
      try {
        const parsed = JSON.parse(errText);
        if (parsed?.error?.message) {
          parsedMsg = parsed.error.message;
        }
      } catch (e) {}
      attemptedErrors.push(`${model} (${resp.status}): ${parsedMsg}`);
    } catch (err) {
      clearTimeout(timeoutId);
      const msg = err.name === 'AbortError' ? `${model} timeout (12s)` : err.message;
      attemptedErrors.push(`${model} err: ${msg}`);
    }
  }

  throw new Error(`Groq gagal: ${attemptedErrors.join(', ')}`);
}

/**
 * 4. Anthropic Claude Vision Call
 */
async function callAnthropicVision(apiKey, systemInstruction, cleanBase64, cleanMimeType, extraPromptText = '') {
  const ANTHROPIC_MODELS = [
    process.env.ANTHROPIC_VISION_MODEL,
    'claude-3-5-haiku-20241022',
    'claude-3-5-sonnet-20241022',
    'claude-3-haiku-20240307',
  ].filter(Boolean);
  const attemptedErrors = [];

  let anthropicMedia = cleanMimeType;
  if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(anthropicMedia)) {
    anthropicMedia = 'image/jpeg';
  }

  for (const model of ANTHROPIC_MODELS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey.trim(),
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1500,
          temperature: 0.2,
          system: systemInstruction,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: anthropicMedia,
                    data: cleanBase64,
                  },
                },
                {
                  type: 'text',
                  text: (extraPromptText ? extraPromptText + '\n' : '') +
                    'Kembalikan HANYA format RAW JSON valid sesuai skema instruksi sistem tanpa teks pengantar, teks penutup, atau markdown fences.',
                },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (resp.ok) {
        const data = await resp.json();
        const textBlock = (data?.content || []).find(b => b.type === 'text');
        const text = textBlock?.text || '';
        if (text && text.trim()) {
          return { text: text.trim(), model };
        }
      }

      const errText = await resp.text();
      let parsedMsg = errText.slice(0, 160);
      try {
        const parsed = JSON.parse(errText);
        if (parsed?.error?.message) {
          parsedMsg = parsed.error.message;
        }
      } catch (e) {}
      attemptedErrors.push(`${model} (${resp.status}): ${parsedMsg}`);
    } catch (err) {
      clearTimeout(timeoutId);
      const msg = err.name === 'AbortError' ? `${model} timeout (15s)` : err.message;
      attemptedErrors.push(`${model} err: ${msg}`);
    }
  }

  throw new Error(`Anthropic gagal: ${attemptedErrors.join(', ')}`);
}

/**
 * 5. OpenRouter Vision Call (Fallback Cadangan Luas)
 */
async function callOpenRouterVision(apiKey, systemInstruction, cleanBase64, cleanMimeType, extraPromptText = '') {
  const OPENROUTER_MODELS = [
    'google/gemini-2.0-flash-exp:free',
    'meta-llama/llama-3.2-11b-vision-instruct:free',
    'openai/gpt-4o-mini',
  ];
  let lastError = null;

  for (const model of OPENROUTER_MODELS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    try {
      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`,
          'HTTP-Referer': 'https://nutritrack.vercel.app',
          'X-Title': 'NutriTrack System',
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 1500,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemInstruction },
            {
              role: 'user',
              content: [
                ...(extraPromptText ? [{ type: 'text', text: extraPromptText }] : []),
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${cleanMimeType};base64,${cleanBase64}`,
                  },
                },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (resp.ok) {
        const data = await resp.json();
        const text = data?.choices?.[0]?.message?.content || '';
        if (text && text.trim()) {
          return { text: text.trim(), model };
        }
      }

      const errText = await resp.text();
      lastError = new Error(`${model} (${resp.status}): ${errText.slice(0, 140)}`);
    } catch (err) {
      clearTimeout(timeoutId);
      const msg = err.name === 'AbortError' ? `${model} timeout (12s)` : err.message;
      lastError = new Error(`${model} err: ${msg}`);
    }
  }

  throw lastError || new Error('Seluruh model OpenRouter gagal merespons.');
}

function getProviderDisplayName(code) {
  switch (code) {
    case 'gemini': return 'Google Gemini';
    case 'openai': return 'OpenAI';
    case 'groq': return 'Groq Vision';
    case 'anthropic': return 'Anthropic Claude';
    case 'openrouter': return 'OpenRouter';
    default: return code;
  }
}

/**
 * Fallback Cerdas Berbasis Standar Gizi Klinis Kemenkes RI & TKPI
 * Menjamin zero single-point-of-failure saat seluruh jaringan AI cloud sedang mengalami antrean / limit
 */
function getIndonesianStaplePlateFallback() {
  return {
    scale_reference_detected: 'Piring / Wadah Standar (Estimasi Klinis Kemenkes RI)',
    overall_confidence: 0.88,
    is_fallback: true,
    detected_items: [
      {
        item_name_id: 'Nasi Putih / Nasi Goreng',
        food_category: 'carbohydrate',
        cooking_method: 'stir_fried',
        visual_segmentation: {
          polygon_mask: [
            [250, 320], [350, 260], [520, 260], [600, 320],
            [620, 480], [560, 580], [400, 600], [280, 520], [240, 420]
          ],
          box_2d: [260, 240, 600, 620],
          centroid: [420, 420],
          highlight_color_hex: '#1A73E8',
          label_short: 'Nasi • 150g'
        },
        apparent_density_used: 0.70,
        estimated_weight_g: 150.0,
        urt_amount: 1.5,
        urt_unit: 'centong magiccom',
        urt_display_label: '1.5 centong (150g)',
        hidden_oil_or_coconut_milk_g: 3.0,
        fallback_nutrition_for_estimated_weight: {
          energy_kcal: 260.0,
          protein_g: 4.5,
          fat_total_g: 4.0,
          carb_total_g: 50.0,
          sugar_total_g: 0.5,
          dietary_fiber_g: 1.0,
          sodium_mg: 120.0
        }
      },
      {
        item_name_id: 'Telur Mata Sapi / Ceplok',
        food_category: 'animal_protein',
        cooking_method: 'fried_deep',
        visual_segmentation: {
          polygon_mask: [
            [500, 450], [600, 420], [700, 460], [740, 560],
            [710, 660], [620, 700], [530, 670], [480, 570]
          ],
          box_2d: [420, 480, 700, 740],
          centroid: [600, 560],
          highlight_color_hex: '#FA903E',
          label_short: 'Telur • 60g'
        },
        apparent_density_used: 1.12,
        estimated_weight_g: 60.0,
        urt_amount: 1.0,
        urt_unit: 'butir',
        urt_display_label: '1 butir (60g)',
        hidden_oil_or_coconut_milk_g: 4.0,
        fallback_nutrition_for_estimated_weight: {
          energy_kcal: 110.0,
          protein_g: 7.5,
          fat_total_g: 8.5,
          carb_total_g: 0.6,
          sugar_total_g: 0.2,
          dietary_fiber_g: 0.0,
          sodium_mg: 90.0
        }
      },
      {
        item_name_id: 'Lalapan Timun & Pelengkap',
        food_category: 'vegetable',
        cooking_method: 'raw_fresh',
        visual_segmentation: {
          polygon_mask: [
            [220, 520], [260, 480], [310, 510], [330, 580],
            [300, 640], [250, 650], [210, 600]
          ],
          box_2d: [480, 210, 650, 330],
          centroid: [270, 570],
          highlight_color_hex: '#81C995',
          label_short: 'Lalapan • 35g'
        },
        apparent_density_used: 0.32,
        estimated_weight_g: 35.0,
        urt_amount: 3.0,
        urt_unit: 'iris',
        urt_display_label: '3 iris (35g)',
        hidden_oil_or_coconut_milk_g: 0.0,
        fallback_nutrition_for_estimated_weight: {
          energy_kcal: 8.0,
          protein_g: 0.3,
          fat_total_g: 0.1,
          carb_total_g: 1.5,
          sugar_total_g: 0.6,
          dietary_fiber_g: 0.5,
          sodium_mg: 3.0
        }
      }
    ]
  };
}

function getLabelOcrFallback() {
  return {
    product_metadata: {
      product_name: 'Produk Kemasan (Estimasi Manual)',
      brand: 'Merek Kemasan',
      barcode_ean: '',
      category: 'Makanan Kemasan',
      food_type: 'packaged',
      base_unit: 'g',
      net_weight_metric: 100.0,
    },
    serving_info: {
      basis_type: 'per_serving',
      serving_size_metric: 30.0,
      serving_size_urt_amount: 1.0,
      serving_size_urt_unit: 'sajian',
      servings_per_package: 3.0,
    },
    nutrients_as_labeled: {
      energy_kcal: 140.0,
      energy_from_fat_kcal: 50.0,
      protein_g: 3.0,
      fat_total_g: 6.0,
      fat_saturated_g: 2.0,
      fat_trans_g: 0.0,
      cholesterol_mg: 0.0,
      carb_total_g: 18.0,
      dietary_fiber_g: 1.0,
      sugar_total_g: 4.0,
      sugar_added_g: 2.0,
      sodium_mg: 120.0,
      potassium_mg: 0.0,
      calcium_mg: 0.0,
      iron_mg: 0.0,
      vit_a_mcg: 0.0,
      vit_c_mg: 0.0,
      vit_d_mcg: 0.0,
    },
    akg_percentages_as_labeled: {
      protein_akg_pct: 5.0,
      fat_total_akg_pct: 9.0,
      carb_total_akg_pct: 6.0,
      dietary_fiber_akg_pct: 3.0,
      sodium_akg_pct: 8.0,
    },
    ocr_confidence: 0.85,
    extraction_notes: 'Katalog Cadangan: Silakan sesuaikan angka nutrisi sesuai label kemasan asli jika terdapat perbedaan.',
  };
}

/**
 * Multi-Provider Cascade Coordinator
 * Mencoba provider sesuai prioritas atau preferensi user, dan jika gagal/sibuk/overload,
 * langsung berpindah otomatis ke provider cadangan aktif tanpa menampilkan error ke user.
 */
async function callVisionCascade({
  mode = 'food',
  requestedProvider = 'auto',
  systemInstruction,
  base64Image,
  mimeType,
  extraPromptText = '',
  custom_keys = {},
}) {
  const startTime = Date.now();
  const cleanBase64 = String(base64Image || '').replace(/^data:image\/[a-zA-Z]+;base64,/, '').trim();
  const cleanMimeType = (mimeType && mimeType.includes('/')) ? mimeType : 'image/jpeg';

  const keys = {
    gemini: String(custom_keys?.gemini || process.env.GEMINI_API_KEY || '').trim(),
    openai: String(custom_keys?.openai || process.env.OPENAI_API_KEY || '').trim(),
    groq: String(custom_keys?.groq || process.env.GROQ_API_KEY || '').trim(),
    anthropic: String(custom_keys?.anthropic || process.env.ANTHROPIC_API_KEY || '').trim(),
    openrouter: String(custom_keys?.openrouter || process.env.OPENROUTER_API_KEY || '').trim(),
  };

  const availableProviders = Object.keys(keys).filter(k => !!keys[k]);
  if (availableProviders.length === 0) {
    // Jika tidak ada API key sama sekali, jalankan langsung Fallback Katalog Gizi Klinis
    const fallbackData = (mode === 'label') ? getLabelOcrFallback() : getIndonesianStaplePlateFallback();
    return {
      text: JSON.stringify(fallbackData),
      provider_used: 'Katalog Gizi Klinis NutriTrack (Cadangan)',
      provider_code: 'clinical_fallback',
      model_used: 'kemenkes-heuristic-v1',
      latency_ms: Date.now() - startTime,
      fallback_occurred: true,
      fallback_errors: ['Tidak ada API key terpasang'],
      is_clinical_fallback: true,
      fallback_notice: 'Belum ada API Key AI terpasang. Sistem menggunakan estimasi porsi standar Kemenkes RI. Anda dapat memasang API Key di menu ⚙️ Kunci API.'
    };
  }

  // Tentukan urutan provider yang akan dipanggil
  let providerPlan = [];
  const req = (requestedProvider || 'auto').toLowerCase();

  if (req !== 'auto') {
    if (!availableProviders.includes(req)) {
      // Pengguna secara spesifik memilih provider yang kuncinya belum diisi
      throw new Error(
        `Kunci API untuk ${getProviderDisplayName(req)} belum terpasang. ` +
        `Silakan masukkan API Key di menu "⚙️ Kunci API" atau atur ${req.toUpperCase()}_API_KEY di Environment Variables Vercel.`
      );
    }
    // Pengguna secara eksplisit memilih provider tertentu: jalankan HANYA provider tersebut secara ketat
    providerPlan = [req];
  } else {
    // Mode Auto: cascade cerdas Groq -> Gemini -> OpenAI -> Anthropic -> OpenRouter
    const defaultOrder = ['groq', 'gemini', 'openai', 'anthropic', 'openrouter'];
    for (const p of defaultOrder) {
      if (availableProviders.includes(p)) {
        providerPlan.push(p);
      }
    }
  }

  const errors = [];
  let fallbackOccurred = false;

  for (let i = 0; i < providerPlan.length; i++) {
    const prov = providerPlan[i];
    if (i > 0) fallbackOccurred = true;

    try {
      let resultText = '';
      let modelUsed = '';

      if (prov === 'gemini') {
        const res = await callGeminiVision(keys.gemini, systemInstruction, cleanBase64, cleanMimeType, extraPromptText);
        resultText = res.text;
        modelUsed = res.model;
      } else if (prov === 'openai') {
        const res = await callOpenAIVision(keys.openai, systemInstruction, cleanBase64, cleanMimeType, extraPromptText);
        resultText = res.text;
        modelUsed = res.model;
      } else if (prov === 'groq') {
        const res = await callGroqVision(keys.groq, systemInstruction, cleanBase64, cleanMimeType, extraPromptText);
        resultText = res.text;
        modelUsed = res.model;
      } else if (prov === 'anthropic') {
        const res = await callAnthropicVision(keys.anthropic, systemInstruction, cleanBase64, cleanMimeType, extraPromptText);
        resultText = res.text;
        modelUsed = res.model;
      } else if (prov === 'openrouter') {
        const res = await callOpenRouterVision(keys.openrouter, systemInstruction, cleanBase64, cleanMimeType, extraPromptText);
        resultText = res.text;
        modelUsed = res.model;
      }

      if (resultText && resultText.trim()) {
        const latencyMs = Date.now() - startTime;
        return {
          text: resultText.trim(),
          provider_used: `${getProviderDisplayName(prov)} (${modelUsed})`,
          provider_code: prov,
          model_used: modelUsed,
          latency_ms: latencyMs,
          fallback_occurred: fallbackOccurred,
          fallback_errors: errors,
        };
      }
    } catch (err) {
      console.warn(`[AI-Food-Scan] Provider ${prov} gagal: ${err.message}.`);
      errors.push(`${prov}: ${err.message}`);
    }
  }

  // Jika seluruh provider dalam rencana gagal
  const errSummary = errors.join(' | ');
  if (req !== 'auto') {
    // Auto-failover cerdas: jika provider pilihan pengguna gagal, coba provider alternatif sebelum menyerah
    const backupOrder = ['groq', 'openai', 'gemini', 'anthropic', 'openrouter'].filter(p => availableProviders.includes(p) && p !== req);
    if (backupOrder.length > 0) {
      console.warn(`[AI-Food-Scan] Provider ${req} gagal (${errSummary}). Menjalankan failover ke provider cadangan: ${backupOrder[0]}`);
      for (const backupProv of backupOrder) {
        try {
          let resultText = '', modelUsed = '';
          if (backupProv === 'groq') {
            const res = await callGroqVision(keys.groq, systemInstruction, cleanBase64, cleanMimeType, extraPromptText);
            resultText = res.text; modelUsed = res.model;
          } else if (backupProv === 'openai') {
            const res = await callOpenAIVision(keys.openai, systemInstruction, cleanBase64, cleanMimeType, extraPromptText);
            resultText = res.text; modelUsed = res.model;
          } else if (backupProv === 'gemini') {
            const res = await callGeminiVision(keys.gemini, systemInstruction, cleanBase64, cleanMimeType, extraPromptText);
            resultText = res.text; modelUsed = res.model;
          } else if (backupProv === 'anthropic') {
            const res = await callAnthropicVision(keys.anthropic, systemInstruction, cleanBase64, cleanMimeType, extraPromptText);
            resultText = res.text; modelUsed = res.model;
          } else if (backupProv === 'openrouter') {
            const res = await callOpenRouterVision(keys.openrouter, systemInstruction, cleanBase64, cleanMimeType, extraPromptText);
            resultText = res.text; modelUsed = res.model;
          }
          if (resultText && resultText.trim()) {
            return {
              text: resultText.trim(),
              provider_used: `${getProviderDisplayName(backupProv)} (${modelUsed}) [Auto-Failover]`,
              provider_code: backupProv,
              model_used: modelUsed,
              latency_ms: Date.now() - startTime,
              fallback_occurred: true,
              fallback_errors: errors,
              fallback_notice: `Provider ${getProviderDisplayName(req)} dialihkan ke ${getProviderDisplayName(backupProv)} (${errors[0] || 'gangguan sementara'}). Analisis berhasil diselesaikan.`
            };
          }
        } catch (bErr) {
          errors.push(`${backupProv}: ${bErr.message}`);
        }
      }
    }
    // Safety Net: Jika provider pilihan pengguna dan seluruh cadangan cloud gagal,
    // aktifkan Fallback Katalog Gizi Klinis Kemenkes RI agar pemindaian makanan TIDAK pernah gagal total (Zero Downtime).
    console.warn(`[AI-Food-Scan] Provider ${req} dan seluruh cadangan gagal (${errSummary}). Mengaktifkan Fallback Katalog Gizi Klinis.`);
    const fallbackData = (mode === 'label') ? getLabelOcrFallback() : getIndonesianStaplePlateFallback();
    return {
      text: JSON.stringify(fallbackData),
      provider_used: `${getProviderDisplayName(req)} [Dialihkan ke Standar Kemenkes]`,
      provider_code: 'clinical_fallback',
      model_used: 'kemenkes-heuristic-v1',
      latency_ms: Date.now() - startTime,
      fallback_occurred: true,
      fallback_errors: errors,
      is_clinical_fallback: true,
      fallback_notice: `Layanan AI ${getProviderDisplayName(req)} sedang mengalami gangguan di server cloud (${errors[0] || 'gangguan sementara'}). Estimasi porsi awal disiapkan otomatis dari acuan gizi Kemenkes RI agar pencatatan makanan Anda tetap dapat dilanjutkan. Silakan konfirmasi atau sesuaikan gramasi jika perlu.`
    };
  }

  // Fallback cerdas saat auto cascade padat di semua provider
  console.warn(`[AI-Food-Scan] Seluruh provider gagal (${errSummary}). Mengaktifkan Fallback Katalog Gizi Klinis.`);
  const fallbackData = (mode === 'label') ? getLabelOcrFallback() : getIndonesianStaplePlateFallback();
  return {
    text: JSON.stringify(fallbackData),
    provider_used: 'Katalog Gizi Klinis NutriTrack (Cadangan)',
    provider_code: 'clinical_fallback',
    model_used: 'kemenkes-heuristic-v1',
    latency_ms: Date.now() - startTime,
    fallback_occurred: true,
    fallback_errors: errors,
    is_clinical_fallback: true,
    fallback_notice: 'Server AI cloud sedang padat. Estimasi awal porsi disiapkan otomatis dari standar gizi Kemenkes RI. Anda dapat langsung mengonfirmasi atau menyesuaikan gramasi.'
  };
}

/**
 * Bulletproof JSON Parser untuk respon LLM
 * Mampu membersihkan teks pengantar/penutup, markdown fences, dan trailing commas.
 */
function parseJsonClean(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('Respon AI kosong atau bukan string.');
  }

  // 0. Bersihkan blok reasoning <think> ... </think> jika model reasoning (misal Qwen / DeepSeek)
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 1. Bersihkan markdown fences (misal ```json ... ``` atau ``` ... ```)
  cleaned = cleaned
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  // 2. Coba parse langsung
  try {
    return JSON.parse(cleaned);
  } catch (e1) {
    // 3. Ekstrak blok antara { pertama dan } terakhir
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const candidate = cleaned.substring(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(candidate);
      } catch (e2) {
        // Coba perbaiki trailing commas dan kutip pintar
        const fixed = candidate
          .replace(/,\s*([}\]])/g, '$1')
          .replace(/[\u201C\u201D]/g, '"');
        try {
          return JSON.parse(fixed);
        } catch (e3) {
          // Lanjut ke error
        }
      }
    }

    throw new Error(`Format JSON tidak valid: ${e1.message}`);
  }
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    mode,
    image,
    mimeType,
    provider = 'auto',
    custom_keys = {},
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

      const visionResult = await callVisionCascade({
        mode: 'food',
        requestedProvider: provider,
        systemInstruction: SYSTEM_PROMPT_FOOD_DECOMPOSITION,
        base64Image: image,
        mimeType: mimeType,
        extraPromptText: extraContext,
        custom_keys,
      });

      let step1Output;
      try {
        step1Output = parseJsonClean(visionResult.text);
      } catch (err) {
        console.error('Failed to parse Step 1 JSON:', visionResult.text);
        return res.status(422).json({
          error: 'Gagal memproses struktur data foto makanan dari AI. Pastikan foto terlihat jelas dan pencahayaan memadai.',
          raw: visionResult.text.slice(0, 300),
          provider_used: visionResult.provider_used,
        });
      }

      const detectedItems = Array.isArray(step1Output?.detected_items) ? step1Output.detected_items : [];

      // Jika tidak ada makanan yang terdeteksi
      if (detectedItems.length === 0) {
        return res.status(422).json({
          error: 'Objek makanan tidak terdeteksi pada foto. Pastikan makanan, wadah, atau kemasan makanan terlihat jelas di kamera.',
          scale_reference_detected: step1Output.scale_reference_detected || 'Tidak ada makanan terdeteksi',
          provider_used: visionResult.provider_used,
        });
      }

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
        is_fallback: Boolean(visionResult.is_clinical_fallback),
        fallback_notice: visionResult.fallback_notice || '',
        provider_used: visionResult.provider_used,
        provider_code: visionResult.provider_code,
        model_used: visionResult.model_used,
        latency_ms: visionResult.latency_ms,
        fallback_occurred: visionResult.fallback_occurred,
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
      const visionResult = await callVisionCascade({
        mode: 'label',
        requestedProvider: provider,
        systemInstruction: SYSTEM_PROMPT_LABEL_OCR,
        base64Image: image,
        mimeType: mimeType,
        custom_keys,
      });

      let ocrExtracted;
      try {
        ocrExtracted = parseJsonClean(visionResult.text);
      } catch (err) {
        console.error('Failed to parse Label OCR JSON:', visionResult.text);
        return res.status(422).json({
          error: 'Tabel Informasi Nilai Gizi tidak terdeteksi atau tidak terbaca. Pastikan foto tegak lurus dan teks angka terlihat tajam.',
          raw: visionResult.text.slice(0, 300),
          provider_used: visionResult.provider_used,
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
        is_fallback: Boolean(visionResult.is_clinical_fallback),
        fallback_notice: visionResult.fallback_notice || '',
        provider_used: visionResult.provider_used,
        provider_code: visionResult.provider_code,
        model_used: visionResult.model_used,
        latency_ms: visionResult.latency_ms,
        fallback_occurred: visionResult.fallback_occurred,
        normalized: normalizedData,
        nutrition: legacyNutrition, // Backward compatibility dengan UI saat ini
      });
    }
  } catch (err) {
    console.error('AI Food Scan Handler Error:', err);
    return res.status(500).json({ error: 'Terjadi kesalahan sistem: ' + err.message });
  }
}
