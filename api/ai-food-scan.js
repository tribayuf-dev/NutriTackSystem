/**
 * NutriTrack – AI Food Vision API (Vercel Serverless)
 * Endpoint: POST /api/ai-food-scan
 *
 * Menerima gambar makanan dalam format base64, lalu mengirimnya ke
 * Google Gemini Multimodal API untuk dua modus analisis:
 *
 *  mode "food"  → Identifikasi jenis makanan + estimasi berat (gram)
 *  mode "label" → Baca tabel Informasi Nilai Gizi dari kemasan
 */

export const config = {
  api: { bodyParser: { sizeLimit: '8mb' } },
};

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

// ─── Helper: Call Gemini API with dynamic model discovery & fallback ─────────

async function callGemini(apiKey, prompt, base64Image, mimeType) {
  const candidateModels = [
    'gemini-2.0-flash',
    'gemini-2.5-flash',
    'gemini-1.5-flash-latest',
    'gemini-2.0-flash-exp',
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b',
    'gemini-1.5-pro'
  ];

  let targetModels = candidateModels;

  // Coba query ListModels dari Google untuk mengetahui model mana yang aktif di akun ini
  try {
    const listResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (listResp.ok) {
      const listData = await listResp.json();
      const validNames = (listData.models || [])
        .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
        .map(m => m.name.replace(/^models\//, ''));

      const available = candidateModels.filter(c => validNames.includes(c));
      if (available.length > 0) {
        targetModels = available;
      } else if (validNames.length > 0) {
        const flashModel = validNames.find(v => v.includes('flash'));
        targetModels = [flashModel || validNames[0]];
      }
    }
  } catch (e) {
    console.warn('ListModels warning:', e);
  }

  const payload = {
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

  let lastError = null;
  for (const model of targetModels) {
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
      // Jika error 404 (model tidak ada), lanjutkan ke candidate model berikutnya
      if (resp.status === 404) continue;
      // Jika error autentikasi / kuota, lempar error
      throw lastError;
    } catch (err) {
      lastError = err;
      if (!err.message || !err.message.includes('404')) throw err;
    }
  }

  throw lastError || new Error('Tidak ada model Gemini yang dapat digunakan.');
}

// ─── Helper: Parse JSON response safely ──────────────────────────────────────

function parseJson(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
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
