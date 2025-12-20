const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const CryptoJS = require("crypto-js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 5678;

/* ========== CONFIG ========== */
const API_KEY = "C-SINT";
const DEVELOPER = "@C-SINTOFFICIALS";

const GEMINI_API_KEY = "AIzaSyDpG1sW70KrFOgaxtPbhTkykzan4g_KDfk";
const ENCRYPTION_KEY = "nic@impds#dedup05613";
const USERNAME = "dsojpnagar@gmail.com";
const PASSWORD = "CHCAEsoK";

const BASE_URL = "https://impds.nic.in/impdsdeduplication";
/* ============================ */

// Gemini init
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// session
let JSESSIONID = null;
let lastLogin = 0;

// axios instance
const client = axios.create({
  timeout: 60000,
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

/* ========== HELPERS ========== */
const sha512 = (t) =>
  CryptoJS.SHA512(t).toString(CryptoJS.enc.Hex);

const encryptAadhaar = (t) =>
  CryptoJS.AES.encrypt(t, ENCRYPTION_KEY).toString();
/* ============================ */

/* ========== API KEY CHECK ========== */
app.use((req, res, next) => {
  if (req.query.key !== API_KEY) {
    return res.status(401).json({
      success: false,
      message: "Invalid or missing API key",
      developer: DEVELOPER
    });
  }
  next();
});
/* ================================= */

/* ========== LOGIN ========== */
async function login() {
  const page = await client.get(`${BASE_URL}/LoginPage`);
  const cookies = page.headers["set-cookie"] || [];
  const cookieStr = cookies.map(c => c.split(";")[0]).join("; ");

  const $ = cheerio.load(page.data);
  const csrf = $('input[name="REQ_CSRF_TOKEN"]').val();
  const script = $("script").text();
  const saltMatch = script.match(/USER_SALT\s*=\s*'([^']+)'/);
  const salt = saltMatch ? saltMatch[1] : null;

  if (!csrf || !salt) throw new Error("CSRF/SALT missing");

  const cap = await client.post(
    `${BASE_URL}/ReloadCaptcha`,
    {},
    { headers: { Cookie: cookieStr } }
  );

  const img = cap.data.captchaBase64;

  const ai = await model.generateContent([
    "Return ONLY captcha text in uppercase",
    { inlineData: { data: img, mimeType: "image/png" } }
  ]);

  const captcha = ai.response.text()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  const hashed =
    sha512(sha512(salt) + sha512(PASSWORD));

  const form = new URLSearchParams();
  form.append("userName", USERNAME);
  form.append("password", hashed);
  form.append("captcha", captcha);
  form.append("REQ_CSRF_TOKEN", csrf);

  const auth = await client.post(
    `${BASE_URL}/UserLogin`,
    form,
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieStr
      }
    }
  );

  if (auth.data?.athenticationError) {
    throw new Error("Captcha failed");
  }

  const finalCookies = auth.headers["set-cookie"] || cookies;
  const js = finalCookies.find(c => c.includes("JSESSIONID"));
  JSESSIONID = js.split(";")[0].split("=")[1];
  lastLogin = Date.now();
}

async function ensureLogin() {
  if (!JSESSIONID || Date.now() - lastLogin > 25 * 60 * 1000) {
    await login();
  }
}
/* ============================= */

/* ========== MAIN API ========== */
app.get("/", async (req, res) => {
  const { aadhaar, ration } = req.query;

  if (!aadhaar && !ration) {
    return res.json({
      success: false,
      message: "Use ?key=C-SINT&aadhaar=XXXX or ?ration=XXXX",
      developer: DEVELOPER
    });
  }

  try {
    await ensureLogin();

    const form = new URLSearchParams();
    if (aadhaar) {
      form.append("search", "A");
      form.append("aadhar", encryptAadhaar(aadhaar));
    } else {
      form.append("search", "R");
      form.append("rcNo", ration);
    }

    const resp = await client.post(
      `${BASE_URL}/search`,
      form,
      {
        headers: {
          Cookie: `JSESSIONID=${JSESSIONID}`,
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    const $ = cheerio.load(resp.data);
    const data = [];

    $("table.table-striped tbody tr").each((_, r) => {
      const t = $(r).find("td");
      if (t.length >= 7) {
        const rawDistrict = t.eq(2).text().trim();
        const rawName = t.eq(6).text().trim();

        const cleanName = rawName.replace(/[0-9]/g, "").trim();

        data.push({
          district: rawDistrict,
          memberName: cleanName
        });
      }
    });

    if (data.length === 0) {
      return res.json({
        success: false,
        message: "No info found",
        developer: DEVELOPER
      });
    }

    res.json({
      success: true,
      count: data.length,
      developer: DEVELOPER,
      data
    });

  } catch (e) {
    res.status(500).json({
      success: false,
      message: "No info found",
      developer: DEVELOPER
    });
  }
});
/* ============================= */

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
