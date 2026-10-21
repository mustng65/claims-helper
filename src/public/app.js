const REQUIRED_COLUMNS = [
  "Claim Number",
  "Provider",
  "Service Date",
  "Total Charges",
  "SavDisc",
  "Inelig",
  "Ded",
  "CoPay",
  "Amount Paid",
];

const fileInput = document.querySelector("#csv-file");
const statusMessage = document.querySelector("#status");
const statusText = document.querySelector("#status-text");
const dismissStatusButton = document.querySelector("#dismiss-status");
const preview = document.querySelector("#preview");
const rowCount = document.querySelector("#row-count");
const table = document.querySelector("#csv-table");
const serviceDateInput = document.querySelector("#service-date");
const clearDateButton = document.querySelector("#clear-date");
const yearTabs = document.querySelector("#year-tabs");
const statusOptions = document.querySelector("#status-options");
const selectAllStatusesButton = document.querySelector("#select-all-statuses");
const resetFiltersButton = document.querySelector("#reset-filters");
const filtersDialog = document.querySelector("#filters-dialog");
const openFiltersButton = document.querySelector("#open-filters");
const closeFiltersButton = document.querySelector("#close-filters");
const filterSummary = document.querySelector("#filter-summary");
const activeFilterCount = document.querySelector("#active-filter-count");
const dedTotal = document.querySelector("#ded-total");
const copayTotal = document.querySelector("#copay-total");
const coinsTotal = document.querySelector("#coins-total");
const costShareTotal = document.querySelector("#cost-share-total");
const chargesTotal = document.querySelector("#charges-total");
const savdiscTotal = document.querySelector("#savdisc-total");
const amountPaidTotal = document.querySelector("#amount-paid-total");
const reviewDialog = document.querySelector("#review-dialog");
const reviewForm = document.querySelector("#review-form");
const reviewClaimNumber = document.querySelector("#review-claim-number");
const reviewedCheckbox = document.querySelector("#reviewed-checkbox");
const reviewComment = document.querySelector("#review-comment");
let loadedClaims = null;
let selectedYear = null;
let defaultYear = null;
let toastTimeout = null;
let editingClaimNumber = null;
const CLAIM_STATUSES = ["Pending", "Paid", "Needs Review", "Reviewed"];

dismissStatusButton.addEventListener("click", hideToast);
openFiltersButton.addEventListener("click", () => filtersDialog.showModal());
closeFiltersButton.addEventListener("click", () => filtersDialog.close());
document.querySelector("#close-review").addEventListener("click", () => reviewDialog.close());
document.querySelector("#cancel-review").addEventListener("click", () => reviewDialog.close());
table.addEventListener("click", (event) => {
  console.log("table click", event.target);
  const button = event.target.closest("button[data-review-claim], button[data-view-comment]");
  if (!button) {
    document.querySelectorAll(".claim-actions[open]").forEach((openMenu) => {
      openMenu?.removeAttribute("open");
    });
    return;
  }

  button.closest("details")?.removeAttribute("open");
  if (button.dataset.reviewClaim) {
    openReviewDialog(button.dataset.reviewClaim);
  } else {
    document.querySelectorAll(".claim-actions[open]").forEach((openMenu) => {
      openMenu?.removeAttribute("open");
    });
    openReviewDialog(button.dataset.viewComment, true);
  }
});
reviewForm.addEventListener("submit", saveClaimReview);
filtersDialog.addEventListener("click", (event) => {
  if (event.target === filtersDialog) {
    filtersDialog.close();
  }
});

serviceDateInput.addEventListener("input", () => {
  if (serviceDateInput.value) {
    selectedYear = serviceDateInput.value.slice(0, 4);
  }
  renderFilteredClaims();
});
clearDateButton.addEventListener("click", () => {
  serviceDateInput.value = "";
  renderFilteredClaims();
});
yearTabs.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-year]");
  if (!button) return;

  selectedYear = button.dataset.year;
  serviceDateInput.value = "";
  renderFilteredClaims();
});
statusOptions.addEventListener("change", renderFilteredClaims);
selectAllStatusesButton.addEventListener("click", () => {
  statusOptions.querySelectorAll('input[name="claim-status"]').forEach((input) => {
    input.checked = true;
  });
  renderFilteredClaims();
});
resetFiltersButton.addEventListener("click", () => {
  if (!loadedClaims) return;

  selectedYear = defaultYear;
  serviceDateInput.value = "";
  statusOptions.querySelectorAll('input[name="claim-status"]').forEach((input) => {
    input.checked = true;
  });
  renderFilteredClaims();
});

fileInput.addEventListener("change", async () => {
  const [file] = fileInput.files;
  if (!file) return;

  preview.hidden = true;
  table.replaceChildren();
  loadedClaims = null;
  selectedYear = null;
  defaultYear = null;
  editingClaimNumber = null;
  yearTabs.replaceChildren();
  statusOptions.replaceChildren();
  if (filtersDialog.open) filtersDialog.close();
  if (reviewDialog.open) reviewDialog.close();
  filterSummary.textContent = "";
  activeFilterCount.hidden = true;
  resetFiltersButton.disabled = true;
  serviceDateInput.value = "";
  serviceDateInput.disabled = true;
  clearDateButton.disabled = true;
  showToast(`Loading ${file.name}…`, "info", 0);

  try {
    const records = parseCsv(await file.text());
    parseClaimsExport(records);
    const result = await requestClaims("/api/claims", {
      method: "POST",
      headers: records[0].map((header) => header.trim()),
      records: records.slice(1),
    });

    displayClaims(result.headers, result.records, result.reviews);
    showToast(`Created ${result.inserted} new, ${result.updated} updated, and ${result.unchanged} unchanged claims.`, "success");
  } catch (error) {
    showToast(error instanceof Error
      ? `Could not import claims export: ${error.message}`
      : "Could not import claims export due to an unknown error.", "error");
  }
});

function showToast(message, type, duration = 6000) {
  clearTimeout(toastTimeout);
  statusMessage.className = `toast ${type}`;
  statusText.textContent = message;
  statusMessage.hidden = false;
  if (duration > 0) {
    toastTimeout = setTimeout(hideToast, duration);
  }
}

function hideToast() {
  clearTimeout(toastTimeout);
  statusMessage.hidden = true;
}

async function requestClaims(url, body, method = body ? "POST" : "GET") {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("The server returned an invalid response.");
  }
  if (!response.ok) {
    throw new Error(result.error || `The server returned ${response.status}.`);
  }
  return result;
}

function displayClaims(headers, records, reviews = {}) {
  const claims = parseClaimsExport([headers, ...records]);
  claims.rows.forEach((claim) => {
    const review = reviews[claim["Claim Number"].trim()];
    claim.reviewed = review?.reviewed ?? false;
    claim.reviewComment = review?.comment ?? "";
    claim.originalStatus = claim.Status;
    if (claim.reviewed) claim.Status = "Reviewed";
  });
  loadedClaims = claims;
  populateYearTabs(claims.rows);
  populateStatusFilters();
  serviceDateInput.disabled = false;
  renderFilteredClaims();
  preview.hidden = false;
}

function openReviewDialog(claimNumber, readOnly = false) {
  const claim = loadedClaims?.rows.find((row) => row["Claim Number"].trim() === claimNumber);
  if (!claim) return;

  editingClaimNumber = claimNumber;
  reviewClaimNumber.textContent = claimNumber;
  reviewedCheckbox.checked = claim.reviewed;
  reviewedCheckbox.disabled = readOnly;
  reviewedCheckbox.closest("label").hidden = readOnly;
  reviewComment.value = claim.reviewComment;
  reviewComment.readOnly = readOnly;
  reviewForm.querySelector('button[type="submit"]').hidden = readOnly;
  document.querySelector("#review-title").textContent = readOnly ? "Review comment" : "Review claim";
  document.querySelector("#cancel-review").textContent = readOnly ? "Close" : "Cancel";
  reviewDialog.showModal();
}

async function saveClaimReview(event) {
  event.preventDefault();
  if (!editingClaimNumber || !loadedClaims) return;

  const saveButton = reviewForm.querySelector('button[type="submit"]');
  saveButton.disabled = true;
  try {
    const review = await requestClaims("/api/reviews", {
      claimNumber: editingClaimNumber,
      reviewed: reviewedCheckbox.checked,
      comment: reviewComment.value,
    }, "PUT");
    const claim = loadedClaims.rows.find((row) => row["Claim Number"].trim() === review.claimNumber);
    if (claim) {
      claim.reviewed = review.reviewed;
      claim.reviewComment = review.comment;
      claim.Status = review.reviewed ? "Reviewed" : claim.originalStatus;
    }
    reviewDialog.close();
    renderFilteredClaims();
    showToast(`Review saved for claim ${review.claimNumber}.`, "success");
  } catch (error) {
    showToast(error instanceof Error
      ? `Could not save claim review: ${error.message}`
      : "Could not save claim review due to an unknown error.", "error");
  } finally {
    saveButton.disabled = false;
  }
}

async function loadStoredClaims() {
  try {
    const result = await requestClaims("/api/claims");
    if (result.records.length === 0) {
      return;
    }

    displayClaims(result.headers, result.records, result.reviews);
  } catch (error) {
    showToast(error instanceof Error
      ? `Could not load stored claims: ${error.message}`
      : "Could not load stored claims due to an unknown error.", "error");
  }
}

loadStoredClaims();

function renderFilteredClaims() {
  if (!loadedClaims || selectedYear === null) return;

  const selectedDate = serviceDateInput.value;
  const selectedStatuses = new Set(
    [...statusOptions.querySelectorAll('input[name="claim-status"]:checked')]
      .map((input) => input.value),
  );
  const allStatusesSelected = selectedStatuses.size === CLAIM_STATUSES.length;
  const claims = loadedClaims.rows.filter((claim) => {
    const serviceDate = toInputDate(claim["Service Date"]);
    const claimYear = serviceDate ? serviceDate.slice(0, 4) : "unknown";
    return claimYear === selectedYear
      && (!selectedDate || serviceDate === selectedDate)
      && selectedStatuses.has(claim.Status);
  });
  const yearClaims = loadedClaims.rows.filter((claim) => {
    const serviceDate = toInputDate(claim["Service Date"]);
    const claimYear = serviceDate ? serviceDate.slice(0, 4) : "unknown";
    return claimYear === selectedYear;
  });
  const groups = groupClaimsByPrefix(claims);

  renderTable(loadedClaims.headers, groups);
  renderYearSummary(yearClaims);
  const yearLabel = selectedYear === "unknown" ? "Unknown service year" : selectedYear;
  rowCount.textContent = `${yearLabel} · ${claims.length} ${claims.length === 1 ? "row" : "rows"} · ${loadedClaims.headers.length} columns · ${groups.length} claim groups`;
  clearDateButton.disabled = selectedDate === "";
  selectAllStatusesButton.disabled = allStatusesSelected;
  resetFiltersButton.disabled = selectedYear === defaultYear
    && selectedDate === ""
    && allStatusesSelected;
  yearTabs.querySelectorAll("button[data-year]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.year === selectedYear));
  });
  updateFilterSummary(selectedDate, selectedStatuses);
}

function updateFilterSummary(selectedDate, selectedStatuses) {
  const yearLabel = selectedYear === "unknown" ? "Unknown year" : selectedYear;
  const summary = [yearLabel];
  if (selectedDate) summary.push(selectedDate);
  summary.push(selectedStatuses.size === CLAIM_STATUSES.length
    ? "All statuses"
    : selectedStatuses.size === 0
      ? "No statuses"
      : [...selectedStatuses].join(", "));
  filterSummary.textContent = summary.join(" · ");

  const activeCount = Number(selectedYear !== defaultYear)
    + Number(selectedDate !== "")
    + Number(selectedStatuses.size !== CLAIM_STATUSES.length);
  activeFilterCount.textContent = String(activeCount);
  activeFilterCount.hidden = activeCount === 0;
}

function populateStatusFilters() {
  CLAIM_STATUSES.forEach((status) => {
    const label = document.createElement("label");
    label.className = "status-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "claim-status";
    checkbox.value = status;
    checkbox.checked = true;

    const text = document.createElement("span");
    text.textContent = status;

    label.append(checkbox, text);
    statusOptions.append(label);
  });
  selectAllStatusesButton.disabled = true;
}

function renderYearSummary(claims) {
  const totals = claims.reduce((sum, claim) => {
    sum.ded += parseAmountCents(claim["Ded"]);
    sum.copay += parseAmountCents(claim["CoPay"]);
    sum.coins += claim.CoInsCents;
    sum.charges += parseAmountCents(claim["Total Charges"]);
    sum.savdisc += parseAmountCents(claim["SavDisc"]);
    sum.amountPaid += parseAmountCents(claim["Amount Paid"]);
    return sum;
  }, { ded: 0, copay: 0, coins: 0, charges: 0, savdisc: 0, amountPaid: 0 });

  dedTotal.textContent = formatCurrencyCents(totals.ded);
  copayTotal.textContent = formatCurrencyCents(totals.copay);
  coinsTotal.textContent = formatCurrencyCents(totals.coins);
  costShareTotal.textContent = formatCurrencyCents(totals.ded + totals.copay + totals.coins);
  chargesTotal.textContent = formatCurrencyCents(totals.charges);
  savdiscTotal.textContent = formatCurrencyCents(totals.savdisc);
  amountPaidTotal.textContent = formatCurrencyCents(totals.amountPaid);
}

function populateYearTabs(claims) {
  const counts = new Map();

  claims.forEach((claim) => {
    const serviceDate = toInputDate(claim["Service Date"]);
    const year = serviceDate ? serviceDate.slice(0, 4) : "unknown";
    counts.set(year, (counts.get(year) ?? 0) + 1);
  });

  const years = [...counts.keys()].sort((left, right) => {
    if (left === "unknown") return 1;
    if (right === "unknown") return -1;
    return Number(right) - Number(left);
  });

  if (years.length === 0) {
    years.push("unknown");
    counts.set("unknown", 0);
  }

  selectedYear = years[0];
  defaultYear = selectedYear;
  years.forEach((year) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "year-tab";
    button.dataset.year = year;
    button.setAttribute("aria-pressed", String(year === selectedYear));
    const label = year === "unknown" ? "Unknown" : year;
    const count = counts.get(year);
    button.textContent = `${label} (${count})`;
    yearTabs.append(button);
  });
}

function toInputDate(date) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date);
  if (!match) return "";

  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function parseClaimsExport(records) {
  if (records.length === 0) {
    throw new Error("The selected file is empty.");
  }

  const headers = records[0].map((header) => header.trim());
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
  if (missingColumns.length > 0) {
    throw new Error(`Expected claims-export columns are missing: ${missingColumns.join(", ")}.`);
  }

  const sourceHeaders = [...headers];
  headers.splice(headers.indexOf("Service Date"), 1);
  headers.unshift("Service Date");
  headers.splice(headers.indexOf("CoPay") + 1, 0, "CoIns");
  headers.push("Status");
  const rows = records.slice(1).map((values) => {
    const claim = Object.fromEntries(sourceHeaders.map((header, index) => [header, values[index] ?? ""]));
    const ineligibleAmount = claim["Inelig"].trim();

    if (ineligibleAmount !== "" && parseAmountCents(ineligibleAmount) === 0) {
      const coInsuranceCents = parseAmountCents(claim["Total Charges"])
        - ["SavDisc", "Ded", "CoPay", "Amount Paid"]
          .reduce((total, header) => total + parseAmountCents(claim[header]), 0);
      claim.CoInsCents = coInsuranceCents;
      claim.CoIns = formatCurrencyCents(coInsuranceCents);
    } else {
      claim.CoInsCents = 0;
      claim.CoIns = "$0.00";
    }

    claim.Status = getClaimStatus(claim);
    return claim;
  });

  groupClaimsByPrefix(rows).forEach((group) => {
    if (group.claims.length < 2) return;

    const ineligibleTotal = group.claims.reduce((total, claim) => (
      total + parseAmountCents(claim["Inelig"])
    ), 0);

    const PaidTotal = group.claims.reduce((total, claim) => (
      total + parseAmountCents(claim["Amount Paid"])
    ), 0);

    const groupStatus = (ineligibleTotal > 0 && PaidTotal <= 0) ? "Needs Review" : "Paid";
    group.claims.forEach((claim) => {
      claim.Status = groupStatus;
    });
  });

  return { headers, rows };
}

function getClaimStatus(claim) {
  if (claim["SavDisc"].trim() === "") {
    return "Pending";
  }

  const paidTotal = ["SavDisc", "Ded", "CoPay", "CoIns", "Amount Paid"]
    .reduce((total, header) => total + parseAmountCents(claim[header]), 0);
  return parseAmountCents(claim["Total Charges"]) === paidTotal
    ? "Paid"
    : "Needs Review";
}

function parseCsv(text) {
  const input = text.replace(/^\uFEFF/, "");
  if (input.length === 0) return [];

  const records = [];
  let record = [];
  let field = "";
  let inQuotes = false;
  let afterQuote = false;
  let recordStarted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    recordStarted = true;

    if (inQuotes) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (afterQuote && character !== "," && character !== "\r" && character !== "\n" && character !== " " && character !== "\t") {
      throw new Error(`Unexpected character after a quoted field at character ${index + 1}.`);
    }

    if (character === '"') {
      if (field.length !== 0 || afterQuote) {
        throw new Error(`Unexpected quote at character ${index + 1}.`);
      }
      inQuotes = true;
    } else if (character === ",") {
      record.push(field);
      field = "";
      afterQuote = false;
    } else if (character === "\r" || character === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      afterQuote = false;
      recordStarted = false;
      if (character === "\r" && input[index + 1] === "\n") index += 1;
    } else if (!afterQuote || (character !== " " && character !== "\t")) {
      field += character;
    }
  }

  if (inQuotes) {
    throw new Error("The file ends inside a quoted field.");
  }

  if (recordStarted || field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  return records;
}

function groupClaimsByPrefix(claims) {
  const groups = new Map();

  claims.forEach((claim, index) => {
    const claimNumber = claim["Claim Number"];
    const revisionMarker = /R\d+$/.exec(claimNumber);
    const prefix = revisionMarker ? claimNumber.slice(0, revisionMarker.index) : null;
    const key = prefix === null ? `unmatched-${index}` : `prefix-${prefix}`;
    const label = prefix === null
      ? `${claimNumber || "(blank claim number)"} (no R)`
      : prefix || "(empty prefix)";

    if (!groups.has(key)) {
      groups.set(key, { label, claims: [] });
    }
    groups.get(key).claims.push(claim);
  });

  return [...groups.values()].map((group) => {
    if (group.claims.length > 1) {
      group.claims.sort((left, right) => {
        const leftRevision = Number(/R(\d+)$/.exec(left["Claim Number"])?.[1]);
        const rightRevision = Number(/R(\d+)$/.exec(right["Claim Number"])?.[1]);
        return leftRevision - rightRevision;
      });
    }
    return group;
  });
}

function renderTable(headers, groups) {
  const visibleHeaders = headers.filter((header) => header !== "Provider");
  const tableHeaders = visibleHeaders;
  const headerRow = document.createElement("tr");

  tableHeaders.forEach((header) => {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = header;
    headerRow.append(cell);
  });

  const thead = document.createElement("thead");
  thead.append(headerRow);
  const tbody = document.createElement("tbody");

  groups.forEach((group) => {
    const groupRow = document.createElement("tr");
    groupRow.className = "group-row";
    const groupCell = document.createElement("td");
    groupCell.colSpan = tableHeaders.length;
    groupCell.textContent = `Claim ${group.label} · ${group.claims.length} ${group.claims.length === 1 ? "record" : "records"}`;
    groupRow.append(groupCell);
    tbody.append(groupRow);

    group.claims.forEach((claim) => {
      const tableRow = document.createElement("tr");
      const hasNeedsReview = claim["Status"] === "Needs Review";
      const hasCostShare = parseAmount(claim["Ded"]) > 0 || parseAmount(claim["CoPay"]) > 0;
      const rowClasses = [];
      const rowWarnings = [];

      if (hasCostShare) {
        rowClasses.push("info-row");
        rowWarnings.push("Deductible or copay is greater than zero.");
      }
      if (hasNeedsReview) {
        rowClasses.push("warning-row");
        rowWarnings.push("This claim needs review.");
      }
      tableRow.className = rowClasses.join(" ");
      tableRow.title = rowWarnings.join(" ");

      visibleHeaders.forEach((header) => {
        const cell = document.createElement("td");
        if (header === "Claim Number") {
          const claimNumber = document.createElement("span");
          claimNumber.className = "claim-number";
          claimNumber.textContent = claim["Claim Number"];
          const provider = document.createElement("span");
          provider.className = "claim-provider";
          provider.textContent = claim.Provider;
          cell.append(claimNumber, provider);
        } else if (header === "Status") {
          const statusContainer = document.createElement("div");
          statusContainer.className = "status-cell";
          const status = document.createElement("span");
          status.textContent = claim.Status;
          statusContainer.append(status);
          cell.append(statusContainer);
          if (claim.Status === "Needs Review" || claim.reviewComment) {
            const actions = document.createElement("div");
            actions.className = "status-actions";
            if (claim.Status === "Needs Review") {
              const menu = document.createElement("details");
              menu.className = "claim-actions";
              const trigger = document.createElement("summary");
              trigger.className = "claim-actions-trigger";
              trigger.setAttribute("aria-label", `Actions for claim ${claim["Claim Number"]}`);
              trigger.title = "Claim actions";
              trigger.textContent = "⋮";
              const menuItems = document.createElement("div");
              menuItems.className = "claim-actions-menu";
              const reviewButton = document.createElement("button");
              reviewButton.type = "button";
              reviewButton.dataset.reviewClaim = claim["Claim Number"].trim();
              reviewButton.textContent = "Review claim";
              menuItems.append(reviewButton);
              menu.append(trigger, menuItems);
              actions.append(menu);
            }
            if (claim.reviewComment) {
              const commentButton = document.createElement("button");
              commentButton.type = "button";
              commentButton.className = "comment-trigger";
              commentButton.dataset.viewComment = claim["Claim Number"].trim();
              commentButton.setAttribute("aria-label", `View review comment for claim ${claim["Claim Number"]}`);
              commentButton.title = "View review comment";
              const commentIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
              commentIcon.setAttribute("viewBox", "0 0 20 20");
              commentIcon.setAttribute("aria-hidden", "true");
              const commentPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
              commentPath.setAttribute("d", "M3 4.5A2.5 2.5 0 0 1 5.5 2h9A2.5 2.5 0 0 1 17 4.5v6a2.5 2.5 0 0 1-2.5 2.5H8l-4.5 4v-5.2A2.5 2.5 0 0 1 3 10.5z");
              commentIcon.append(commentPath);
              commentButton.append(commentIcon);
              actions.append(commentButton);
            }
            statusContainer.append(actions);
          }
        } else {
          cell.textContent = claim[header];
        }
        tableRow.append(cell);
      });
      tbody.append(tableRow);
    });
  });

  if (groups.length === 0) {
    const emptyRow = document.createElement("tr");
    const emptyCell = document.createElement("td");
    emptyCell.colSpan = tableHeaders.length;
    emptyCell.textContent = "No claims found for this service date.";
    emptyRow.append(emptyCell);
    tbody.append(emptyRow);
  }

  table.replaceChildren(thead, tbody);
}

function parseAmount(value) {
  return parseAmountCents(value) / 100;
}

function parseAmountCents(value) {
  const trimmed = value.trim();
  if (trimmed === "") return 0;

  const isParenthesized = trimmed.startsWith("(") && trimmed.endsWith(")");
  const amount = trimmed
    .replace(/^\(|\)$/g, "")
    .replace(/[$,\s]/g, "");

  if (!/^-?\d+(?:\.\d+)?$/.test(amount)) {
    throw new Error(`Invalid currency amount: "${value}".`);
  }

  const cents = Math.round(Math.abs(Number(amount)) * 100);
  return isParenthesized || amount.startsWith("-") ? -cents : cents;
}

function formatCurrencyCents(amount) {
  const sign = amount < 0 ? "-$" : "$";
  const absoluteAmount = Math.abs(amount);
  return `${sign}${Math.floor(absoluteAmount / 100).toLocaleString("en-US")}.${String(absoluteAmount % 100).padStart(2, "0")}`;
}
