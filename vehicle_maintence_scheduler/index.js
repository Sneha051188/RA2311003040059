
"use strict";

const axios = require("axios");
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const { Log } = require("../logging_middleware/logger");

const BASE_URL = process.env.BASE_URL || "http://20.207.122.201/evaluation-service";
const MODULE = "auth";


/**
 * Returns axios headers with the Bearer token for authenticated requests.
 * Throws an error if the token is not present in the environment.
 *
 * @returns {{ Authorization: string, "Content-Type": string }}
 */
function getAuthHeaders() {
  const token = process.env.ACCESS_TOKEN;
  if (!token) {
    throw new Error("ACCESS_TOKEN is not set. Run auth.js first.");
  }
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

// ─── Step 1 : Fetch Depots ────────────────────────────────────────────────────

/**
 * Fetches depot information from the evaluation service.
 * Extracts the total MechanicHours available for scheduling.
 *
 * @returns {Promise<number>} Total mechanic hours (knapsack capacity)
 */
async function fetchMechanicHours() {
  await Log("backend", "info", MODULE, "Fetching depot data from /depots …");

  const response = await axios.get(`${BASE_URL}/depots`, {
    headers: getAuthHeaders(),
  });

  const depots = response.data;
  await Log(
    "backend",
    "debug",
    MODULE,
    "Fetched depots data"
  );

  /*
   * The API may return a single depot object or an array.
   * We sum MechanicHours across all depots to get the total budget.
   */
  const rawDepots = depots.depots || depots;
  const depotsArray = Array.isArray(rawDepots) ? rawDepots : [rawDepots];
  const totalHours = depotsArray.reduce(
    (sum, d) => sum + (d.MechanicHours || d.mechanicHours || d.mechanic_hours || 0),
    0
  );

  await Log(
    "backend",
    "info",
    MODULE,
    `Total MechanicHours available: ${totalHours}`
  );

  return totalHours;
}

// ─── Step 2 : Fetch Vehicles ──────────────────────────────────────────────────

/**
 * Fetches the list of vehicles pending maintenance.
 * Normalises each entry to { id, name, duration, impact }.
 *
 * @returns {Promise<Array<{ id: string|number, name: string, duration: number, impact: number }>>}
 */
async function fetchVehicles() {
  await Log("backend", "info", MODULE, "Fetching vehicle list from /vehicles …");

  const response = await axios.get(`${BASE_URL}/vehicles`, {
    headers: getAuthHeaders(),
  });

  const raw = response.data;
  await Log(
    "backend",
    "debug",
    MODULE,
    "Fetched vehicles data"
  );

  const vehiclesArray = Array.isArray(raw) ? raw : [raw];

  // Normalise field names (API may use camelCase, PascalCase, or snake_case)
  const vehicles = vehiclesArray.map((v, idx) => ({
    id: v.id || v.vehicleId || v.vehicle_id || idx,
    name: v.name || v.vehicleName || v.vehicle_name || `Vehicle-${idx}`,
    duration:
      v.Duration || v.duration || v.MaintenanceDuration || v.maintenance_duration || 0,
    impact: v.Impact || v.impact || v.ImpactScore || v.impact_score || 0,
  }));

  await Log(
    "backend",
    "info",
    MODULE,
    `Total vehicles fetched: ${vehicles.length}`
  );

  return vehicles;
}

// ─── Step 3 : 0/1 Knapsack Algorithm ─────────────────────────────────────────

/**
 * Solves the 0/1 Knapsack problem using dynamic programming.
 *
 * Time complexity  : O(n × W) where n = number of items, W = capacity
 * Space complexity : O(n × W) for the DP table
 *
 * @param {number}   capacity  - Maximum mechanic hours (knapsack capacity W)
 * @param {number[]} durations - Duration of each vehicle's maintenance (weights)
 * @param {number[]} impacts   - Impact score of each vehicle (values)
 * @returns {{ maxImpact: number, selectedIndices: number[] }}
 */
function knapsack(capacity, durations, impacts) {
  const n = durations.length;

  /*
   * dp[i][w] = maximum impact achievable using vehicles 0..i-1
   *            within a budget of w mechanic hours.
   * We use integer capacity; if hours can be fractional, multiply
   * by a scaling factor before calling this function.
   */
  const W = Math.floor(capacity);
  const dp = Array.from({ length: n + 1 }, () => new Array(W + 1).fill(0));

  // Fill the DP table bottom-up
  for (let i = 1; i <= n; i++) {
    const weight = Math.floor(durations[i - 1]);
    const value = impacts[i - 1];

    for (let w = 0; w <= W; w++) {
      // Option A: skip vehicle i
      dp[i][w] = dp[i - 1][w];

      // Option B: include vehicle i (only if it fits)
      if (weight <= w) {
        const withItem = dp[i - 1][w - weight] + value;
        if (withItem > dp[i][w]) {
          dp[i][w] = withItem;
        }
      }
    }
  }

  // ── Backtrack to identify which vehicles were selected ──────────────────────
  const selectedIndices = [];
  let w = W;
  for (let i = n; i > 0; i--) {
    if (dp[i][w] !== dp[i - 1][w]) {
      // Vehicle i-1 (0-indexed) was included
      selectedIndices.push(i - 1);
      w -= Math.floor(durations[i - 1]);
    }
  }

  return { maxImpact: dp[n][W], selectedIndices: selectedIndices.reverse() };
}

// ─── Step 4 : Report Results ──────────────────────────────────────────────────

/**
 * Logs the optimal vehicle selection to the console and remote logger.
 *
 * @param {Array}  vehicles        - Full vehicle list
 * @param {number[]} selectedIndices - Indices of chosen vehicles
 * @param {number} maxImpact       - Total impact of the selected subset
 * @param {number} capacity        - Available mechanic hours
 */
async function reportResults(vehicles, selectedIndices, maxImpact, capacity) {
  const selected = selectedIndices.map((i) => vehicles[i]);
  const totalDuration = selected.reduce((sum, v) => sum + v.duration, 0);

  await Log(
    "backend",
    "info",
    MODULE,
    `Solved: Impact=${maxImpact} Hrs=${totalDuration}/${capacity}`
  );

  let output = "\n══════════════════════════════════════════════════\n";
  output += "  VEHICLE MAINTENANCE SCHEDULER – OPTIMAL PLAN\n";
  output += "══════════════════════════════════════════════════\n";
  output += `  Available Mechanic Hours : ${capacity}\n`;
  output += `  Vehicles Scheduled       : ${selected.length}\n`;
  output += `  Total Duration Used      : ${totalDuration} hrs\n`;
  output += `  Total Impact Achieved    : ${maxImpact}\n`;
  output += "──────────────────────────────────────────────────\n";

  selected.forEach((v, rank) => {
    output += `  [${rank + 1}] ${v.name.padEnd(20)} | Duration: ${String(v.duration).padStart(3)} hrs | Impact: ${v.impact}\n`;
  });

  output += "══════════════════════════════════════════════════\n";
  
  await Log("backend", "info", MODULE, output);

  // Log the full selected set as a structured entry
  await Log(
    "backend",
    "info",
    MODULE,
    `Selected ${selected.length} vehicles`
  );

  return selected;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Orchestrates the complete scheduling pipeline.
 *
 * @returns {Promise<Array>} The optimal list of vehicles to service
 */
async function main() {
  await Log("backend", "info", MODULE, "=== Scheduler started ===");

  try {
    // 1. Fetch mechanic-hours budget from depots
    const capacity = await fetchMechanicHours();
    if (capacity <= 0) {
      await Log("backend", "warn", MODULE, "MechanicHours is 0 or missing. Aborting.");
      return [];
    }

    // 2. Fetch vehicles
    const vehicles = await fetchVehicles();
    if (vehicles.length === 0) {
      await Log("backend", "warn", MODULE, "No vehicles found. Nothing to schedule.");
      return [];
    }

    // 3. Solve 0/1 Knapsack
    await Log("backend", "info", MODULE, `Running knapsack cap=${capacity} n=${vehicles.length}`);

    const durations = vehicles.map((v) => v.duration);
    const impacts = vehicles.map((v) => v.impact);
    const { maxImpact, selectedIndices } = knapsack(capacity, durations, impacts);

    // 4. Report
    const optimal = await reportResults(vehicles, selectedIndices, maxImpact, capacity);

    await Log("backend", "info", MODULE, "=== Scheduler completed ===");
    return optimal;
  } catch (error) {
    const reason = error.response
      ? `HTTP ${error.response.status} – ${JSON.stringify(error.response.data)}`
      : error.message;

    await Log("backend", "error", MODULE, `Scheduler failed: ${reason}`);
    await Log("backend", "error", MODULE, `[ERROR] ${reason}`);
    process.exit(1);
  }
}

// Run when invoked directly
if (require.main === module) {
  main();
}

// Export for testing or composition
module.exports = { fetchMechanicHours, fetchVehicles, knapsack, main };
