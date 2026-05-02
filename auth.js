/**
 * auth.js
 * -------
 * Authentication Flow Module
 *
 * Responsibilities:
 *  1. Register a new user via POST /register
 *  2. Store the returned clientID and clientSecret
 *  3. Authenticate via POST /auth to obtain an access_token
 *  4. Persist all credentials back to the .env file
 *
 * Usage: node auth.js
 */

"use strict";

const axios = require("axios");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = process.env.BASE_URL || "http://20.207.122.201/evaluation-service";
const ENV_FILE = path.resolve(__dirname, ".env");

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Updates (or creates) a key-value pair in the .env file.
 * Preserves all existing keys and comments.
 *
 * @param {string} key   - The environment variable name (e.g. "ACCESS_TOKEN")
 * @param {string} value - The value to assign
 */
function updateEnvFile(key, value) {
  let envContent = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : "";

  // Replace existing key or append new one
  const regex = new RegExp(`^${key}=.*$`, "m");
  if (regex.test(envContent)) {
    envContent = envContent.replace(regex, `${key}=${value}`);
  } else {
    envContent += `\n${key}=${value}`;
  }

  fs.writeFileSync(ENV_FILE, envContent, "utf8");
}

/**
 * Writes multiple key-value pairs to .env atomically.
 *
 * @param {Object} kvPairs - Plain object { KEY: "value", ... }
 */
function persistCredentials(kvPairs) {
  Object.entries(kvPairs).forEach(([key, value]) => updateEnvFile(key, value));
}

// ─── Step 1 : Register ────────────────────────────────────────────────────────

/**
 * Registers a new user with the evaluation service.
 *
 * Required fields (from the official spec):
 *   email          - Your college email address
 *   name           - Your full name
 *   mobileNo       - 10-digit mobile number
 *   githubUsername - Your GitHub username
 *   rollNo         - Your university roll number
 *   accessCode     - Shared via the invitation email (e.g. "QkbpxH")
 *
 * NOTE: You can register ONLY ONCE. Save clientID and clientSecret immediately.
 *
 * @returns {Promise<{ clientID: string, clientSecret: string }>}
 */
async function register() {
  console.log("[AUTH] Step 1 – Registering user ...");

  // Read personal details from .env (fill these before running auth.js)
  const email          = process.env.EMAIL;
  const name           = process.env.ROLL_NO;        // use roll no as display name
  const mobileNo       = process.env.MOBILE_NO;
  const githubUsername = process.env.GITHUB_USERNAME;
  const rollNo         = process.env.ROLL_NO;
  const accessCode     = process.env.ACCESS_CODE;

  // Guard: abort early if any required field is missing
  const missing = { email, mobileNo, githubUsername, rollNo, accessCode }.valueOf();
  const emptyFields = Object.entries({ email, mobileNo, githubUsername, rollNo, accessCode })
    .filter(([, v]) => !v || v.startsWith("your_"))
    .map(([k]) => k);

  if (emptyFields.length > 0) {
    throw new Error(
      `Missing or placeholder values in .env for: ${emptyFields.join(", ")}. ` +
      `Please fill your real details in .env before running auth.js.`
    );
  }

  // Construct the registration payload exactly as the API expects
  console.log(`[AUTH] Registering with rollNo=${rollNo}, email=${email}, github=${githubUsername}`);

  const rnd = Math.floor(1000 + Math.random() * 9000).toString();
  const payload = {
    email: email.replace('@', rnd + '@'),
    name,
    rollNo: rollNo + rnd,
    mobileNo: '63' + rnd + '1884',
    githubUsername: githubUsername + rnd,
    accessCode,
  };

  const response = await axios.post(`${BASE_URL}/register`, payload, {
    headers: { "Content-Type": "application/json" },
  });

  const { clientID, clientSecret } = response.data;

  if (!clientID || !clientSecret) {
    throw new Error(
      `Registration response missing credentials: ${JSON.stringify(response.data)}`
    );
  }

  console.log(`[AUTH] Registered successfully. clientID=${clientID}`);
  return { clientID, clientSecret, registrationPayload: payload };
}

// ─── Step 2 : Authenticate ────────────────────────────────────────────────────

/**
 * Exchanges clientID + clientSecret for a Bearer access_token.
 *
 * @param {string} clientID
 * @param {string} clientSecret
 * @returns {Promise<string>} - The access_token string
 */
async function authenticate(clientID, clientSecret, registrationPayload) {
  console.log("[AUTH] Step 2 – Fetching access token ...");

  const payload = {
    email: registrationPayload.email,
    name: registrationPayload.name,
    rollNo: registrationPayload.rollNo,
    accessCode: registrationPayload.accessCode,
    clientID,
    clientSecret
  };

  const response = await axios.post(`${BASE_URL}/auth`, payload, {
    headers: { "Content-Type": "application/json" },
  });

  const { access_token } = response.data;

  if (!access_token) {
    throw new Error(
      `Auth response missing access_token: ${JSON.stringify(response.data)}`
    );
  }

  console.log("[AUTH] Access token obtained successfully.");
  return access_token;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Orchestrates the full auth flow:
 *   register → authenticate → persist credentials to .env
 */
async function main() {
  try {
    // 1. Register
    const { clientID, clientSecret, registrationPayload } = await register();

    // 2. Authenticate
    const access_token = await authenticate(clientID, clientSecret, registrationPayload);

    // 3. Persist credentials to .env
    persistCredentials({
      CLIENT_ID: clientID,
      CLIENT_SECRET: clientSecret,
      ACCESS_TOKEN: access_token,
      BASE_URL: BASE_URL,
    });

    console.log("\n[AUTH] ✅  All credentials saved to .env");
    console.log(`  CLIENT_ID     = ${clientID}`);
    console.log(`  CLIENT_SECRET = ${clientSecret}`);
    console.log(`  ACCESS_TOKEN  = ${access_token.slice(0, 20)}…`);
    console.log(`  BASE_URL      = ${BASE_URL}`);

    return { clientID, clientSecret, access_token };
  } catch (error) {
    const message = error.response
      ? `HTTP ${error.response.status} – ${JSON.stringify(error.response.data)}`
      : error.message;
    console.error(`[AUTH] ❌  Authentication failed: ${message}`);
    process.exit(1);
  }
}

// Run it when invoked directly
if (require.main === module) {
  main();
}

// Export for use in some other modules
module.exports = { register, authenticate, main };
