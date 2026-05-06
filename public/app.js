const state = {
  token: localStorage.getItem("bakery_token") || "",
  user: null,
  breadTypes: {},
  adminFilters: {
    baker: "all",
    bagger: "all",
    sales: "all",
    delivery: "all",
  },
};

const el = {
  loginView: document.getElementById("loginView"),
  appView: document.getElementById("appView"),
  loginForm: document.getElementById("loginForm"),
  adminLoginForm: document.getElementById("adminLoginForm"),
  toast: document.getElementById("toast"),
  welcomeTitle: document.getElementById("welcomeTitle"),
  roleInfo: document.getElementById("roleInfo"),
  logoutBtn: document.getElementById("logoutBtn"),
  quickNav: document.getElementById("quickNav"),
  staffPanel: document.getElementById("staffPanel"),
  adminPanel: document.getElementById("adminPanel"),
  bakerCard: document.getElementById("bakerCard"),
  baggerCard: document.getElementById("baggerCard"),
  salesCard: document.getElementById("salesCard"),
  deliveryCard: document.getElementById("deliveryCard"),
  productionForm: document.getElementById("productionForm"),
  baggingForm: document.getElementById("baggingForm"),
  salesForm: document.getElementById("salesForm"),
  deliveryForm: document.getElementById("deliveryForm"),
  mySubmissionsCard: document.getElementById("mySubmissionsCard"),
  mySubmissions: document.getElementById("mySubmissions"),
  userAvatar: document.getElementById("userAvatar"),
  createStaffForm: document.getElementById("createStaffForm"),
  staffList: document.getElementById("staffList"),
  refreshAdminBtn: document.getElementById("refreshAdminBtn"),
  exportCsvBtn: document.getElementById("exportCsvBtn"),
  reportDate: document.getElementById("reportDate"),
  adminCounts: document.getElementById("adminCounts"),
  alertSummary: document.getElementById("alertSummary"),
  topDiscrepancies: document.getElementById("topDiscrepancies"),
  bakerFilters: document.getElementById("bakerFilters"),
  baggerFilters: document.getElementById("baggerFilters"),
  salesFilters: document.getElementById("salesFilters"),
  deliveryFilters: document.getElementById("deliveryFilters"),
  bakerSubmissionsTable: document.getElementById("bakerSubmissionsTable"),
  baggerSubmissionsTable: document.getElementById("baggerSubmissionsTable"),
  salesSubmissionsTable: document.getElementById("salesSubmissionsTable"),
  deliverySubmissionsTable: document.getElementById("deliverySubmissionsTable"),
  batchHistoryCard: document.getElementById("batchHistoryCard"),
  batchHistory: document.getElementById("batchHistory"),
  historyFromDate: document.getElementById("historyFromDate"),
  historyBreadType: document.getElementById("historyBreadType"),
  applyHistoryFilter: document.getElementById("applyHistoryFilter"),
  changePasswordCard: document.getElementById("changePasswordCard"),
  changePasswordForm: document.getElementById("changePasswordForm"),
};

function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.remove("hidden");
  setTimeout(() => el.toast.classList.add("hidden"), 2500);
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }

  return payload;
}

function breadTypeOptions() {
  return Object.keys(state.breadTypes)
    .map((t) => `<option value="${t}">${t}</option>`)
    .join("");
}

function renderFormsByRole() {
  const role = state.user.role;
  const options = breadTypeOptions();

  el.staffPanel.classList.remove("hidden");
  el.bakerCard.classList.add("hidden");
  el.baggerCard.classList.add("hidden");
  el.salesCard.classList.add("hidden");
  el.deliveryCard.classList.add("hidden");
  el.mySubmissionsCard.classList.add("hidden");

  if (role === "baker") {
    el.bakerCard.classList.remove("hidden");
    el.productionForm.innerHTML = `
      <p class="form-intro">Submit one batch at a time.</p>
      <h4 class="form-section-title">Production Details</h4>
      <label>Bread Type<select name="breadType" required>${options}</select></label>
      <label>Flour Bags Used<input name="flourBags" type="number" min="0" step="0.01" required /></label>
      <label>Breads Produced<input name="producedCount" type="number" min="0" step="1" required /></label>
      <h4 class="form-section-title span-2">Ingredient Inputs</h4>
      <label>Sugar Used (kg)<input name="sugar" type="number" min="0" step="0.01" required /></label>
      <label>Salt Used (kg)<input name="salt" type="number" min="0" step="0.01" required /></label>
      <label>Preservative Used (grams)<input name="preservative" type="number" min="0" step="0.01" required /></label>
      <label>Butter Used (kg)<input name="butter" type="number" min="0" step="0.01" required /></label>
      <label>Yeast Used (grams)<input name="yeast" type="number" min="0" step="0.01" required /></label>
      <label>Vegetable Oil Used (litres)<input name="vegetableOil" type="number" min="0" step="0.01" required /></label>
      <label>Improver Used (grams)<input name="improver" type="number" min="0" step="0.01" required /></label>
      <button type="submit">Submit Production</button>
      <div id="bakerPreview" class="staff-preview hidden"></div>
    `;

    el.productionForm.onsubmit = async (event) => {
      event.preventDefault();
      const fd = new FormData(el.productionForm);
      const body = Object.fromEntries(fd.entries());
      await submitStaff("/api/production", body, "Production submitted");
    };
  }

  if (role === "bagger") {
    el.baggerCard.classList.remove("hidden");
    el.baggingForm.innerHTML = `
      <p class="form-intro">Submit one batch at a time.</p>
      <label>Bread Type<select name="breadType" required>${options}</select></label>
      <label>Breads Received<input name="receivedCount" type="number" min="0" step="1" required /></label>
      <label>Breads Bagged<input name="baggedCount" type="number" min="0" step="1" required /></label>
      <button type="submit">Submit Bagging</button>
      <div id="baggerPreview" class="staff-preview hidden"></div>
    `;

    el.baggingForm.onsubmit = async (event) => {
      event.preventDefault();
      const fd = new FormData(el.baggingForm);
      await submitStaff("/api/bagging", Object.fromEntries(fd.entries()), "Bagging submitted");
    };
  }

  if (role === "sales") {
    el.salesCard.classList.remove("hidden");
    el.salesForm.innerHTML = `
      <p class="form-intro">Submit one batch at a time.</p>
      <label>Bread Type<select name="breadType" required>${options}</select></label>
      <label>Sold Paid<input name="paidCount" type="number" min="0" step="1" required /></label>
      <label>Sold Credit<input name="creditCount" type="number" min="0" step="1" required /></label>
      <button type="submit">Submit Sales</button>
      <div id="salesPreview" class="staff-preview hidden"></div>
    `;

    el.salesForm.onsubmit = async (event) => {
      event.preventDefault();
      const fd = new FormData(el.salesForm);
      await submitStaff("/api/sales", Object.fromEntries(fd.entries()), "Sales submitted");
    };
  }

  if (role === "delivery") {
    el.deliveryCard.classList.remove("hidden");
    el.deliveryForm.innerHTML = `
      <p class="form-intro">Submit one batch at a time.</p>
      <label>Bread Type<select name="breadType" required>${options}</select></label>
      <label>Taken For Delivery<input name="takenCount" type="number" min="0" step="1" required /></label>
      <label>Delivered Paid<input name="paidCount" type="number" min="0" step="1" required /></label>
      <label>Delivered Credit<input name="creditCount" type="number" min="0" step="1" required /></label>
      <button type="submit">Submit Delivery</button>
      <div id="deliveryPreview" class="staff-preview hidden"></div>
    `;

    el.deliveryForm.onsubmit = async (event) => {
      event.preventDefault();
      const fd = new FormData(el.deliveryForm);
      await submitStaff("/api/delivery", Object.fromEntries(fd.entries()), "Delivery submitted");
    };
  }

  buildQuickNav();
}

async function submitStaff(path, body, successMessage) {
  try {
    const result = await api(path, { method: "POST", body: JSON.stringify(body) });
    const adminNote = state.user?.role === "baker" ? " Sent to admin dashboard." : "";
    showToast(`${successMessage}. Difference: ${result.difference ?? 0}.${adminNote}`);
    renderStaffSubmissionPreview(body, result);
  } catch (error) {
    showToast(error.message);
  }
}

function previewField(label, value) {
  return `<div class="submission-kv"><span>${label}</span><strong>${value ?? "-"}</strong></div>`;
}

function renderStaffSubmissionPreview(submittedBody, savedResult) {
  const role = state.user?.role;
  const createdAt = formatDateTime(savedResult.createdAt || new Date().toISOString());
  const submissionId = savedResult.id ?? "-";
  let target = null;
  let fields = "";

  if (role === "baker") {
    target = document.getElementById("bakerPreview");
    fields = [
      previewField("Bread Type", submittedBody.breadType),
      previewField("Flour Bags", submittedBody.flourBags),
      previewField("Produced", submittedBody.producedCount),
      previewField("Sugar", submittedBody.sugar),
      previewField("Salt", submittedBody.salt),
      previewField("Preservative", submittedBody.preservative),
      previewField("Butter", submittedBody.butter),
      previewField("Yeast", submittedBody.yeast),
      previewField("Vegetable Oil", submittedBody.vegetableOil),
      previewField("Improver", submittedBody.improver),
    ].join("");
  }

  if (role === "bagger") {
    target = document.getElementById("baggerPreview");
    fields = [
      previewField("Bread Type", submittedBody.breadType),
      previewField("Received", submittedBody.receivedCount),
      previewField("Bagged", submittedBody.baggedCount),
    ].join("");
  }

  if (role === "sales") {
    target = document.getElementById("salesPreview");
    fields = [
      previewField("Bread Type", submittedBody.breadType),
      previewField("Paid", submittedBody.paidCount),
      previewField("Credit", submittedBody.creditCount),
      previewField("Total Sold", savedResult.totalSold),
    ].join("");
  }

  if (role === "delivery") {
    target = document.getElementById("deliveryPreview");
    fields = [
      previewField("Bread Type", submittedBody.breadType),
      previewField("Taken", submittedBody.takenCount),
      previewField("Paid", submittedBody.paidCount),
      previewField("Credit", submittedBody.creditCount),
      previewField("Total Delivered", savedResult.totalDelivered),
    ].join("");
  }

  if (!target) return;

  target.innerHTML = `
    <header class="submission-head">
      <div>
        <strong>Latest Submission Preview</strong>
        <div class="submission-meta">Submission ID: ${submissionId}</div>
      </div>
      <time>${createdAt}</time>
    </header>
    <div class="submission-grid">${fields}</div>
  `;
  target.classList.remove("hidden");
}

function renderStaffPreviewFromSavedRecord(record) {
  const role = state.user?.role;
  if (!record || !role) return;

  if (role === "baker") {
    renderStaffSubmissionPreview(
      {
        breadType: record.bread_type,
        flourBags: record.flour_bags,
        producedCount: record.produced_count,
        sugar: record.sugar,
        salt: record.salt,
        preservative: record.preservative,
        butter: record.butter,
        yeast: record.yeast,
        vegetableOil: record.vegetable_oil,
        improver: record.improver,
      },
      {
        id: record.id,
        createdAt: record.created_at,
        totalSold: record.total_sold,
        totalDelivered: record.total_delivered,
      }
    );
    return;
  }

  if (role === "bagger") {
    renderStaffSubmissionPreview(
      {
        breadType: record.bread_type,
        receivedCount: record.received_count,
        baggedCount: record.bagged_count,
      },
      { id: record.id, createdAt: record.created_at }
    );
    return;
  }

  if (role === "sales") {
    renderStaffSubmissionPreview(
      {
        breadType: record.bread_type,
        paidCount: record.paid_count,
        creditCount: record.credit_count,
      },
      { id: record.id, createdAt: record.created_at, totalSold: record.total_sold }
    );
    return;
  }

  if (role === "delivery") {
    renderStaffSubmissionPreview(
      {
        breadType: record.bread_type,
        takenCount: record.taken_count,
        paidCount: record.paid_count,
        creditCount: record.credit_count,
      },
      { id: record.id, createdAt: record.created_at, totalDelivered: record.total_delivered }
    );
  }
}

async function hydrateStaffPreviewFromHistory() {
  const role = state.user?.role;
  if (!role || role === "admin") return;

  const data = await api("/api/staff/my-submissions");
  const latestByRole = {
    baker: data.production?.[0],
    bagger: data.bagging?.[0],
    sales: data.sales?.[0],
    delivery: data.delivery?.[0],
  };

  renderStaffPreviewFromSavedRecord(latestByRole[role]);
}

function tableFromRows(columns, rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (!safeRows.length) return "<p class=\"muted\">No submissions for selected date.</p>";

  const head = columns.map((c) => `<th>${c.label}</th>`).join("");
  const body = safeRows
    .map((row) => {
      const tds = columns
        .map((c) => {
          const value = typeof c.render === "function" ? c.render(row[c.key], row) : row[c.key];
          return `<td>${value ?? ""}</td>`;
        })
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");

  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function severityBadge(severity) {
  if (!severity) return '<span class="badge ok">ok</span>';
  return `<span class="badge ${severity}">${severity}</span>`;
}

function formatDifference(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return numeric > 0 ? `+${numeric}` : `${numeric}`;
}

function absDifference(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.abs(numeric) : 0;
}

function roleFilterCounts(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  return {
    all: safeRows.length,
    flagged: safeRows.filter((row) => Number(row.flagged) === 1).length,
    critical: safeRows.filter((row) => row.severity === "critical").length,
  };
}

function applyAdminFilter(rows, filter) {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (filter === "flagged") return safeRows.filter((row) => Number(row.flagged) === 1);
  if (filter === "critical") return safeRows.filter((row) => row.severity === "critical");
  return safeRows;
}

function renderRoleFilterButtons(role, rows) {
  const container = el[`${role}Filters`];
  if (!container) return;

  const active = state.adminFilters[role] || "all";
  const counts = roleFilterCounts(rows);
  const items = [
    { key: "all", label: "All", count: counts.all },
    { key: "flagged", label: "Flagged", count: counts.flagged },
    { key: "critical", label: "Critical", count: counts.critical },
  ];

  container.innerHTML = items
    .map(
      (item) => `<button
        type="button"
        class="filter-pill ${active === item.key ? "active" : ""}"
        data-filter-role="${role}"
        data-filter-value="${item.key}"
      >${item.label} <span>${item.count}</span></button>`
    )
    .join("");
}

function buildQuickNav() {
  const role = state.user?.role;
  if (role === "admin") {
    el.quickNav.innerHTML = "";
    el.quickNav.classList.add("hidden");
    return;
  }

  const scope = role === "admin" ? el.adminPanel : el.staffPanel;
  const cards = Array.from(scope.querySelectorAll(".card[id][data-nav-label]:not(.hidden)"));

  if (cards.length <= 1) {
    el.quickNav.innerHTML = "";
    el.quickNav.classList.add("hidden");
    return;
  }

  el.quickNav.innerHTML = cards
    .map((card) => `<button type="button" data-target="${card.id}">${card.dataset.navLabel}</button>`)
    .join("");

  el.quickNav.classList.remove("hidden");
}

function formatDateTime(value) {
  const d = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return value || "";
  return d.toLocaleString();
}

function renderSubmissionCards(rows, fields, stageLabel) {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (!safeRows.length) {
    return '<p class="muted">No submissions for selected date.</p>';
  }

  return `<div class="submission-list">${safeRows
    .map((row) => {
      const fieldItems = fields
        .map((f) => {
          const value = typeof f.render === "function" ? f.render(row[f.key], row) : row[f.key] ?? "-";
          return `<div class="submission-kv"><span>${f.label}</span><strong>${value}</strong></div>`;
        })
        .join("");
      return `
        <article class="submission-item ${row.flagged ? "flagged-row" : ""}">
          <header class="submission-head">
            <div>
              <strong>${row.name || row.email || "Unknown Staff"}</strong>
              <div class="submission-meta">${stageLabel || "Entry"} · Loaf: ${row.bread_type || "-"} · Discrepancy: <span class="discrepancy-amount ${
                row.flagged ? "flagged" : "ok"
              }">${formatDifference(row.difference)} loaves</span></div>
            </div>
            <time>${formatDateTime(row.created_at)}</time>
          </header>
          <div class="submission-grid">${fieldItems}</div>
        </article>
      `;
    })
    .join("")}</div>`;
}

async function refreshMySubmissions() {
  const data = await api("/api/staff/my-submissions");

  const sections = [
    { title: "Production", rows: data.production },
    { title: "Bagging", rows: data.bagging },
    { title: "Sales", rows: data.sales },
    { title: "Delivery", rows: data.delivery },
  ];

  el.mySubmissions.innerHTML = sections
    .map((section) => {
      const rows = section.rows.map((r) => ({
        id: r.id,
        bread: r.bread_type,
        difference: r.difference,
        time: r.created_at,
      }));

      return `
        <h4>${section.title}</h4>
        ${tableFromRows(
          [
            { key: "id", label: "ID" },
            { key: "bread", label: "Bread" },
            { key: "difference", label: "Difference" },
            { key: "time", label: "Timestamp" },
          ],
          rows
        )}
      `;
    })
    .join("");
}

async function loadStaffList() {
  const staffListEl = el.staffList;
  if (!staffListEl) return;
  try {
    const data = await api("/api/admin/staff");
    if (!data.staff.length) {
      staffListEl.innerHTML = '<p class="muted">No staff accounts yet. Add one above.</p>';
      return;
    }
    const roleOrder = ["baker", "bagger", "sales", "delivery"];
    const sorted = data.staff.sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role));
    staffListEl.innerHTML = `<div class="staff-preview">${sorted.map((s) => {
      const initials = s.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
      return `<div class="staff-item">
        <div class="staff-avatar">${initials}</div>
        <div class="staff-info">
          <div class="staff-name">${s.name}</div>
          <div class="staff-detail">${s.phone || s.email || "—"}</div>
        </div>
        <span class="role-tag ${s.role}">${s.role.charAt(0).toUpperCase() + s.role.slice(1)}</span>
        <button type="button" class="btn-delete-staff danger-btn" data-id="${s.id}">Remove</button>
      </div>`;
    }).join("")}</div>`;

    staffListEl.querySelectorAll(".btn-delete-staff").forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm("Remove this staff member?")) return;
        try {
          await api(`/api/admin/staff/${btn.dataset.id}`, { method: "DELETE" });
          showToast("Staff removed");
          loadStaffList();
        } catch (err) {
          showToast(err.message);
        }
      };
    });
  } catch (err) {
    staffListEl.innerHTML = '<p class="muted">Could not load staff.</p>';
  }
}

function initCreateStaffForm() {
  const form = el.createStaffForm;
  if (!form) return;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const body = Object.fromEntries(fd.entries());
    try {
      await api("/api/admin/staff", { method: "POST", body: JSON.stringify(body) });
      showToast(`Staff account created for ${body.name}`);
      form.reset();
      loadStaffList();
    } catch (err) {
      showToast(err.message);
    }
  };
}

function initChangePasswordForm() {
  const form = el.changePasswordForm;
  if (!form) return;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const currentPassword = fd.get("currentPassword");
    const newPassword = fd.get("newPassword");
    const confirmPassword = fd.get("confirmPassword");
    if (newPassword !== confirmPassword) {
      showToast("New passwords do not match");
      return;
    }
    if (newPassword.length < 4) {
      showToast("New password must be at least 4 characters");
      return;
    }
    try {
      await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      showToast("Password updated successfully");
      form.reset();
    } catch (err) {
      showToast(err.message);
    }
  };
}

async function refreshAdmin() {
  const date = el.reportDate.value;
  const submissions = await api(`/api/admin/submissions?date=${date}`);
  const bakerRows = Array.isArray(submissions.baker) ? submissions.baker : [];
  const baggerRows = Array.isArray(submissions.bagger) ? submissions.bagger : [];
  const salesRows = Array.isArray(submissions.sales) ? submissions.sales : [];
  const deliveryRows = Array.isArray(submissions.delivery) ? submissions.delivery : [];

  renderRoleFilterButtons("baker", bakerRows);
  renderRoleFilterButtons("bagger", baggerRows);
  renderRoleFilterButtons("sales", salesRows);
  renderRoleFilterButtons("delivery", deliveryRows);

  const filteredBakerRows = applyAdminFilter(bakerRows, state.adminFilters.baker);
  const filteredBaggerRows = applyAdminFilter(baggerRows, state.adminFilters.bagger);
  const filteredSalesRows = applyAdminFilter(salesRows, state.adminFilters.sales);
  const filteredDeliveryRows = applyAdminFilter(deliveryRows, state.adminFilters.delivery);

  const allRows = [
    ...bakerRows.map((row) => ({ ...row, stage: "Baker" })),
    ...baggerRows.map((row) => ({ ...row, stage: "Bagger" })),
    ...salesRows.map((row) => ({ ...row, stage: "Sales" })),
    ...deliveryRows.map((row) => ({ ...row, stage: "Delivery" })),
  ];

  const flaggedCount = allRows.filter((row) => Number(row.flagged) === 1).length;
  const criticalCount = allRows.filter((row) => row.severity === "critical").length;
  const warningCount = allRows.filter((row) => row.severity === "warning").length;
  const discrepancyTotal = allRows.reduce((sum, row) => sum + absDifference(row.difference), 0);

  const loafBreakdown = allRows
    .filter((row) => Number(row.flagged) === 1)
    .reduce((acc, row) => {
      const key = row.bread_type || "Unknown";
      const existing = acc.get(key) || { loaf: key, count: 0, amount: 0 };
      existing.count += 1;
      existing.amount += absDifference(row.difference);
      acc.set(key, existing);
      return acc;
    }, new Map());

  const topDiscrepancies = allRows
    .filter((row) => Number(row.flagged) === 1)
    .sort((a, b) => absDifference(b.difference) - absDifference(a.difference))
    .slice(0, 6);

  el.adminCounts.innerHTML = `
    <p><strong>Baker:</strong> ${bakerRows.length}</p>
    <p><strong>Bagger:</strong> ${baggerRows.length}</p>
    <p><strong>Sales:</strong> ${salesRows.length}</p>
    <p><strong>Delivery:</strong> ${deliveryRows.length}</p>
  `;

  if (el.alertSummary) {
    const loafItems = Array.from(loafBreakdown.values())
      .sort((a, b) => b.amount - a.amount)
      .map(
        (item) => `<span class="loaf-chip"><strong>${item.loaf}</strong> ${item.amount} loaves (${item.count})</span>`
      )
      .join("");

    el.alertSummary.innerHTML = `
      <article class="alert-kpi danger">
        <span>Flagged Entries</span>
        <strong>${flaggedCount}</strong>
      </article>
      <article class="alert-kpi critical">
        <span>Critical Alerts</span>
        <strong>${criticalCount}</strong>
      </article>
      <article class="alert-kpi warning">
        <span>Warning Alerts</span>
        <strong>${warningCount}</strong>
      </article>
      <article class="alert-kpi neutral">
        <span>Total Discrepancy</span>
        <strong>${discrepancyTotal}</strong>
      </article>
      <article class="alert-kpi loaf-breakdown">
        <span>Loaf Types With Discrepancy</span>
        <div class="loaf-chip-list">${loafItems || '<span class="muted">None</span>'}</div>
      </article>
    `;
  }

  if (el.topDiscrepancies) {
    el.topDiscrepancies.innerHTML = topDiscrepancies.length
      ? `
        <h4>Top Discrepancies</h4>
        <div class="top-discrepancy-list">${topDiscrepancies
          .map(
            (row) => `
              <article class="top-discrepancy-item ${row.severity || "warning"}">
                <div>
                  <strong>${row.name || "Unknown Staff"}</strong>
                  <p>${row.stage} · Loaf: ${row.bread_type}</p>
                </div>
                <div>
                  <strong>${formatDifference(row.difference)} loaves</strong>
                  <p>${severityBadge(row.severity)}</p>
                </div>
              </article>
            `
          )
          .join("")}</div>
      `
      : '<p class="muted" style="margin-top:0.7rem">No flagged discrepancies for selected date.</p>';
  }

  el.bakerSubmissionsTable.innerHTML = renderSubmissionCards(
    filteredBakerRows,
    [
      { key: "bread_type", label: "Bread Type" },
      { key: "flour_bags", label: "Flour Bags" },
      { key: "produced_count", label: "Produced" },
      { key: "difference", label: "Difference" },
      { key: "severity", label: "Status", render: (v) => severityBadge(v) },
      { key: "sugar", label: "Sugar" },
      { key: "salt", label: "Salt" },
      { key: "preservative", label: "Preservative" },
      { key: "butter", label: "Butter" },
      { key: "yeast", label: "Yeast" },
      { key: "vegetable_oil", label: "Vegetable Oil" },
      { key: "improver", label: "Improver" },
    ],
    "Baker"
  );

  el.baggerSubmissionsTable.innerHTML = renderSubmissionCards(
    filteredBaggerRows,
    [
      { key: "bread_type", label: "Bread Type" },
      { key: "received_count", label: "Received" },
      { key: "bagged_count", label: "Bagged" },
      { key: "difference", label: "Difference" },
      { key: "severity", label: "Status", render: (v) => severityBadge(v) },
    ],
    "Bagger"
  );

  el.salesSubmissionsTable.innerHTML = renderSubmissionCards(
    filteredSalesRows,
    [
      { key: "bread_type", label: "Bread Type" },
      { key: "paid_count", label: "Paid" },
      { key: "credit_count", label: "Credit" },
      { key: "total_sold", label: "Total Sold" },
      { key: "difference", label: "Difference" },
      { key: "severity", label: "Status", render: (v) => severityBadge(v) },
    ],
    "Sales"
  );

  el.deliverySubmissionsTable.innerHTML = renderSubmissionCards(
    filteredDeliveryRows,
    [
      { key: "bread_type", label: "Bread Type" },
      { key: "taken_count", label: "Taken" },
      { key: "paid_count", label: "Paid" },
      { key: "credit_count", label: "Credit" },
      { key: "total_delivered", label: "Total Delivered" },
      { key: "difference", label: "Difference" },
      { key: "severity", label: "Status", render: (v) => severityBadge(v) },
    ],
    "Delivery"
  );

  buildQuickNav();
}

async function boot() {
  el.reportDate.value = new Date().toISOString().slice(0, 10);

  // ── Login tab switching ──────────────────────────────────────────
  document.querySelectorAll(".login-tab").forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll(".login-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const pane = tab.dataset.tab;
      document.getElementById("staffLoginPane").classList.toggle("hidden", pane !== "staff");
      document.getElementById("adminLoginPane").classList.toggle("hidden", pane !== "admin");
    };
  });

  // ── Staff login ──────────────────────────────────────────────────
  el.loginForm.onsubmit = async (event) => {
    event.preventDefault();
    const formData = new FormData(el.loginForm);
    const phone = formData.get("phone");
    const password = formData.get("password");

    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ phone, password }),
      });

      state.token = data.token;
      state.user = data.user;
      localStorage.setItem("bakery_token", state.token);

      await afterAuth();
      showToast("Login successful");
    } catch (error) {
      showToast(error.message);
    }
  };

  // ── Admin portal login ───────────────────────────────────────────
  el.adminLoginForm.onsubmit = async (event) => {
    event.preventDefault();
    const code = new FormData(el.adminLoginForm).get("code");
    try {
      const data = await api("/api/auth/admin-login", {
        method: "POST",
        body: JSON.stringify({ code }),
      });

      state.token = data.token;
      state.user = data.user;
      localStorage.setItem("bakery_token", state.token);

      await afterAuth();
      showToast("Admin access granted");
    } catch (error) {
      showToast(error.message || "Invalid access code");
    }
  };

  el.logoutBtn.onclick = () => {
    state.token = "";
    state.user = null;
    localStorage.removeItem("bakery_token");
    location.reload();
  };

  el.refreshAdminBtn.onclick = async () => {
    try {
      await refreshAdmin();
      showToast("Admin data refreshed");
    } catch (error) {
      showToast(error.message);
    }
  };

  if (el.exportCsvBtn) {
    el.exportCsvBtn.onclick = () => {
      const date = el.reportDate.value || new Date().toISOString().slice(0, 10);
      const params = new URLSearchParams({ date });
      const a = document.createElement("a");
      a.href = `/api/admin/export-csv?${params.toString()}`;
      a.download = `bigcat-report-${date}.csv`;
      if (state.token) {
        // Use authenticated fetch to include bearer token, then trigger browser download.
        fetch(a.href, { headers: { Authorization: `Bearer ${state.token}` } })
          .then((response) => {
            if (!response.ok) {
              return response.json().then((payload) => {
                throw new Error(payload.error || "Export failed");
              });
            }
            return response.blob();
          })
          .then((blob) => {
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = a.download;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            showToast("CSV export downloaded");
          })
          .catch((error) => showToast(error.message));
      }
    };
  }

  el.adminPanel.onclick = async (event) => {
    const button = event.target.closest("button[data-filter-role][data-filter-value]");
    if (!button) return;

    const role = button.dataset.filterRole;
    const filter = button.dataset.filterValue;
    if (!role || !filter || state.adminFilters[role] === filter) return;

    state.adminFilters[role] = filter;
    try {
      await refreshAdmin();
    } catch (error) {
      showToast(error.message);
    }
  };

  el.quickNav.onclick = (event) => {
    const button = event.target.closest("button[data-target]");
    if (!button) return;

    const target = document.getElementById(button.dataset.target);
    if (!target) return;

    target.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (!state.token) return;

  try {
    const me = await api("/api/auth/me");
    state.user = me.user;
    await afterAuth();
  } catch (_error) {
    localStorage.removeItem("bakery_token");
    state.token = "";
  }
}

async function loadBatchHistory() {
  const fromDate = el.historyFromDate.value || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const breadType = el.historyBreadType.value;
  
  try {
    const endpoint = state.user.role === "admin" ? "/api/admin/all-submissions" : "/api/staff/my-submissions";
    const data = await api(endpoint);
    let allSubmissions = [];
    
    // Combine all submission types with role labels
    (data.production || []).forEach(row => {
      allSubmissions.push({ ...row, stage: '🍞 Baker', type: 'production' });
    });
    (data.bagging || []).forEach(row => {
      allSubmissions.push({ ...row, stage: '📦 Bagger', type: 'bagging' });
    });
    (data.sales || []).forEach(row => {
      allSubmissions.push({ ...row, stage: '🏪 Sales', type: 'sales' });
    });
    (data.delivery || []).forEach(row => {
      allSubmissions.push({ ...row, stage: '🚚 Delivery', type: 'delivery' });
    });
    
    // Filter by date and bread type
    let filtered = allSubmissions.filter(row => {
      const rowDate = row.created_at.slice(0, 10);
      const matchDate = rowDate >= fromDate;
      const matchType = !breadType || row.bread_type === breadType;
      return matchDate && matchType;
    });
    
    // Sort by date descending
    filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    if (!filtered.length) {
      el.batchHistory.innerHTML = '<p class="muted" style="padding:1rem">No submissions in this period.</p>';
      return;
    }
    
    el.batchHistory.innerHTML = `<table>
      <thead><tr>
        <th>Date</th><th>Stage</th><th>Bread Type</th><th>Quantity</th><th>Difference</th>
      </tr></thead>
      <tbody>${filtered.map(row => `<tr>
        <td>${row.created_at.slice(0, 10)}</td>
        <td>${row.stage}</td>
        <td>${row.bread_type}</td>
        <td>${row.produced_count || row.bagged_count || row.total_sold || row.total_delivered || '—'}</td>
        <td style="font-weight:600;color:${row.difference > 0 ? '#dc2626' : '#15803d'}">${row.difference > 0 ? '+' : ''}${row.difference}</td>
      </tr>`).join('')}</tbody>
    </table>`;
  } catch (err) {
    el.batchHistory.innerHTML = `<p class="muted" style="padding:1rem">Error loading history: ${err.message}</p>`;
  }
}

async function afterAuth() {
  const meta = await api("/api/meta");
  state.breadTypes = meta.breadTypes;
  document.body.setAttribute("data-role", state.user.role);

  el.loginView.classList.add("hidden");
  el.appView.classList.remove("hidden");

  const displayName = state.user.name || state.user.email;
  const initials = displayName.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  if (el.userAvatar) el.userAvatar.textContent = initials;
  el.welcomeTitle.textContent = displayName;
  el.roleInfo.textContent = state.user.role.charAt(0).toUpperCase() + state.user.role.slice(1);

  // Hard role isolation for visibility.
  el.adminPanel.classList.add("hidden");
  el.staffPanel.classList.add("hidden");

  if (state.user.role === "admin") {
    el.adminPanel.classList.remove("hidden");
    initCreateStaffForm();
    loadStaffList();
    try {
      await refreshAdmin();
    } catch (error) {
      showToast(error.message || "Unable to load admin submissions");
    }
  } else {
    renderFormsByRole();
    // Show change-password card for staff (not admin)
    if (state.user.role !== "admin" && el.changePasswordCard) {
      el.changePasswordCard.classList.remove("hidden");
      initChangePasswordForm();
    }
  }
  
  // Setup batch history for both staff and admins
  el.batchHistoryCard.classList.remove("hidden");
  // Populate bread type dropdown if not already populated
  if (!el.historyBreadType.querySelector("option[value='Jumbo']")) {
    Object.keys(state.breadTypes).forEach(breadType => {
      const option = document.createElement("option");
      option.value = breadType;
      option.textContent = breadType;
      el.historyBreadType.appendChild(option);
    });
  }
  // Set default date to 30 days ago
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  el.historyFromDate.value = thirtyDaysAgo;
  // Load initial history and wire up filter
  await loadBatchHistory();
  el.applyHistoryFilter.onclick = () => loadBatchHistory();
  
  if (state.user.role !== "admin") {
    try {
      await hydrateStaffPreviewFromHistory();
    } catch (_error) {
      // Keep UI usable even if preview history cannot be fetched.
    }
  }
}

boot();
