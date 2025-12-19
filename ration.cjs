const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const CryptoJS = require("crypto-js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const https = require("https");

const app = express();

/* ================= CONFIG ================= */
const PORT = process.env.PORT || 5678;

const ENCRYPTION_KEY = "nic@impds#dedup05613";
const GEMINI_API_KEY = "AIzaSyA6mmQbiqGqt3KcYRx2bPJ4k0C0Cg5NU7c";
const IMPDS_PASSWORD = "CHCAEsoK";
const USERNAME = "dsojpnagar@gmail.com";

const BASE_URL = "https://impds.nic.in/impdsdeduplication";
/* ========================================== */

// Gemini
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// Session
let currentJSESSIONID = null;
let sessionLastUpdated = null;

// Axios
const axiosInstance = axios.create({
  withCredentials: true,
  httpsAgent: new https.Agent({
    rejectUnauthorized: false,
    keepAlive: true
  }),
  headers: {
    "User-Agent": "Mozilla/5.0",
    "Accept": "text/html,application/xhtml+xml,*/*",
    "Accept-Language": "en-IN,en;q=0.9"
  }
});

/* =============== HELPERS ================= */
function encryptAadhaar(text) {
  return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString();
}

function sha512(text) {
  return CryptoJS.SHA512(text).toString(CryptoJS.enc.Hex);
}
/* ======================================== */

async function performLogin(retry = 0) {
  const maxRetries = 8;

  const loginPage = await axiosInstance.get(`${BASE_URL}/LoginPage`);
  const cookies = loginPage.headers["set-cookie"] || [];
  const cookieString = cookies.map(c => c.split(";")[0]).join("; ");

  const $ = cheerio.load(loginPage.data);
  const csrfToken = $('input[name="REQ_CSRF_TOKEN"]').val();

  const script = $("script").text();
  const saltMatch = script.match(/USER_SALT\s*=\s*'([^']+)'/);
  const userSalt = saltMatch ? saltMatch[1] : null;

  if (!csrfToken || !userSalt) {
    throw new Error("Salt / CSRF missing");
  }

  const captchaRes = await axiosInstance.post(
    `${BASE_URL}/ReloadCaptcha`,
    {},
    { headers: { Cookie: cookieString } }
  );

  const captchaBase64 = captchaRes.data.captchaBase64;

  const result = await model.generateContent([
    "Read captcha and return ONLY 6 uppercase alphanumeric characters",
    { inlineData: { data: captchaBase64, mimeType: "image/png" } }
  ]);

  const captchaText = result.response
    .text()
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  const saltedPassword =
    sha512(sha512(userSalt) + sha512(IMPDS_PASSWORD));

  const params = new URLSearchParams();
  params.append("userName", USERNAME);
  params.append("password", saltedPassword);
  params.append("captcha", captchaText);
  params.append("REQ_CSRF_TOKEN", csrfToken);

  const auth = await axiosInstance.post(
    `${BASE_URL}/UserLogin`,
    params,
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieString
      }
    }
  );

  if (auth.data?.athenticationError) {
    if (retry < maxRetries) {
      return performLogin(retry + 1);
    }
    throw new Error("Captcha retries exceeded");
  }

  const finalCookies = auth.headers["set-cookie"] || cookies;
  const jsess = finalCookies.find(c => c.includes("JSESSIONID"));

  currentJSESSIONID = jsess.split(";")[0].split("=")[1];
  sessionLastUpdated = Date.now();
}

async function ensureSession() {
  if (
    !currentJSESSIONID ||
    Date.now() - sessionLastUpdated > 30 * 60 * 1000
  ) {
    await performLogin();
  }
}

/* ================= API ================== */
app.get("/", async (req, res) => {
  const { aadhaar, ration } = req.query;

  if (!aadhaar && !ration) {
    return res.json({
      success: false,
      error: "Use ?aadhaar= or ?ration="
    });
  }

  try {
    await ensureSession();

    const params = new URLSearchParams();

    if (aadhaar) {
      params.append("search", "A");
      params.append("aadhar", encryptAadhaar(aadhaar));
    } else {
      params.append("search", "R");
      params.append("rcNo", ration);
    }

    const response = await axiosInstance.post(
      `${BASE_URL}/search`,
      params,
      {
        headers: {
          Cookie: `JSESSIONID=${currentJSESSIONID}; PDS_SESSION_ID=${currentJSESSIONID}`,
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    const $ = cheerio.load(response.data);
    const data = [];

    $("table.table-striped tbody tr").each((_, row) => {
      const td = $(row).find("td");
      if (td.length >= 7) {
        data.push({
          state: td.eq(1).text().trim(),
          district: td.eq(2).text().trim(),
          rationCard: td.eq(3).text().trim(),
          memberId: td.eq(5).text().trim(),
          memberName: td.eq(6).text().trim()
        });
      }
    });

    res.json({ success: true, count: data.length, data });

  } catch (e) {
    res.status(500).json({ success: false, error: "Request failed" });
  }
});

/* ============== SERVER ================= */
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
