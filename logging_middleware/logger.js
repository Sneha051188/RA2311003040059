"use strict";

const axios = require("axios");
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const BASE_URL = process.env.BASE_URL || "http://20.207.122.201/evaluation-service";
const LOGS_ENDPOINT = `${BASE_URL}/logs`;

/** Accepted values for the stack field */
const VALID_STACKS = new Set(["backend", "frontend"]);

/** Accepted values for the level field */
const VALID_LEVELS = new Set(["debug", "info", "warn", "error", "fatal"]);

// ─── Core Function ────────────────────────────────────────────────────────────

/**
 * Sends a structured log entry to the remote logging service.
 *
 * @param {string} stack   - Layer originating the log: "backend" | "frontend"
 * @param {string} level   - Severity: "debug" | "info" | "warn" | "error" | "fatal"
 * @param {string} pkg     - Package/module name for context (e.g. "vehicle_maintenance")
 * @param {string} message - Human-readable description of the event
 * @returns {Promise<void>}
 */
async function Log(stack, level, pkg, message) {

  if (!VALID_STACKS.has(stack)) {
    console.warn(
      `[LOGGER] Invalid stack "${stack}". Must be one of: ${[...VALID_STACKS].join(", ")}`
    );
  }
  if (!VALID_LEVELS.has(level)) {
    console.warn(
      `[LOGGER] Invalid level "${level}". Must be one of: ${[...VALID_LEVELS].join(", ")}`
    );
  }

  const localPrefix = `[${level.toUpperCase()}][${stack}][${pkg}]`;
  console.log(`${localPrefix} ${message}`);

  const token = process.env.ACCESS_TOKEN;
  if (!token) {
    console.warn(
      "[LOGGER] ACCESS_TOKEN is not set. Remote log skipped. Run auth.js first."
    );
    return;
  }

  const payload = {
    stack,
    level,
    package: pkg,
    message,
  };

  try {
    await axios.post(LOGS_ENDPOINT, payload, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      timeout: 5000,
    });
  } catch (error) {
    const reason = error.response
      ? `HTTP ${error.response.status} – ${JSON.stringify(error.response.data)}`
      : error.message;
    console.warn(`[LOGGER] ⚠️  Failed to send remote log: ${reason}`);
  }
}

module.exports = { Log };
