/**
 * NutriTrack System - Nutrition Normalizer & BPOM Validation Service
 * 
 * Standar Acuan:
 * 1. Regulasi Label Informasi Nilai Gizi (ING) BPOM RI
 * 2. Angka Kecukupan Gizi (AKG) Kelompok Umum BPOM: Kebutuhan Energi 2150 kkal
 * 3. Atwater General Factor System untuk Verifikasi Konsistensi Kalori
 */

import {
  createMasterFood,
  createFoodNutrients100,
  createServingUnit,
  FoodType,
  BaseUnit,
  DataSource,
  FoodCategory,
} from './schema.js';

// Acuan AKG Kelompok Umum BPOM RI (Kebutuhan Energi 2150 kkal)
export const BPOM_AKG_REFERENCE = Object.freeze({
  ENERGY_KCAL: 2150,
  PROTEIN_G: 60,
  CARB_TOTAL_G: 325,
  FAT_TOTAL_G: 67,
  FAT_SATURATED_G: 20,
  SODIUM_MG: 1500,
  DIETARY_FIBER_G: 30,
});

/**
 * Normalisasi angka float ke 2 desimal
 */
function round2(val) {
  if (val == null || isNaN(val)) return 0.0;
  return Math.round(Number(val) * 100) / 100;
}

/**
 * Hitung Kalori Atwater: (4 * Protein) + (4 * Karbohidrat) + (9 * Lemak)
 */
export function calculateAtwaterKcal(protein_g, carb_total_g, fat_total_g) {
  const p = Math.max(0, Number(protein_g) || 0);
  const c = Math.max(0, Number(carb_total_g) || 0);
  const f = Math.max(0, Number(fat_total_g) || 0);
  return round2((4 * p) + (4 * c) + (9 * f));
}

/**
 * Validasi konsistensi kalori Atwater terhadap kalori tertera di label
 * Jika selisih > thresholdPct (default 25%), return needs_review: true
 */
export function validateAtwaterConsistency(labeledKcal, atwaterKcal, thresholdPct = 25.0) {
  const labeled = Math.max(0, Number(labeledKcal) || 0);
  const atwater = Math.max(0, Number(atwaterKcal) || 0);

  if (labeled === 0 && atwater === 0) {
    return {
      isValid: true,
      needsReview: false,
      discrepancyPct: 0.0,
      warning: null,
    };
  }

  const denominator = Math.max(labeled, 1);
  const discrepancyPct = round2((Math.abs(atwater - labeled) / denominator) * 100);
  const needsReview = discrepancyPct > thresholdPct;

  let warning = null;
  if (needsReview) {
    warning = `Perbedaan antara kalori tertera (${labeled} kkal) dengan kalkulasi makronutrisi Atwater (${atwater} kkal) mencapai ${discrepancyPct}%. Mohon periksa kembali takaran atau angka makronutrisi.`;
  }

  return {
    isValid: !needsReview,
    needsReview,
    discrepancyPct,
    warning,
  };
}

/**
 * Menangani jebakan pembulatan 0g BPOM:
 * Berdasarkan aturan BPOM, kandungan < 0.5g per sajian dapat dicantumkan sebagai 0g.
 * Jika nilai pada takaran saji tertulis 0 namun % AKG > 0, estimasikan nilai sebenarnya
 * menggunakan rumus: (akg_pct / 100) * Standar_AKG
 */
export function resolveBpomZeroRoundingTrap(nutrientsLabeled = {}, akgPercentages = {}) {
  const corrected = { ...nutrientsLabeled };
  const corrections = [];

  const checkAndCorrect = (field, akgField, standardValue, unit = 'g') => {
    const val = Number(corrected[field]) || 0;
    const akgPct = Number(akgPercentages[akgField]) || 0;

    if (val <= 0 && akgPct > 0) {
      const estimated = round2((akgPct / 100) * standardValue);
      if (estimated > 0) {
        corrected[field] = estimated;
        corrections.push({
          field,
          labeledValue: val,
          akgPct,
          estimatedValue: estimated,
          reason: `Nilai ${field} tertulis 0${unit} pada label, namun % AKG tercantum ${akgPct}%. Disesuaikan menjadi ~${estimated}${unit} berdasarkan standar BPOM 2150 kkal.`,
        });
      }
    }
  };

  checkAndCorrect('protein_g', 'protein_akg_pct', BPOM_AKG_REFERENCE.PROTEIN_G);
  checkAndCorrect('fat_total_g', 'fat_total_akg_pct', BPOM_AKG_REFERENCE.FAT_TOTAL_G);
  checkAndCorrect('fat_saturated_g', 'fat_saturated_akg_pct', BPOM_AKG_REFERENCE.FAT_SATURATED_G);
  checkAndCorrect('carb_total_g', 'carb_total_akg_pct', BPOM_AKG_REFERENCE.CARB_TOTAL_G);
  checkAndCorrect('dietary_fiber_g', 'dietary_fiber_akg_pct', BPOM_AKG_REFERENCE.DIETARY_FIBER_G);
  checkAndCorrect('sodium_mg', 'sodium_akg_pct', BPOM_AKG_REFERENCE.SODIUM_MG, 'mg');

  return {
    correctedNutrients: corrected,
    corrections,
  };
}

/**
 * Mengonversi input mentah dari Open Food Facts ke bentuk terstruktur
 */
export function parseOpenFoodFactsProduct(offProduct) {
  if (!offProduct) throw new Error('Data produk Open Food Facts kosong.');

  const nutriments = offProduct.nutriments || {};

  // Deteksi Takaran Saji
  let servingMetric = 100.0;
  let servingAmount = 1.0;
  let servingUnitName = 'sajian';

  if (offProduct.serving_quantity) {
    servingMetric = Number(offProduct.serving_quantity);
  } else if (typeof offProduct.serving_size === 'string') {
    const match = offProduct.serving_size.match(/(\d+(?:[.,]\d+)?)\s*(g|ml|keping|sdm|bungkus)?/i);
    if (match) {
      servingMetric = parseFloat(match[1].replace(',', '.'));
      if (match[2]) servingUnitName = match[2];
    }
  }

  // Net weight
  let netWeightMetric = null;
  if (offProduct.product_quantity) {
    netWeightMetric = Number(offProduct.product_quantity);
  }

  // Sodium di Open Food Facts sering kali dalam satuan gram pada `sodium_100g` atau `salt_100g`
  let sodiumMg100g = 0;
  if (nutriments['sodium_100g'] != null) {
    sodiumMg100g = round2(Number(nutriments['sodium_100g']) * 1000); // g -> mg
  } else if (nutriments['salt_100g'] != null) {
    sodiumMg100g = round2(Number(nutriments['salt_100g']) * 393.37); // garam -> natrium mg
  }

  // Energy
  const energyKcal = nutriments['energy-kcal_100g'] != null
    ? Number(nutriments['energy-kcal_100g'])
    : (nutriments['energy_100g'] ? round2(nutriments['energy_100g'] / 4.184) : 0);

  return {
    product_metadata: {
      product_name: offProduct.product_name || offProduct.product_name_id || offProduct.product_name_en || 'Produk Kemasan',
      brand: offProduct.brands || null,
      barcode_ean: offProduct.code || null,
      category: offProduct.categories ? offProduct.categories.split(',')[0].trim() : FoodCategory.SNACK,
      food_type: FoodType.PACKAGED,
      base_unit: (offProduct.quantity && offProduct.quantity.toLowerCase().includes('ml')) ? BaseUnit.MILLILITER : BaseUnit.GRAM,
      net_weight_metric: netWeightMetric,
      nova_group: offProduct.nova_group || null,
      nutriscore: offProduct.nutriscore_grade || null,
      data_source: DataSource.OPEN_FOOD_FACTS,
    },
    serving_info: {
      basis_type: 'per_100g', // OFF nutriments *_100g sudah dalam basis 100g
      serving_size_metric: servingMetric,
      serving_size_urt_amount: servingAmount,
      serving_size_urt_unit: servingUnitName,
      servings_per_package: netWeightMetric && servingMetric ? round2(netWeightMetric / servingMetric) : 1,
    },
    nutrients_as_labeled: {
      energy_kcal: energyKcal,
      protein_g: Number(nutriments['proteins_100g']) || 0,
      fat_total_g: Number(nutriments['fat_100g']) || 0,
      fat_saturated_g: Number(nutriments['saturated-fat_100g']) || 0,
      fat_trans_g: Number(nutriments['trans-fat_100g']) || 0,
      cholesterol_mg: round2((Number(nutriments['cholesterol_100g']) || 0) * 1000), // jika g di OFF
      carb_total_g: Number(nutriments['carbohydrates_100g']) || 0,
      dietary_fiber_g: Number(nutriments['fiber_100g']) || 0,
      sugar_total_g: Number(nutriments['sugars_100g']) || 0,
      sugar_added_g: Number(nutriments['added-sugars_100g']) || 0,
      sodium_mg: sodiumMg100g,
      potassium_mg: round2((Number(nutriments['potassium_100g']) || 0) * 1000),
      calcium_mg: round2((Number(nutriments['calcium_100g']) || 0) * 1000),
      iron_mg: round2((Number(nutriments['iron_100g']) || 0) * 1000),
      vit_a_mcg: Number(nutriments['vitamin-a_100g']) || 0,
      vit_c_mg: round2((Number(nutriments['vitamin-c_100g']) || 0) * 1000),
      vit_d_mcg: Number(nutriments['vitamin-d_100g']) || 0,
    },
    akg_percentages_as_labeled: {},
    ocr_confidence: 1.0,
    extraction_notes: 'Parsed from Open Food Facts API v2',
  };
}

/**
 * FUNGSI UTAMA: normalizeAndValidateNutritionData
 * Sesuai PRD.md Bagian 4.2 & Master Prompt Tahap 2:
 * 1. Menerima JSON hasil Vision LLM atau Open Food Facts
 * 2. Mengonversi seluruh nilai nutrisi ke basis per 100g / 100ml
 * 3. Menangani pembulatan 0g BPOM via % AKG (2150 kkal)
 * 4. Memastikan nilai kosong bernilai 0 (bukan null) dan satuan sodium/cholesterol dalam mg
 * 5. Menghitung validasi Atwater (4*P + 4*C + 9*F) dengan batas toleransi 25%
 * 6. Membentuk payload siap simpan untuk 3 tabel relasional + format legacy frontend
 */
export function normalizeAndValidateNutritionData(rawExtractedJson) {
  if (!rawExtractedJson || typeof rawExtractedJson !== 'object') {
    throw new Error('Input JSON nutrisi tidak valid atau kosong.');
  }

  // Jika input berupa response langsung dari Open Food Facts (memiliki root `product` atau `nutriments`)
  let structured = rawExtractedJson;
  if (rawExtractedJson.product && rawExtractedJson.product.nutriments) {
    structured = parseOpenFoodFactsProduct(rawExtractedJson.product);
  } else if (rawExtractedJson.nutriments && rawExtractedJson.product_name) {
    structured = parseOpenFoodFactsProduct(rawExtractedJson);
  }

  const productMeta = structured.product_metadata || {};
  const servingInfo = structured.serving_info || {};
  let rawNutrients = structured.nutrients_as_labeled || {};
  const akgPercentages = structured.akg_percentages_as_labeled || {};

  // 1. Eksekusi Pembetulan Jebakan Pembulatan Nol BPOM
  const { correctedNutrients, corrections: bpomCorrections } = resolveBpomZeroRoundingTrap(
    rawNutrients,
    akgPercentages
  );

  // 2. Tentukan Faktor Pengali untuk Normalisasi ke Basis 100g / 100ml
  const basisType = String(servingInfo.basis_type || 'per_serving').toLowerCase();
  let factor = 1.0;
  let servingMetric = Number(servingInfo.serving_size_metric) || 0;
  const netWeightMetric = Number(productMeta.net_weight_metric) || null;

  if (basisType === 'per_serving') {
    if (servingMetric <= 0 && netWeightMetric && Number(servingInfo.servings_per_package) > 0) {
      servingMetric = round2(netWeightMetric / Number(servingInfo.servings_per_package));
    }
    if (servingMetric > 0) {
      factor = 100.0 / servingMetric;
    } else {
      factor = 1.0; // Fallback jika serving size tidak diketahui
    }
  } else if (basisType === 'per_package') {
    if (netWeightMetric && netWeightMetric > 0) {
      factor = 100.0 / netWeightMetric;
    } else if (servingMetric > 0) {
      factor = 100.0 / servingMetric;
    }
  } else {
    // basisType === 'per_100g'
    factor = 1.0;
  }

  // 3. Kalikan seluruh nutrisi dengan factor
  const scaled = {};
  for (const [k, v] of Object.entries(correctedNutrients)) {
    const num = Number(v);
    scaled[k] = isNaN(num) || num < 0 ? 0.0 : round2(num * factor);
  }

  // 4. Validasi Integritas Logika Nutrisi:
  // - fat_saturated <= fat_total
  // - fat_trans <= fat_total
  // - fat_saturated + fat_trans <= fat_total
  // - sugar_total <= carb_total
  // - sugar_added <= sugar_total
  const logicWarnings = [];

  let fatTotal = scaled.fat_total_g || 0;
  let fatSaturated = scaled.fat_saturated_g || 0;
  let fatTrans = scaled.fat_trans_g || 0;

  if (fatSaturated > fatTotal) {
    logicWarnings.push(`Lemak jenuh (${fatSaturated}g) melebihi lemak total (${fatTotal}g). Dibatasi ke lemak total.`);
    fatSaturated = fatTotal;
  }
  if (fatTrans > fatTotal) {
    fatTrans = fatTotal;
  }
  if (fatSaturated + fatTrans > fatTotal && fatTotal > 0) {
    const diff = (fatSaturated + fatTrans) - fatTotal;
    fatTrans = Math.max(0, fatTrans - diff);
  }

  let carbTotal = scaled.carb_total_g || 0;
  let sugarTotal = scaled.sugar_total_g || 0;
  let sugarAdded = scaled.sugar_added_g || 0;

  if (sugarTotal > carbTotal) {
    logicWarnings.push(`Gula total (${sugarTotal}g) melebihi karbohidrat total (${carbTotal}g). Dibatasi ke karbohidrat total.`);
    sugarTotal = carbTotal;
  }
  if (sugarAdded > sugarTotal) {
    sugarAdded = sugarTotal;
  }

  // 5. Validasi Atwater Konsistensi Kalori
  const protein100 = scaled.protein_g || 0;
  const carb100 = carbTotal;
  const fat100 = fatTotal;
  let energyKcal100 = scaled.energy_kcal || 0;

  const atwaterKcal100 = calculateAtwaterKcal(protein100, carb100, fat100);

  // Jika energi 0 tapi makronutrisi ada, autofill dari Atwater
  if (energyKcal100 === 0 && atwaterKcal100 > 0) {
    energyKcal100 = atwaterKcal100;
  }

  const atwaterValidation = validateAtwaterConsistency(energyKcal100, atwaterKcal100, 25.0);

  // 6. Buat Objek Model Relasional Siap Simpan
  const foodId = productMeta.id || `food_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  const masterFoodRecord = createMasterFood({
    id: foodId,
    name: productMeta.product_name || 'Produk Tanpa Nama',
    brand: productMeta.brand || null,
    barcode_ean: productMeta.barcode_ean || null,
    food_type: productMeta.food_type || FoodType.PACKAGED,
    category: productMeta.category || FoodCategory.GENERAL,
    base_unit: productMeta.base_unit || BaseUnit.GRAM,
    net_weight_metric: netWeightMetric,
    nova_group: productMeta.nova_group || null,
    nutriscore: productMeta.nutriscore || null,
    data_source: productMeta.data_source || DataSource.AI_OCR_LABEL,
    is_verified: false,
  });

  const nutrients100Record = createFoodNutrients100({
    food_id: foodId,
    energy_kcal: energyKcal100,
    protein_g: protein100,
    fat_total_g: fat100,
    fat_saturated_g: fatSaturated,
    fat_trans_g: fatTrans,
    cholesterol_mg: scaled.cholesterol_mg || 0,
    carb_total_g: carb100,
    dietary_fiber_g: scaled.dietary_fiber_g || 0,
    sugar_total_g: sugarTotal,
    sugar_added_g: sugarAdded,
    sodium_mg: scaled.sodium_mg || 0,
    potassium_mg: scaled.potassium_mg || 0,
    calcium_mg: scaled.calcium_mg || 0,
    iron_mg: scaled.iron_mg || 0,
    vit_a_mcg: scaled.vit_a_mcg || 0,
    vit_c_mg: scaled.vit_c_mg || 0,
    vit_d_mcg: scaled.vit_d_mcg || 0,
  }, foodId);

  // 7. Konstruksi Serving Units
  const servingUnits = [];

  // Unit default: Takaran saji kemasan
  if (servingMetric > 0) {
    const urtUnit = servingInfo.serving_size_urt_unit || 'sajian';
    const urtAmount = Number(servingInfo.serving_size_urt_amount) || 1.0;
    servingUnits.push(createServingUnit({
      food_id: foodId,
      unit_name: urtUnit,
      unit_amount: urtAmount,
      gram_equivalent: servingMetric,
      is_default_unit: true,
    }, foodId));
  } else {
    // Default 100g jika takaran saji tidak tercantum
    servingUnits.push(createServingUnit({
      food_id: foodId,
      unit_name: 'porsi (100g)',
      unit_amount: 1.0,
      gram_equivalent: 100.0,
      is_default_unit: true,
    }, foodId));
  }

  // Jika ada kemasan utuh (net_weight_metric) dan berbeda dari serving size
  if (netWeightMetric && netWeightMetric > 0 && Math.abs(netWeightMetric - servingMetric) > 1) {
    servingUnits.push(createServingUnit({
      food_id: foodId,
      unit_name: 'kemasan / bungkus',
      unit_amount: 1.0,
      gram_equivalent: netWeightMetric,
      is_default_unit: false,
    }, foodId));
  }

  // 8. Bentuk Objek Legacy untuk Kompatibilitas 100% Frontend (index.html)
  // Mapping s: { [unit_name]: gram_equivalent }
  const legacyPortions = {};
  for (const u of servingUnits) {
    legacyPortions[u.unit_name] = u.gram_equivalent;
  }
  if (!legacyPortions['100g']) legacyPortions['100g'] = 100.0;

  const legacyFoodItem = {
    id: foodId,
    n: masterFoodRecord.name,
    br: masterFoodRecord.brand || '',
    bc: masterFoodRecord.barcode_ean || '',
    cat: masterFoodRecord.category,
    src: masterFoodRecord.data_source,
    st: 'Belum diverifikasi',
    k: nutrients100Record.energy_kcal,
    p: nutrients100Record.protein_g,
    c: nutrients100Record.carb_total_g,
    f: nutrients100Record.fat_total_g,
    fi: nutrients100Record.dietary_fiber_g,
    su: nutrients100Record.sugar_total_g,
    na: nutrients100Record.sodium_mg,
    servName: servingUnits[0]?.unit_name || 'sajian',
    servGram: servingUnits[0]?.gram_equivalent || 100.0,
    s: legacyPortions,
  };

  // Kumpulkan semua catatan review
  const allReviewReasons = [];
  if (atwaterValidation.warning) allReviewReasons.push(atwaterValidation.warning);
  allReviewReasons.push(...logicWarnings);

  return {
    success: true,
    master_food: masterFoodRecord,
    food_nutrients_100: nutrients100Record,
    food_serving_units: servingUnits,
    validation_meta: {
      basis_type_applied: basisType,
      conversion_factor_used: round2(factor),
      labeled_kcal_100g: energyKcal100,
      atwater_calculated_kcal_100g: atwaterKcal100,
      discrepancy_pct: atwaterValidation.discrepancyPct,
      needs_review: atwaterValidation.needsReview || logicWarnings.length > 0,
      review_reasons: allReviewReasons,
      bpom_corrections: bpomCorrections,
      ocr_confidence: structured.ocr_confidence || 1.0,
    },
    legacy_food_item: legacyFoodItem,
  };
}
