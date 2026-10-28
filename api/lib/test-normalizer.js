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

// -----------------------------------------------------------------------------
// Test 6: Polygon Geometry Helper (Shoelace Formula, Centroid & Porsimetry)
// -----------------------------------------------------------------------------
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
  pointsToSmoothPath,
} from './PolygonGeometryHelper.js';

// Square 100x100 from (100,100) to (200,200)
const squarePts = [[100, 100], [200, 100], [200, 200], [100, 200]];
const sqArea = calculateShoelaceArea(squarePts);
assert(sqArea === 10000, `Test 6.1: Shoelace area of 100x100 square is 10000 (got ${sqArea})`);

const sqCentroid = calculateCentroid(squarePts);
assert(sqCentroid[0] === 150 && sqCentroid[1] === 150, `Test 6.2: Centroid of square is [150, 150] (got [${sqCentroid}])`);

const sqBbox = calculateBoundingBox(squarePts);
assert(sqBbox[0] === 100 && sqBbox[1] === 100 && sqBbox[2] === 200 && sqBbox[3] === 200, 'Test 6.3: Bounding box matches square coordinates');

const carbColor = getCategoryHighlightColor('carbohydrate');
const protColor = getCategoryHighlightColor('animal_protein');
assert(carbColor === '#1A73E8', `Test 6.4: Carbohydrate highlight color is #1A73E8 (got ${carbColor})`);
assert(protColor === '#FA903E', `Test 6.5: Animal protein highlight color is #FA903E (got ${protColor})`);

// Sample polygon from PRD Section 3 (Nasi Putih)
const prdPolygon = [
  [210, 320], [265, 280], [340, 275], [410, 300],
  [445, 360], [430, 440], [380, 495], [295, 510],
  [230, 470], [195, 395]
];
const prdAreaNorm = calculateShoelaceArea(prdPolygon);
assert(prdAreaNorm > 30000 && prdAreaNorm < 60000, `Test 6.6: PRD sample polygon area in expected range (got ${prdAreaNorm})`);

const prdCentroid = calculateCentroid(prdPolygon);
assert(prdCentroid[0] >= 280 && prdCentroid[0] <= 360 && prdCentroid[1] >= 340 && prdCentroid[1] <= 420, `Test 6.7: PRD sample centroid in expected range (got [${prdCentroid}])`);

const fallbackPts = generateFallbackPolygonFromBox([200, 200, 400, 400], 12);
assert(fallbackPts.length === 12, `Test 6.8: Fallback polygon has 12 points (got ${fallbackPts.length})`);

const porsimetry = calculateVolumeAndWeight(57.1, 2.5, 0.70);
assert(Math.abs(porsimetry.volumeCc - 142.8) <= 0.2, `Test 6.9: Volume calculation (got ${porsimetry.volumeCc} cc)`);
assert(Math.abs(porsimetry.weightG - 100.0) <= 0.2, `Test 6.10: Weight calculation (got ${porsimetry.weightG} g)`);

// Test Catmull-Rom Smooth Path Generator
const smoothPath = pointsToSmoothPath(prdPolygon);
assert(smoothPath.startsWith('M ') && smoothPath.includes(' C ') && smoothPath.endsWith(' Z'), 'Test 6.11: pointsToSmoothPath generates valid cubic Bezier SVG path');

// Test normalizePolygonPoints with flat array
const flatPts = [100, 200, 150, 250, 120, 280];
const normalizedFlat = normalizePolygonPoints(flatPts);
assert(normalizedFlat.length === 3 && normalizedFlat[0][0] === 100 && normalizedFlat[0][1] === 200, 'Test 6.12: normalizePolygonPoints handles flat array');

// Test normalizePolygonPoints auto-transpose for [y, x] flipped coordinates
// Bounding box: candy package wider than tall [ymin: 400, xmin: 200, ymax: 500, xmax: 600] (W=400, H=100)
// Points returned as [y, x]: y in 410..490, x in 220..580
const flippedPts = [
  [420, 250], [430, 400], [450, 550], [480, 500], [470, 300]
];
const transposed = normalizePolygonPoints(flippedPts, [400, 200, 500, 600]);
assert(transposed[0][0] === 250 && transposed[0][1] === 420, `Test 6.13: normalizePolygonPoints transposes [y, x] -> [x, y] (got [${transposed[0]}])`);

// Test normalizePolygonPoints with array of objects
const objPts = [{ x: 10, y: 20 }, { x: 30, y: 40 }, { x: 50, y: 60 }];
const normalizedObj = normalizePolygonPoints(objPts);
assert(normalizedObj.length === 3 && normalizedObj[1][0] === 30 && normalizedObj[1][1] === 40, 'Test 6.14: normalizePolygonPoints handles array of objects');

// Test calculateTagAnchorPosition places tag OUTSIDE/ABOVE food
const tagPos = calculateTagAnchorPosition([300, 200, 500, 400]); // ymin=300, xmin=200, ymax=500, xmax=400
assert(tagPos.place === 'above' && tagPos.y < 300 && tagPos.anchorY === 300, `Test 6.15: calculateTagAnchorPosition places tag above food (tagY: ${tagPos.y} < 300)`);

console.log('\n================================================================');
console.log(`TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
console.log('================================================================');
