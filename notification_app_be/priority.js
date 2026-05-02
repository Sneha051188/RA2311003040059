/**
 * notification_app_be/priority.js
 * --------------------------------
 * Notification Priority System
 *
 * Goal:
 *   Return the top 10 highest-priority notifications from a pool
 *   using a composite Priority Score:
 *
 *     Priority = TypeWeight + RecencyScore
 *
 * Type Weights (descending):
 *   Placement > Result > Event
 *   Placement = 30, Result = 20, Event = 10
 *   (Unknown types default to 0)
 *
 * Recency Score:
 *   Derived from the ISO-8601 timestamp.
 *   Newer notifications receive a higher score.
 *   Score = timestamp converted to Unix epoch milliseconds.
 *   The sort is purely descending on the combined Priority value.
 *
 * Usage: node notification_app_be/priority.js
 */

"use strict";

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const axios = require("axios");
const { Log } = require("../logging_middleware/logger");

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = process.env.BASE_URL || "http://20.207.122.201/evaluation-service";
const MODULE = "auth";

/**
 * Type weights — higher value = higher priority.
 * Placement outranks Result which outranks Event.
 */
const TYPE_WEIGHTS = {
  Placement: 30,
  placement: 30,
  Result: 20,
  result: 20,
  Event: 10,
  event: 10,
};

// ─── Auth Headers ─────────────────────────────────────────────────────────────

/**
 * Returns authorised request headers.
 * @returns {{ Authorization: string, "Content-Type": string }}
 */
function getAuthHeaders() {
  const token = process.env.ACCESS_TOKEN;
  if (!token) throw new Error("ACCESS_TOKEN not set. Run auth.js first.");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

// ─── Core Logic ───────────────────────────────────────────────────────────────

/**
 * Calculates the composite priority score for a single notification.
 *
 * Priority = TypeWeight + RecencyScore
 *
 * RecencyScore is the Unix timestamp in milliseconds of the notification's
 * createdAt field. Newer notifications naturally have a larger epoch value
 * and therefore a higher recency score.
 *
 * @param {{ type: string, timestamp: string }} notification
 * @returns {number} Combined priority score
 */
function computePriority(notification) {
  // ── Type Weight ────────────────────────────────────────────────────────────
  const typeKey =
    notification.type ||
    notification.notificationType ||
    notification.notification_type ||
    "";
  const weight = TYPE_WEIGHTS[typeKey] ?? 0;

  // ── Recency Score ──────────────────────────────────────────────────────────
  const rawTimestamp =
    notification.timestamp ||
    notification.createdAt ||
    notification.created_at ||
    notification.date ||
    null;

  let recency = 0;
  if (rawTimestamp) {
    const epoch = new Date(rawTimestamp).getTime();
    // Normalise to seconds to keep numbers manageable alongside weights
    recency = isNaN(epoch) ? 0 : Math.floor(epoch / 1000);
  }

  return weight + recency;
}

/**
 * Fetches all notifications from the evaluation service.
 *
 * @returns {Promise<Array>} Raw notification objects
 */
async function fetchNotifications() {
  await Log("backend", "info", MODULE, "Fetching notifications");

  const response = await axios.get(`${BASE_URL}/notifications`, {
    headers: getAuthHeaders(),
  });

  const raw = response.data;
  const rawArray = raw.notifications || raw;
  const notificationsArray = Array.isArray(rawArray) ? rawArray : [rawArray];

  const list = notificationsArray.map((n, idx) => ({
    id: n.ID || n.id || n.notificationId || idx,
    type: n.Type || n.type || "Unknown",
    message: n.Message || n.message || "(no message)",
    timestamp: n.Timestamp || n.timestamp || Date.now(),
  }));

  await Log(
    "backend",
    "info",
    MODULE,
    `Total received: ${list.length}`
  );

  return list;
}

/**
 * Ranks notifications by priority and returns the top N.
 *
 * Uses an in-place sort (O(n log n)) which is efficient for typical
 * notification volumes. For very large datasets, a min-heap of size N
 * would give O(n log N) — see system design doc for details.
 *
 * @param {Array}  notifications - Raw notification objects
 * @param {number} [topN=10]     - How many to return
 * @returns {Array} Top N notifications with an added `priorityScore` field
 */
function rankNotifications(notifications, topN = 10) {
  // Attach computed priority to each item
  const scored = notifications.map((n) => ({
    ...n,
    priorityScore: computePriority(n),
  }));

  // Sort descending by priority score
  scored.sort((a, b) => b.priorityScore - a.priorityScore);

  // Return top N
  return scored.slice(0, topN);
}

// ─── Display Helper ───────────────────────────────────────────────────────────

/**
 * Pretty-prints the top notifications to stdout.
 *
 * @param {Array} topNotifications
 */
async function displayResults(topNotifications) {
  let output = "\n══════════════════════════════════════════════════════════\n";
  output += "  TOP 10 NOTIFICATIONS BY PRIORITY\n";
  output += "══════════════════════════════════════════════════════════\n";
  output += "  Rank  Type         Score          Message\n";
  output += "──────────────────────────────────────────────────────────\n";

  topNotifications.forEach((n, idx) => {
    const rank = String(idx + 1).padEnd(4);
    const type = n.type.padEnd(12);
    const score = String(Math.round(n.priorityScore)).padEnd(14);
    const msg = n.message.length > 30 ? n.message.substring(0, 27) + "..." : n.message;
    output += `  ${rank}  ${type} ${score} ${msg}\n`;
  });

  output += "══════════════════════════════════════════════════════════\n";
  await Log("backend", "info", MODULE, output);

  await Log(
    "backend",
    "info",
    MODULE,
    `Top 10 computed. Max score: ${topNotifications.length > 0 ? topNotifications[0].priorityScore : 0}`
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * End-to-end pipeline:
 *   1. Fetch notifications from API
 *   2. Score and rank by priority
 *   3. Return and display top 10
 *
 * @returns {Promise<Array>} The top 10 prioritised notifications
 */
async function main() {
  await Log("backend", "info", MODULE, "=== Priority System started ===");

  try {
    // 1. Fetch
    const notifications = await fetchNotifications();

    if (notifications.length === 0) {
      await Log("backend", "warn", MODULE, "No notifications found.");
      return [];
    }

    // 2. Rank
    await Log("backend", "info", MODULE, "Computing priority scores …");
    const top10 = rankNotifications(notifications, 10);

    // 3. Display
    await displayResults(top10);

    await Log("backend", "info", MODULE, "=== Priority System completed ===");
    return top10;
  } catch (error) {
    const reason = error.response
      ? `HTTP ${error.response.status} – ${JSON.stringify(error.response.data)}`
      : error.message;

    await Log("backend", "error", MODULE, `Priority system failed: ${reason}`);
    await Log("backend", "error", MODULE, `[ERROR] ${reason}`);
    process.exit(1);
  }
}

// Run when invoked directly
if (require.main === module) {
  main();
}

// Export for testing or pipeline composition
module.exports = { computePriority, rankNotifications, fetchNotifications, main };
