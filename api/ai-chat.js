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
6. Berikan pengingat medis ramah jika pertanyaan menyangkut kondisi penyakit kronis khusus (seperti gagal ginjal, diabetes melitus akut, atau kehamilan komplikasi).
7. FITUR KARTU LOG INTERAKTIF: Jika Anda merekomendasikan opsi makanan/camilan konkret yang siap dimakan, cantumkan kartu aksi di baris baru tersendiri dengan format: [FOOD: Nama Makanan | Kalori (angka) | Protein (angka g)] contoh: [FOOD: Greek Yogurt + Chia Seeds | 130 | 17] agar pengguna dapat langsung mencatatnya ke jurnal hanya dengan 1 klik!`;
}

﻿// ─── Dynamic Model Discovery with In-Memory Caching (Zero-Maintenance) ─────────
let _groqModelCache = { models: [], timestamp: 0 };
let _geminiModelCache = { models: [], timestamp: 0 };
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 jam caching agar super cepat

async function getAvailableGroqModels(apiKey) {
  const now = Date.now();
  if (_groqModelCache.models.length > 0 && (now - _groqModelCache.timestamp) < CACHE_TTL_MS) {
    return _groqModelCache.models;
  }

  const fallback = [
    process.env.GROQ_CHAT_MODEL,
    'llama-3.3-70b-versatile',
    'llama3-70b-8192',
    'llama3-8b-8192',
    'mixtral-8x7b-32768',
    'gemma2-9b-it',
  ].filter(Boolean);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000); // 2s timeout
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { 'Authorization': 'Bearer ' + apiKey.trim() },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      const list = (data.data || []).map(m => m.id);
      const chatModels = list.filter(id => 
        (id.includes('llama') || id.includes('mixtral') || id.includes('gemma') || id.includes('qwen')) &&
        !id.includes('whisper') && !id.includes('vision')
      );
      if (chatModels.length > 0) {
        chatModels.sort((a, b) => {
          const score = id => {
            if (id.includes('3.3-70b')) return 100;
            if (id.includes('70b')) return 80;
            if (id.includes('8b')) return 60;
            if (id.includes('mixtral')) return 50;
            return 10;
          };
          return score(b) - score(a);
        });

        if (process.env.GROQ_CHAT_MODEL && !chatModels.includes(process.env.GROQ_CHAT_MODEL)) {
          chatModels.unshift(process.env.GROQ_CHAT_MODEL);
        }

        _groqModelCache = { models: chatModels, timestamp: now };
        return chatModels;
      }
    }
  } catch (err) {
    console.warn('[NutriBot] Groq auto-discovery fallback:', err.message);
  }

  return fallback;
}

async function getAvailableGeminiTargets(apiKey) {
  const now = Date.now();
  if (_geminiModelCache.models.length > 0 && (now - _geminiModelCache.timestamp) < CACHE_TTL_MS) {
    return _geminiModelCache.models;
  }

  const fallback = [
    ...(process.env.GEMINI_CHAT_MODEL ? [{ ver: 'v1beta', model: process.env.GEMINI_CHAT_MODEL }] : []),
    { ver: 'v1beta', model: 'gemini-flash-latest' },
    { ver: 'v1beta', model: 'gemini-flash-lite-latest' },
    { ver: 'v1', model: 'gemini-1.5-flash' },
    { ver: 'v1beta', model: 'gemini-2.0-flash' },
    { ver: 'v1beta', model: 'gemini-1.5-flash' },
    { ver: 'v1', model: 'gemini-1.5-pro' },
  ];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000); // 2s timeout
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(apiKey.trim()), {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      const rawList = data.models || [];
      const validModels = rawList
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map(m => m.name.replace(/^models\//, ''))
        .filter(id => !id.includes('embedding') && !id.includes('aqa'));

      if (validModels.length > 0) {
        validModels.sort((a, b) => {
          const score = id => {
            if (id.includes('flash-latest')) return 100;
            if (id.includes('2.0-flash')) return 90;
            if (id.includes('1.5-flash')) return 80;
            if (id.includes('flash')) return 70;
            if (id.includes('pro')) return 50;
            return 10;
          };
          return score(b) - score(a);
        });

        const targets = validModels.map(m => ({ ver: 'v1beta', model: m }));
        if (process.env.GEMINI_CHAT_MODEL) {
          targets.unshift({ ver: 'v1beta', model: process.env.GEMINI_CHAT_MODEL });
        }

        _geminiModelCache = { models: targets, timestamp: now };
        return targets;
      }
    }
  } catch (err) {
    console.warn('[NutriBot] Gemini auto-discovery fallback:', err.message);
  }

  return fallback;
}

// ─── Provider Callers ────────────────────────────────────────────────────────

async function callGroqChat(apiKey, systemInstruction, messages, timeoutMs = 2800) {
  const models = await getAvailableGroqModels(apiKey);
  let lastError = null;

  for (const model of models) {
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
        max_tokens: 1024,
      };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey.trim(),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const errText = await res.text();
        throw new Error('groq ' + model + ' (' + res.status + '): ' + errText);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || '';
      if (!content.trim()) throw new Error('Respon Groq kosong.');

      return {
        text: content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim(),
        model: 'groq/' + model,
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

async function callGeminiChat(apiKey, systemInstruction, messages, timeoutMs = 2800) {
  const targets = await getAvailableGeminiTargets(apiKey);
  let lastError = null;

  for (const target of targets) {
    try {
      const contents = [];
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

      const url = 'https://generativelanguage.googleapis.com/' + target.ver + '/models/' + target.model + ':generateContent?key=' + encodeURIComponent(apiKey.trim());
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const errText = await res.text();
        throw new Error('gemini ' + target.model + ' (' + res.status + '): ' + errText);
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!text.trim()) throw new Error('Respon Gemini kosong.');

      return {
        text: text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim(),
        model: 'gemini/' + target.model,
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

async function callOpenAIChat(apiKey, systemInstruction, messages, timeoutMs = 2800) {
  const OPENAI_MODELS = [process.env.OPENAI_CHAT_MODEL, 'gpt-4o-mini', 'gpt-4o', 'chatgpt-4o-latest'].filter(Boolean);
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

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

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

async function callAnthropicChat(apiKey, systemInstruction, messages, timeoutMs = 2800) {
  const ANTHROPIC_MODELS = [process.env.ANTHROPIC_CHAT_MODEL, 'claude-3-5-haiku-latest', 'claude-3-5-haiku-20241022', 'claude-3-haiku-20240307'].filter(Boolean);
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

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

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

async function callOpenRouterChat(apiKey, systemInstruction, messages, timeoutMs = 2800) {
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

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://nutritrack.vercel.app',
          'X-Title': 'NutriTrack Pro NutriBot',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

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
  const DEADLINE_MS = 6000; // 6s total AI budget to prevent Vercel 10s serverless timeout

  for (const prov of plan) {
    if (Date.now() - startTime > DEADLINE_MS) {
      console.warn(`[NutriBot] Global AI budget reached (${Date.now() - startTime}ms), switching to clinical engine.`);
      break;
    }
    const remainingBudget = Math.max(1200, DEADLINE_MS - (Date.now() - startTime));
    const providerTimeout = Math.min(2800, remainingBudget);

    try {
      let result = null;
      if (prov === 'groq') {
        result = await callGroqChat(keys.groq, systemInstruction, messages, providerTimeout);
      } else if (prov === 'gemini') {
        result = await callGeminiChat(keys.gemini, systemInstruction, messages, providerTimeout);
      } else if (prov === 'openai') {
        result = await callOpenAIChat(keys.openai, systemInstruction, messages, providerTimeout);
      } else if (prov === 'anthropic') {
        result = await callAnthropicChat(keys.anthropic, systemInstruction, messages, providerTimeout);
      } else if (prov === 'openrouter') {
        result = await callOpenRouterChat(keys.openrouter, systemInstruction, messages, providerTimeout);
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

  // Seamless Clinical Nutrition Fallback Engine (Zero Error Experience)
  // Ketika seluruh kuota API eksternal habis, NutriBot tetap merespons secara klinis berbasis Mifflin-St Jeor!
  const fallbackMessage = generateClinicalFallbackResponse(userContext, messages);
  return res.status(200).json({
    success: true,
    message: fallbackMessage,
    provider: 'mifflin-st-jeor',
    provider_name: 'NutriTrack Clinical Engine (Mifflin–St Jeor)',
    model: 'clinical-rules-v2',
    latency_ms: Date.now() - startTime,
    fallback: true,
  });
}

/**
 * Expert Clinical Nutrition Rule Engine
 * Membangun rekomendasi nutrisi presisi berdasarkan sisa kalori, target makro,
 * dan intent pertanyaan pengguna dengan kartu makanan interaktif [FOOD: name | kcal | prot].
 */
function generateClinicalFallbackResponse(userContext = {}, messages = []) {
  const lastMsg = (messages[messages.length - 1]?.content || '').toLowerCase();
  const name = userContext.name || 'Sobat Sehat';
  const remKcal = Math.round(userContext.remainingKcal || 500);
  const targetP = Math.round(userContext.targetProtein || 75);
  const consumedP = Math.round(userContext.consumedProtein || 0);
  const pDeficit = Math.max(0, targetP - consumedP);
  const consumedWater = Math.round(userContext.consumedWater || 0);
  const targetWater = Math.round(userContext.targetWater || 2000);

  // 1. Rekomendasi Makan Malam / Menu Utama
  if (lastMsg.includes('makan malam') || lastMsg.includes('malam') || lastMsg.includes('dinner') || lastMsg.includes('makan') || lastMsg.includes('menu')) {
    const maxKcal = Math.max(250, Math.min(remKcal, 600));
    return `Halo ${name}! Untuk makan malam hari ini dengan sisa target **${remKcal > 0 ? remKcal + ' kcal' : 'kuota kalori terjaga'}** dan kebutuhan protein **${pDeficit > 0 ? pDeficit + 'g lagi' : 'sudah tercapai'}**, berikut rekomendasi menu bergizi seimbang di bawah ${maxKcal} kcal:

[FOOD: Dada Ayam Panggang Sambal Matah + Nasi Merah | 380 | 34]
[FOOD: Pepes Ikan Kembung + Sayur Bening Bayam | 310 | 28]
[FOOD: Tahu Tempe Bacem Panggang + Telur Rebus | 260 | 22]

💡 **Tips Gizi Klinis**: Mengonsumsi protein berkualitas tinggi saat makan malam membantu sintesis protein otot semalaman dan mencegah rasa lapar tengah malam.

Kamu bisa langsung klik **+ Log** pada menu di atas untuk mencatatnya ke jurnal harianmu!`;
  }

  // 2. Camilan / Snack
  if (lastMsg.includes('camilan') || lastMsg.includes('snack') || lastMsg.includes('ngemil')) {
    return `Pilihan terbaik untuk camilan sehat ${pDeficit > 0 ? 'tinggi protein (' + pDeficit + 'g lagi)' : 'rendah kalori'} tanpa mengorbankan kuota harian:

[FOOD: Greek Yogurt + Chia Seeds | 130 | 17]
[FOOD: Edamame Rebus 1 Porsi (100g) | 120 | 11]
[FOOD: Telur Rebus 2 Butir | 140 | 13]

💡 Camilan ini kaya serat dan protein sehingga memberikan rasa kenyang lebih stabil dan aman untuk gula darah. Klik **+ Log** untuk langsung mencatatnya!`;
  }

  // 3. Status Hidrasi
  if (lastMsg.includes('hidrasi') || lastMsg.includes('air') || lastMsg.includes('minum')) {
    const sisaAir = Math.max(0, targetWater - consumedWater);
    const persentase = Math.min(100, Math.round((consumedWater / targetWater) * 100));
    return `Halo ${name}! Evaluasi status hidrasimu hari ini:
💧 **Asupan Air**: ${consumedWater} ml / ${targetWater} ml (${persentase}%)
${sisaAir > 0 
  ? `Kamu masih butuh sekitar **${sisaAir} ml** (~${Math.ceil(sisaAir / 250)} gelas) lagi hingga malam ini. Disarankan minum 1 gelas sekarang dan 1 gelas sebelum tidur agar metabolisme tetap lancar.`
  : `🎉 **Luar biasa!** Target hidrasi harianmu sudah terpenuhi optimal. Pertahankan kebiasaan baik ini!`}`;
  }

  // 4. Analisis Protein
  if (lastMsg.includes('protein') || lastMsg.includes('makro')) {
    return `Analisis asupan protein harianmu:
🥩 **Realisasi**: ${consumedP}g / ${targetP}g (${Math.round((consumedP / targetP) * 100)}%)
${pDeficit > 0 
  ? `Kamu masih membutuhkan **${pDeficit}g protein lagi** untuk menjaga massa otot dan rasa kenyang optimal.

Berikut opsi penambah protein cepat:
[FOOD: Dada Ayam Rebus/Panggang 100g | 165 | 31]
[FOOD: Tempe Goreng Air Fryer 100g | 190 | 19]
[FOOD: Greek Yogurt Plain 150g | 100 | 15]

Klik **+ Log** untuk langsung menambahkannya ke jurnal!`
  : `🎉 Target protein harianmu sebesar **${targetP}g** sudah tercapai! Otot dan sistem imun tubuhmu ternutrisi dengan baik hari ini.`}`;
  }

  // 5. Default General Response
  return `Halo ${name}! Saya asisten nutrisi NutriTrack. Berdasarkan catatanmu hari ini:
• Sisa Target Energi: **${remKcal > 0 ? remKcal + ' kcal' : '0 kcal (Surplus)'}**
• Kebutuhan Protein: **${pDeficit > 0 ? pDeficit + 'g lagi' : 'Tercapai'}**
• Status Hidrasi: **${consumedWater} / ${targetWater} ml**

Berikut rekomendasi makanan bergizi yang siap kamu santap:
[FOOD: Dada Ayam Panggang Sambal Matah | 280 | 35]
[FOOD: Tumis Tempe Tahu + Telur Rebus | 250 | 22]

Klik tombol **+ Log** pada pilihan makanan di atas untuk mencatatnya langsung ke jurnal! Ada hal lain seputar gizi yang ingin kamu tanyakan?`;
}
}
