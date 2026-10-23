-- ==============================================================================
-- NutriTrack System - Migration 001: Initial Relational Nutrition Schema
-- Standards: BPOM RI & Kemenkes RI URT (Ukuran Rumah Tangga)
-- Dialect: ANSI SQL / PostgreSQL / Supabase compatible
-- ==============================================================================

-- 1. Table: master_foods (Identitas Makanan)
CREATE TABLE IF NOT EXISTS master_foods (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    brand VARCHAR(150) DEFAULT NULL,
    barcode_ean VARCHAR(64) DEFAULT NULL,
    food_type VARCHAR(32) NOT NULL DEFAULT 'packaged' 
        CHECK (food_type IN ('whole_food', 'cooked_dish', 'packaged')),
    category VARCHAR(100) NOT NULL DEFAULT 'Makanan',
    base_unit VARCHAR(8) NOT NULL DEFAULT 'g' 
        CHECK (base_unit IN ('g', 'ml')),
    net_weight_metric DECIMAL(10, 2) DEFAULT NULL,
    nova_group SMALLINT DEFAULT NULL 
        CHECK (nova_group BETWEEN 1 AND 4),
    nutriscore CHAR(1) DEFAULT NULL 
        CHECK (nutriscore IN ('A', 'B', 'C', 'D', 'E', 'a', 'b', 'c', 'd', 'e')),
    data_source VARCHAR(32) NOT NULL DEFAULT 'USER_MANUAL' 
        CHECK (data_source IN ('TKPI', 'USDA', 'OPEN_FOOD_FACTS', 'AI_OCR_LABEL', 'USER_MANUAL')),
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Unique index on barcode_ean (allowing multiple NULLs for foods without barcodes)
CREATE UNIQUE INDEX IF NOT EXISTS idx_master_foods_barcode_ean 
    ON master_foods(barcode_ean) 
    WHERE barcode_ean IS NOT NULL AND barcode_ean <> '';

CREATE INDEX IF NOT EXISTS idx_master_foods_name 
    ON master_foods(name);

CREATE INDEX IF NOT EXISTS idx_master_foods_category 
    ON master_foods(category);


-- 2. Table: food_nutrients_100 (Profil Nutrisi Wajib Basis Per 100g / 100ml)
CREATE TABLE IF NOT EXISTS food_nutrients_100 (
    id VARCHAR(64) PRIMARY KEY,
    food_id VARCHAR(64) NOT NULL UNIQUE REFERENCES master_foods(id) ON DELETE CASCADE,
    energy_kcal DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    protein_g DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    fat_total_g DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    fat_saturated_g DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    fat_trans_g DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    cholesterol_mg DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    carb_total_g DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    dietary_fiber_g DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    sugar_total_g DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    sugar_added_g DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    sodium_mg DECIMAL(10, 2) NOT NULL DEFAULT 0.00, -- WAJIB dalam miligram
    potassium_mg DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    calcium_mg DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    iron_mg DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    vit_a_mcg DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    vit_c_mg DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    vit_d_mcg DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_food_nutrients_food_id 
    ON food_nutrients_100(food_id);


-- 3. Table: food_serving_units (Konversi Takaran Saji Kemasan & URT ke Gram)
CREATE TABLE IF NOT EXISTS food_serving_units (
    id VARCHAR(64) PRIMARY KEY,
    food_id VARCHAR(64) NOT NULL REFERENCES master_foods(id) ON DELETE CASCADE,
    unit_name VARCHAR(100) NOT NULL, -- Contoh: 'takaran saji', 'centong magiccom', 'keping', 'bungkus'
    unit_amount DECIMAL(10, 2) NOT NULL DEFAULT 1.00,
    gram_equivalent DECIMAL(10, 2) NOT NULL, -- Berat metrik setara dalam g atau ml
    is_default_unit BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_serving_units_food_id 
    ON food_serving_units(food_id);


-- 4. Table: food_physical_density (Referensi Massa Jenis & URT untuk AI Foto)
CREATE TABLE IF NOT EXISTS food_physical_density (
    id VARCHAR(64) PRIMARY KEY,
    category_key VARCHAR(100) NOT NULL UNIQUE,
    apparent_density_g_cc DECIMAL(6, 4) NOT NULL, -- Massa jenis semu dalam g/cm3
    default_urt_name VARCHAR(100) NOT NULL,
    default_urt_grams DECIMAL(10, 2) NOT NULL,
    notes TEXT DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_physical_density_key 
    ON food_physical_density(category_key);
