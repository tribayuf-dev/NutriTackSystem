/**
 * NutriTrack System - Relational Data Schemas & Model Definitions
 * Standar: BPOM RI & Kemenkes RI URT (Ukuran Rumah Tangga)
 */

export const FoodType = Object.freeze({
  WHOLE_FOOD: 'whole_food',
  COOKED_DISH: 'cooked_dish',
  PACKAGED: 'packaged',
});

export const BaseUnit = Object.freeze({
  GRAM: 'g',
  MILLILITER: 'ml',
});

export const DataSource = Object.freeze({
  TKPI: 'TKPI',
  USDA: 'USDA',
  OPEN_FOOD_FACTS: 'OPEN_FOOD_FACTS',
  AI_OCR_LABEL: 'AI_OCR_LABEL',
  USER_MANUAL: 'USER_MANUAL',
});

export const FoodCategory = Object.freeze({
  CARBOHYDRATE: 'Makanan Pokok',
  ANIMAL_PROTEIN: 'Lauk Hewani',
  PLANT_PROTEIN: 'Lauk Nabati',
  VEGETABLE: 'Sayuran',
  FRUIT: 'Buah-buahan',
  SNACK: 'Camilan & Snack',
  BEVERAGE: 'Minuman Kemasan',
  FAT_OIL: 'Minyak & Lemak',
  SAUCE_CONDIMENT: 'Saus & Bumbu',
  GENERAL: 'Makanan',
});

/**
 * Factory untuk Master Food Model
 */
export function createMasterFood(data = {}) {
  const now = new Date().toISOString();
  return {
    id: data.id || `food_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    name: String(data.name || '').trim(),
    brand: data.brand ? String(data.brand).trim() : null,
    barcode_ean: data.barcode_ean ? String(data.barcode_ean).trim() : null,
    food_type: Object.values(FoodType).includes(data.food_type) ? data.food_type : FoodType.PACKAGED,
    category: data.category ? String(data.category).trim() : FoodCategory.GENERAL,
    base_unit: data.base_unit === BaseUnit.MILLILITER ? BaseUnit.MILLILITER : BaseUnit.GRAM,
    net_weight_metric: data.net_weight_metric != null ? Number(data.net_weight_metric) : null,
    nova_group: data.nova_group != null ? Number(data.nova_group) : null,
    nutriscore: data.nutriscore ? String(data.nutriscore).toUpperCase() : null,
    data_source: Object.values(DataSource).includes(data.data_source) ? data.data_source : DataSource.USER_MANUAL,
    is_verified: Boolean(data.is_verified),
    created_at: data.created_at || now,
    updated_at: data.updated_at || now,
  };
}

/**
 * Factory untuk Food Nutrients 100g Model
 * Seluruh nilai wajib dalam basis per 100g / 100ml.
 * Default 0, tidak boleh null atau undefined.
 */
export function createFoodNutrients100(data = {}, foodId = null) {
  const sanitize = (val) => {
    const num = Number(val);
    return isNaN(num) || num < 0 ? 0.0 : Math.round(num * 100) / 100;
  };

  return {
    id: data.id || `nutr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    food_id: foodId || data.food_id || null,
    energy_kcal: sanitize(data.energy_kcal),
    protein_g: sanitize(data.protein_g),
    fat_total_g: sanitize(data.fat_total_g),
    fat_saturated_g: sanitize(data.fat_saturated_g),
    fat_trans_g: sanitize(data.fat_trans_g),
    cholesterol_mg: sanitize(data.cholesterol_mg), // Selalu mg
    carb_total_g: sanitize(data.carb_total_g),
    dietary_fiber_g: sanitize(data.dietary_fiber_g),
    sugar_total_g: sanitize(data.sugar_total_g),
    sugar_added_g: sanitize(data.sugar_added_g),
    sodium_mg: sanitize(data.sodium_mg), // Selalu mg
    potassium_mg: sanitize(data.potassium_mg),
    calcium_mg: sanitize(data.calcium_mg),
    iron_mg: sanitize(data.iron_mg),
    vit_a_mcg: sanitize(data.vit_a_mcg),
    vit_c_mg: sanitize(data.vit_c_mg),
    vit_d_mcg: sanitize(data.vit_d_mcg),
    created_at: data.created_at || new Date().toISOString(),
    updated_at: data.updated_at || new Date().toISOString(),
  };
}

/**
 * Factory untuk Food Serving Unit Model
 */
export function createServingUnit(data = {}, foodId = null) {
  return {
    id: data.id || `unit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    food_id: foodId || data.food_id || null,
    unit_name: String(data.unit_name || 'porsi').trim(),
    unit_amount: data.unit_amount != null ? Math.max(0.01, Number(data.unit_amount)) : 1.0,
    gram_equivalent: data.gram_equivalent != null ? Math.max(0.1, Number(data.gram_equivalent)) : 100.0,
    is_default_unit: Boolean(data.is_default_unit),
    created_at: data.created_at || new Date().toISOString(),
  };
}

/**
 * Factory untuk Food Physical Density Model
 */
export function createPhysicalDensity(data = {}) {
  return {
    id: data.id || `dens_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    category_key: String(data.category_key || '').trim().toLowerCase(),
    apparent_density_g_cc: Number(data.apparent_density_g_cc) || 1.0,
    default_urt_name: String(data.default_urt_name || 'porsi').trim(),
    default_urt_grams: Number(data.default_urt_grams) || 100.0,
    notes: data.notes ? String(data.notes) : null,
    created_at: data.created_at || new Date().toISOString(),
  };
}
