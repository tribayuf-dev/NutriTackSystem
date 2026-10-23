/**
 * NutriTrack System - Database Seeder Data
 * Standar: Kemenkes RI URT (Ukuran Rumah Tangga), Standar Densitas Fisik Pangan, & TKPI
 */

import { FoodType, BaseUnit, DataSource, FoodCategory } from './schema.js';

export const PHYSICAL_DENSITIES_SEED = [
  {
    category_key: 'rice_white',
    apparent_density_g_cc: 0.7000,
    default_urt_name: 'centong magiccom',
    default_urt_grams: 100.0,
    notes: 'Nasi putih / nasi goreng. 1 centong magiccom (atau 3/4 gelas) = 100g (175 kkal, 4g Protein, 40g Karbohidrat).',
  },
  {
    category_key: 'bread_white',
    apparent_density_g_cc: 0.2760,
    default_urt_name: 'iris',
    default_urt_grams: 22.0,
    notes: 'Roti tawar putih. 3 iris = 60-70g (Densitas roti panggang = 0.276 g/cm3).',
  },
  {
    category_key: 'noodle_pasta',
    apparent_density_g_cc: 0.6700,
    default_urt_name: 'porsi',
    default_urt_grams: 240.0,
    notes: 'Mie, spageti, bihun dengan saus. 1 porsi = 240g.',
  },
  {
    category_key: 'tempeh',
    apparent_density_g_cc: 0.8000,
    default_urt_name: 'potong sedang',
    default_urt_grams: 25.0,
    notes: 'Tempe. 1 potong sedang = 25g; 2 potong sedang = 50g (80 kkal, 6g Protein, 3g Lemak, 8g Karbohidrat).',
  },
  {
    category_key: 'tofu',
    apparent_density_g_cc: 0.8000,
    default_urt_name: 'potong sedang',
    default_urt_grams: 50.0,
    notes: 'Tahu putih / kuning. 1 potong sedang = 50g.',
  },
  {
    category_key: 'fish_fresh',
    apparent_density_g_cc: 0.8630,
    default_urt_name: 'potong sedang',
    default_urt_grams: 40.0,
    notes: 'Ikan segar. 1 potong sedang = 40g (50 kkal, 7g Protein, 2g Lemak).',
  },
  {
    category_key: 'chicken_meat',
    apparent_density_g_cc: 0.9500,
    default_urt_name: 'potong sedang',
    default_urt_grams: 60.0,
    notes: 'Daging ayam. 1 potong sedang = 55-65g.',
  },
  {
    category_key: 'beef_meat',
    apparent_density_g_cc: 1.0500,
    default_urt_name: 'potong sedang',
    default_urt_grams: 50.0,
    notes: 'Daging sapi. 1 potong sedang = 50g.',
  },
  {
    category_key: 'egg_scrambled',
    apparent_density_g_cc: 1.1230,
    default_urt_name: 'butir',
    default_urt_grams: 55.0,
    notes: 'Telur ayam (orak-arik/dadar/rebus). 1 butir sedang = 55-60g.',
  },
  {
    category_key: 'vegetable_leafy_raw',
    apparent_density_g_cc: 0.3160,
    default_urt_name: 'mangkuk',
    default_urt_grams: 50.0,
    notes: 'Sayuran daun mentah / salad / lalapan berongga udara.',
  },
  {
    category_key: 'vegetable_cooked',
    apparent_density_g_cc: 0.6500,
    default_urt_name: 'centong sayur',
    default_urt_grams: 15.0,
    notes: 'Sayur masak ditiriskan. 1 centong sayur = 15g; 1 gelas sayur ditiriskan = 100g.',
  },
  {
    category_key: 'french_fries',
    apparent_density_g_cc: 0.2410,
    default_urt_name: 'porsi',
    default_urt_grams: 80.0,
    notes: 'Kentang goreng / kerupuk / gorengan berongga.',
  },
  {
    category_key: 'oil_margarine',
    apparent_density_g_cc: 0.9570,
    default_urt_name: 'sdm',
    default_urt_grams: 10.0,
    notes: 'Minyak goreng / margarin / mentega. 1/2 sdm = 5g; 1 sdm = 10g.',
  },
  {
    category_key: 'sauce_salad_dressing',
    apparent_density_g_cc: 1.1080,
    default_urt_name: 'sdm',
    default_urt_grams: 15.0,
    notes: 'Saus salad / dressing.',
  },
  {
    category_key: 'sauce_tomato_sambal',
    apparent_density_g_cc: 1.1410,
    default_urt_name: 'sdm',
    default_urt_grams: 15.0,
    notes: 'Saus tomat / sambal terasi.',
  },
  {
    category_key: 'jam_sweet_condiment',
    apparent_density_g_cc: 1.3070,
    default_urt_name: 'sdm',
    default_urt_grams: 15.0,
    notes: 'Selai manis / kecap manis.',
  },
  {
    category_key: 'coconut_shredded',
    apparent_density_g_cc: 0.5500,
    default_urt_name: 'potong kecil',
    default_urt_grams: 30.0,
    notes: '1 potong kecil kelapa parut = 30g.',
  },
  {
    category_key: 'coconut_milk_thick',
    apparent_density_g_cc: 0.9800,
    default_urt_name: 'porsi',
    default_urt_grams: 50.0,
    notes: 'Santan kental = 50g.',
  },
  {
    category_key: 'milk_liquid',
    apparent_density_g_cc: 0.9730,
    default_urt_name: 'gelas',
    default_urt_grams: 200.0,
    notes: 'Susu sapi cair. 1 gelas = 200ml.',
  },
  {
    category_key: 'orange_juice',
    apparent_density_g_cc: 1.0110,
    default_urt_name: 'gelas',
    default_urt_grams: 200.0,
    notes: 'Jus jeruk segar. 1 gelas = 200ml.',
  },
  {
    category_key: 'soda_beverage',
    apparent_density_g_cc: 1.0270,
    default_urt_name: 'gelas',
    default_urt_grams: 220.0,
    notes: 'Minuman bersoda / berkarbonasi. 1 gelas = 220ml.',
  },
];

export const STAPLE_FOODS_SEED = [
  {
    food: {
      id: 'food_nasi_putih',
      name: 'Nasi Putih',
      brand: null,
      barcode_ean: null,
      food_type: FoodType.WHOLE_FOOD,
      category: FoodCategory.CARBOHYDRATE,
      base_unit: BaseUnit.GRAM,
      net_weight_metric: null,
      data_source: DataSource.TKPI,
      is_verified: true,
    },
    nutrients_100: {
      energy_kcal: 175.0,
      protein_g: 4.0,
      fat_total_g: 0.5,
      fat_saturated_g: 0.1,
      fat_trans_g: 0.0,
      cholesterol_mg: 0.0,
      carb_total_g: 40.0,
      dietary_fiber_g: 0.5,
      sugar_total_g: 0.1,
      sugar_added_g: 0.0,
      sodium_mg: 5.0,
      potassium_mg: 35.0,
      calcium_mg: 10.0,
      iron_mg: 0.2,
      vit_a_mcg: 0.0,
      vit_c_mg: 0.0,
      vit_d_mcg: 0.0,
    },
    serving_units: [
      { unit_name: 'centong magiccom', unit_amount: 1, gram_equivalent: 100.0, is_default_unit: true },
      { unit_name: 'mangkuk', unit_amount: 1, gram_equivalent: 160.0, is_default_unit: false },
      { unit_name: 'piring', unit_amount: 1, gram_equivalent: 200.0, is_default_unit: false },
    ],
  },
  {
    food: {
      id: 'food_tempe_kedelai',
      name: 'Tempe Kedelai Murni',
      brand: null,
      barcode_ean: null,
      food_type: FoodType.WHOLE_FOOD,
      category: FoodCategory.PLANT_PROTEIN,
      base_unit: BaseUnit.GRAM,
      net_weight_metric: null,
      data_source: DataSource.TKPI,
      is_verified: true,
    },
    nutrients_100: {
      energy_kcal: 160.0,
      protein_g: 12.0,
      fat_total_g: 6.0,
      fat_saturated_g: 1.5,
      fat_trans_g: 0.0,
      cholesterol_mg: 0.0,
      carb_total_g: 16.0,
      dietary_fiber_g: 2.8,
      sugar_total_g: 1.0,
      sugar_added_g: 0.0,
      sodium_mg: 9.0,
      potassium_mg: 234.0,
      calcium_mg: 155.0,
      iron_mg: 4.0,
      vit_a_mcg: 0.0,
      vit_c_mg: 0.0,
      vit_d_mcg: 0.0,
    },
    serving_units: [
      { unit_name: 'potong sedang', unit_amount: 1, gram_equivalent: 25.0, is_default_unit: false },
      { unit_name: 'potong sedang', unit_amount: 2, gram_equivalent: 50.0, is_default_unit: true },
    ],
  },
  {
    food: {
      id: 'food_telur_ayam',
      name: 'Telur Ayam Ras',
      brand: null,
      barcode_ean: null,
      food_type: FoodType.WHOLE_FOOD,
      category: FoodCategory.ANIMAL_PROTEIN,
      base_unit: BaseUnit.GRAM,
      net_weight_metric: null,
      data_source: DataSource.TKPI,
      is_verified: true,
    },
    nutrients_100: {
      energy_kcal: 155.0,
      protein_g: 13.0,
      fat_total_g: 11.0,
      fat_saturated_g: 3.3,
      fat_trans_g: 0.0,
      cholesterol_mg: 372.0,
      carb_total_g: 1.1,
      dietary_fiber_g: 0.0,
      sugar_total_g: 1.1,
      sugar_added_g: 0.0,
      sodium_mg: 124.0,
      potassium_mg: 126.0,
      calcium_mg: 50.0,
      iron_mg: 1.2,
      vit_a_mcg: 160.0,
      vit_c_mg: 0.0,
      vit_d_mcg: 2.0,
    },
    serving_units: [
      { unit_name: 'butir', unit_amount: 1, gram_equivalent: 55.0, is_default_unit: true },
    ],
  },
  {
    food: {
      id: 'food_ikan_mas',
      name: 'Ikan Segar (Ikan Mas / Nila)',
      brand: null,
      barcode_ean: null,
      food_type: FoodType.WHOLE_FOOD,
      category: FoodCategory.ANIMAL_PROTEIN,
      base_unit: BaseUnit.GRAM,
      net_weight_metric: null,
      data_source: DataSource.TKPI,
      is_verified: true,
    },
    nutrients_100: {
      energy_kcal: 125.0,
      protein_g: 17.5,
      fat_total_g: 5.0,
      fat_saturated_g: 1.2,
      fat_trans_g: 0.0,
      cholesterol_mg: 60.0,
      carb_total_g: 0.0,
      dietary_fiber_g: 0.0,
      sugar_total_g: 0.0,
      sugar_added_g: 0.0,
      sodium_mg: 55.0,
      potassium_mg: 280.0,
      calcium_mg: 25.0,
      iron_mg: 1.0,
      vit_a_mcg: 20.0,
      vit_c_mg: 0.0,
      vit_d_mcg: 3.5,
    },
    serving_units: [
      { unit_name: 'potong sedang', unit_amount: 1, gram_equivalent: 40.0, is_default_unit: true },
    ],
  },
  {
    food: {
      id: 'food_minyak_goreng_sawit',
      name: 'Minyak Goreng Kelapa Sawit',
      brand: null,
      barcode_ean: null,
      food_type: FoodType.PACKAGED,
      category: FoodCategory.FAT_OIL,
      base_unit: BaseUnit.GRAM,
      net_weight_metric: null,
      data_source: DataSource.TKPI,
      is_verified: true,
    },
    nutrients_100: {
      energy_kcal: 884.0,
      protein_g: 0.0,
      fat_total_g: 100.0,
      fat_saturated_g: 49.0,
      fat_trans_g: 0.0,
      cholesterol_mg: 0.0,
      carb_total_g: 0.0,
      dietary_fiber_g: 0.0,
      sugar_total_g: 0.0,
      sugar_added_g: 0.0,
      sodium_mg: 0.0,
      potassium_mg: 0.0,
      calcium_mg: 0.0,
      iron_mg: 0.0,
      vit_a_mcg: 100.0,
      vit_c_mg: 0.0,
      vit_d_mcg: 0.0,
    },
    serving_units: [
      { unit_name: 'sdm', unit_amount: 0.5, gram_equivalent: 5.0, is_default_unit: false },
      { unit_name: 'sdm', unit_amount: 1.0, gram_equivalent: 10.0, is_default_unit: true },
    ],
  },
];

/**
 * Menghasilkan SQL INSERT query untuk file migration atau setup database
 */
export function generateSeedSql() {
  const lines = ['-- =============================================================================='];
  lines.push('-- NutriTrack System - Initial Seed Data (Kemenkes URT & Physical Densities)');
  lines.push('-- ==============================================================================\n');

  lines.push('-- 1. Insert food_physical_density');
  for (const d of PHYSICAL_DENSITIES_SEED) {
    const escNotes = d.notes ? `'${d.notes.replace(/'/g, "''")}'` : 'NULL';
    lines.push(`INSERT INTO food_physical_density (id, category_key, apparent_density_g_cc, default_urt_name, default_urt_grams, notes) ` +
      `VALUES ('dens_${d.category_key}', '${d.category_key}', ${d.apparent_density_g_cc}, '${d.default_urt_name}', ${d.default_urt_grams}, ${escNotes}) ` +
      `ON CONFLICT (category_key) DO UPDATE SET apparent_density_g_cc = EXCLUDED.apparent_density_g_cc, default_urt_grams = EXCLUDED.default_urt_grams;`);
  }

  lines.push('\n-- 2. Insert master_foods, food_nutrients_100, food_serving_units');
  for (const item of STAPLE_FOODS_SEED) {
    const f = item.food;
    const n = item.nutrients_100;

    lines.push(`INSERT INTO master_foods (id, name, brand, barcode_ean, food_type, category, base_unit, data_source, is_verified) ` +
      `VALUES ('${f.id}', '${f.name.replace(/'/g, "''")}', ${f.brand ? `'${f.brand}'` : 'NULL'}, ${f.barcode_ean ? `'${f.barcode_ean}'` : 'NULL'}, '${f.food_type}', '${f.category}', '${f.base_unit}', '${f.data_source}', ${f.is_verified}) ` +
      `ON CONFLICT (id) DO NOTHING;`);

    lines.push(`INSERT INTO food_nutrients_100 (id, food_id, energy_kcal, protein_g, fat_total_g, fat_saturated_g, fat_trans_g, cholesterol_mg, carb_total_g, dietary_fiber_g, sugar_total_g, sugar_added_g, sodium_mg, potassium_mg, calcium_mg, iron_mg, vit_a_mcg, vit_c_mg, vit_d_mcg) ` +
      `VALUES ('nutr_${f.id}', '${f.id}', ${n.energy_kcal}, ${n.protein_g}, ${n.fat_total_g}, ${n.fat_saturated_g}, ${n.fat_trans_g}, ${n.cholesterol_mg}, ${n.carb_total_g}, ${n.dietary_fiber_g}, ${n.sugar_total_g}, ${n.sugar_added_g}, ${n.sodium_mg}, ${n.potassium_mg}, ${n.calcium_mg}, ${n.iron_mg}, ${n.vit_a_mcg}, ${n.vit_c_mg}, ${n.vit_d_mcg}) ` +
      `ON CONFLICT (food_id) DO NOTHING;`);

    for (let i = 0; i < item.serving_units.length; i++) {
      const u = item.serving_units[i];
      lines.push(`INSERT INTO food_serving_units (id, food_id, unit_name, unit_amount, gram_equivalent, is_default_unit) ` +
        `VALUES ('unit_${f.id}_${i}', '${f.id}', '${u.unit_name.replace(/'/g, "''")}', ${u.unit_amount}, ${u.gram_equivalent}, ${u.is_default_unit}) ` +
        `ON CONFLICT (id) DO NOTHING;`);
    }
  }

  return lines.join('\n');
}
