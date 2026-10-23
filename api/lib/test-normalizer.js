import {
  normalizeAndValidateNutritionData,
  calculateAtwaterKcal,
  validateAtwaterConsistency,
  BPOM_AKG_REFERENCE,
} from './NutritionNormalizerService.js';
import { PHYSICAL_DENSITIES_SEED, STAPLE_FOODS_SEED } from './seedData.js';

console.log('================================================================');
console.log('TEST SUITE: NutritionNormalizerService & BPOM Compliance');
console.log('================================================================\n');

let passCount = 0;
let failCount = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`[PASS] ${testName}`);
    passCount++;
  } else {
    console.error(`[FAIL] ${testName}`);
    failCount++;
  }
}

// -----------------------------------------------------------------------------
// Test 1: Basis Conversion (per_serving 30g -> 100g)
// -----------------------------------------------------------------------------
const sampleBiskuit = {
  product_metadata: {
    product_name: 'Biskuit Gandum Roma',
    brand: 'Roma',
    barcode_ean: '8992388111223',
    category: 'Camilan & Snack',
    food_type: 'packaged',
    base_unit: 'g',
    net_weight_metric: 150,
  },
  serving_info: {
    basis_type: 'per_serving',
    serving_size_metric: 30, // 30g
    serving_size_urt_amount: 3,
    serving_size_urt_unit: 'keping',
    servings_per_package: 5,
  },
  nutrients_as_labeled: {
    energy_kcal: 140,
    protein_g: 2,
    fat_total_g: 5,
    fat_saturated_g: 2,
    fat_trans_g: 0,
    cholesterol_mg: 0,
    carb_total_g: 21,
    dietary_fiber_g: 1,
    sugar_total_g: 6,
    sodium_mg: 110,
  },
  akg_percentages_as_labeled: {
    protein_akg_pct: 3,
    fat_total_akg_pct: 7,
    fat_saturated_akg_pct: 10,
    carb_total_akg_pct: 6,
    dietary_fiber_akg_pct: 3,
    sodium_akg_pct: 7,
  },
};

const norm1 = normalizeAndValidateNutritionData(sampleBiskuit);
// Faktor = 100 / 30 = 3.3333333333...
// energy_kcal = 140 * (100 / 30) = 466.67 kkal
// protein = 2 * (100 / 30) = 6.67g
// carb = 21 * (100 / 30) = 70.0g
// fat = 5 * (100 / 30) = 16.67g
// sodium = 110 * (100 / 30) = 366.67 mg

assert(norm1.success === true, 'Test 1.1: Conversion success flag');
assert(Math.abs(norm1.food_nutrients_100.energy_kcal - 466.67) < 0.1, `Test 1.2: Normalized calories (got ${norm1.food_nutrients_100.energy_kcal})`);
assert(Math.abs(norm1.food_nutrients_100.protein_g - 6.67) < 0.1, `Test 1.3: Normalized protein (got ${norm1.food_nutrients_100.protein_g})`);
assert(Math.abs(norm1.food_nutrients_100.sodium_mg - 366.67) < 0.1, `Test 1.4: Normalized sodium in mg (got ${norm1.food_nutrients_100.sodium_mg})`);
assert(norm1.food_serving_units.length === 2, 'Test 1.5: Generated 2 serving units (serving + whole package)');
assert(norm1.food_serving_units[0].unit_name === 'keping' && norm1.food_serving_units[0].gram_equivalent === 30, 'Test 1.6: Default serving unit is 3 keping (30g)');
assert(norm1.legacy_food_item.n === 'Biskuit Gandum Roma', 'Test 1.7: Legacy food item generated cleanly');

// -----------------------------------------------------------------------------
// Test 2: BPOM 0g Rounding Trap Correction
// -----------------------------------------------------------------------------
const sampleZeroTrap = {
  product_metadata: {
    product_name: 'Minuman Isotonik',
    food_type: 'packaged',
    base_unit: 'ml',
  },
  serving_info: {
    basis_type: 'per_serving',
    serving_size_metric: 250,
  },
  nutrients_as_labeled: {
    energy_kcal: 60,
    protein_g: 0, // tertulis 0g tapi AKG 2%
    fat_total_g: 0,
    carb_total_g: 15,
    sodium_mg: 0, // tertulis 0mg tapi AKG 5%
  },
  akg_percentages_as_labeled: {
    protein_akg_pct: 2, // 2% of 60g = 1.2g
    sodium_akg_pct: 5,  // 5% of 1500mg = 75mg
  },
};

const norm2 = normalizeAndValidateNutritionData(sampleZeroTrap);
assert(norm2.validation_meta.bpom_corrections.length >= 2, `Test 2.1: Detected ${norm2.validation_meta.bpom_corrections.length} BPOM zero trap corrections`);
assert(norm2.food_nutrients_100.protein_g > 0, `Test 2.2: Protein was corrected from 0g (got ${norm2.food_nutrients_100.protein_g}g per 100g)`);
assert(norm2.food_nutrients_100.sodium_mg > 0, `Test 2.3: Sodium was corrected from 0mg (got ${norm2.food_nutrients_100.sodium_mg}mg per 100g)`);

// -----------------------------------------------------------------------------
// Test 3: Atwater Consistency Discrepancy > 25% Flagging
// -----------------------------------------------------------------------------
const sampleDiscrepancy = {
  product_metadata: { product_name: 'Produk Salah Label' },
  serving_info: { basis_type: 'per_100g', serving_size_metric: 100 },
  nutrients_as_labeled: {
    energy_kcal: 400, // Tertera 400 kkal
    protein_g: 5,     // 5 * 4 = 20
    fat_total_g: 2,   // 2 * 9 = 18
    carb_total_g: 10, // 10 * 4 = 40. Atwater Total = 78 kkal (selisih > 80%!)
  },
};

const norm3 = normalizeAndValidateNutritionData(sampleDiscrepancy);
assert(norm3.validation_meta.needs_review === true, 'Test 3.1: Needs review flagged for severe Atwater discrepancy');
assert(norm3.validation_meta.discrepancy_pct > 25, `Test 3.2: Discrepancy % detected correctly (${norm3.validation_meta.discrepancy_pct}%)`);

// -----------------------------------------------------------------------------
// Test 4: Open Food Facts Product Ingestion
// -----------------------------------------------------------------------------
const sampleOffProduct = {
  product: {
    product_name: 'Indomie Mi Instan Goreng',
    brands: 'Indomie',
    code: '089686010924',
    categories: 'Mie Instan',
    serving_size: '85 g',
    serving_quantity: 85,
    product_quantity: 85,
    nutriments: {
      'energy-kcal_100g': 458,
      'proteins_100g': 9.4,
      'carbohydrates_100g': 63.5,
      'fat_100g': 18.8,
      'saturated-fat_100g': 8.2,
      'sodium_100g': 0.85, // 0.85g sodium = 850mg
    },
  },
};

const norm4 = normalizeAndValidateNutritionData(sampleOffProduct);
assert(norm4.master_food.name === 'Indomie Mi Instan Goreng', 'Test 4.1: OFF product name parsed');
assert(norm4.master_food.barcode_ean === '089686010924', 'Test 4.2: OFF barcode parsed');
assert(norm4.food_nutrients_100.sodium_mg === 850, `Test 4.3: OFF sodium converted from g to mg (850mg, got ${norm4.food_nutrients_100.sodium_mg})`);
assert(norm4.master_food.data_source === 'OPEN_FOOD_FACTS', 'Test 4.4: Data source marked as OPEN_FOOD_FACTS');

// -----------------------------------------------------------------------------
// Test 5: Seed Data and Density References
// -----------------------------------------------------------------------------
assert(PHYSICAL_DENSITIES_SEED.length >= 20, `Test 5.1: Physical densities seed count (${PHYSICAL_DENSITIES_SEED.length} items)`);
const riceDensity = PHYSICAL_DENSITIES_SEED.find(d => d.category_key === 'rice_white');
assert(riceDensity && riceDensity.apparent_density_g_cc === 0.70, 'Test 5.2: Rice white density is 0.70 g/cm3');
assert(STAPLE_FOODS_SEED.length >= 5, `Test 5.3: Staple foods seed count (${STAPLE_FOODS_SEED.length} items)`);

console.log('\n================================================================');
console.log(`TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
console.log('================================================================');
