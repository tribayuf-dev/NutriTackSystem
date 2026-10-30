/**
 * Unit Test Suite for LiDARVolumeCalculatorService
 */

import {
  calculateTrue3DVolumeFromPolygon,
  fitPlaneToPoints,
  calculateTiltCorrection,
  isPointInPolygon,
  createSyntheticDepthMap,
  DEFAULT_CAMERA_INTRINSICS,
} from './LiDARVolumeCalculatorService.js';

console.log('================================================================');
console.log('TEST SUITE: LiDARVolumeCalculatorService (iPhone 3D RGB-D)');
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
// Test 1: Point in polygon check
// -----------------------------------------------------------------------------
const squarePoly = [[10, 10], [50, 10], [50, 50], [10, 50]];
assert(isPointInPolygon(30, 30, squarePoly) === true, 'Test 1.1: Point inside square returns true');
assert(isPointInPolygon(5, 5, squarePoly) === false, 'Test 1.2: Point outside square returns false');
assert(isPointInPolygon(60, 30, squarePoly) === false, 'Test 1.3: Point to the right returns false');

// -----------------------------------------------------------------------------
// Test 2: Plane fitting with Least Squares
// -----------------------------------------------------------------------------
const flatSamples = [
  { u: 20, v: 20, z: 35.0 },
  { u: 80, v: 20, z: 35.0 },
  { u: 20, v: 80, z: 35.0 },
  { u: 80, v: 80, z: 35.0 },
  { u: 50, v: 50, z: 35.0 },
  { u: 30, v: 60, z: 35.0 },
];
const planeResult = fitPlaneToPoints(flatSamples);
assert(Math.abs(planeResult.medianZ - 35.0) < 0.1, `Test 2.1: Plane median distance is 35cm (got ${planeResult.medianZ})`);
assert(Math.abs(planeResult.a) < 0.001 && Math.abs(planeResult.b) < 0.001, 'Test 2.2: Slopes a and b are near 0 for horizontal plane');

// -----------------------------------------------------------------------------
// Test 3: Camera Tilt Correction
// -----------------------------------------------------------------------------
// Camera pointing straight down: [0, 0, -1] -> cosTheta = 1.0
const tiltStraight = calculateTiltCorrection([0, 0, -1]);
assert(Math.abs(tiltStraight - 1.0) < 0.01, `Test 3.1: Straight down tilt factor is 1.0 (got ${tiltStraight})`);

// Camera tilted 30 degrees: [0, sin(30), -cos(30)] = [0, 0.5, -0.866]
const tilt30 = calculateTiltCorrection([0, 0.5, -0.866]);
assert(Math.abs(tilt30 - 0.866) < 0.02, `Test 3.2: 30 deg tilt factor is ~0.866 (got ${tilt30})`);

// -----------------------------------------------------------------------------
// Test 4: Synthetic Depth Map Generation & 3D Voxel Integration
// -----------------------------------------------------------------------------
// Define a mound of rice in the center (scale 0-1000: x=300..700, y=300..700)
const ricePolygon = [
  [300, 400], [350, 320], [450, 300], [550, 300],
  [650, 350], [700, 450], [680, 580], [580, 680],
  [450, 700], [350, 650], [300, 520]
];

const synth = createSyntheticDepthMap(
  [{ polygon: ricePolygon, peakHeightCm: 4.0 }],
  35.0, // 35 cm camera distance to plate
  15.0  // 15 deg tilt
);

assert(synth.depthMap.length === 256 * 192, 'Test 4.1: Synthetic depth map resolution is 256x192');
assert(synth.confidenceMap.length === 256 * 192, 'Test 4.2: Confidence map resolution is 256x192');

// Run 3D Voxel Integration calculation
const lidarResult = calculateTrue3DVolumeFromPolygon({
  polygonMask: ricePolygon,
  depthMap256x192: synth.depthMap,
  confidenceMap: synth.confidenceMap,
  cameraIntrinsics: DEFAULT_CAMERA_INTRINSICS,
  gravityVector: synth.gravityVector,
  apparentDensity: 0.70, // Nasi Putih: 0.70 g/cm3
});

console.log('LiDAR Integration Result:', lidarResult);

assert(lidarResult.measurement_source === 'LIDAR_VOXEL_INTEGRATION', 'Test 4.3: Measurement source is LIDAR_VOXEL_INTEGRATION');
assert(lidarResult.voxel_count > 100, `Test 4.4: Detected voxels inside mound (got ${lidarResult.voxel_count})`);
assert(lidarResult.true_volume_cc > 50 && lidarResult.true_volume_cc < 500, `Test 4.5: Realistic volume for rice mound (got ${lidarResult.true_volume_cc} cc)`);
assert(lidarResult.max_peak_height_cm >= 2.5 && lidarResult.max_peak_height_cm <= 4.5, `Test 4.6: Max peak height ~4cm (got ${lidarResult.max_peak_height_cm} cm)`);
assert(lidarResult.mean_height_cm > 1.0 && lidarResult.mean_height_cm < 4.0, `Test 4.7: Mean height realistic (got ${lidarResult.mean_height_cm} cm)`);
assert(lidarResult.estimated_weight_g > 30 && lidarResult.estimated_weight_g < 350, `Test 4.8: Estimated weight calculated from density (got ${lidarResult.estimated_weight_g} g)`);
assert(Math.abs(lidarResult.camera_to_plate_distance_cm - 35.0) < 2.0, `Test 4.9: Camera to plate distance accurate (got ${lidarResult.camera_to_plate_distance_cm} cm)`);

console.log('\n================================================================');
console.log(`TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
console.log('================================================================');

if (failCount > 0) process.exit(1);
