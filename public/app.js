const state = {
  token: localStorage.getItem("bakery_token") || "",
  user: null,
  breadTypes: {},
  adminDensity: localStorage.getItem("bakery_admin_density") || "comfortable",
  adminView: localStorage.getItem("bakery_admin_view") || "overview",
  adminDataCache: {
    submissions: {
      baker: [],
      bagger: [],
      sales: [],
      delivery: [],
    },
  },
  adminFilters: {
    baker: "all",
    bagger: "all",
    sales: "all",
    delivery: "all",
  },
};

let adminViewportListenerAttached = false;
let adminSectionViewportListenerAttached = false;
let adminQuickNavScrollListenerAttached = false;

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
  exportOptionsToggle: document.getElementById("exportOptionsToggle"),
  exportOptionsPanel: document.getElementById("exportOptionsPanel"),
  executeExportBtn: document.getElementById("executeExportBtn"),
  closeExportPanelBtn: document.getElementById("closeExportPanelBtn"),
  exportFinancialCsvBtn: document.getElementById("exportFinancialCsvBtn"),
  reportDate: document.getElementById("reportDate"),
  adminCounts: document.getElementById("adminCounts"),
  alertSummary: document.getElementById("alertSummary"),
  topDiscrepancies: document.getElementById("topDiscrepancies"),
  financeSummary: document.getElementById("financeSummary"),
  ingredientStockCard: document.getElementById("ingredientStockCard"),
  ingredientStockForm: document.getElementById("ingredientStockForm"),
  ingredientStockSummary: document.getElementById("ingredientStockSummary"),
  ingredientStockTable: document.getElementById("ingredientStockTable"),
  bakerFilters: document.getElementById("bakerFilters"),
  baggerFilters: document.getElementById("baggerFilters"),
  salesFilters: document.getElementById("salesFilters"),
  deliveryFilters: document.getElementById("deliveryFilters"),
  bakerSubmissionsTable: document.getElementById("bakerSubmissionsTable"),
  baggerSubmissionsTable: document.getElementById("baggerSubmissionsTable"),
  salesSubmissionsTable: document.getElementById("salesSubmissionsTable"),
  deliverySubmissionsTable: document.getElementById("deliverySubmissionsTable"),
  adminDensityToggle: document.getElementById("adminDensityToggle"),
  batchHistoryCard: document.getElementById("batchHistoryCard"),
  batchHistory: document.getElementById("batchHistory"),
  historyFromDate: document.getElementById("historyFromDate"),
  historyBreadType: document.getElementById("historyBreadType"),
  applyHistoryFilter: document.getElementById("applyHistoryFilter"),
  changePasswordCard: document.getElementById("changePasswordCard"),
  changePasswordForm: document.getElementById("changePasswordForm"),
  blameAnalysisCard: document.getElementById("blameAnalysisCard"),
  blameAnalysisDate: document.getElementById("blameAnalysisDate"),
  blameAnalysisBreadType: document.getElementById("blameAnalysisBreadType"),
  loadBlameAnalysisBtn: document.getElementById("loadBlameAnalysisBtn"),
  blameAnalysisResults: document.getElementById("blameAnalysisResults"),
  operationsSection: document.getElementById("operationsSection"),
  submissionsSection: document.getElementById("submissionsSection"),
  adjustmentsCard: document.getElementById("adjustmentsCard"),
  adjustmentsList: document.getElementById("adjustmentsList"),
  bakerSearchName: document.getElementById("bakerSearchName"),
  baggerSearchName: document.getElementById("baggerSearchName"),
  salesSearchName: document.getElementById("salesSearchName"),
  deliverySearchName: document.getElementById("deliverySearchName"),
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
      <label>Flour Used (kg)<input name="flourKg" type="number" min="0" step="0.01" required /></label>
      <label>Breads Produced<input name="producedCount" type="number" min="0" step="1" required /></label>
      <h4 class="form-section-title span-2">Ingredient Inputs</h4>
      <label>Sugar Used (kg)<input name="sugar" type="number" min="0" step="0.01" required /></label>
      <label>Salt Used (kg)<input name="salt" type="number" min="0" step="0.01" required /></label>
      <label>Preservative Used (grams)<input name="preservative" type="number" min="0" step="0.01" required /></label>
      <label>Butter Used (kg)<input name="butter" type="number" min="0" step="0.01" required /></label>
      <label>Softener Used (grams)<input name="softener" type="number" min="0" step="0.01" required /></label>
      <label>Improva Used (grams)<input name="improver" type="number" min="0" step="0.01" required /></label>
      <p class="muted span-2" style="margin-top:0.25rem">Standard per 50kg flour: Sugar 7kg, Salt 1kg, Preservative 300g, Butter 1kg, Softener 50g, Improva 50g.</p>
      <button type="submit">Submit Production</button>
      <div id="bakerPreview" class="staff-preview hidden"></div>
    `;

    el.productionForm.onsubmit = async (event) => {
      event.preventDefault();
      const fd = new FormData(el.productionForm);
      const body = Object.fromEntries(fd.entries());
      await submitStaff("/api/production", body, "Production submitted", el.productionForm);
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
      await submitStaff("/api/bagging", Object.fromEntries(fd.entries()), "Bagging submitted", el.baggingForm);
    };
  }

  if (role === "sales") {
    el.salesCard.classList.remove("hidden");
    el.salesForm.innerHTML = `
      <p class="form-intro">Submit one batch at a time.</p>
      <label>Bread Type<select name="breadType" required>${options}</select></label>
      <label>Bread Received<input name="receivedCount" type="number" min="0" step="1" required /></label>
      <label>Sold Paid<input name="paidCount" type="number" min="0" step="1" required /></label>
      <label>Sold Credit<input name="creditCount" type="number" min="0" step="1" required /></label>
      <button type="submit">Submit Sales</button>
      <div id="salesPreview" class="staff-preview hidden"></div>
    `;

    el.salesForm.onsubmit = async (event) => {
      event.preventDefault();
      const fd = new FormData(el.salesForm);
      await submitStaff("/api/sales", Object.fromEntries(fd.entries()), "Sales submitted", el.salesForm);
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
      await submitStaff("/api/delivery", Object.fromEntries(fd.entries()), "Delivery submitted", el.deliveryForm);
    };
  }

  buildQuickNav();
}

async function submitStaff(path, body, successMessage, form) {
  try {
    const result = await api(path, { method: "POST", body: JSON.stringify(body) });
    const adminNote = state.user?.role === "baker" ? " Sent to admin dashboard." : "";
    showToast(`${successMessage}.${adminNote}`);
    if (form) form.reset();
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
      previewField("Flour (kg)", submittedBody.flourKg),
      previewField("Produced", submittedBody.producedCount),
      previewField("Sugar", submittedBody.sugar),
      previewField("Salt", submittedBody.salt),
      previewField("Preservative", submittedBody.preservative),
      previewField("Butter", submittedBody.butter),
      previewField("Softener", submittedBody.softener),
      previewField("Improva", submittedBody.improver),
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
      previewField("Received", submittedBody.receivedCount),
      previewField("Paid", submittedBody.paidCount),
      previewField("Credit", submittedBody.creditCount),
      previewField("Total Sold", savedResult.totalSold),
    ].join("");
  }

  if (role === "delivery") {
    target = document.getElementById("deliveryPreview");
    fields = [
      previewField("Bread Type", submittedBody.breadType),
      previewField("Received", submittedBody.receivedCount),
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
        flourKg: Number(record.flour_bags || 0) * 50,
        producedCount: record.produced_count,
        sugar: record.sugar,
        salt: record.salt,
        preservative: record.preservative,
        butter: record.butter,
        softener: record.yeast,
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

function adminRoleCardByRole(role) {
  const map = {
    baker: "bakerSubmissionsCard",
    bagger: "baggerSubmissionsCard",
    sales: "salesSubmissionsCard",
    delivery: "deliverySubmissionsCard",
  };
  const cardId = map[role];
  return cardId ? document.getElementById(cardId) : null;
}

function isAdminMobileViewport() {
  return window.matchMedia("(max-width: 639px)").matches;
}

function shouldRenderAdminRole(role) {
  const card = adminRoleCardByRole(role);
  if (!card) return true;
  const parentSection = card.closest(".admin-section");
  if (parentSection && parentSection.classList.contains("collapsed")) return false;
  if (!isAdminMobileViewport()) return true;
  return !card.classList.contains("collapsed");
}

function isAdminSectionMobileViewport() {
  return window.matchMedia("(max-width: 767px)").matches;
}

function setAdminSectionExpanded(section, expanded) {
  section.classList.toggle("collapsed", !expanded);
  const toggle = section.querySelector(".admin-section-toggle");
  if (!toggle) return;
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.textContent = expanded ? "Collapse" : "Expand";
}

function initAdminSectionToggles() {
  if (!el.adminPanel) return;
  const sections = Array.from(el.adminPanel.querySelectorAll(".admin-section[id]"));
  if (!sections.length) return;

  sections.forEach((section, index) => {
    const toggle = section.querySelector(".admin-section-toggle");
    if (!toggle) return;
    if (toggle.dataset.ready === "1") return;

    toggle.onclick = () => {
      const mobile = isAdminSectionMobileViewport();
      const expanding = section.classList.contains("collapsed");

      if (mobile && expanding) {
        sections.forEach((other) => {
          if (other !== section) setAdminSectionExpanded(other, false);
        });
      }

      setAdminSectionExpanded(section, !section.classList.contains("collapsed"));
      renderAdminRoleSections();
    };

    toggle.dataset.ready = "1";

    const openByDefault = isAdminSectionMobileViewport() ? index === 0 : true;
    setAdminSectionExpanded(section, openByDefault);
  });

  if (!adminSectionViewportListenerAttached) {
    const mq = window.matchMedia("(max-width: 767px)");
    mq.addEventListener("change", () => {
      if (state.user?.role !== "admin") return;
      sections.forEach((section, index) => {
        const openByDefault = mq.matches ? index === 0 : true;
        setAdminSectionExpanded(section, openByDefault);
      });
      renderAdminRoleSections();
    });
    adminSectionViewportListenerAttached = true;
  }
}

function initAdminQuickNavEffects() {
  if (adminQuickNavScrollListenerAttached) return;
  const onScroll = () => {
    if (!el.quickNav) return;
    const isAdmin = state.user?.role === "admin";
    if (!isAdmin) {
      el.quickNav.classList.remove("scrolled");
      return;
    }
    el.quickNav.classList.toggle("scrolled", window.scrollY > 24);
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  adminQuickNavScrollListenerAttached = true;
}

function applyAdminDensity() {
  document.body.setAttribute("data-admin-density", state.adminDensity);
  if (!el.adminDensityToggle) return;
  el.adminDensityToggle.textContent = state.adminDensity === "compact" ? "Comfortable View" : "Compact View";
}

function initAdminDensityToggle() {
  if (!el.adminDensityToggle) return;
  applyAdminDensity();
  el.adminDensityToggle.onclick = () => {
    state.adminDensity = state.adminDensity === "compact" ? "comfortable" : "compact";
    localStorage.setItem("bakery_admin_density", state.adminDensity);
    applyAdminDensity();
  };
}

function renderAdminRoleSections() {
  const bakerRows = state.adminDataCache.submissions.baker || [];
  const baggerRows = state.adminDataCache.submissions.bagger || [];
  const salesRows = state.adminDataCache.submissions.sales || [];
  const deliveryRows = state.adminDataCache.submissions.delivery || [];

  const filteredBakerRows = applyAdminFilter(bakerRows, state.adminFilters.baker);
  const filteredBaggerRows = applyAdminFilter(baggerRows, state.adminFilters.bagger);
  const filteredSalesRows = applyAdminFilter(salesRows, state.adminFilters.sales);
  const filteredDeliveryRows = applyAdminFilter(deliveryRows, state.adminFilters.delivery);

  if (shouldRenderAdminRole("baker")) {
    const searchTerm = el.bakerSearchName ? el.bakerSearchName.value.toLowerCase() : "";
    const filtered = searchTerm ? filteredBakerRows.filter(r => (r.name || "").toLowerCase().includes(searchTerm)) : filteredBakerRows;
    el.bakerSubmissionsTable.innerHTML = renderSubmissionCards(
      filtered,
      filteredBakerRows,
      [
        { key: "bread_type", label: "Bread Type" },
        { key: "flour_bags", label: "Flour (kg)", render: (v) => (Number(v) * 50).toFixed(2).replace(/\.00$/, "") },
        { key: "produced_count", label: "Produced" },
        { key: "difference", label: "Difference" },
        { key: "severity", label: "Status", render: (v) => severityBadge(v) },
        { key: "sugar", label: "Sugar" },
        { key: "salt", label: "Salt" },
        { key: "preservative", label: "Preservative" },
        { key: "butter", label: "Butter" },
        { key: "yeast", label: "Softener" },
        { key: "improver", label: "Improva" },
      ],
      "Baker"
    );
  }

  if (shouldRenderAdminRole("bagger")) {
    const searchTerm = el.baggerSearchName ? el.baggerSearchName.value.toLowerCase() : "";
    const filtered = searchTerm ? filteredBaggerRows.filter(r => (r.name || "").toLowerCase().includes(searchTerm)) : filteredBaggerRows;
    el.baggerSubmissionsTable.innerHTML = renderSubmissionCards(
      filtered,
      [
        { key: "bread_type", label: "Bread Type" },
        { key: "received_count", label: "Received" },
        { key: "bagged_count", label: "Bagged" },
        { key: "difference", label: "Difference" },
        { key: "severity", label: "Status", render: (v) => severityBadge(v) },
      ],
      "Bagger"
    );
  }

  if (shouldRenderAdminRole("sales")) {
    const searchTerm = el.salesSearchName ? el.salesSearchName.value.toLowerCase() : "";
    const filtered = searchTerm ? filteredSalesRows.filter(r => (r.name || "").toLowerCase().includes(searchTerm)) : filteredSalesRows;
    el.salesSubmissionsTable.innerHTML = renderSubmissionCards(
      filtered,
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
  }

  if (shouldRenderAdminRole("delivery")) {
    const searchTerm = el.deliverySearchName ? el.deliverySearchName.value.toLowerCase() : "";
    const filtered = searchTerm ? filteredDeliveryRows.filter(r => (r.name || "").toLowerCase().includes(searchTerm)) : filteredDeliveryRows;
    el.deliverySubmissionsTable.innerHTML = renderSubmissionCards(
      filtered,
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
  }
}

function initAdminAccordions() {
  if (!el.adminPanel) return;
  const cards = Array.from(el.adminPanel.querySelectorAll(".card[id][data-nav-label]"));
  cards.forEach((card, index) => {
    if (card.dataset.accordionReady === "1") return;

    const label = card.dataset.navLabel || "Section";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "admin-card-toggle";
    toggle.setAttribute("aria-expanded", "true");
    toggle.innerHTML = `<span>${label}</span><span class="admin-card-toggle-icon" aria-hidden="true">+</span>`;

    const body = document.createElement("div");
    body.className = "admin-card-body";

    const existing = Array.from(card.childNodes);
    existing.forEach((node) => body.appendChild(node));

    card.appendChild(toggle);
    card.appendChild(body);
    card.classList.add("admin-card");

    const defaultExpanded = index < 3;
    if (!defaultExpanded) {
      card.classList.add("collapsed");
      toggle.setAttribute("aria-expanded", "false");
    }

    toggle.onclick = () => {
      const isCollapsed = card.classList.toggle("collapsed");
      toggle.setAttribute("aria-expanded", String(!isCollapsed));
      if (!isCollapsed) {
        renderAdminRoleSections();
      }
    };

    card.dataset.accordionReady = "1";
  });

  if (!adminViewportListenerAttached) {
    const mobileMq = window.matchMedia("(max-width: 639px)");
    mobileMq.addEventListener("change", () => {
      if (state.user?.role === "admin") {
        renderAdminRoleSections();
      }
    });
    adminViewportListenerAttached = true;
  }
}

function setAdminDashboardView(view, persist = true) {
  const views = {
    overview: ["adminControlsCard"],
    staff: ["staffManagementCard"],
    finance: ["financeCard"],
    stock: ["ingredientStockCard"],
    rootcause: ["blameAnalysisCard"],
    adjustments: ["adjustmentsCard"],
    submissions: ["bakerSubmissionsCard", "baggerSubmissionsCard", "salesSubmissionsCard", "deliverySubmissionsCard"],
  };

  const selected = views[view] ? view : "overview";
  state.adminView = selected;
  if (persist) localStorage.setItem("bakery_admin_view", selected);

  const allCards = Array.from(el.adminPanel.querySelectorAll(".card[id][data-nav-label]"));
  const visible = new Set(views[selected]);

  allCards.forEach((card) => {
    const show = visible.has(card.id);
    card.classList.toggle("hidden", !show);
  });

  [el.operationsSection, el.submissionsSection].forEach((section) => {
    if (!section) return;
    const hasVisibleCards = Array.from(section.querySelectorAll(".card[id][data-nav-label]")).some(
      (card) => !card.classList.contains("hidden")
    );
    section.classList.toggle("hidden", !hasVisibleCards);
  });

  el.quickNav.querySelectorAll("button[data-admin-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.adminView === selected);
  });
}

function buildQuickNav() {
  const role = state.user?.role;
  if (role === "admin") {
    el.quickNav.innerHTML = `
      <button type="button" data-admin-view="overview" data-badge="overview">Dashboard</button>
      <button type="button" data-admin-view="submissions" data-badge="submissions">Submissions</button>
      <button type="button" data-admin-view="staff">Staff Management</button>
      <button type="button" data-admin-view="rootcause">Root Cause Analysis</button>
      <button type="button" data-admin-view="finance">Finance</button>
      <button type="button" data-admin-view="stock">Ingredient Stock</button>
      <button type="button" data-admin-view="adjustments">Adjustments</button>
    `;
    el.quickNav.classList.remove("hidden");
    setAdminDashboardView(state.adminView, false);
    updateMenuBadges();
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

function formatCurrency(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "N0";
  return `N${numeric.toLocaleString()}`;
}

function stockBadge(status) {
  if (status === "not_set") return '<span class="badge neutral">not set</span>';
  if (status === "critical") return '<span class="badge critical">critical</span>';
  if (status === "warning") return '<span class="badge warning">low</span>';
  return '<span class="badge ok">ok</span>';
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
          await loadStaffList();
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
    const submitBtn = form.querySelector("button[type='submit']");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Creating...";
    }
    const fd = new FormData(form);
    const body = Object.fromEntries(fd.entries());
    try {
      await api("/api/admin/staff", { method: "POST", body: JSON.stringify(body) });
      showToast(`Staff account created for ${body.name}`);
      form.reset();
      await loadStaffList();
    } catch (err) {
      showToast(err.message);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Create Staff Account";
      }
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
  const finance = await api(`/api/admin/finance?date=${date}`);
  await loadIngredientStock();
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

  state.adminDataCache.submissions = {
    baker: bakerRows,
    bagger: baggerRows,
    sales: salesRows,
    delivery: deliveryRows,
  };

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

  // Keep summary stats refreshed first, and render heavy role sections on demand on mobile.
  renderAdminRoleSections();

  if (el.financeSummary) {
    const rows = Array.isArray(finance.byBreadType) ? finance.byBreadType : [];
    const financeRows = rows
      .map(
        (row) => `
          <tr>
            <td>${row.breadType}</td>
            <td>${formatCurrency(row.unitPrice)}</td>
            <td>${row.sold}</td>
            <td>${formatCurrency(row.grossSalesValue)}</td>
            <td>${row.missingBreads}</td>
            <td>${formatCurrency(row.financialLoss)}</td>
            <td>${formatCurrency(row.netAfterLoss)}</td>
          </tr>
        `
      )
      .join("");

    el.financeSummary.innerHTML = `
      <div class="admin-alert-summary">
        <article class="alert-kpi neutral">
          <span>Gross Sales Value</span>
          <strong>${formatCurrency(finance.totalGrossSalesValue)}</strong>
        </article>
        <article class="alert-kpi warning">
          <span>Financial Loss</span>
          <strong>${formatCurrency(finance.totalFinancialLoss)}</strong>
        </article>
        <article class="alert-kpi critical">
          <span>Missing Breads</span>
          <strong>${finance.totalMissingBreads}</strong>
        </article>
        <article class="alert-kpi danger">
          <span>Net After Loss</span>
          <strong>${formatCurrency(finance.netRevenueAfterLoss)}</strong>
        </article>
      </div>
      <div class="scroll-table" style="margin-top:0.75rem">
        <table>
          <thead>
            <tr>
              <th>Bread Type</th>
              <th>Unit Price</th>
              <th>Sold</th>
              <th>Gross Sales</th>
              <th>Missing</th>
              <th>Loss</th>
              <th>Net After Loss</th>
            </tr>
          </thead>
          <tbody>
            ${financeRows || '<tr><td colspan="7" class="muted">No financial data for selected date.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  }

  buildQuickNav();
  // Update menu badges with latest alert counts
  await updateMenuBadges();
}

async function loadIngredientStock() {
  if (!state.token || state.user?.role !== "admin" || !el.ingredientStockTable) return;
  try {
    const data = await api("/api/admin/ingredient-stock");
    const rows = Array.isArray(data.rows) ? data.rows : [];

    if (el.ingredientStockSummary) {
      el.ingredientStockSummary.innerHTML = `
        <article class="alert-kpi neutral">
          <span>Tracked Ingredients</span>
          <strong>${data.summary?.trackedIngredients || rows.length}</strong>
        </article>
        <article class="alert-kpi warning">
          <span>Low Stock</span>
          <strong>${data.summary?.lowCount || 0}</strong>
        </article>
        <article class="alert-kpi critical">
          <span>Critical Stock</span>
          <strong>${data.summary?.criticalCount || 0}</strong>
        </article>
      `;
    }

    if (!rows.length) {
      el.ingredientStockTable.innerHTML = '<p class="muted">No ingredient stock records yet.</p>';
      return;
    }

    const labelMap = {
      flour: "Flour",
      sugar: "Sugar",
      salt: "Salt",
      preservative: "Preservative",
      butter: "Butter",
      yeast: "Softener",
      improver: "Improva",
      vegetable_oil: "Vegetable Oil",
    };

    el.ingredientStockTable.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Ingredient</th>
            <th>Remaining</th>
            <th>Unit</th>
            <th>Warning</th>
            <th>Critical</th>
            <th>Status</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  <td>${labelMap[row.ingredient] || row.ingredient}</td>
                  <td>${Number(row.quantity || 0).toFixed(2).replace(/\.00$/, "")}</td>
                  <td>${row.unit || "-"}</td>
                  <td>${Number(row.warning_level || 0).toFixed(2).replace(/\.00$/, "")}</td>
                  <td>${Number(row.critical_level || 0).toFixed(2).replace(/\.00$/, "")}</td>
                  <td>${stockBadge(row.status)}</td>
                  <td>${formatDateTime(row.updated_at)}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    `;
  } catch (error) {
    el.ingredientStockTable.innerHTML = `<p class="muted">Could not load ingredient stock: ${error.message}</p>`;
  }
}

function initIngredientStockForm() {
  if (!el.ingredientStockForm) return;
  el.ingredientStockForm.onsubmit = async (event) => {
    event.preventDefault();
    const fd = new FormData(el.ingredientStockForm);
    const payload = Object.fromEntries(fd.entries());
    try {
      await api("/api/admin/ingredient-stock/adjust", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      showToast("Ingredient stock updated");
      el.ingredientStockForm.reset();
      await loadIngredientStock();
    } catch (error) {
      showToast(error.message);
    }
  };
}

async function loadBlameAnalysis() {
  if (!el.blameAnalysisResults) return;
  const date = el.blameAnalysisDate.value || new Date().toISOString().slice(0, 10);
  const breadType = el.blameAnalysisBreadType?.value || "";
  const params = new URLSearchParams({ date });
  if (breadType) params.set("breadType", breadType);
  el.blameAnalysisResults.innerHTML = '<p class="muted">Analyzing flow and discrepancies...</p>';
  try {
    const result = await api(`/api/admin/blame-analysis?${params.toString()}`);
    const { analysis } = result;

    if (!analysis || analysis.length === 0) {
      el.blameAnalysisResults.innerHTML = '<p class="muted">No data for this date.</p>';
      return;
    }

    let html = '<div style="display: grid; gap: 1.5rem;">';
    analysis.forEach((item) => {
      const totalLoss = Number(item.totalLoss) || 0;
      const hasData = Boolean(item.hasData);
      const confidence = String(item.confidence || (hasData ? "high" : "none"));
      const status = !hasData ? 'ok' : totalLoss === 0 ? 'ok' : totalLoss > 5 ? 'critical' : 'warning';
      const flow = item.flow || {};
      const dominant = (item.blame || []).reduce((top, current) => {
        const currentLoss = Number(current?.loss) || 0;
        return currentLoss > (Number(top?.loss) || 0) ? current : top;
      }, null);
      const dominantText = !hasData
        ? "No records submitted for this date."
        : (dominant && Number(dominant.loss) > 0)
          ? `Likely root cause: ${dominant.stage} (${dominant.loss} loaves)`
          : "No loss detected across stages.";
      
      let blameHtml = '';
      if (item.blame && Array.isArray(item.blame)) {
        blameHtml = item.blame.map(b => `
          <div style="padding: 0.75rem; background: #f0f0f0; border-left: 3px solid ${Number(b.loss) > 0 ? '#ff6b6b' : '#22c55e'}; margin: 0.5rem 0;">
            <strong>${b.stage}</strong> - Impact: <strong>${b.loss}</strong> loaves<br/>
            <small style="color: #666;">${b.reason}</small>
          </div>
        `).join('');
      }

      html += `
        <div style="border: 1px solid #ddd; border-radius: 8px; padding: 1rem; background: #fafafa;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
            <strong>${item.breadType}</strong>
            <div style="display:flex; gap:0.45rem; align-items:center; flex-wrap:wrap; justify-content:flex-end;">
              <span class="badge ${status}">${!hasData ? 'NO DATA' : totalLoss === 0 ? 'OK' : totalLoss > 0 ? 'LOSS: ' + totalLoss : 'NET GAIN: ' + Math.abs(totalLoss)}</span>
              <span class="badge ${confidence === 'high' ? 'ok' : 'warning'}">CONFIDENCE: ${confidence.toUpperCase()}</span>
            </div>
          </div>
          <p class="muted" style="margin:0 0 0.75rem 0;">${dominantText}</p>
          <div style="background: #f5f5f5; padding: 0.5rem; border-radius: 4px; font-size: 0.9rem; margin-bottom: 0.75rem;">
            Baker Produced: ${flow.produced ?? item.produced} → Bagger Received: ${flow.baggerReceived ?? 0} → Bagger Bagged: ${flow.bagged ?? item.bagged} → Sales Received: ${flow.salesReceived ?? 0} → Sales Sold: ${flow.sold ?? item.sold} → Delivery Taken: ${flow.deliveryTaken ?? 0} → Delivery Delivered: ${flow.delivered ?? item.delivered}
          </div>
          ${Array.isArray(item.dataGaps) && item.dataGaps.length ? `<div style="background:#fff5f5; border:1px solid #fecaca; color:#991b1b; padding:0.55rem 0.7rem; border-radius:6px; margin-bottom:0.75rem; font-size:0.86rem;"><strong>Data gaps:</strong> ${item.dataGaps.join('; ')}</div>` : ''}
          ${blameHtml || '<p class="muted" style="margin: 0;">No discrepancies</p>'}
        </div>
      `;
    });
    html += '</div>';

    el.blameAnalysisResults.innerHTML = html;
  } catch (err) {
    el.blameAnalysisResults.innerHTML = `<p class="muted">Error loading analysis: ${err.message}</p>`;
  }
}

async function updateMenuBadges() {
  if (!state.token || state.user.role !== "admin") return;
  
  try {
    // Count critical/warning submissions per role
    const countByRole = { baker: 0, bagger: 0, sales: 0, delivery: 0 };
    
    for (const role of Object.keys(countByRole)) {
      const response = await api(`/api/admin/submissions?role=${role}&limit=1000`);
      const submissions = response.submissions || [];
      countByRole[role] = submissions.filter(s => s.severity === "critical" || s.severity === "warning").length;
    }
    
    // Update badges on menu buttons
    document.querySelectorAll('[data-badge="submissions"]').forEach(btn => {
      const total = Object.values(countByRole).reduce((a, b) => a + b, 0);
      if (total > 0) {
        btn.innerHTML = `Submissions <span class="badge">${total}</span>`;
      }
    });
  } catch (err) {
    console.warn("Could not load badge counts:", err);
  }
}

async function loadAdjustments() {
  if (!state.token || state.user.role !== "admin" || !el.adjustmentsList) return;
  
  try {
    const response = await api("/api/admin/adjustments");
    const adjustments = response.adjustments || [];
    
    if (adjustments.length === 0) {
      el.adjustmentsList.innerHTML = "<p class=\"muted\">No adjustments recorded</p>";
      return;
    }
    
    el.adjustmentsList.innerHTML = adjustments.map(adj => `
      <div class="adjustment-item" style="border-left: 4px solid var(--color-accent); padding: 0.75rem; margin: 0.5rem 0; background: var(--color-bg-secondary); border-radius: 0.25rem;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem;">
          <strong>${adj.table.toUpperCase()}</strong>
          <small class="muted">${new Date(adj.adjusted_at).toLocaleString()}</small>
        </div>
        <p style="margin: 0; font-size: 0.85rem; color: var(--color-text-secondary);">
          ${adj.change_description || "Data correction applied"}
        </p>
        <p style="margin: 0.25rem 0 0 0; font-size: 0.8rem; color: var(--color-muted);">
          By: ${adj.admin_name || "Unknown"}
        </p>
      </div>
    `).join("");
  } catch (err) {
    el.adjustmentsList.innerHTML = `<p class="muted">Error loading adjustments: ${err.message}</p>`;
  }
}

function initFormValidation() {
  // Production form validation
  const productionForm = el.productionForm;
  if (!productionForm) return;
  
  const rules = {
    flourKg: (val) => val > 0 || "Must be greater than 0",
    producedCount: (val) => val > 0 || "Must be greater than 0",
    soldCount: (val) => val >= 0 || "Cannot be negative",
  };
  
  const validateField = (fieldName, value) => {
    const rule = rules[fieldName];
    if (!rule) return "";
    const result = rule(Number(value));
    return result === true ? "" : result;
  };
  
  // Clear validation on focus, validate on blur
  productionForm.querySelectorAll("input[type=\"number\"]").forEach(field => {
    field.addEventListener("blur", () => {
      const error = validateField(field.name, field.value);
      let errorEl = field.nextElementSibling;
      if (errorEl && errorEl.classList.contains("field-error")) {
        errorEl.remove();
      }
      if (error) {
        const span = document.createElement("span");
        span.className = "field-error";
        span.style.cssText = "color: var(--color-critical); font-size: 0.8rem; display: block; margin-top: 0.25rem;";
        span.textContent = error;
        field.parentNode.insertBefore(span, field.nextSibling);
      }
    });
  });
}

function wireSearchInputs() {
  if (!state.token || state.user.role !== "admin") return;
  
  const searchFields = [
    { el: el.bakerSearchName, debounceKey: "bakerSearch" },
    { el: el.baggerSearchName, debounceKey: "baggerSearch" },
    { el: el.salesSearchName, debounceKey: "salesSearch" },
    { el: el.deliverySearchName, debounceKey: "deliverySearch" },
  ];
  
  searchFields.forEach(({ el: field, debounceKey }) => {
    if (!field) return;
    
    field.addEventListener("input", () => {
      clearTimeout(window[debounceKey]);
      window[debounceKey] = setTimeout(() => {
        loadAdminData(false); // Refresh tables with search applied
      }, 300);
    });
  });
}

function wireHistoryFilterDisplay() {
  const historyFilterBar = document.getElementById("historyFilterBar");
  if (!historyFilterBar) return;
  
  const dateInput = el.historyFromDate;
  const breadInput = el.historyBreadType;
  
  const updateDisplay = () => {
    const date = dateInput ? dateInput.value : "";
    const bread = breadInput ? breadInput.value : "";
    
    let display = [];
    if (date) display.push(`Date: ${new Date(date).toLocaleDateString()}`);
    if (bread) display.push(`Bread: ${bread}`);
    
    const badges = display.map(text => 
      `<span class="filter-badge" style="display: inline-block; background: var(--color-accent); color: white; padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.8rem; margin: 0 0.25rem 0.25rem 0;">${text}</span>`
    ).join("");
    
    let filterDisplay = document.getElementById("historyFilterDisplay");
    if (!filterDisplay && display.length > 0) {
      filterDisplay = document.createElement("div");
      filterDisplay.id = "historyFilterDisplay";
      filterDisplay.style.cssText = "margin-bottom: 0.75rem; display: flex; flex-wrap: wrap; gap: 0.25rem;";
      historyFilterBar.parentNode.insertBefore(filterDisplay, historyFilterBar.nextSibling);
    }
    
    if (filterDisplay) {
      if (display.length === 0) {
        filterDisplay.remove();
      } else {
        filterDisplay.innerHTML = badges;
      }
    }
  };
  
  if (dateInput) dateInput.addEventListener("change", updateDisplay);
  if (breadInput) breadInput.addEventListener("change", updateDisplay);
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

  if (el.exportOptionsToggle) {
    el.exportOptionsToggle.onclick = () => {
      el.exportOptionsPanel.classList.toggle("hidden");
    };
  }
  
  if (el.closeExportPanelBtn) {
    el.closeExportPanelBtn.onclick = () => {
      el.exportOptionsPanel.classList.add("hidden");
    };
  }
  
  if (el.executeExportBtn) {
    el.executeExportBtn.onclick = () => {
      const date = el.reportDate.value || new Date().toISOString().slice(0, 10);
      const scope = document.querySelector('input[name="exportScope"]:checked')?.value || 'all';
      const params = new URLSearchParams({ date, scope });
      const a = document.createElement("a");
      a.href = `/api/admin/export-csv?${params.toString()}`;
      a.download = `bigcat-report-${date}-${scope}.csv`;
      if (state.token) {
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
            el.exportOptionsPanel.classList.add("hidden");
          })
          .catch((error) => showToast(error.message));
      }
    };
  }

  if (el.exportFinancialCsvBtn) {
    el.exportFinancialCsvBtn.onclick = () => {
      const date = el.reportDate.value || new Date().toISOString().slice(0, 10);
      const params = new URLSearchParams({ date });
      const a = document.createElement("a");
      a.href = `/api/admin/export-financial-csv?${params.toString()}`;
      a.download = `bigcat-financial-report-${date}.csv`;

      if (state.token) {
        fetch(a.href, { headers: { Authorization: `Bearer ${state.token}` } })
          .then((response) => {
            if (!response.ok) {
              return response.json().then((payload) => {
                throw new Error(payload.error || "Financial export failed");
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
            showToast("Financial report downloaded");
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
    if (state.user?.role === "admin") {
      const menuButton = event.target.closest("button[data-admin-view]");
      if (!menuButton) return;
      setAdminDashboardView(menuButton.dataset.adminView);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

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
        <th>Date</th><th>Stage</th><th>Bread Type</th><th>Quantity</th>
      </tr></thead>
      <tbody>${filtered.map(row => `<tr>
        <td>${row.created_at.slice(0, 10)}</td>
        <td>${row.stage}</td>
        <td>${row.bread_type}</td>
        <td>${row.produced_count || row.bagged_count || row.total_sold || row.total_delivered || '—'}</td>
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
    initAdminDensityToggle();
    initAdminQuickNavEffects();
    initAdminAccordions();
    initCreateStaffForm();
    initIngredientStockForm();
    loadStaffList();
    try {
      await refreshAdmin();
    } catch (error) {
      showToast(error.message || "Unable to load admin submissions");
    }
    // Setup and run root cause analysis on first admin load.
    if (el.blameAnalysisDate) {
      el.blameAnalysisDate.value = el.reportDate.value || new Date().toISOString().slice(0, 10);
    }
    if (el.blameAnalysisBreadType && !el.blameAnalysisBreadType.querySelector("option[value='Jumbo']")) {
      Object.keys(state.breadTypes).forEach((type) => {
        const option = document.createElement("option");
        option.value = type;
        option.textContent = type;
        el.blameAnalysisBreadType.appendChild(option);
      });
    }
    if (el.loadBlameAnalysisBtn) {
      el.loadBlameAnalysisBtn.onclick = () => loadBlameAnalysis();
    }
    await loadBlameAnalysis();
    // Load adjustments and wire up admin features
    await loadAdjustments();
    wireSearchInputs();
    await updateMenuBadges();
  } else {
    renderFormsByRole();
    // Initialize form validation for staff submission forms
    initFormValidation();
  }

  // Show change-password card for all roles
  if (el.changePasswordCard) {
    el.changePasswordCard.classList.remove("hidden");
    initChangePasswordForm();
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
  wireHistoryFilterDisplay();
  
  if (state.user.role !== "admin") {
    try {
      await hydrateStaffPreviewFromHistory();
    } catch (_error) {
      // Keep UI usable even if preview history cannot be fetched.
    }
  }
}

boot();
