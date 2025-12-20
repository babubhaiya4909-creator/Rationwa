const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 5678;

/* ========= CONFIG ========= */
const API_KEY = "C-SINTMAIN";
const DEVELOPER = "@C-SINT";
const BASE_URL = "https://impds.nic.in/impdsdeduplication";
/* ========================== */

const client = axios.create({
  timeout: 60000,
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

/* ========= API KEY CHECK ========= */
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
/* ================================ */

/* ========= MAIN API ========= */
app.get("/", async (req, res) => {
  const { ration } = req.query;

  if (!ration) {
    return res.json({
      success: false,
      message: "Use ?key=C-SINT&ration=XXXX",
      developer: DEVELOPER
    });
  }

  try {
    // 🔹 MAIN SOURCE REQUEST
    const response = await client.get(`${BASE_URL}/search`);
    const $ = cheerio.load(response.data);

    const data = [];

    // 🔹 DIRECT CLEANING (NO RAW STORAGE)
    $("table.table-striped tbody tr").each((_, row) => {
      const td = $(row).find("td");
      if (td.length >= 7) {
        data.push({
          state: td.eq(1).text().trim(),
          district: td.eq(2).text().trim(),
          memberName: td.eq(6).text().trim()
        });
      }
    });

    // 🔴 NO INFO FOUND CASE
    if (data.length === 0) {
      return res.json({
        success: false,
        message: "No info found",
        developer: DEVELOPER
      });
    }

    // ✅ SUCCESS RESPONSE
    return res.json({
      success: true,
      count: data.length,
      developer: DEVELOPER,
      data
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "No info found",
      developer: DEVELOPER
    });
  }
});
/* ============================== */

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
