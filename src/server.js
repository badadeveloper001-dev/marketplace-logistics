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
  BREAD_TYPES,
  THRESHOLD,
  getSeverity,
  maybeRecordDiscrepancy,
  toDateBounds,
  getDailyTotalsByBread,
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

function createUserSafe(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
  };
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

app.post("/api/auth/admin-login", (req, res) => {
  const code = String(req.body.code || "").trim();
  if (!code) return badRequest(res, "Access code is required");
  if (code !== ADMIN_ACCESS_CODE) {
    return res.status(401).json({ error: "Invalid access code" });
  }

  const admin = db.prepare("SELECT id, name, email, phone, role FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!admin) return res.status(500).json({ error: "Admin account not configured" });

  const token = jwt.sign(
    { id: admin.id, name: admin.name, email: admin.email, phone: admin.phone, role: admin.role },
    JWT_SECRET,
    { expiresIn: "12h" }
  );

  res.json({ token, user: { id: admin.id, name: admin.name, email: admin.email, role: admin.role } });
});

app.post("/api/auth/login", (req, res) => {
  const phone = String(req.body.phone || "").trim();
  const password = String(req.body.password || "");
  if (!phone || !password) {
    return badRequest(res, "Phone number and password are required");
  }

  const user = db
    .prepare("SELECT id, name, email, phone, username, role, password_hash FROM users WHERE phone = ?")
    .get(phone);

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
  queueSupabaseSync();
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
      "yeast",
      "vegetable_oil",
      "improver",
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

app.post("/api/production", authRequired, roleRequired("baker"), (req, res) => {
  const {
    breadType,
    flourBags,
    producedCount,
    sugar,
    salt,
    preservative,
    butter,
    yeast,
    vegetableOil,
    improver,
  } = req.body;

  if (!validateBreadType(breadType)) {
    return badRequest(res, "Invalid bread type");
  }

  const flour = asNumber(flourBags);
  const produced = asNumber(producedCount);
  const ingSugar = asNumber(sugar);
  const ingSalt = asNumber(salt);
  const ingPreservative = asNumber(preservative);
  const ingButter = asNumber(butter);
  const ingYeast = asNumber(yeast);
  const ingVegetableOil = asNumber(vegetableOil);
  const ingImprover = asNumber(improver);

  const values = [
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
  const severity = getSeverity(Math.abs(difference));
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

  const createdAt = db
    .prepare("SELECT created_at FROM production_logs WHERE id = ?")
    .get(info.lastInsertRowid).created_at;

  maybeSendCriticalAlertEmail({
    stage: "production",
    breadType,
    difference,
    severity,
    staffName: req.user.name,
    staffRole: req.user.role,
    createdAt,
  });
  queueSupabaseSync();

  res.status(201).json({
    id: info.lastInsertRowid,
    breadType,
    expectedOutput,
    producedCount: produced,
    difference,
    flagged: Boolean(flagged),
    severity,
    createdAt,
  });
});

app.post("/api/bagging", authRequired, roleRequired("bagger"), (req, res) => {
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

  const createdAt = db.prepare("SELECT created_at FROM bagging_logs WHERE id = ?").get(info.lastInsertRowid)
    .created_at;

  maybeSendCriticalAlertEmail({
    stage: "bagging",
    breadType,
    difference,
    severity,
    staffName: req.user.name,
    staffRole: req.user.role,
    createdAt,
  });
  queueSupabaseSync();

  res.status(201).json({
    id: info.lastInsertRowid,
    breadType,
    difference,
    flagged: Boolean(flagged),
    severity,
    createdAt,
  });
});

app.post("/api/sales", authRequired, roleRequired("sales"), (req, res) => {
  const { breadType, paidCount, creditCount } = req.body;

  if (!validateBreadType(breadType)) {
    return badRequest(res, "Invalid bread type");
  }

  const paid = asNumber(paidCount);
  const credit = asNumber(creditCount);

  if ([paid, credit].some((n) => Number.isNaN(n) || n < 0)) {
    return badRequest(res, "Counts must be non-negative numbers");
  }

  const totalSold = paid + credit;

  const baggedTotal = db
    .prepare(
      `SELECT COALESCE(SUM(bagged_count), 0) AS total FROM bagging_logs WHERE bread_type = ? AND date(created_at) = date('now')`
    )
    .get(breadType).total;

  const soldBefore = db
    .prepare(
      `SELECT COALESCE(SUM(total_sold), 0) AS total FROM sales_logs WHERE bread_type = ? AND date(created_at) = date('now')`
    )
    .get(breadType).total;

  const receivedForSales = Number(baggedTotal) - Number(soldBefore);
  const difference = receivedForSales - totalSold;
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
      receivedForSales,
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

  const createdAt = db.prepare("SELECT created_at FROM sales_logs WHERE id = ?").get(info.lastInsertRowid)
    .created_at;

  maybeSendCriticalAlertEmail({
    stage: "sales",
    breadType,
    difference,
    severity,
    staffName: req.user.name,
    staffRole: req.user.role,
    createdAt,
  });
  queueSupabaseSync();

  res.status(201).json({
    id: info.lastInsertRowid,
    breadType,
    totalSold,
    inferredReceivedForSales: receivedForSales,
    difference,
    flagged: Boolean(flagged),
    severity,
    createdAt,
  });
});

app.post("/api/delivery", authRequired, roleRequired("delivery"), (req, res) => {
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

  const createdAt = db
    .prepare("SELECT created_at FROM delivery_logs WHERE id = ?")
    .get(info.lastInsertRowid).created_at;

  maybeSendCriticalAlertEmail({
    stage: "delivery",
    breadType,
    difference,
    severity,
    staffName: req.user.name,
    staffRole: req.user.role,
    createdAt,
  });
  queueSupabaseSync();

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

  const normalizedPhone = phone.replace(/[\s\-\+\(\)]/g, "").replace(/^234/, "0");

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
  const username = `staff_${normalizedPhone.slice(-6)}`;

  const info = db
    .prepare("INSERT INTO users (name, email, phone, username, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)")
    .run(name, email || null, normalizedPhone, username, passwordHash, role);

  const created = db
    .prepare("SELECT id, name, email, phone, role, created_at FROM users WHERE id = ?")
    .get(info.lastInsertRowid);
  
  queueSupabaseSync();
  
  try {
    await ensureSyncComplete();
  } catch (error) {
    console.error("Sync failed during staff creation:", error.message);
    // On Vercel, if sync to PostgreSQL fails, data will be lost when instance restarts
    // So we must throw an error instead of silently failing
    if (IS_VERCEL) {
      return res.status(500).json({ error: "Failed to persist staff data. Please try again." });
    }
  }

  res.status(201).json({ user: created });
});

app.get("/api/admin/staff", authRequired, roleRequired("admin"), (req, res) => {
  const staff = db
    .prepare("SELECT id, name, email, phone, role, created_at FROM users WHERE role != 'admin' ORDER BY role, name")
    .all();
  res.json({ staff });
});

app.delete("/api/admin/staff/:id", authRequired, roleRequired("admin"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return badRequest(res, "Invalid staff ID");
  }
  const user = db.prepare("SELECT id, role FROM users WHERE id = ?").get(id);
  if (!user) return res.status(404).json({ error: "Staff not found" });
  if (user.role === "admin") return res.status(403).json({ error: "Cannot delete admin" });
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  queueSupabaseSync();
  
  try {
    await ensureSyncComplete();
  } catch (error) {
    console.error("Sync failed during staff deletion:", error.message);
    // On Vercel, if sync to PostgreSQL fails, data will be lost when instance restarts
    // So we must throw an error instead of silently failing
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
  const day = req.query.date;
  const totals = getDailyTotalsByBread(day);

  let totalMissingBreads = 0;
  let totalFinancialLoss = 0;

  const byBreadType = totals.map((row) => {
    const missingAtStages =
      Math.max(0, row.produced - row.bagged) +
      Math.max(0, row.bagged - row.sold) +
      Math.max(0, row.sold - row.delivered);

    const loss = missingAtStages * BREAD_TYPES[row.breadType].price;
    totalMissingBreads += missingAtStages;
    totalFinancialLoss += loss;

    return {
      breadType: row.breadType,
      missingBreads: missingAtStages,
      unitPrice: BREAD_TYPES[row.breadType].price,
      loss,
    };
  });

  res.json({
    date: day || new Date().toISOString().slice(0, 10),
    byBreadType,
    totalMissingBreads,
    totalFinancialLoss,
  });
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

  const rows = db
    .prepare(
      `SELECT * FROM (
       SELECT 'baker' AS stage, u.name AS staff_name, p.bread_type, p.created_at,
              p.produced_count AS quantity, p.difference, p.severity
       FROM production_logs p
       JOIN users u ON u.id = p.user_id
       WHERE p.created_at BETWEEN ? AND ?

       UNION ALL

       SELECT 'bagger' AS stage, u.name AS staff_name, b.bread_type, b.created_at,
              b.bagged_count AS quantity, b.difference, b.severity
       FROM bagging_logs b
       JOIN users u ON u.id = b.user_id
       WHERE b.created_at BETWEEN ? AND ?

       UNION ALL

       SELECT 'sales' AS stage, u.name AS staff_name, s.bread_type, s.created_at,
              s.total_sold AS quantity, s.difference, s.severity
       FROM sales_logs s
       JOIN users u ON u.id = s.user_id
       WHERE s.created_at BETWEEN ? AND ?

       UNION ALL

       SELECT 'delivery' AS stage, u.name AS staff_name, d.bread_type, d.created_at,
              d.total_delivered AS quantity, d.difference, d.severity
       FROM delivery_logs d
       JOIN users u ON u.id = d.user_id
       WHERE d.created_at BETWEEN ? AND ?
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
  res.setHeader("Content-Disposition", `attachment; filename="bigcat-report-${day}.csv"`);
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

app.get("/api/staff/my-submissions", authRequired, (req, res) => {
  const production = db
    .prepare(
      `SELECT id, bread_type, produced_count, expected_output, difference, created_at
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

app.get("/api/admin/all-submissions", authRequired, (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admins only" });
  }
  const production = db
    .prepare(
      `SELECT id, bread_type, produced_count, expected_output, difference, created_at, user_id
       FROM production_logs ORDER BY created_at DESC`
    )
    .all();
  const bagging = db
    .prepare(
      `SELECT id, bread_type, received_count, bagged_count, difference, created_at, user_id
       FROM bagging_logs ORDER BY created_at DESC`
    )
    .all();
  const sales = db
    .prepare(
      `SELECT id, bread_type, received_for_sales, total_sold, difference, created_at, user_id
       FROM sales_logs ORDER BY created_at DESC`
    )
    .all();
  const delivery = db
    .prepare(
      `SELECT id, bread_type, taken_count, total_delivered, difference, created_at, user_id
       FROM delivery_logs ORDER BY created_at DESC`
    )
    .all();
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
