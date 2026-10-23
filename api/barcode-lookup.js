/**
 * NutriTrack - Barcode Lookup API (Vercel Serverless)
 * Endpoint: GET or POST /api/barcode-lookup
 * 
 * Mengimplementasikan Waterfall 3 Lapis (Lapis 1 & Lapis 2) sesuai PRD.md:
 * - Lapis 1: Local / Static Catalog check
 * - Lapis 2: Open Food Facts API v2 Fallback (dengan User-Agent wajib & normalisasi BPOM)
 */

import { normalizeAndValidateNutritionData } from './lib/NutritionNormalizerService.js';
import { STAPLE_FOODS_SEED } from './lib/seedData.js';

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const code = (req.query?.code || req.body?.code || req.body?.barcode || '').toString().trim();
  if (!code) {
    return res.status(400).json({ success: false, error: 'Parameter barcode / code diperlukan.' });
  }

  // ─── LAPIS 1: Cek di Local Seed / Static Database ──────────────────────────
  const localStaple = STAPLE_FOODS_SEED.find(item => item.food.barcode_ean === code);
  if (localStaple) {
    const normalized = normalizeAndValidateNutritionData({
      product_metadata: {
        product_name: localStaple.food.name,
        brand: localStaple.food.brand,
        barcode_ean: localStaple.food.barcode_ean,
        food_type: localStaple.food.food_type,
        category: localStaple.food.category,
        base_unit: localStaple.food.base_unit,
        data_source: localStaple.food.data_source,
      },
      serving_info: {
        basis_type: 'per_100g',
        serving_size_metric: 100,
      },
      nutrients_as_labeled: localStaple.nutrients_100,
    });

    return res.status(200).json({
      success: true,
      found: true,
      source: 'LOCAL_DB',
      data: normalized,
    });
  }

  // ─── LAPIS 2: Panggil Open Food Facts API v2 ────────────────────────────────
  const codesToTry = [
    code,
    code.padStart(13, '0'),
    code.replace(/^0+/, ''),
    code.padStart(14, '0'),
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  let foundProduct = null;

  for (const c of codesToTry) {
    try {
      const offUrl = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(c)}.json`;
      const offResp = await fetch(offUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'NutritionTrackerApp/1.0 (contact@nutritrack.app)',
        },
      });

      if (offResp.ok) {
        const offData = await offResp.json();
        if (offData.status === 1 && offData.product) {
          foundProduct = offData.product;
          break;
        }
      }
    } catch (e) {
      console.warn(`OFF fetch error for code ${c}:`, e.message);
    }
  }

  // Cek apakah produk ditemukan dan memiliki data nutrisi
  if (foundProduct) {
    const nutriments = foundProduct.nutriments || {};
    const hasNutrients = (
      nutriments['energy-kcal_100g'] != null ||
      nutriments['proteins_100g'] != null ||
      nutriments['carbohydrates_100g'] != null ||
      nutriments['fat_100g'] != null ||
      nutriments['energy_100g'] != null
    );

    if (hasNutrients) {
      try {
        const normalized = normalizeAndValidateNutritionData(foundProduct);
        return res.status(200).json({
          success: true,
          found: true,
          source: 'OPEN_FOOD_FACTS',
          product_image: foundProduct.image_front_small_url || foundProduct.image_front_url || null,
          data: normalized,
        });
      } catch (err) {
        console.error('Normalization error for OFF product:', err);
      }
    }

    // Jika produk ada di OFF tetapi nutriments kosong
    return res.status(200).json({
      success: true,
      found: false,
      barcode: code,
      product_name: foundProduct.product_name || foundProduct.product_name_id || null,
      message: 'Produk terdaftar di Open Food Facts tetapi informasi nutrisinya belum lengkap. Silakan potret Tabel Informasi Nilai Gizi untuk membaca otomatis via AI OCR.',
    });
  }

  // ─── LAPIS 3 Fallback: Barcode tidak ditemukan ─────────────────────────────
  return res.status(200).json({
    success: true,
    found: false,
    barcode: code,
    message: `Barcode ${code} belum terdaftar di database online. Anda dapat memotret Tabel Informasi Nilai Gizi atau memasukkan data secara manual.`,
  });
}
