const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const DB_PATH = path.join(__dirname, "..", "bakery.db");

const BREAD_TYPES = {
  Jumbo: { price: 2000, fromFlourBag: 65 },
  Eco: { price: 1300, fromFlourBag: 100 },
  Mini: { price: 500, fromFlourBag: 250 },
};

const INGREDIENTS = [
  "flour",
  "sugar",
  "salt",
  "preservative",
  "butter",
  "yeast",
  "vegetable_oil",
  "improver",
];

const THRESHOLD = 2;
const CRITICAL_THRESHOLD = 10;

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

function hasColumn(tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column.name === columnName);
}

function migrateUsersTable() {
  if (!hasColumn("users", "name")) {
    db.exec("ALTER TABLE users ADD COLUMN name TEXT NOT NULL DEFAULT ''");
  }

  if (!hasColumn("users", "email")) {
    db.exec("ALTER TABLE users ADD COLUMN email TEXT");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL");
  }

  if (!hasColumn("users", "phone")) {
    db.exec("ALTER TABLE users ADD COLUMN phone TEXT");
  }

  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL");
}

function removeLegacySeedStaff() {
  const legacyUsers = db
    .prepare(
      `SELECT id FROM users
       WHERE email IS NULL
         AND username IN ('baker_01', 'bagger_01', 'sales_01', 'delivery_01')`
    )
    .all();

  if (!legacyUsers.length) {
    return;
  }

  const deleteProductionLogs = db.prepare("DELETE FROM production_logs WHERE user_id = ?");
  const deleteBaggingLogs = db.prepare("DELETE FROM bagging_logs WHERE user_id = ?");
  const deleteSalesLogs = db.prepare("DELETE FROM sales_logs WHERE user_id = ?");
  const deleteDeliveryLogs = db.prepare("DELETE FROM delivery_logs WHERE user_id = ?");
  const deleteDiscrepancies = db.prepare("DELETE FROM discrepancies WHERE user_id = ?");
  const clearAdjustedBy = db.prepare("UPDATE production_logs SET adjusted_by = NULL, adjusted_at = NULL WHERE adjusted_by = ?");
  const clearBaggingAdjustedBy = db.prepare("UPDATE bagging_logs SET adjusted_by = NULL, adjusted_at = NULL WHERE adjusted_by = ?");
  const clearSalesAdjustedBy = db.prepare("UPDATE sales_logs SET adjusted_by = NULL, adjusted_at = NULL WHERE adjusted_by = ?");
  const clearDeliveryAdjustedBy = db.prepare("UPDATE delivery_logs SET adjusted_by = NULL, adjusted_at = NULL WHERE adjusted_by = ?");
  const deleteAdjustments = db.prepare("DELETE FROM adjustments WHERE admin_user_id = ?");
  const deleteUser = db.prepare("DELETE FROM users WHERE id = ?");

  const cleanup = db.transaction((users) => {
    users.forEach(({ id }) => {
      deleteDiscrepancies.run(id);
      clearAdjustedBy.run(id);
      clearBaggingAdjustedBy.run(id);
      clearSalesAdjustedBy.run(id);
      clearDeliveryAdjustedBy.run(id);
      deleteProductionLogs.run(id);
      deleteBaggingLogs.run(id);
      deleteSalesLogs.run(id);
      deleteDeliveryLogs.run(id);
      deleteAdjustments.run(id);
      deleteUser.run(id);
    });
  });

  cleanup(legacyUsers);
}

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      email TEXT UNIQUE,
      phone TEXT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'baker', 'bagger', 'sales', 'delivery')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS production_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      bread_type TEXT NOT NULL,
      flour_bags REAL NOT NULL,
      expected_output REAL NOT NULL,
      produced_count INTEGER NOT NULL,
      sugar REAL NOT NULL,
      salt REAL NOT NULL,
      preservative REAL NOT NULL,
      butter REAL NOT NULL,
      yeast REAL NOT NULL,
      vegetable_oil REAL NOT NULL,
      improver REAL NOT NULL,
      difference REAL NOT NULL,
      flagged INTEGER NOT NULL,
      severity TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      adjusted_by INTEGER,
      adjusted_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(adjusted_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS bagging_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      bread_type TEXT NOT NULL,
      received_count INTEGER NOT NULL,
      bagged_count INTEGER NOT NULL,
      difference INTEGER NOT NULL,
      flagged INTEGER NOT NULL,
      severity TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      adjusted_by INTEGER,
      adjusted_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(adjusted_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS sales_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      bread_type TEXT NOT NULL,
      received_for_sales INTEGER NOT NULL,
      paid_count INTEGER NOT NULL,
      credit_count INTEGER NOT NULL,
      total_sold INTEGER NOT NULL,
      difference INTEGER NOT NULL,
      flagged INTEGER NOT NULL,
      severity TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      adjusted_by INTEGER,
      adjusted_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(adjusted_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS delivery_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      bread_type TEXT NOT NULL,
      taken_count INTEGER NOT NULL,
      paid_count INTEGER NOT NULL,
      credit_count INTEGER NOT NULL,
      total_delivered INTEGER NOT NULL,
      difference INTEGER NOT NULL,
      flagged INTEGER NOT NULL,
      severity TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      adjusted_by INTEGER,
      adjusted_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(adjusted_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS discrepancies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stage TEXT NOT NULL,
      ref_table TEXT NOT NULL,
      ref_id INTEGER NOT NULL,
      bread_type TEXT NOT NULL,
      difference REAL NOT NULL,
      user_id INTEGER NOT NULL,
      severity TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_user_id INTEGER NOT NULL,
      table_name TEXT NOT NULL,
      entry_id INTEGER NOT NULL,
      field_name TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(admin_user_id) REFERENCES users(id)
    );
  `);

  migrateUsersTable();
  seedUsers();
  removeLegacySeedStaff();
}

function seedUsers() {
  const adminExists = db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
  if (!adminExists) {
    db.prepare(
      "INSERT INTO users (name, email, username, password_hash, role) VALUES (?, ?, ?, ?, ?)"
    ).run("Admin", "admin@bakery.com", "owner_admin", bcrypt.hashSync("admin123", 10), "admin");
    return;
  }

  db.prepare(
    `UPDATE users
     SET name = COALESCE(NULLIF(name, ''), 'Admin'),
         email = COALESCE(email, 'admin@bakery.com')
     WHERE role = 'admin' AND (name = '' OR name IS NULL OR email IS NULL)`
  ).run();
}

function getSeverity(absDifference) {
  if (absDifference > CRITICAL_THRESHOLD) {
    return "critical";
  }
  if (absDifference > THRESHOLD) {
    return "warning";
  }
  return null;
}

function maybeRecordDiscrepancy({ stage, refTable, refId, breadType, difference, userId }) {
  const absDifference = Math.abs(difference);
  const severity = getSeverity(absDifference);
  if (!severity) return;

  db.prepare(
    `INSERT INTO discrepancies (stage, ref_table, ref_id, bread_type, difference, user_id, severity)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(stage, refTable, refId, breadType, difference, userId, severity);
}

function toDateBounds(dateText) {
  const day = dateText || new Date().toISOString().slice(0, 10);
  const start = `${day} 00:00:00`;
  const end = `${day} 23:59:59`;
  return { day, start, end };
}

function getDailyTotalsByBread(dateText) {
  const { start, end } = toDateBounds(dateText);

  const producedRows = db
    .prepare(
      `SELECT bread_type, COALESCE(SUM(produced_count), 0) AS total FROM production_logs
       WHERE created_at BETWEEN ? AND ? GROUP BY bread_type`
    )
    .all(start, end);

  const baggedRows = db
    .prepare(
      `SELECT bread_type, COALESCE(SUM(bagged_count), 0) AS total FROM bagging_logs
       WHERE created_at BETWEEN ? AND ? GROUP BY bread_type`
    )
    .all(start, end);

  const soldRows = db
    .prepare(
      `SELECT bread_type, COALESCE(SUM(total_sold), 0) AS total FROM sales_logs
       WHERE created_at BETWEEN ? AND ? GROUP BY bread_type`
    )
    .all(start, end);

  const deliveredRows = db
    .prepare(
      `SELECT bread_type, COALESCE(SUM(total_delivered), 0) AS total FROM delivery_logs
       WHERE created_at BETWEEN ? AND ? GROUP BY bread_type`
    )
    .all(start, end);

  const totals = Object.keys(BREAD_TYPES).map((breadType) => ({
    breadType,
    produced: 0,
    bagged: 0,
    sold: 0,
    delivered: 0,
  }));

  const index = new Map(totals.map((item) => [item.breadType, item]));
  producedRows.forEach((row) => (index.get(row.bread_type).produced = Number(row.total)));
  baggedRows.forEach((row) => (index.get(row.bread_type).bagged = Number(row.total)));
  soldRows.forEach((row) => (index.get(row.bread_type).sold = Number(row.total)));
  deliveredRows.forEach((row) => (index.get(row.bread_type).delivered = Number(row.total)));

  return totals;
}

module.exports = {
  db,
  initDb,
  BREAD_TYPES,
  INGREDIENTS,
  THRESHOLD,
  CRITICAL_THRESHOLD,
  getSeverity,
  maybeRecordDiscrepancy,
  toDateBounds,
  getDailyTotalsByBread,
};
