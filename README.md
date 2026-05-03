# Bakery Operations Control System

Bakery Operations Control System for tracking production, ingredient usage, stage-by-stage bread accountability, discrepancies, and financial loss.

The system enforces role-based accountability:

- Admin (owner)
- Baker
- Bagger
- Sales
- Delivery

Every submission is automatically tied to the logged-in account and timestamped by the database.
No manual staff name entry is used anywhere.

## Features

- Role-based login with unique user accounts
- Bread production tracking with flour-to-output expectations
- Ingredient usage tracking per production batch
- Bagger, Sales, and Delivery stage submissions
- Automatic discrepancy detection with threshold logic
- Admin-only alerts, summaries, daily report, and adjustments
- One-click admin CSV export for the selected report date
- Staff submission history (read-only for staff)
- Financial loss calculation from missing loaves by bread type pricing
- Critical discrepancy email notifications (SMTP)
- Optional Supabase PostgreSQL persistence sync for production durability
- Mobile-first, fast input dashboard UI

## Bread Types And Prices

- Jumbo: 2000
- Eco: 1300
- Mini: 500

## Production Rules

Expected output from 1 flour bag:

- Mini: 250
- Jumbo: 65
- Eco: 100

Discrepancy threshold:

- Difference <= 2: ignored
- Difference > 2: warning
- Difference > 10: critical

## Ingredients Tracked

- Flour
- Sugar
- Salt
- Preservative
- Butter
- Yeast
- Vegetable oil
- Improver

## Tech Stack

- Node.js
- Express
- SQLite via better-sqlite3
- PostgreSQL (Supabase) sync via pg
- JWT authentication
- Nodemailer (SMTP alerts)
- Vanilla HTML/CSS/JS frontend

## Run Locally

1. Install dependencies

	npm install

2. Start server

	npm start

3. Open in browser

	http://localhost:3000

Database file is auto-created as bakery.db in the project root.

## Seeded Accounts

- Admin: admin@bakery.com / admin123
- Staff: created by admin from the dashboard, then log in with email / password

## Dashboards

### Baker

Inputs:

- Flour bags used
- Bread type
- Breads produced
- Sugar, Salt, Preservative, Butter, Yeast, Vegetable Oil, Improver

System:

- Calculates expected output from flour bags
- Compares expected vs produced
- Flags discrepancy when difference exceeds threshold
- Stores full ingredient usage per batch

### Bagger

Inputs:

- Bread type
- Breads received
- Breads bagged

System:

- Compares received vs bagged
- Flags discrepancy when difference exceeds threshold

### Sales

Inputs:

- Bread type
- Sold paid
- Sold credit

System:

- Total sold = paid + credit
- Compares against inferred available stock from bagging flow
- Flags discrepancy when difference exceeds threshold

### Delivery

Inputs:

- Bread type
- Taken for delivery
- Delivered paid
- Delivered credit

System:

- Total delivered = paid + credit
- Compares taken vs delivered
- Flags discrepancy when difference exceeds threshold

### Admin

Includes:

- Stage summary by bread type (produced, bagged, sold, delivered)
- Daily ingredient totals and per-batch ingredient usage
- Itemized discrepancies with responsible staff and timestamp
- Cross-stage discrepancy checks
- Alert feed (warning and critical only)
- Loss calculation (missing breads and money value)
- Staff accountability (submissions, discrepancies, accuracy rate)
- Daily report
- Admin-only adjustments with audit log

## Global Rules Enforced

- Every action is linked to authenticated user ID
- Every submission is timestamped automatically
- Staff do not get edit routes
- Only admin can adjust submitted records
- Adjustment actions are logged with reason

## API Overview

Auth:

- POST /api/auth/login
- GET /api/auth/me

Staff submissions:

- POST /api/production (baker)
- POST /api/bagging (bagger)
- POST /api/sales (sales)
- POST /api/delivery (delivery)
- GET /api/staff/my-submissions

Admin:

- GET /api/admin/summary
- GET /api/admin/ingredients
- GET /api/admin/discrepancies
- GET /api/admin/loss
- GET /api/admin/staff-accountability
- GET /api/admin/daily-report
- GET /api/admin/alerts
- GET /api/admin/export-csv
- PATCH /api/admin/adjust/:table/:id
- GET /api/admin/adjustments

## Notes

- Use a strong JWT_SECRET in production.
- Seed passwords are for local development only.

## Production Environment Variables

- JWT_SECRET: required, long random secret
- ADMIN_ACCESS_CODE: required, admin portal code
- ALERT_EMAIL_TO: comma-separated recipients for critical alerts
- SMTP_HOST: SMTP host for alert delivery
- SMTP_PORT: SMTP port (for example 587 or 465)
- SMTP_USER: SMTP username
- SMTP_PASS: SMTP password or app password
- SMTP_FROM: optional from address (defaults to SMTP_USER)
- DATABASE_URL or SUPABASE_DB_URL: optional Supabase PostgreSQL connection string for persistent sync

If DATABASE_URL/SUPABASE_DB_URL is set, the app initializes SQLite locally and synchronizes all operational tables to Supabase so data survives serverless restarts.