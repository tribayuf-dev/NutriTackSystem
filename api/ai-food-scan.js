/**
 * NutriTrack – AI Food Vision API (Vercel Serverless)
 * Endpoint: POST /api/ai-food-scan
 *
 * Menerima gambar makanan dalam format base64, lalu mengirimnya ke
 * Google Gemini 1.5 Flash (multimodal) untuk dua modus analisis:
 *
 *  mode "food"  → Identifikasi jenis makanan + estimasi berat (gram)
 *  mode "label" → Baca tabel Informasi Nilai Gizi dari kemasan
 *
 * Request body (JSON):
 *   { mode: "food"|"label", image: "<base64 tanpa prefix>", mimeType: "image/jpeg"|"image/png" }
 *
 * Response (JSON):
 *   mode "food"  → { results: [{name, gram, confidence, aliases}] }
 *   mode "label" → { nutrition: {calories, protein, carbs, fat, fiber, sugar, sodium, servingName, servingGram} }
 *   Error        → { error: "pesan kesalahan" }
 */

export const config = {
  api: { bodyParser: { sizeLimit: '8mb' } },
};

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

// ─── Prompt Templates ───────────────────────────────────────────────────────

const FOOD_PROMPT = `Kamu adalah asisten analisis foto makanan Indonesia yang sangat ahli.

Lihat foto ini dengan teliti. Identifikasi SETIAP jenis makanan/minuman yang terlihat di foto.

Untuk setiap item makanan, berikan:
1. nama_makanan: Nama umum dalam Bahasa Indonesia (singkat, contoh: "Nasi Putih", "Ayam Goreng Dada", "Telur Mata Sapi")
2. estimasi_gram: Perkiraan berat dalam gram berdasarkan visual (ukuran piring, porsi, dll)
3. keyakinan: "tinggi" / "sedang" / "rendah"
4. alias: Array nama alternatif yang sering dipakai (untuk pencarian di database)

PENTING:
- Jika ini adalah foto kemasan produk (bukan makanan siap makan), return array kosong results: []
- Pisahkan lauk/nasi/sayur sebagai item terpisah
- Estimasi berat harus realistis untuk porsi normal Indonesia
- Jika tidak bisa mendeteksi makanan sama sekali, return results: []

Balas HANYA dengan JSON valid ini (tanpa markdown, tanpa komentar):
{
  "results": [
    {
      "name": "Nasi Putih",
      "gram": 200,
      "confidence": "tinggi",
      "aliases": ["nasi", "nasi putih", "white rice"]
    }
  ]
}`;

const LABEL_PROMPT = `Kamu adalah asisten pembaca label gizi makanan kemasan Indonesia yang sangat ahli.

Lihat foto tabel Informasi Nilai Gizi (atau Nutrition Facts) pada kemasan produk ini dengan sangat teliti.

Ekstrak nilai-nilai berikut:
- calories: Energi total per takaran saji dalam kkal (bukan kJ)
- protein: Protein dalam gram
- carbs: Karbohidrat total dalam gram
- fat: Lemak total dalam gram
- fiber: Serat pangan dalam gram (null jika tidak ada)
- sugar: Gula dalam gram (null jika tidak ada)
- sodium: Natrium dalam miligram (mg) — jika tertulis dalam gram, kalikan 1000
- servingName: Nama takaran saji (contoh: "sajian", "keping", "bungkus", "cup")
- servingGram: Berat 1 takaran saji dalam gram (angka saja, null jika tidak ada)
- productName: Nama produk jika terlihat (null jika tidak terlihat)

PENTING:
- Jika gambar bukan tabel nilai gizi / tidak bisa dibaca, return { "error": "Tabel nilai gizi tidak terdeteksi" }
- Jika nilai per 100g tersedia (bukan per sajian), tulis di servingGram: 100
- Konversi energi kJ ke kkal: bagi 4.184 (ambil yang kkal jika keduanya ada)
- Natrium: jika tertulis "Garam/Salt" bukan "Natrium/Sodium", konversi: nilai_mg × 0.393 (garam ke natrium)
- Hanya return angka murni (tanpa satuan) untuk setiap nilai numerik

Balas HANYA dengan JSON valid ini (tanpa markdown, tanpa komentar):
{
  "calories": 180,
  "protein": 4.5,
  "carbs": 28,
  "fat": 6,
  "fiber": 1.2,
  "sugar": 3.5,
  "sodium": 320,
  "servingName": "sajian",
  "servingGram": 40,
  "productName": "Nama Produk"
}`;

// ─── Helper: Call Gemini API ─────────────────────────────────────────────────

async function callGemini(apiKey, prompt, base64Image, mimeType) {
  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType || 'image/jpeg', data: base64Image } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      topP: 0.9,
      maxOutputTokens: 1024,
    },
  };

  const resp = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return text.trim();
}

// ─── Helper: Parse JSON response safely ──────────────────────────────────────

function parseJson(text) {
  // Strip markdown code blocks if present
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  return JSON.parse(cleaned);
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server belum dikonfigurasi (GEMINI_API_KEY tidak ada).' });
  }

  const { mode, image, mimeType } = req.body || {};

  if (!image) return res.status(400).json({ error: 'Gambar tidak ditemukan di request.' });
  if (!['food', 'label'].includes(mode)) {
    return res.status(400).json({ error: 'mode harus "food" atau "label".' });
  }

  try {
    const prompt = mode === 'food' ? FOOD_PROMPT : LABEL_PROMPT;
    const rawText = await callGemini(apiKey, prompt, image, mimeType || 'image/jpeg');

    let parsed;
    try {
      parsed = parseJson(rawText);
    } catch {
      console.error('Gemini raw output:', rawText);
      return res.status(422).json({
        error: 'Gagal memproses respons AI. Coba foto ulang dengan pencahayaan lebih terang.',
        raw: rawText.slice(0, 300),
      });
    }

    // Validate & return
    if (mode === 'food') {
      const results = Array.isArray(parsed?.results) ? parsed.results : [];
      return res.status(200).json({ results });
    } else {
      if (parsed?.error) return res.status(200).json({ error: parsed.error });
      return res.status(200).json({ nutrition: parsed });
    }
  } catch (err) {
    console.error('AI Food Scan error:', err);
    return res.status(500).json({ error: 'Terjadi kesalahan: ' + err.message });
  }
}
