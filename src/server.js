const express = require("express");
const path = require("path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const {
  db,
  initDb,
  queueSupabaseSync,
  ensureSyncComplete,
  checkPostgresConnection,
  deleteUserAndRelatedRecords,
  BREAD_TYPES,
  INGREDIENT_STOCK_META,
  THRESHOLD,
  getSeverity,
  maybeRecordDiscrepancy,
  toDateBounds,
  getDailyTotalsByBread,
  pgPool,
  pgDirectInsert,
  pgDirectDelete,
  pgDirectUpdate,
} = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const IS_VERCEL = Boolean(process.env.VERCEL);
const JWT_SECRET = process.env.JWT_SECRET || "bakery_control_secret_change_me";
const ADMIN_ACCESS_CODE = process.env.ADMIN_ACCESS_CODE || "BIGCAT00";
const ALERT_EMAIL_TO = process.env.ALERT_EMAIL_TO || "";

const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && ALERT_EMAIL_TO);
const alertTransport = smtpConfigured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number.isFinite(smtpPort) ? smtpPort : 587,
      secure: smtpPort === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })
  : null;

const dbReady = initDb().catch((error) => {
  console.error("Database initialization failed:", error);
  throw error;
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public"), {
  setHeaders(res, filePath) {
    if (filePath.endsWith(".js") || filePath.endsWith(".css")) {
      res.setHeader("Cache-Control", "no-store");
    }
  },
}));

app.use(async (_req, _res, next) => {
  try {
    await dbReady;
    next();
  } catch (error) {
    next(error);
  }
});

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

function authRequired(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function roleRequired(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

function validateBreadType(breadType) {
  return Object.prototype.hasOwnProperty.call(BREAD_TYPES, breadType);
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

const INGREDIENT_BASELINE_PER_50KG = {
  sugar: 7,
  salt: 1,
  preservative: 300,
  butter: 1,
  softener: 50,
  improva: 50,
};

function severityRank(severity) {
  if (severity === "critical") return 2;
  if (severity === "warning") return 1;
  return 0;
}

function analyzeIngredientDiscrepancy(flourKg, ingredients) {
  if (!Number.isFinite(flourKg) || flourKg <= 0) {
    return { severity: null, flagged: false, details: [] };
  }

  const multiplier = flourKg / 50;
  const details = Object.entries(INGREDIENT_BASELINE_PER_50KG).map(([key, base]) => {
    const expected = base * multiplier;
    const actual = Number(ingredients[key] || 0);
    const delta = actual - expected;
    const pct = expected > 0 ? Math.abs(delta) / expected : 0;
    let severity = null;
    if (pct > 0.2) severity = "critical";
    else if (pct > 0.1) severity = "warning";
    return { key, expected, actual, delta, pct, severity };
  });

  const maxRank = Math.max(...details.map((x) => severityRank(x.severity)), 0);
  const severity = maxRank === 2 ? "critical" : maxRank === 1 ? "warning" : null;
  return {
    severity,
    flagged: Boolean(severity),
    details: details.filter((x) => x.severity),
  };
}

function stockStatus(quantity, warningLevel, criticalLevel) {
  if (quantity <= criticalLevel) return "critical";
  if (quantity <= warningLevel) return "warning";
  return "ok";
}

function recordIngredientUsage({ ingredient, usedAmount, reason, sourceType, sourceId, actorUserId }) {
  if (!Number.isFinite(usedAmount) || usedAmount <= 0) return null;

  const current = db
    .prepare("SELECT id, quantity, unit, warning_level, critical_level FROM ingredient_stock WHERE ingredient = ?")
    .get(ingredient);
  if (!current) return null;

  const nextQuantity = Number(current.quantity || 0) - usedAmount;
  db.prepare("UPDATE ingredient_stock SET quantity = ?, updated_at = datetime('now') WHERE id = ?").run(
    nextQuantity,
    current.id
  );
  db.prepare(
    `INSERT INTO ingredient_stock_movements
     (ingredient, change_amount, quantity_after, unit, reason, source_type, source_id, actor_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    ingredient,
    -usedAmount,
    nextQuantity,
    current.unit,
    reason,
    sourceType || null,
    sourceId || null,
    actorUserId || null
  );

  if (pgPool) {
    pgPool
      .query(
        `UPDATE ingredient_stock
         SET quantity = quantity - $1, updated_at = NOW()
         WHERE ingredient = $2
         RETURNING quantity, unit`,
        [usedAmount, ingredient]
      )
      .then((result) => {
        const row = result.rows[0];
        if (!row) return;
        return pgPool.query(
          `INSERT INTO ingredient_stock_movements
           (ingredient, change_amount, quantity_after, unit, reason, source_type, source_id, actor_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [ingredient, -usedAmount, row.quantity, row.unit, reason, sourceType || null, sourceId || null, actorUserId || null]
        );
      })
      .catch((err) => console.error("PG ingredient stock usage update failed:", err.message));
  }

  return {
    ingredient,
    used: usedAmount,
    remaining: nextQuantity,
    unit: current.unit,
    status: stockStatus(nextQuantity, Number(current.warning_level || 0), Number(current.critical_level || 0)),
  };
}

function createStaffUsernameFromPhone(normalizedPhone) {
  // Use full normalized phone to avoid collisions across different numbers.
  return `staff_${normalizedPhone}`;
}

function normalizePhoneInput(phone) {
  return String(phone || "")
    .replace(/[\s\-\+\(\)]/g, "")
    .replace(/^234/, "0");
}

function createUserSafe(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
  };
}

async function loadAdminUser() {
  const lookups = [];

  if (pgPool) {
    lookups.push(
      pgPool
        .query("SELECT id, name, email, phone, role FROM users WHERE role = 'admin' LIMIT 1")
        .then((result) => result.rows[0] || null)
    );
  }

  lookups.push(
    Promise.resolve(
      db.prepare("SELECT id, name, email, phone, role FROM users WHERE role = 'admin' LIMIT 1").get()
    )
  );

  const results = await Promise.allSettled(lookups);
  const admin = results.find((result) => result.status === "fulfilled" && result.value);
  return admin ? admin.value : null;
}

async function loadStaffUserByPhone(normalizedPhone) {
  const lookups = [];

  if (pgPool) {
    lookups.push(
      pgPool
        .query(
          "SELECT id, name, email, phone, username, role, password_hash FROM users WHERE phone = $1 LIMIT 1",
          [normalizedPhone]
        )
        .then((result) => result.rows[0] || null)
    );
  }

  lookups.push(
    Promise.resolve(
      db
        .prepare("SELECT id, name, email, phone, username, role, password_hash FROM users WHERE phone = ?")
        .get(normalizedPhone)
    )
  );

  const results = await Promise.allSettled(lookups);
  const user = results.find((result) => result.status === "fulfilled" && result.value);
  return user ? user.value : null;
}

function toCsvCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function rowsToCsv(headers, rows) {
  const head = headers.map((h) => toCsvCell(h)).join(",");
  const lines = rows.map((row) => row.map((value) => toCsvCell(value)).join(","));
  return `${[head, ...lines].join("\n")}\n`;
}

function maybeSendCriticalAlertEmail(payload) {
  if (!alertTransport || payload?.severity !== "critical") {
    return;
  }

  const occurredAt = payload.createdAt || new Date().toISOString();
  const subject = `CRITICAL ALERT: ${payload.stage} discrepancy (${payload.breadType})`;
  const text = [
    "BigCat Bakery Critical Discrepancy Alert",
    "",
    `Stage: ${payload.stage}`,
    `Bread Type: ${payload.breadType}`,
    `Difference: ${payload.difference}`,
    `Severity: ${payload.severity}`,
    `Staff: ${payload.staffName || "Unknown"} (${payload.staffRole || "unknown"})`,
    `Time: ${occurredAt}`,
  ].join("\n");

  alertTransport
    .sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: ALERT_EMAIL_TO,
      subject,
      text,
    })
    .catch((error) => {
      console.error("Critical alert email failed:", error.message);
    });
}

function computeFinancialSummary(dateText) {
  const date = dateText || new Date().toISOString().slice(0, 10);
  const totals = getDailyTotalsByBread(date);

  const byBreadType = totals.map((row) => {
    const unitPrice = BREAD_TYPES[row.breadType].price;
    const missingBreads =
      Math.max(0, row.produced - row.bagged) +
      Math.max(0, row.bagged - row.sold) +
      Math.max(0, row.sold - row.delivered);

    const grossSalesValue = row.sold * unitPrice;
    const deliveredValue = row.delivered * unitPrice;
    const financialLoss = missingBreads * unitPrice;
    const netAfterLoss = grossSalesValue - financialLoss;

    return {
      breadType: row.breadType,
      unitPrice,
      produced: row.produced,
      bagged: row.bagged,
      sold: row.sold,
      delivered: row.delivered,
      grossSalesValue,
      deliveredValue,
      missingBreads,
      financialLoss,
      netAfterLoss,
    };
  });

  const totalsSummary = byBreadType.reduce(
    (acc, row) => {
      acc.totalProduced += row.produced;
      acc.totalSold += row.sold;
      acc.totalDelivered += row.delivered;
      acc.totalGrossSalesValue += row.grossSalesValue;
      acc.totalDeliveredValue += row.deliveredValue;
      acc.totalMissingBreads += row.missingBreads;
      acc.totalFinancialLoss += row.financialLoss;
      acc.netRevenueAfterLoss += row.netAfterLoss;
      return acc;
    },
    {
      totalProduced: 0,
      totalSold: 0,
      totalDelivered: 0,
      totalGrossSalesValue: 0,
      totalDeliveredValue: 0,
      totalMissingBreads: 0,
      totalFinancialLoss: 0,
      netRevenueAfterLoss: 0,
    }
  );

  return {
    date,
    byBreadType,
    ...totalsSummary,
  };
}

app.post("/api/auth/admin-login", (req, res) => {
  const code = String(req.body.code || "").trim();
  if (!code) return badRequest(res, "Access code is required");
  if (code !== ADMIN_ACCESS_CODE) {
    return res.status(401).json({ error: "Invalid access code" });
  }

  return loadAdminUser()
    .then((admin) => {
      if (!admin) return res.status(500).json({ error: "Admin account not configured" });

      const token = jwt.sign(
        { id: admin.id, name: admin.name, email: admin.email, phone: admin.phone, role: admin.role },
        JWT_SECRET,
        { expiresIn: "12h" }
      );

      return res.json({ token, user: { id: admin.id, name: admin.name, email: admin.email, role: admin.role } });
    })
    .catch((error) => {
      console.error("Admin login lookup failed:", error.message);
      return res.status(500).json({ error: "Admin account not configured" });
    });
});

app.post("/api/auth/login", async (req, res) => {
  const phone = String(req.body.phone || "").trim();
  const normalizedPhone = normalizePhoneInput(phone);
  const password = String(req.body.password || "");
  if (!phone || !password) {
    return badRequest(res, "Phone number and password are required");
  }

  let user = null;

  try {
    user = await loadStaffUserByPhone(normalizedPhone);
  } catch (error) {
    console.error("Login lookup failed:", error.message);
    if (IS_VERCEL) {
      return res.status(500).json({ error: "Failed to load login record. Please try again." });
    }
  }

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign(
    {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: "12h" }
  );

  res.json({ token, user: createUserSafe(user) });
});

app.get("/api/auth/me", authRequired, (req, res) => {
  const user = db
    .prepare("SELECT id, name, email, phone, username, role FROM users WHERE id = ?")
    .get(req.user.id);

  if (!user) {
    return res.status(401).json({ error: "User not found" });
  }

  res.json({ user });
});

app.post("/api/auth/change-password", authRequired, (req, res) => {
  const currentPassword = String(req.body.currentPassword || "");
  const newPassword = String(req.body.newPassword || "");
  if (!currentPassword || !newPassword) {
    return badRequest(res, "Current and new password are required");
  }
  if (newPassword.length < 4) {
    return badRequest(res, "New password must be at least 4 characters");
  }
  const staffUser = db
    .prepare("SELECT id, password_hash FROM users WHERE id = ?")
    .get(req.user.id);
  if (!staffUser || !bcrypt.compareSync(currentPassword, staffUser.password_hash)) {
    return res.status(401).json({ error: "Current password is incorrect" });
  }
  const newHash = bcrypt.hashSync(newPassword, 10);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newHash, req.user.id);
  pgDirectUpdate("users", req.user.id, { password_hash: newHash }).catch((err) =>
    console.error("PG password update failed:", err.message)
  );
  res.json({ ok: true });
});

app.get("/api/meta", authRequired, (req, res) => {
  res.json({
    breadTypes: BREAD_TYPES,
    threshold: THRESHOLD,
    ingredients: [
      "flour",
      "sugar",
      "salt",
      "preservative",
      "butter",
      "softener",
      "improva",
    ],
  });
});

app.get("/api/health/persistence", async (_req, res) => {
  const postgres = await checkPostgresConnection();
  const durable = postgres.configured && postgres.connected;
  const statusCode = durable || !IS_VERCEL ? 200 : 503;

  res.status(statusCode).json({
    ok: durable || !IS_VERCEL,
    runtime: {
      vercel: IS_VERCEL,
    },
    persistence: {
      durable,
      postgres,
      sqliteFallback: !postgres.configured,
    },
    timestamp: new Date().toISOString(),
  });
});

app.post("/api/production", authRequired, roleRequired("baker"), async (req, res) => {
  const {
    breadType,
    flourKg,
    flourBags,
    producedCount,
    sugar,
    salt,
    preservative,
    butter,
    softener,
    yeast,
    vegetableOil,
    improver,
  } = req.body;

  if (!validateBreadType(breadType)) {
    return badRequest(res, "Invalid bread type");
  }

  const flourKgValue = asNumber(
    flourKg ?? (flourBags !== undefined ? Number(flourBags) * 50 : undefined)
  );
  const flour = flourKgValue / 50;
  const produced = asNumber(producedCount);
  const ingSugar = asNumber(sugar);
  const ingSalt = asNumber(salt);
  const ingPreservative = asNumber(preservative);
  const ingButter = asNumber(butter);
  const ingYeast = asNumber(softener ?? yeast ?? 0);
  const ingVegetableOil = asNumber(vegetableOil ?? 0);
  const ingImprover = asNumber(improver);

  const values = [
    flourKgValue,
    flour,
    produced,
    ingSugar,
    ingSalt,
    ingPreservative,
    ingButter,
    ingYeast,
    ingVegetableOil,
    ingImprover,
  ];

  if (values.some((n) => Number.isNaN(n) || n < 0)) {
    return badRequest(res, "All numeric fields must be non-negative numbers");
  }

  const expectedOutput = flour * BREAD_TYPES[breadType].fromFlourBag;
  const difference = expectedOutput - produced;
  const loafSeverity = getSeverity(Math.abs(difference));
  const ingredientAnalysis = analyzeIngredientDiscrepancy(flourKgValue, {
    sugar: ingSugar,
    salt: ingSalt,
    preservative: ingPreservative,
    butter: ingButter,
    softener: ingYeast,
    improva: ingImprover,
  });
  const severity =
    severityRank(ingredientAnalysis.severity) > severityRank(loafSeverity)
      ? ingredientAnalysis.severity
      : loafSeverity;
  const flagged = severity ? 1 : 0;

  const info = db
    .prepare(
      `INSERT INTO production_logs
      (user_id, bread_type, flour_bags, expected_output, produced_count, sugar, salt, preservative, butter, yeast, vegetable_oil, improver, difference, flagged, severity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      breadType,
      flour,
      expectedOutput,
      produced,
      ingSugar,
      ingSalt,
      ingPreservative,
      ingButter,
      ingYeast,
      ingVegetableOil,
      ingImprover,
      difference,
      flagged,
      severity
    );

  maybeRecordDiscrepancy({
    stage: "production",
    refTable: "production_logs",
    refId: info.lastInsertRowid,
    breadType,
    difference,
    userId: req.user.id,
  });

  let createdAt = db
    .prepare("SELECT created_at FROM production_logs WHERE id = ?")
    .get(info.lastInsertRowid).created_at;

  // Write directly to PostgreSQL (single INSERT — no full-table sync)
  try {
    const pgRow = await pgDirectInsert("production_logs", {
      user_id: req.user.id,
      bread_type: breadType,
      flour_bags: flour,
      expected_output: expectedOutput,
      produced_count: produced,
      sugar: ingSugar,
      salt: ingSalt,
      preservative: ingPreservative,
      butter: ingButter,
      yeast: ingYeast,
      vegetable_oil: ingVegetableOil,
      improver: ingImprover,
      difference,
      flagged,
      severity,
    });
    if (pgRow) createdAt = pgRow.created_at;
  } catch (error) {
    console.error("PG insert failed during production submission:", error.message);
    if (IS_VERCEL) {
      return res.status(500).json({ error: "Failed to persist submission", detail: error.message });
    }
  }

  maybeSendCriticalAlertEmail({
    stage: "production",
    breadType,
    difference,
    severity,
    staffName: req.user.name,
    staffRole: req.user.role,
    createdAt,
  });

  const stockImpact = [
    recordIngredientUsage({
      ingredient: "flour",
      usedAmount: flourKgValue,
      reason: "Baker production usage",
      sourceType: "production",
      sourceId: info.lastInsertRowid,
      actorUserId: req.user.id,
    }),
    recordIngredientUsage({
      ingredient: "sugar",
      usedAmount: ingSugar,
      reason: "Baker production usage",
      sourceType: "production",
      sourceId: info.lastInsertRowid,
      actorUserId: req.user.id,
    }),
    recordIngredientUsage({
      ingredient: "salt",
      usedAmount: ingSalt,
      reason: "Baker production usage",
      sourceType: "production",
      sourceId: info.lastInsertRowid,
      actorUserId: req.user.id,
    }),
    recordIngredientUsage({
      ingredient: "preservative",
      usedAmount: ingPreservative,
      reason: "Baker production usage",
      sourceType: "production",
      sourceId: info.lastInsertRowid,
      actorUserId: req.user.id,
    }),
    recordIngredientUsage({
      ingredient: "butter",
      usedAmount: ingButter,
      reason: "Baker production usage",
      sourceType: "production",
      sourceId: info.lastInsertRowid,
      actorUserId: req.user.id,
    }),
    recordIngredientUsage({
      ingredient: "yeast",
      usedAmount: ingYeast,
      reason: "Baker production usage",
      sourceType: "production",
      sourceId: info.lastInsertRowid,
      actorUserId: req.user.id,
    }),
    recordIngredientUsage({
      ingredient: "improver",
      usedAmount: ingImprover,
      reason: "Baker production usage",
      sourceType: "production",
      sourceId: info.lastInsertRowid,
      actorUserId: req.user.id,
    }),
  ].filter(Boolean);

  res.status(201).json({
    id: info.lastInsertRowid,
    breadType,
    flourKg: flourKgValue,
    flourBags: flour,
    expectedOutput,
    producedCount: produced,
    difference,
    flagged: Boolean(flagged),
    severity,
    ingredientDiscrepancy: {
      flagged: ingredientAnalysis.flagged,
      severity: ingredientAnalysis.severity,
      details: ingredientAnalysis.details,
    },
    stockImpact,
    createdAt,
  });
});

app.post("/api/bagging", authRequired, roleRequired("bagger"), async (req, res) => {
  const { breadType, receivedCount, baggedCount } = req.body;

  if (!validateBreadType(breadType)) {
    return badRequest(res, "Invalid bread type");
  }

  const received = asNumber(receivedCount);
  const bagged = asNumber(baggedCount);

  if ([received, bagged].some((n) => Number.isNaN(n) || n < 0)) {
    return badRequest(res, "Counts must be non-negative numbers");
  }

  const difference = received - bagged;
  const severity = getSeverity(Math.abs(difference));
  const flagged = severity ? 1 : 0;

  const info = db
    .prepare(
      `INSERT INTO bagging_logs
      (user_id, bread_type, received_count, bagged_count, difference, flagged, severity)
      VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(req.user.id, breadType, received, bagged, difference, flagged, severity);

  maybeRecordDiscrepancy({
    stage: "bagging",
    refTable: "bagging_logs",
    refId: info.lastInsertRowid,
    breadType,
    difference,
    userId: req.user.id,
  });

  let createdAt = db.prepare("SELECT created_at FROM bagging_logs WHERE id = ?").get(info.lastInsertRowid)
    .created_at;

  try {
    const pgRow = await pgDirectInsert("bagging_logs", {
      user_id: req.user.id,
      bread_type: breadType,
      received_count: received,
      bagged_count: bagged,
      difference,
      flagged,
      severity,
    });
    if (pgRow) createdAt = pgRow.created_at;
  } catch (error) {
    console.error("PG insert failed during bagging submission:", error.message);
    if (IS_VERCEL) {
      return res.status(500).json({ error: "Failed to persist submission", detail: error.message });
    }
  }

  maybeSendCriticalAlertEmail({
    stage: "bagging",
    breadType,
    difference,
    severity,
    staffName: req.user.name,
    staffRole: req.user.role,
    createdAt,
  });

  res.status(201).json({
    id: info.lastInsertRowid,
    breadType,
    difference,
    flagged: Boolean(flagged),
    severity,
    createdAt,
  });
});

app.post("/api/sales", authRequired, roleRequired("sales"), async (req, res) => {
  const { breadType, receivedCount, paidCount, creditCount } = req.body;

  if (!validateBreadType(breadType)) {
    return badRequest(res, "Invalid bread type");
  }

  const received = asNumber(receivedCount);
  const paid = asNumber(paidCount);
  const credit = asNumber(creditCount);

  if ([received, paid, credit].some((n) => Number.isNaN(n) || n < 0)) {
    return badRequest(res, "Counts must be non-negative numbers");
  }

  const totalSold = paid + credit;
  const difference = received - totalSold;
  const severity = getSeverity(Math.abs(difference));
  const flagged = severity ? 1 : 0;

  const info = db
    .prepare(
      `INSERT INTO sales_logs
      (user_id, bread_type, received_for_sales, paid_count, credit_count, total_sold, difference, flagged, severity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      breadType,
      received,
      paid,
      credit,
      totalSold,
      difference,
      flagged,
      severity
    );

  maybeRecordDiscrepancy({
    stage: "sales",
    refTable: "sales_logs",
    refId: info.lastInsertRowid,
    breadType,
    difference,
    userId: req.user.id,
  });

  let createdAt = db.prepare("SELECT created_at FROM sales_logs WHERE id = ?").get(info.lastInsertRowid)
    .created_at;

  try {
    const pgRow = await pgDirectInsert("sales_logs", {
      user_id: req.user.id,
      bread_type: breadType,
      received_for_sales: received,
      paid_count: paid,
      credit_count: credit,
      total_sold: totalSold,
      difference,
      flagged,
      severity,
    });
    if (pgRow) createdAt = pgRow.created_at;
  } catch (error) {
    console.error("PG insert failed during sales submission:", error.message);
    if (IS_VERCEL) {
      return res.status(500).json({ error: "Failed to persist submission", detail: error.message });
    }
  }

  maybeSendCriticalAlertEmail({
    stage: "sales",
    breadType,
    difference,
    severity,
    staffName: req.user.name,
    staffRole: req.user.role,
    createdAt,
  });

  res.status(201).json({
    id: info.lastInsertRowid,
    breadType,
    totalSold,
    inferredReceivedForSales: received,
    difference,
    flagged: Boolean(flagged),
    severity,
    createdAt,
  });
});

app.post("/api/delivery", authRequired, roleRequired("delivery"), async (req, res) => {
  const { breadType, takenCount, paidCount, creditCount } = req.body;

  if (!validateBreadType(breadType)) {
    return badRequest(res, "Invalid bread type");
  }

  const taken = asNumber(takenCount);
  const paid = asNumber(paidCount);
  const credit = asNumber(creditCount);

  if ([taken, paid, credit].some((n) => Number.isNaN(n) || n < 0)) {
    return badRequest(res, "Counts must be non-negative numbers");
  }

  const totalDelivered = paid + credit;
  const difference = taken - totalDelivered;
  const severity = getSeverity(Math.abs(difference));
  const flagged = severity ? 1 : 0;

  const info = db
    .prepare(
      `INSERT INTO delivery_logs
      (user_id, bread_type, taken_count, paid_count, credit_count, total_delivered, difference, flagged, severity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(req.user.id, breadType, taken, paid, credit, totalDelivered, difference, flagged, severity);

  maybeRecordDiscrepancy({
    stage: "delivery",
    refTable: "delivery_logs",
    refId: info.lastInsertRowid,
    breadType,
    difference,
    userId: req.user.id,
  });

  let createdAt = db
    .prepare("SELECT created_at FROM delivery_logs WHERE id = ?")
    .get(info.lastInsertRowid).created_at;

  try {
    const pgRow = await pgDirectInsert("delivery_logs", {
      user_id: req.user.id,
      bread_type: breadType,
      taken_count: taken,
      paid_count: paid,
      credit_count: credit,
      total_delivered: totalDelivered,
      difference,
      flagged,
      severity,
    });
    if (pgRow) createdAt = pgRow.created_at;
  } catch (error) {
    console.error("PG insert failed during delivery submission:", error.message);
    if (IS_VERCEL) {
      return res.status(500).json({ error: "Failed to persist submission", detail: error.message });
    }
  }

  maybeSendCriticalAlertEmail({
    stage: "delivery",
    breadType,
    difference,
    severity,
    staffName: req.user.name,
    staffRole: req.user.role,
    createdAt,
  });

  res.status(201).json({
    id: info.lastInsertRowid,
    breadType,
    totalDelivered,
    difference,
    flagged: Boolean(flagged),
    severity,
    createdAt,
  });
});

app.post("/api/admin/staff", authRequired, roleRequired("admin"), async (req, res) => {
  const name = String(req.body.name || "").trim();
  const phone = String(req.body.phone || "").trim();
  const role = String(req.body.role || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();

  if (!name || !phone || !role) {
    return badRequest(res, "Name, phone number, and role are required");
  }

  const validRoles = ["baker", "bagger", "sales", "delivery"];
  if (!validRoles.includes(role)) {
    return badRequest(res, "Role must be one of: baker, bagger, sales, delivery");
  }

  if (!/^\d{7,15}$/.test(phone.replace(/[\s\-\+\(\)]/g, ""))) {
    return badRequest(res, "Invalid phone number");
  }

  const normalizedPhone = normalizePhoneInput(phone);

  const existingPhone = db.prepare("SELECT id FROM users WHERE phone = ?").get(normalizedPhone);
  if (existingPhone) {
    return res.status(409).json({ error: "A user with that phone number already exists" });
  }

  if (email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return badRequest(res, "Invalid email address");
    }
    const existingEmail = db.prepare("SELECT id FROM users WHERE lower(email) = ?").get(email);
    if (existingEmail) {
      return res.status(409).json({ error: "A user with that email already exists" });
    }
  }

  // Default password = last 4 digits of the normalized phone number
  const last4 = normalizedPhone.slice(-4);
  const passwordHash = bcrypt.hashSync(last4, 10);
  const username = createStaffUsernameFromPhone(normalizedPhone);

  let info;
  try {
    info = db
      .prepare("INSERT INTO users (name, email, phone, username, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)")
      .run(name, email || null, normalizedPhone, username, passwordHash, role);
  } catch (error) {
    // Prevent route crash on SQLite constraint conflicts and return clear API errors.
    if (String(error.message || "").includes("users.username")) {
      return res.status(409).json({ error: "A staff account with this phone pattern already exists" });
    }
    if (String(error.message || "").includes("users.phone")) {
      return res.status(409).json({ error: "A user with that phone number already exists" });
    }
    if (String(error.message || "").includes("users.email")) {
      return res.status(409).json({ error: "A user with that email already exists" });
    }
    console.error("SQLite insert failed during staff creation:", error.message);
    return res.status(500).json({ error: "Failed to create staff account. Please try again." });
  }

  const created = db
    .prepare("SELECT id, name, email, phone, role, created_at FROM users WHERE id = ?")
    .get(info.lastInsertRowid);

  try {
    await pgDirectInsert("users", {
      name,
      email: email || null,
      phone: normalizedPhone,
      username,
      password_hash: passwordHash,
      role,
    });
  } catch (error) {
    console.error("PG insert failed during staff creation:", error.message);
    if (IS_VERCEL) {
      // Keep durability guarantees on Vercel by rolling back local write if PG write fails.
      db.prepare("DELETE FROM users WHERE id = ?").run(info.lastInsertRowid);
      return res.status(500).json({ error: "Failed to persist staff data. Please try again." });
    }
  }

  res.status(201).json({ user: created });
});

app.get("/api/admin/staff", authRequired, roleRequired("admin"), async (req, res) => {
  if (pgPool) {
    try {
      const result = await pgPool.query(
        "SELECT id, name, email, phone, role, created_at FROM users WHERE role <> 'admin' ORDER BY role, name"
      );
      return res.json({ staff: result.rows });
    } catch (error) {
      console.error("PG read failed during staff listing:", error.message);
      if (IS_VERCEL) {
        return res.status(500).json({ error: "Failed to load staff list. Please try again." });
      }
    }
  }

  const staff = db
    .prepare("SELECT id, name, email, phone, role, created_at FROM users WHERE role != 'admin' ORDER BY role, name")
    .all();
  return res.json({ staff });
});

app.delete("/api/admin/staff/:id", authRequired, roleRequired("admin"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return badRequest(res, "Invalid staff ID");
  }
  const user = db.prepare("SELECT id, role FROM users WHERE id = ?").get(id);
  if (!user) return res.status(404).json({ error: "Staff not found" });
  if (user.role === "admin") return res.status(403).json({ error: "Cannot delete admin" });
  deleteUserAndRelatedRecords(id);

  try {
    if (pgPool) {
      const tables = ["production_logs", "bagging_logs", "sales_logs", "delivery_logs", "discrepancies"];
      await Promise.all(tables.map((t) =>
        pgPool.query(`DELETE FROM ${t} WHERE user_id = $1`, [id]).catch(() => null)
      ));
      await pgPool.query("UPDATE ingredient_stock_movements SET actor_user_id = NULL WHERE actor_user_id = $1", [id]);
      await pgDirectDelete("users", id);
    }
  } catch (error) {
    console.error("PG delete failed during staff deletion:", error.message);
    if (IS_VERCEL) {
      return res.status(500).json({ error: "Failed to persist deletion. Please try again." });
    }
  }

  res.json({ deleted: id });
});

app.get("/api/admin/submissions", authRequired, roleRequired("admin"), (req, res) => {
  const { start, end, day } = toDateBounds(req.query.date);

  const baker = db
    .prepare(
      `SELECT p.id, u.name, u.username, p.bread_type, p.flour_bags, p.produced_count, p.sugar, p.salt,
              p.preservative, p.butter, p.yeast, p.vegetable_oil, p.improver, p.difference, p.flagged, p.severity, p.created_at
       FROM production_logs p
       JOIN users u ON u.id = p.user_id
       WHERE p.created_at BETWEEN ? AND ?
       ORDER BY p.created_at DESC`
    )
    .all(start, end);

  const bagger = db
    .prepare(
      `SELECT b.id, u.name, b.bread_type, b.received_count, b.bagged_count, b.difference, b.flagged, b.severity, b.created_at
       FROM bagging_logs b
       JOIN users u ON u.id = b.user_id
       WHERE b.created_at BETWEEN ? AND ?
       ORDER BY b.created_at DESC`
    )
    .all(start, end);

  const sales = db
    .prepare(
      `SELECT s.id, u.name, s.bread_type, s.paid_count, s.credit_count, s.total_sold, s.difference, s.flagged, s.severity, s.created_at
       FROM sales_logs s
       JOIN users u ON u.id = s.user_id
       WHERE s.created_at BETWEEN ? AND ?
       ORDER BY s.created_at DESC`
    )
    .all(start, end);

  const delivery = db
    .prepare(
      `SELECT d.id, u.name, d.bread_type, d.taken_count, d.paid_count, d.credit_count, d.total_delivered, d.difference, d.flagged, d.severity, d.created_at
       FROM delivery_logs d
       JOIN users u ON u.id = d.user_id
       WHERE d.created_at BETWEEN ? AND ?
       ORDER BY d.created_at DESC`
    )
    .all(start, end);

  res.json({ date: day, baker, bagger, sales, delivery });
});

app.get("/api/admin/summary", authRequired, roleRequired("admin"), (req, res) => {
  const day = req.query.date;
  const rows = getDailyTotalsByBread(day);
  res.json({ date: day || new Date().toISOString().slice(0, 10), rows });
});

app.get("/api/admin/ingredients", authRequired, roleRequired("admin"), (req, res) => {
  const { start, end, day } = toDateBounds(req.query.date);

  const totals = db
    .prepare(
      `SELECT
        COALESCE(SUM(flour_bags), 0) AS flour,
        COALESCE(SUM(sugar), 0) AS sugar,
        COALESCE(SUM(salt), 0) AS salt,
        COALESCE(SUM(preservative), 0) AS preservative,
        COALESCE(SUM(butter), 0) AS butter,
        COALESCE(SUM(yeast), 0) AS yeast,
        COALESCE(SUM(vegetable_oil), 0) AS vegetable_oil,
        COALESCE(SUM(improver), 0) AS improver
      FROM production_logs
      WHERE created_at BETWEEN ? AND ?`
    )
    .get(start, end);

  const batches = db
    .prepare(
      `SELECT p.id, p.created_at, u.username, p.bread_type, p.flour_bags, p.sugar, p.salt, p.preservative, p.butter, p.yeast, p.vegetable_oil, p.improver
      FROM production_logs p
      JOIN users u ON u.id = p.user_id
      WHERE p.created_at BETWEEN ? AND ?
      ORDER BY p.created_at DESC`
    )
    .all(start, end);

  res.json({ date: day, totals, batches });
});

app.get("/api/admin/ingredient-stock", authRequired, roleRequired("admin"), (req, res) => {
  const stockRows = db
    .prepare(
      `SELECT id, ingredient, quantity, unit, warning_level, critical_level, updated_at
       FROM ingredient_stock
       ORDER BY ingredient ASC`
    )
    .all();

  const rows = stockRows.map((row) => ({
    ...row,
    status: stockStatus(Number(row.quantity || 0), Number(row.warning_level || 0), Number(row.critical_level || 0)),
  }));
  const lowCount = rows.filter((r) => r.status === "warning" || r.status === "critical").length;
  const criticalCount = rows.filter((r) => r.status === "critical").length;

  const recentMovements = db
    .prepare(
      `SELECT ingredient, change_amount, quantity_after, unit, reason, source_type, source_id, created_at
       FROM ingredient_stock_movements
       ORDER BY created_at DESC
       LIMIT 25`
    )
    .all();

  res.json({
    rows,
    summary: {
      trackedIngredients: rows.length,
      lowCount,
      criticalCount,
    },
    recentMovements,
  });
});

app.post("/api/admin/ingredient-stock/adjust", authRequired, roleRequired("admin"), (req, res) => {
  const ingredient = String(req.body.ingredient || "").trim();
  const action = String(req.body.action || "add").trim(); // add | subtract | set
  const quantity = asNumber(req.body.quantity);
  const reason = String(req.body.reason || "Manual stock adjustment").trim();

  if (!Object.prototype.hasOwnProperty.call(INGREDIENT_STOCK_META, ingredient)) {
    return badRequest(res, "Invalid ingredient");
  }
  if (!Number.isFinite(quantity) || quantity < 0) {
    return badRequest(res, "Quantity must be a non-negative number");
  }
  if (!["add", "subtract", "set"].includes(action)) {
    return badRequest(res, "Action must be add, subtract, or set");
  }

  const row = db
    .prepare("SELECT id, quantity, unit, warning_level, critical_level FROM ingredient_stock WHERE ingredient = ?")
    .get(ingredient);
  if (!row) {
    return res.status(404).json({ error: "Ingredient stock row not found" });
  }

  const oldQty = Number(row.quantity || 0);
  const nextQty = action === "set" ? quantity : action === "add" ? oldQty + quantity : oldQty - quantity;
  const changeAmount = nextQty - oldQty;

  db.prepare("UPDATE ingredient_stock SET quantity = ?, updated_at = datetime('now') WHERE id = ?").run(nextQty, row.id);
  db.prepare(
    `INSERT INTO ingredient_stock_movements
     (ingredient, change_amount, quantity_after, unit, reason, source_type, source_id, actor_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(ingredient, changeAmount, nextQty, row.unit, reason, "admin_adjustment", null, req.user.id);

  if (pgPool) {
    pgPool
      .query("UPDATE ingredient_stock SET quantity = $1, updated_at = NOW() WHERE ingredient = $2", [nextQty, ingredient])
      .then(() =>
        pgPool.query(
          `INSERT INTO ingredient_stock_movements
           (ingredient, change_amount, quantity_after, unit, reason, source_type, source_id, actor_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [ingredient, changeAmount, nextQty, row.unit, reason, "admin_adjustment", null, req.user.id]
        )
      )
      .catch((err) => console.error("PG ingredient stock adjustment failed:", err.message));
  }

  const status = stockStatus(nextQty, Number(row.warning_level || 0), Number(row.critical_level || 0));
  res.json({
    ingredient,
    quantity: nextQty,
    unit: row.unit,
    status,
    changeAmount,
  });
});

app.get("/api/admin/discrepancies", authRequired, roleRequired("admin"), (req, res) => {
  const { start, end, day } = toDateBounds(req.query.date);

  const itemized = db
    .prepare(
      `SELECT d.id, d.stage, d.ref_table, d.ref_id, d.bread_type, d.difference, d.severity, d.created_at,
              u.username, u.role
       FROM discrepancies d
       JOIN users u ON u.id = d.user_id
       WHERE d.created_at BETWEEN ? AND ?
       ORDER BY d.created_at DESC`
    )
    .all(start, end)
    .map((x) => ({
      id: x.id,
      stage: x.stage,
      refTable: x.ref_table,
      refId: x.ref_id,
      breadType: x.bread_type,
      difference: x.difference,
      severity: x.severity,
      timestamp: x.created_at,
      staffResponsible: {
        username: x.username,
        role: x.role,
      },
    }));

  const totals = getDailyTotalsByBread(day);
  const crossStage = [];

  for (const row of totals) {
    const checks = [
      { from: "production", to: "bagging", diff: row.produced - row.bagged },
      { from: "bagging", to: "sales", diff: row.bagged - row.sold },
      { from: "sales", to: "delivery", diff: row.sold - row.delivered },
    ];

    for (const check of checks) {
      const absDiff = Math.abs(check.diff);
      const severity = getSeverity(absDiff);
      if (severity) {
        crossStage.push({
          breadType: row.breadType,
          stage: `${check.from}_vs_${check.to}`,
          quantityDifference: check.diff,
          severity,
          timestamp: `${day} 23:59:59`,
          staffResponsible: "system_aggregate",
        });
      }
    }
  }

  res.json({ date: day, itemized, crossStage });
});

app.get("/api/admin/loss", authRequired, roleRequired("admin"), (req, res) => {
  const finance = computeFinancialSummary(req.query.date);

  res.json({
    date: finance.date,
    byBreadType: finance.byBreadType.map((row) => ({
      breadType: row.breadType,
      missingBreads: row.missingBreads,
      unitPrice: row.unitPrice,
      loss: row.financialLoss,
    })),
    totalMissingBreads: finance.totalMissingBreads,
    totalFinancialLoss: finance.totalFinancialLoss,
  });
});

app.get("/api/admin/finance", authRequired, roleRequired("admin"), (req, res) => {
  const finance = computeFinancialSummary(req.query.date);
  res.json(finance);
});

app.get("/api/admin/staff-accountability", authRequired, roleRequired("admin"), (req, res) => {
  const { start, end } = toDateBounds(req.query.date);

  const users = db
    .prepare("SELECT id, username, role FROM users WHERE role != 'admin' ORDER BY role, username")
    .all();

  const submissionsStmt = db.prepare(
    `SELECT
      (SELECT COUNT(*) FROM production_logs WHERE user_id = ? AND created_at BETWEEN ? AND ?) +
      (SELECT COUNT(*) FROM bagging_logs WHERE user_id = ? AND created_at BETWEEN ? AND ?) +
      (SELECT COUNT(*) FROM sales_logs WHERE user_id = ? AND created_at BETWEEN ? AND ?) +
      (SELECT COUNT(*) FROM delivery_logs WHERE user_id = ? AND created_at BETWEEN ? AND ?) AS total`
  );

  const discrepanciesStmt = db.prepare(
    `SELECT COUNT(*) AS total FROM discrepancies WHERE user_id = ? AND created_at BETWEEN ? AND ?`
  );

  const rows = users.map((u) => {
    const submissionCount = submissionsStmt.get(
      u.id,
      start,
      end,
      u.id,
      start,
      end,
      u.id,
      start,
      end,
      u.id,
      start,
      end
    ).total;

    const discrepancyCount = discrepanciesStmt.get(u.id, start, end).total;
    const accuracyRate = submissionCount === 0 ? 100 : ((submissionCount - discrepancyCount) / submissionCount) * 100;

    return {
      userId: u.id,
      username: u.username,
      role: u.role,
      totalSubmissions: submissionCount,
      discrepancies: discrepancyCount,
      accuracyRate: Number(accuracyRate.toFixed(2)),
    };
  });

  res.json({ rows });
});

app.get("/api/admin/daily-report", authRequired, roleRequired("admin"), (req, res) => {
  const day = req.query.date;
  const totals = getDailyTotalsByBread(day);

  const totalProduced = totals.reduce((sum, row) => sum + row.produced, 0);
  const totalDelivered = totals.reduce((sum, row) => sum + row.delivered, 0);

  const ingredients = db
    .prepare(
      `SELECT
        COALESCE(SUM(flour_bags), 0) AS flour,
        COALESCE(SUM(sugar), 0) AS sugar,
        COALESCE(SUM(salt), 0) AS salt,
        COALESCE(SUM(preservative), 0) AS preservative,
        COALESCE(SUM(butter), 0) AS butter,
        COALESCE(SUM(yeast), 0) AS yeast,
        COALESCE(SUM(vegetable_oil), 0) AS vegetable_oil,
        COALESCE(SUM(improver), 0) AS improver
      FROM production_logs
      WHERE date(created_at) = date(?)`
    )
    .get(day || new Date().toISOString().slice(0, 10));

  let totalMissingBreads = 0;
  let totalLoss = 0;
  for (const row of totals) {
    const missing =
      Math.max(0, row.produced - row.bagged) +
      Math.max(0, row.bagged - row.sold) +
      Math.max(0, row.sold - row.delivered);

    totalMissingBreads += missing;
    totalLoss += missing * BREAD_TYPES[row.breadType].price;
  }

  res.json({
    date: day || new Date().toISOString().slice(0, 10),
    totalBreadsProduced: totalProduced,
    totalBreadsAccountedFor: totalDelivered,
    totalMissingBreads,
    totalLoss,
    totalIngredientsUsed: ingredients,
    breakdown: totals,
  });
});

app.get("/api/admin/alerts", authRequired, roleRequired("admin"), (req, res) => {
  const { start, end } = toDateBounds(req.query.date);

  const rows = db
    .prepare(
      `SELECT d.stage, d.bread_type, d.difference, d.severity, d.created_at, u.username
       FROM discrepancies d
       JOIN users u ON u.id = d.user_id
       WHERE d.created_at BETWEEN ? AND ?
       ORDER BY CASE d.severity WHEN 'critical' THEN 1 ELSE 2 END, d.created_at DESC`
    )
    .all(start, end);

  res.json({ alerts: rows });
});

app.get("/api/admin/export-csv", authRequired, roleRequired("admin"), (req, res) => {
  const { start, end, day } = toDateBounds(req.query.date);
  const scope = req.query.scope || 'all'; // 'all' or 'errors'

  let whereClause = 'WHERE p.created_at BETWEEN ? AND ?';
  if (scope === 'errors') {
    whereClause += ' AND (p.flagged = 1 OR p.severity IN ("critical", "warning"))';
  }
  
  let baggerWhere = 'WHERE b.created_at BETWEEN ? AND ?';
  if (scope === 'errors') {
    baggerWhere += ' AND (b.flagged = 1 OR b.severity IN ("critical", "warning"))';
  }
  
  let salesWhere = 'WHERE s.created_at BETWEEN ? AND ?';
  if (scope === 'errors') {
    salesWhere += ' AND (s.flagged = 1 OR s.severity IN ("critical", "warning"))';
  }
  
  let deliveryWhere = 'WHERE d.created_at BETWEEN ? AND ?';
  if (scope === 'errors') {
    deliveryWhere += ' AND (d.flagged = 1 OR d.severity IN ("critical", "warning"))';
  }

  const rows = db
    .prepare(
      `SELECT * FROM (
       SELECT 'baker' AS stage, u.name AS staff_name, p.bread_type, p.created_at,
              p.produced_count AS quantity, p.difference, p.severity
       FROM production_logs p
       JOIN users u ON u.id = p.user_id
       ${whereClause}

       UNION ALL

       SELECT 'bagger' AS stage, u.name AS staff_name, b.bread_type, b.created_at,
              b.bagged_count AS quantity, b.difference, b.severity
       FROM bagging_logs b
       JOIN users u ON u.id = b.user_id
       ${baggerWhere}

       UNION ALL

       SELECT 'sales' AS stage, u.name AS staff_name, s.bread_type, s.created_at,
              s.total_sold AS quantity, s.difference, s.severity
       FROM sales_logs s
       JOIN users u ON u.id = s.user_id
       ${salesWhere}

       UNION ALL

       SELECT 'delivery' AS stage, u.name AS staff_name, d.bread_type, d.created_at,
              d.total_delivered AS quantity, d.difference, d.severity
       FROM delivery_logs d
       JOIN users u ON u.id = d.user_id
       ${deliveryWhere}
          ) AS export_rows
          ORDER BY export_rows.created_at DESC`
    )
    .all(start, end, start, end, start, end, start, end);

  const csv = rowsToCsv(
    ["date", "stage", "staff", "bread_type", "quantity", "difference", "severity"],
    rows.map((row) => [
      row.created_at,
      row.stage,
      row.staff_name,
      row.bread_type,
      row.quantity,
      row.difference,
      row.severity || "ok",
    ])
  );

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="bigcat-report-${day}-${scope}.csv"`);
  res.send(csv);
});

app.get("/api/admin/export-financial-csv", authRequired, roleRequired("admin"), (req, res) => {
  const finance = computeFinancialSummary(req.query.date);

  const dataRows = finance.byBreadType.map((row) => [
    finance.date,
    row.breadType,
    row.unitPrice,
    row.produced,
    row.bagged,
    row.sold,
    row.delivered,
    row.grossSalesValue,
    row.deliveredValue,
    row.missingBreads,
    row.financialLoss,
    row.netAfterLoss,
  ]);

  dataRows.push([
    finance.date,
    "TOTAL",
    "",
    finance.totalProduced,
    "",
    finance.totalSold,
    finance.totalDelivered,
    finance.totalGrossSalesValue,
    finance.totalDeliveredValue,
    finance.totalMissingBreads,
    finance.totalFinancialLoss,
    finance.netRevenueAfterLoss,
  ]);

  const csv = rowsToCsv(
    [
      "date",
      "bread_type",
      "unit_price",
      "produced",
      "bagged",
      "sold",
      "delivered",
      "gross_sales_value",
      "delivered_value",
      "missing_breads",
      "financial_loss",
      "net_after_loss",
    ],
    dataRows
  );

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="bigcat-financial-report-${finance.date}.csv"`);
  res.send(csv);
});

app.patch("/api/admin/adjust/:table/:id", authRequired, roleRequired("admin"), (req, res) => {
  const table = String(req.params.table || "");
  const id = Number(req.params.id);
  const { fieldName, newValue, reason } = req.body;

  if (!Number.isInteger(id) || id <= 0) {
    return badRequest(res, "Invalid id");
  }

  if (!reason || typeof reason !== "string") {
    return badRequest(res, "Adjustment reason is required");
  }

  const config = {
    production_logs: [
      "bread_type",
      "flour_bags",
      "expected_output",
      "produced_count",
      "sugar",
      "salt",
      "preservative",
      "butter",
      "yeast",
      "vegetable_oil",
      "improver",
      "difference",
      "flagged",
      "severity",
    ],
    bagging_logs: ["bread_type", "received_count", "bagged_count", "difference", "flagged", "severity"],
    sales_logs: [
      "bread_type",
      "received_for_sales",
      "paid_count",
      "credit_count",
      "total_sold",
      "difference",
      "flagged",
      "severity",
    ],
    delivery_logs: [
      "bread_type",
      "taken_count",
      "paid_count",
      "credit_count",
      "total_delivered",
      "difference",
      "flagged",
      "severity",
    ],
  };

  if (!config[table]) {
    return badRequest(res, "Invalid table");
  }

  if (!config[table].includes(fieldName)) {
    return badRequest(res, "Invalid field for table");
  }

  const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!existing) {
    return res.status(404).json({ error: "Entry not found" });
  }

  const oldValue = existing[fieldName];

  const tx = db.transaction(() => {
    db.prepare(`UPDATE ${table} SET ${fieldName} = ?, adjusted_by = ?, adjusted_at = datetime('now') WHERE id = ?`).run(
      newValue,
      req.user.id,
      id
    );

    db.prepare(
      `INSERT INTO adjustments (admin_user_id, table_name, entry_id, field_name, old_value, new_value, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(req.user.id, table, id, fieldName, String(oldValue), String(newValue), reason);
  });

  tx();
  queueSupabaseSync();

  res.json({
    message: "Adjustment applied",
    table,
    entryId: id,
    fieldName,
    oldValue,
    newValue,
    reason,
  });
});

app.get("/api/admin/adjustments", authRequired, roleRequired("admin"), (req, res) => {
  const rows = db
    .prepare(
      `SELECT a.id, a.table_name, a.entry_id, a.field_name, a.old_value, a.new_value, a.reason, a.created_at, u.username AS admin_username
       FROM adjustments a
       JOIN users u ON u.id = a.admin_user_id
       ORDER BY a.created_at DESC
       LIMIT 200`
    )
    .all();

  res.json({ rows });
});

app.get("/api/admin/blame-analysis", authRequired, roleRequired("admin"), (req, res) => {
  const { date: dateStr, breadType: filterBreadType } = req.query;
  if (filterBreadType && !validateBreadType(filterBreadType)) {
    return badRequest(res, "Invalid bread type filter");
  }
  const { start, end } = toDateBounds(dateStr);

  // Collect all submissions from each stage for the period
  const prodRows = db
    .prepare(
      `SELECT bread_type, SUM(produced_count) as total FROM production_logs
       WHERE created_at BETWEEN ? AND ? ${filterBreadType ? "AND bread_type = ?" : ""}
       GROUP BY bread_type`
    )
    .all(...(filterBreadType ? [start, end, filterBreadType] : [start, end]));

  const bagRows = db
    .prepare(
      `SELECT bread_type, SUM(received_count) as received, SUM(bagged_count) as total FROM bagging_logs
       WHERE created_at BETWEEN ? AND ? ${filterBreadType ? "AND bread_type = ?" : ""}
       GROUP BY bread_type`
    )
    .all(...(filterBreadType ? [start, end, filterBreadType] : [start, end]));

  const saleRows = db
    .prepare(
      `SELECT bread_type, SUM(received_for_sales) as received, SUM(total_sold) as total FROM sales_logs
       WHERE created_at BETWEEN ? AND ? ${filterBreadType ? "AND bread_type = ?" : ""}
       GROUP BY bread_type`
    )
    .all(...(filterBreadType ? [start, end, filterBreadType] : [start, end]));

  const delRows = db
    .prepare(
      `SELECT bread_type, SUM(taken_count) as received, SUM(total_delivered) as total FROM delivery_logs
       WHERE created_at BETWEEN ? AND ? ${filterBreadType ? "AND bread_type = ?" : ""}
       GROUP BY bread_type`
    )
    .all(...(filterBreadType ? [start, end, filterBreadType] : [start, end]));

  // Perform root-cause analysis
  const analysis = [];

  const allBreadTypes = new Set(filterBreadType ? [filterBreadType] : Object.keys(BREAD_TYPES));
  [...prodRows, ...bagRows, ...saleRows, ...delRows].forEach((r) => allBreadTypes.add(r.bread_type));

  allBreadTypes.forEach((breadType) => {
    const prod = prodRows.find((r) => r.bread_type === breadType);
    const bag = bagRows.find((r) => r.bread_type === breadType);
    const sale = saleRows.find((r) => r.bread_type === breadType);
    const del = delRows.find((r) => r.bread_type === breadType);

    const produced = prod?.total ?? 0;
    const baggerReceived = bag?.received ?? 0;
    const bagged = bag?.total ?? 0;
    const salesReceived = sale?.received ?? 0;
    const sold = sale?.total ?? 0;
    const deliveryTaken = del?.received ?? 0;
    const delivered = del?.total ?? 0;

    const bakerLoss = produced - baggerReceived;
    const baggerLoss = baggerReceived - bagged;
    const baggerToSalesLoss = bagged - salesReceived;
    const salesLoss = salesReceived - sold;
    const salesToDeliveryLoss = sold - deliveryTaken;
    const deliveryLoss = deliveryTaken - delivered;

    const blame = [];
    const dataGaps = [];
    if (bakerLoss > 0) {
      blame.push({
        stage: "Baker",
        loss: bakerLoss,
        reason: `Baker produced ${produced} but bagger only received ${baggerReceived}`,
      });
    }
    if (baggerLoss > 0) {
      blame.push({
        stage: "Bagger",
        loss: baggerLoss,
        reason: `Bagger received ${baggerReceived} but bagged ${bagged}`,
      });
    }
    if (baggerToSalesLoss > 0) {
      blame.push({
        stage: "Transit (Bagger→Sales)",
        loss: baggerToSalesLoss,
        reason: `Bagger released ${bagged} but sales received ${salesReceived}`,
      });
    }
    if (salesLoss > 0) {
      blame.push({
        stage: "Sales",
        loss: salesLoss,
        reason: `Sales received ${salesReceived} but sold ${sold}`,
      });
    }
    if (salesToDeliveryLoss > 0) {
      blame.push({
        stage: "Transit (Sales→Delivery)",
        loss: salesToDeliveryLoss,
        reason: `Sales released ${sold} but delivery took ${deliveryTaken}`,
      });
    }
    if (deliveryLoss > 0) {
      blame.push({
        stage: "Delivery",
        loss: deliveryLoss,
        reason: `Delivery took ${deliveryTaken} but delivered ${delivered}`,
      });
    }

    if (produced > 0 && baggerReceived === 0) {
      dataGaps.push("No bagger received logs for produced loaves");
    }
    if (bagged > 0 && salesReceived === 0) {
      dataGaps.push("No sales received logs for bagged loaves");
    }
    if (sold > 0 && deliveryTaken === 0) {
      dataGaps.push("No delivery intake logs for sold loaves");
    }

    const hasData = produced > 0 || baggerReceived > 0 || bagged > 0 || salesReceived > 0 || sold > 0 || deliveryTaken > 0 || delivered > 0;
    const confidence = !hasData ? "none" : dataGaps.length ? "medium" : "high";

    analysis.push({
      breadType,
      produced,
      bagged,
      sold,
      delivered,
      totalLoss: produced - delivered,
      hasData,
      confidence,
      dataGaps,
      flow: {
        produced,
        baggerReceived,
        bagged,
        salesReceived,
        sold,
        deliveryTaken,
        delivered,
      },
      blame: blame.length > 0 ? blame : [{ stage: "None", loss: 0, reason: hasData ? "No discrepancies" : "No submissions recorded for selected date" }],
    });
  });

  res.json({ date: dateStr || new Date().toISOString().slice(0, 10), analysis });
});

app.get("/api/staff/my-submissions", authRequired, (req, res) => {
  const production = db
    .prepare(
      `SELECT id, bread_type, flour_bags, produced_count, expected_output, sugar, salt, preservative, butter, yeast, improver, difference, created_at
       FROM production_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
    )
    .all(req.user.id);

  const bagging = db
    .prepare(
      `SELECT id, bread_type, received_count, bagged_count, difference, created_at
       FROM bagging_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
    )
    .all(req.user.id);

  const sales = db
    .prepare(
      `SELECT id, bread_type, received_for_sales, total_sold, difference, created_at
       FROM sales_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
    )
    .all(req.user.id);

  const delivery = db
    .prepare(
      `SELECT id, bread_type, taken_count, total_delivered, difference, created_at
       FROM delivery_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
    )
    .all(req.user.id);

  res.json({ production, bagging, sales, delivery });
});

app.get("/api/admin/all-submissions", authRequired, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admins only" });
  }

  // Use PostgreSQL if available, otherwise fall back to SQLite
  let production, bagging, sales, delivery;

  if (pgPool) {
    try {
      const pgRes = await Promise.all([
        pgPool.query("SELECT id, bread_type, produced_count, expected_output, difference, created_at, user_id FROM production_logs ORDER BY created_at DESC"),
        pgPool.query("SELECT id, bread_type, received_count, bagged_count, difference, created_at, user_id FROM bagging_logs ORDER BY created_at DESC"),
        pgPool.query("SELECT id, bread_type, received_for_sales, total_sold, difference, created_at, user_id FROM sales_logs ORDER BY created_at DESC"),
        pgPool.query("SELECT id, bread_type, taken_count, total_delivered, difference, created_at, user_id FROM delivery_logs ORDER BY created_at DESC"),
      ]);
      production = pgRes[0].rows || [];
      bagging = pgRes[1].rows || [];
      sales = pgRes[2].rows || [];
      delivery = pgRes[3].rows || [];
    } catch (error) {
      console.error("PG query failed, falling back to SQLite:", error.message);
      // Fall through to SQLite
    }
  }

  // Fallback to SQLite
  if (!production) {
    production = db
      .prepare(
        `SELECT id, bread_type, produced_count, expected_output, difference, created_at, user_id
         FROM production_logs ORDER BY created_at DESC`
      )
      .all();
    bagging = db
      .prepare(
        `SELECT id, bread_type, received_count, bagged_count, difference, created_at, user_id
         FROM bagging_logs ORDER BY created_at DESC`
      )
      .all();
    sales = db
      .prepare(
        `SELECT id, bread_type, received_for_sales, total_sold, difference, created_at, user_id
         FROM sales_logs ORDER BY created_at DESC`
      )
      .all();
    delivery = db
      .prepare(
        `SELECT id, bread_type, taken_count, total_delivered, difference, created_at, user_id
         FROM delivery_logs ORDER BY created_at DESC`
      )
      .all();
  }

  res.json({ production, bagging, sales, delivery });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

if (!IS_VERCEL) {
  app.listen(PORT, () => {
    console.log(`Bakery control system running on http://localhost:${PORT}`);
  });
}

  app.use((err, _req, res, _next) => {
    console.error("Unhandled API error:", err);
    const message = err && err.message ? err.message : "Internal server error";
    res.status(500).json({ error: "Internal Server Error", message });
  });

module.exports = app;
