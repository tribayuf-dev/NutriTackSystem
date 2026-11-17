/**
 * NutriTrack – AI Conversational Assistant ("NutriBot")
 * Endpoint: POST /api/ai-chat
 *
 * Mengimplementasikan Asisten Gizi & Diet Interaktif bertenaga AI dengan
 * Automatic Context Injection (sisa kalori, target makro, log makanan hari ini,
 * ritme sirkadian, estimasi beban glikemik, dan profil tubuh pengguna).
 *
 * Didukung Multi-Provider Cascade:
 * - Groq (llama-3.3-70b-versatile, llama-3.1-8b-instant) [Sub-second ultra fast]
 * - Google Gemini (gemini-2.0-flash, gemini-1.5-flash)
 * - OpenAI (gpt-4o-mini, gpt-4o)
 * - Anthropic (claude-3-5-haiku-20241022)
 * - OpenRouter (multi-model)
 */

export const config = {
  api: { bodyParser: { sizeLimit: '2mb' } },
};

function buildSystemPrompt(userContext = {}) {
  const {
    name = 'Pengguna',
    goal = 'Menjaga Berat Badan',
    targetKcal = 2000,
    targetProtein = 75,
    targetCarbs = 250,
    targetFat = 65,
    targetFiber = 25,
    targetWater = 2000,
    consumedKcal = 0,
    consumedProtein = 0,
    consumedCarbs = 0,
    consumedFat = 0,
    consumedFiber = 0,
    consumedWater = 0,
    burnedKcal = 0,
    netKcal = 0,
    remainingKcal = 2000,
    mealsToday = [],
    eatingWindow = null,
    glycemicLoad = null,
    profile = {},
  } = userContext;

  const mealsListText = mealsToday && mealsToday.length > 0
    ? mealsToday.map(m => `- [${m.meal || 'Makanan'}] ${m.name} (${m.portion || '1 porsi'}): ${m.kcal || 0} kkal, P:${m.p || 0}g, K:${m.c || 0}g, L:${m.f || 0}g`).join('\n')
    : '- Belum ada makanan yang dicatat hari ini.';

  const windowText = eatingWindow && eatingWindow.firstTime
    ? `Makan pertama pukul ${eatingWindow.firstTime}, makan terakhir pukul ${eatingWindow.lastTime} (Jendela makan: ${eatingWindow.windowHours || '–'}).`
    : 'Belum ada data jendela makan hari ini.';

  const glText = glycemicLoad
    ? `Beban Glikemik hari ini: GL ${glycemicLoad.score || 0} (${glycemicLoad.status || 'Moderat'}).`
    : 'Beban Glikemik: Belum ada data.';

  return `Anda adalah NutriBot, Asisten Ahli Gizi Klinis & Diet Companion berlisensi untuk aplikasi NutriTrack.
Anda berbicara dalam Bahasa Indonesia yang ramah, hangat, empatik, suportif, dan berbasis bukti sains gizi terkini (evidence-based nutrition).

DATA & STATUS NUTRISI PENGGUNA HARI INI:
- Nama: ${name}
- Profil Tubuh: Usia ${profile.age || 25} thn, Jenis Kelamin ${profile.sex === 'm' ? 'Laki-laki' : 'Perempuan'}, BB ${profile.weight || 65} kg, TB ${profile.height || 170} cm. Target BB: ${profile.targetWeight ? profile.targetWeight + ' kg' : 'Sama dengan saat ini'}.
- Pola/Preferensi Diet: ${profile.diet || 'Umum/Omnivora'}.
- Sasaran / Goal: ${goal}.
- Target Harian: ${targetKcal} kkal | Protein ${targetProtein}g | Karbo ${targetCarbs}g | Lemak ${targetFat}g | Serat ${targetFiber}g | Air ${targetWater} ml.
- Realisasi Konsumsi:
  * Makanan: ${consumedKcal} kkal (Protein ${consumedProtein}g, Karbo ${consumedCarbs}g, Lemak ${consumedFat}g, Serat ${consumedFiber}g).
  * Olahraga/Aktivitas Terbakar: -${burnedKcal} kkal.
  * Kalori Bersih (Net Calorie): ${netKcal} kkal.
  * Sisa Kalori Target: ${remainingKcal >= 0 ? remainingKcal + ' kkal tersisa' : 'Surplus +' + Math.abs(remainingKcal) + ' kkal'}.
  * Hidrasi Air Minum: ${consumedWater} ml / ${targetWater} ml.
- Riwayat Makanan Hari Ini:
${mealsListText}
- Ritme Jam Makan: ${windowText}
- ${glText}

PANDUAN MENJAWAB:
1. Berikan rekomendasi yang spesifik, langsung dapat dieksekusi, dan kaitkan secara cerdas dengan sisa kuota kalori atau kekurangan makronutrien pengguna hari ini.
2. Utamakan bahan makanan khas Indonesia yang terjangkau, bergizi, dan mudah didapat (contoh: dada ayam, telur rebus, tahu/tempe, ikan kembung/tongkol, tumis bayam, sayur bening, pepes, nasi merah, pisang, dll.).
3. Saat memberi saran menu atau camilan, selalu cantumkan perkiraan kalori dan protein secara singkat dan jelas (misal: "1 porsi dada ayam panggang 100g (~165 kkal, 31g protein)").
4. Format jawaban dengan rapi menggunakan Markdown (poin-poin tebal, emoji yang relevan, dan paragraf ringkas agar mudah dibaca di layar ponsel).
5. Bersikap realistis, hindari menyarankan diet ekstrem atau pantangan berlebihan tanpa indikasi medis.
6. Berikan pengingat medis ramah jika pertanyaan menyangkut kondisi penyakit kronis khusus (seperti gagal ginjal, diabetes melitus akut, atau kehamilan komplikasi).`;
}

// ─── Provider Callers ────────────────────────────────────────────────────────

async function callGroqChat(apiKey, systemInstruction, messages) {
  const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
  let lastError = null;

  for (const model of GROQ_MODELS) {
    try {
      const payload = {
        model,
        messages: [
          { role: 'system', content: systemInstruction },
          ...messages.map(m => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: String(m.content || ''),
          })),
        ],
        temperature: 0.6,
        max_completion_tokens: 1024,
      };

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`groq ${model} (${res.status}): ${errText}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || '';
      if (!content.trim()) throw new Error('Respon Groq kosong.');

      return {
        text: content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim(),
        model: `groq/${model}`,
      };
    } catch (err) {
      lastError = err;
      if (String(err.message).includes('401') || String(err.message).includes('invalid_api_key')) {
        throw err;
      }
    }
  }

  throw lastError || new Error('Seluruh model Groq gagal.');
}

async function callGeminiChat(apiKey, systemInstruction, messages) {
  const GEMINI_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash'];
  let lastError = null;

  for (const model of GEMINI_MODELS) {
    try {
      const contents = [];
      // Gemini allows system_instruction or prepending system prompt
      for (const m of messages) {
        contents.push({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: String(m.content || '') }],
        });
      }

      const body = {
        system_instruction: {
          parts: [{ text: systemInstruction }],
        },
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024,
        },
      };

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`gemini ${model} (${res.status}): ${errText}`);
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!text.trim()) throw new Error('Respon Gemini kosong.');

      return {
        text: text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim(),
        model: `gemini/${model}`,
      };
    } catch (err) {
      lastError = err;
      if (String(err.message).includes('API_KEY_INVALID') || String(err.message).includes('403')) {
        throw err;
      }
    }
  }

  throw lastError || new Error('Seluruh model Gemini gagal.');
}

async function callOpenAIChat(apiKey, systemInstruction, messages) {
  const OPENAI_MODELS = ['gpt-4o-mini', 'gpt-4o'];
  let lastError = null;

  for (const model of OPENAI_MODELS) {
    try {
      const payload = {
        model,
        messages: [
          { role: 'system', content: systemInstruction },
          ...messages.map(m => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: String(m.content || ''),
          })),
        ],
        temperature: 0.7,
        max_tokens: 1024,
      };

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`openai ${model} (${res.status}): ${errText}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || '';
      if (!content.trim()) throw new Error('Respon OpenAI kosong.');

      return {
        text: content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim(),
        model: `openai/${model}`,
      };
    } catch (err) {
      lastError = err;
      if (String(err.message).includes('401') || String(err.message).includes('invalid_api_key')) {
        throw err;
      }
    }
  }

  throw lastError || new Error('Seluruh model OpenAI gagal.');
}

async function callAnthropicChat(apiKey, systemInstruction, messages) {
  const ANTHROPIC_MODELS = ['claude-3-5-haiku-20241022'];
  let lastError = null;

  for (const model of ANTHROPIC_MODELS) {
    try {
      const payload = {
        model,
        max_tokens: 1024,
        system: systemInstruction,
        messages: messages.map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: String(m.content || ''),
        })),
      };

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`claude ${model} (${res.status}): ${errText}`);
      }

      const data = await res.json();
      const text = data.content?.[0]?.text || '';
      if (!text.trim()) throw new Error('Respon Claude kosong.');

      return {
        text: text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim(),
        model: `anthropic/${model}`,
      };
    } catch (err) {
      lastError = err;
      if (String(err.message).includes('401') || String(err.message).includes('authentication_error')) {
        throw err;
      }
    }
  }

  throw lastError || new Error('Seluruh model Anthropic gagal.');
}

async function callOpenRouterChat(apiKey, systemInstruction, messages) {
  const OPENROUTER_MODELS = [
    'meta-llama/llama-3.3-70b-instruct:free',
    'google/gemini-2.0-flash-exp:free',
    'meta-llama/llama-3.1-8b-instruct:free',
  ];
  let lastError = null;

  for (const model of OPENROUTER_MODELS) {
    try {
      const payload = {
        model,
        messages: [
          { role: 'system', content: systemInstruction },
          ...messages.map(m => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: String(m.content || ''),
          })),
        ],
        max_tokens: 1024,
      };

      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://nutritrack.vercel.app',
          'X-Title': 'NutriTrack Pro NutriBot',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`openrouter ${model} (${res.status}): ${errText}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || '';
      if (!content.trim()) throw new Error('Respon OpenRouter kosong.');

      return {
        text: content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim(),
        model: `openrouter/${model}`,
      };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Seluruh model OpenRouter gagal.');
}

function getProviderDisplayName(code) {
  switch (code) {
    case 'groq': return 'Groq (Llama 3.3)';
    case 'gemini': return 'Google Gemini';
    case 'openai': return 'OpenAI';
    case 'anthropic': return 'Anthropic Claude';
    case 'openrouter': return 'OpenRouter';
    default: return code;
  }
}

// ─── Main Handler ────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    messages = [],
    userContext = {},
    provider = 'auto',
    custom_keys = {},
  } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Daftar pesan (messages) wajib diisi.' });
  }

  const startTime = Date.now();

  const keys = {
    groq: String(custom_keys?.groq || process.env.GROQ_API_KEY || '').trim(),
    gemini: String(custom_keys?.gemini || process.env.GEMINI_API_KEY || '').trim(),
    openai: String(custom_keys?.openai || process.env.OPENAI_API_KEY || '').trim(),
    anthropic: String(custom_keys?.anthropic || process.env.ANTHROPIC_API_KEY || '').trim(),
    openrouter: String(custom_keys?.openrouter || process.env.OPENROUTER_API_KEY || '').trim(),
  };

  const availableProviders = Object.keys(keys).filter(k => !!keys[k]);
  if (availableProviders.length === 0) {
    return res.status(400).json({
      error: 'Tidak ada API Key AI yang aktif. Harap masukkan API Key melalui pengaturan atau periksa konfigurasi server.',
    });
  }

  // Tentukan urutan provider
  const plan = [];
  const reqLower = String(provider || 'auto').toLowerCase();

  if (reqLower !== 'auto' && keys[reqLower]) {
    plan.push(reqLower);
  }

  // Groq (cepat), Gemini (stabil), OpenAI (presisi), Claude, OpenRouter
  const defaultOrder = ['groq', 'gemini', 'openai', 'anthropic', 'openrouter'];
  for (const p of defaultOrder) {
    if (!plan.includes(p) && keys[p]) {
      plan.push(p);
    }
  }

  const systemInstruction = buildSystemPrompt(userContext);
  const errors = [];

  for (const prov of plan) {
    try {
      let result = null;
      if (prov === 'groq') {
        result = await callGroqChat(keys.groq, systemInstruction, messages);
      } else if (prov === 'gemini') {
        result = await callGeminiChat(keys.gemini, systemInstruction, messages);
      } else if (prov === 'openai') {
        result = await callOpenAIChat(keys.openai, systemInstruction, messages);
      } else if (prov === 'anthropic') {
        result = await callAnthropicChat(keys.anthropic, systemInstruction, messages);
      } else if (prov === 'openrouter') {
        result = await callOpenRouterChat(keys.openrouter, systemInstruction, messages);
      }

      if (result && result.text) {
        const latencyMs = Date.now() - startTime;
        return res.status(200).json({
          success: true,
          message: result.text,
          provider: prov,
          provider_name: getProviderDisplayName(prov),
          model: result.model,
          latency_ms: latencyMs,
        });
      }
    } catch (err) {
      console.warn(`[NutriBot] Provider ${prov} gagal: ${err.message}`);
      errors.push(`${prov}: ${err.message}`);
    }
  }

  return res.status(502).json({
    error: `Asisten AI sedang padat (${errors.join(' | ')}). Silakan coba lagi sebentar lagi.`,
  });
}
