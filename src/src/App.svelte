<script>
  import { onMount } from "svelte";
  import {
    CLAIM_STATUSES,
    formatCurrencyCents,
    groupClaimsByPrefix,
    parseAmountCents,
    parseClaimsExport,
    parseCsv,
    toInputDate,
  } from "./claims.js";

  let loadedClaims = null;
  let years = [];
  let yearCounts = {};
  let selectedYear = null;
  let defaultYear = null;
  let selectedDate = "";
  let selectedStatuses = [...CLAIM_STATUSES];
  let fileInput;
  let filtersDialog;
  let reviewDialog;
  let reviewTarget = null;
  let reviewReadOnly = false;
  let reviewSaving = false;
  let reviewCommentDraft = "";
  let reviewedDraft = false;
  let toast = null;
  let toastTimeout;

  $: selectedStatusSet = new Set(selectedStatuses);
  $: yearClaims = loadedClaims && selectedYear !== null
    ? loadedClaims.rows.filter((claim) => getYear(claim) === selectedYear)
    : [];
  $: visibleClaims = yearClaims.filter((claim) => (
    (!selectedDate || toInputDate(claim["Service Date"]) === selectedDate)
    && selectedStatusSet.has(claim.Status)
  ));
  $: groups = groupClaimsByPrefix(visibleClaims);
  $: visibleHeaders = loadedClaims?.headers.filter((header) => header !== "Provider") ?? [];
  $: rowCount = loadedClaims
    ? `${selectedYear === "unknown" ? "Unknown service year" : selectedYear} · ${visibleClaims.length} ${visibleClaims.length === 1 ? "row" : "rows"} · ${loadedClaims.headers.length} columns · ${groups.length} claim groups`
    : "";
  $: summary = calculateSummary(yearClaims);
  $: allStatusesSelected = selectedStatuses.length === CLAIM_STATUSES.length;
  $: resetDisabled = selectedYear === defaultYear && selectedDate === "" && allStatusesSelected;
  $: yearLabel = selectedYear === "unknown" ? "Unknown year" : selectedYear;
  $: filterSummary = [
    yearLabel,
    ...(selectedDate ? [selectedDate] : []),
    allStatusesSelected
      ? "All statuses"
      : selectedStatuses.length === 0
        ? "No statuses"
        : selectedStatuses.join(", "),
  ].join(" · ");
  $: activeFilterCount = Number(selectedYear !== defaultYear)
    + Number(selectedDate !== "")
    + Number(!allStatusesSelected);

  onMount(() => {
    loadStoredClaims();
    return () => clearTimeout(toastTimeout);
  });

  function getYear(claim) {
    return toInputDate(claim["Service Date"])?.slice(0, 4) || "unknown";
  }

  function calculateSummary(claims) {
    const totals = claims.reduce((sum, claim) => {
      sum.ded += parseAmountCents(claim.Ded);
      sum.copay += parseAmountCents(claim.CoPay);
      sum.coins += claim.CoInsCents;
      sum.charges += parseAmountCents(claim["Total Charges"]);
      sum.savdisc += parseAmountCents(claim.SavDisc);
      sum.amountPaid += parseAmountCents(claim["Amount Paid"]);
      return sum;
    }, { ded: 0, copay: 0, coins: 0, charges: 0, savdisc: 0, amountPaid: 0 });
    return {
      ...totals,
      costShare: totals.ded + totals.copay + totals.coins,
    };
  }

  function showToast(message, type = "info", duration = 6000) {
    clearTimeout(toastTimeout);
    toast = { message, type };
    if (duration > 0) toastTimeout = setTimeout(() => (toast = null), duration);
  }

  function openFilePicker() {
    fileInput.click();
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
    if (!response.ok) throw new Error(result.error || `The server returned ${response.status}.`);
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
    yearCounts = {};
    claims.rows.forEach((claim) => {
      const year = getYear(claim);
      yearCounts[year] = (yearCounts[year] ?? 0) + 1;
    });
    years = Object.keys(yearCounts).sort((left, right) => {
      if (left === "unknown") return 1;
      if (right === "unknown") return -1;
      return Number(right) - Number(left);
    });
    if (years.length === 0) {
      years = ["unknown"];
      yearCounts = { unknown: 0 };
    }
    selectedYear = years[0];
    defaultYear = selectedYear;
    selectedDate = "";
    selectedStatuses = [...CLAIM_STATUSES];
  }

  async function loadStoredClaims() {
    try {
      const result = await requestClaims("/api/claims");
      if (result.records.length > 0) displayClaims(result.headers, result.records, result.reviews);
    } catch (error) {
      showToast(`Could not load stored claims: ${error.message}`, "error");
    }
  }

  async function handleUpload(event) {
    const input = event.currentTarget;
    const [file] = input.files;
    if (!file) return;
    loadedClaims = null;
    selectedYear = null;
    showToast(`Loading ${file.name}…`, "info", 0);
    try {
      const records = parseCsv(await file.text());
      parseClaimsExport(records);
      const result = await requestClaims("/api/claims", {
        headers: records[0].map((header) => header.trim()),
        records: records.slice(1),
      });
      displayClaims(result.headers, result.records, result.reviews);
      showToast(`Created ${result.inserted} new, ${result.updated} updated, and ${result.unchanged} unchanged claims.`, "success");
    } catch (error) {
      showToast(`Could not import claims export: ${error.message}`, "error");
    } finally {
      input.value = "";
    }
  }

  function toggleStatus(status) {
    selectedStatuses = selectedStatuses.includes(status)
      ? selectedStatuses.filter((item) => item !== status)
      : [...selectedStatuses, status];
  }

  function resetFilters() {
    selectedYear = defaultYear;
    selectedDate = "";
    selectedStatuses = [...CLAIM_STATUSES];
  }

  function syncSelectedDateYear() {
    if (selectedDate) selectedYear = selectedDate.slice(0, 4);
  }

  function openReview(claim, readOnly = false) {
    reviewTarget = claim;
    reviewReadOnly = readOnly;
    reviewCommentDraft = claim.reviewComment;
    reviewedDraft = claim.reviewed;
    reviewDialog.showModal();
  }

  async function saveReview(event) {
    event.preventDefault();
    if (!reviewTarget || !loadedClaims) return;
    reviewSaving = true;
    try {
      const saved = await requestClaims("/api/reviews", {
        claimNumber: reviewTarget["Claim Number"].trim(),
        reviewed: reviewedDraft,
        comment: reviewCommentDraft,
      }, "PUT");
      const claim = loadedClaims.rows.find((row) => row["Claim Number"].trim() === saved.claimNumber);
      if (claim) {
        claim.reviewed = saved.reviewed;
        claim.reviewComment = saved.comment;
        claim.Status = saved.reviewed ? "Reviewed" : claim.originalStatus;
        loadedClaims = { ...loadedClaims, rows: [...loadedClaims.rows] };
      }
      reviewDialog.close();
      showToast(`Review saved for claim ${saved.claimNumber}.`, "success");
    } catch (error) {
      showToast(`Could not save claim review: ${error.message}`, "error");
    } finally {
      reviewSaving = false;
    }
  }

  function claimRowClass(claim) {
    if (claim.Status === "Needs Review") return "warning-row";
    if (parseAmountCents(claim.Ded) > 0 || parseAmountCents(claim.CoPay) > 0) return "info-row";
    return "";
  }

  function claimRowTitle(claim) {
    const warnings = [];
    if (parseAmountCents(claim.Ded) > 0 || parseAmountCents(claim.CoPay) > 0) {
      warnings.push("Deductible or copay is greater than zero.");
    }
    if (claim.Status === "Needs Review") warnings.push("This claim needs review.");
    return warnings.join(" ");
  }
</script>

<svelte:head>
  <title>Claims Helper</title>
  <meta name="description" content="Import and analyze your claims data.">
</svelte:head>

<main class="app-shell">
  <header class="page-header">
    <div>
      <p class="eyebrow">CLAIMS OVERVIEW</p>
      <h1><img class="app-icon" src="/favicon.svg" alt="">Claims Helper</h1>
      <p class="intro">Help you analyze your claims data by uploading a CSV file.</p>
    </div>
    <button class="btn btn-primary header-upload" type="button" on:click={openFilePicker}>Load CSV file</button>
  </header>
  <input bind:this={fileInput} id="csv-file" class="file-input-hidden" type="file" accept=".csv,text/csv" aria-hidden="true" tabindex="-1" on:change={handleUpload}>

  {#if toast}
    <div class="alert toast-alert" class:alert-error={toast.type === "error"} class:alert-success={toast.type === "success"} role="status" aria-live="polite">
      <span>{toast.message}</span>
      <button class="btn btn-ghost btn-sm" type="button" aria-label="Dismiss notification" on:click={() => (toast = null)}>×</button>
    </div>
  {/if}

  {#if loadedClaims}
    <section class="card bg-base-100 preview">
      <div class="preview-header">
        <p class="row-count">{rowCount}</p>
        <div class="filter-launcher">
          <p class="filter-summary">{filterSummary}</p>
          <button class="btn btn-outline btn-sm" type="button" on:click={() => filtersDialog.showModal()}>
            Filters
            {#if activeFilterCount}<span class="badge badge-primary badge-sm">{activeFilterCount}</span>{/if}
          </button>
        </div>
      </div>

      <div class="preview-content">
        <aside class="year-summary" aria-labelledby="summary-title">
          <h2 id="summary-title">Year totals</h2>
          <dl class="summary-metrics">
            <div class="summary-metric"><dt>Ded</dt><dd>{formatCurrencyCents(summary.ded)}</dd></div>
            <div class="summary-metric"><dt>CoPay</dt><dd>{formatCurrencyCents(summary.copay)}</dd></div>
            <div class="summary-metric"><dt>CoIns</dt><dd>{formatCurrencyCents(summary.coins)}</dd></div>
            <div class="summary-metric summary-grand-total"><dt>Combined total</dt><dd>{formatCurrencyCents(summary.costShare)}</dd></div>
          </dl>
          <dl class="summary-metrics summary-payment-metrics" aria-label="Additional year totals">
            <div class="summary-metric"><dt>Total Charges</dt><dd>{formatCurrencyCents(summary.charges)}</dd></div>
            <div class="summary-metric"><dt>SavDisc</dt><dd>{formatCurrencyCents(summary.savdisc)}</dd></div>
            <div class="summary-metric"><dt>Amount Paid</dt><dd>{formatCurrencyCents(summary.amountPaid)}</dd></div>
          </dl>
        </aside>

        <div class="table-scroll">
          <table class="table claims-table">
            <thead><tr>{#each visibleHeaders as header}<th scope="col">{header}</th>{/each}</tr></thead>
            <tbody>
              {#each groups as group (group.label)}
                <tr class="group-row"><td colspan={visibleHeaders.length}>Claim {group.label} · {group.claims.length} {group.claims.length === 1 ? "record" : "records"}</td></tr>
                {#each group.claims as claim (claim["Claim Number"])}
                  <tr class={claimRowClass(claim)} title={claimRowTitle(claim)}>
                    {#each visibleHeaders as header}
                      <td>
                        {#if header === "Claim Number"}
                          <span class="claim-number">{claim[header]}</span>
                          <span class="claim-provider">{claim.Provider}</span>
                        {:else if header === "Status"}
                          <div class="status-cell">
                            <span class:badge={claim.Status === "Needs Review"} class:badge-warning={claim.Status === "Needs Review"} class:badge-success={claim.Status === "Paid"} class:badge-info={claim.Status === "Pending"} class:badge-neutral={claim.Status === "Reviewed"}>{claim.Status}</span>
                            {#if claim.Status === "Needs Review"}
                              <details class="dropdown">
                                <summary class="btn m-1">:</summary>
                                <ul class="menu dropdown-content bg-base-100 rounded-box z-1 w-52 p-2 shadow-sm shadow">
                                  <li><button on:click={() => openReview(claim)}>Review claim</button></li>
                                </ul>
                              </details>
                            {/if}
                            {#if claim.reviewComment}
                              <button class="btn btn-ghost btn-xs comment-trigger" type="button" aria-label={`View review comment for claim ${claim["Claim Number"]}`} title="View review comment" on:click={() => openReview(claim, true)}>
                                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4.5A2.5 2.5 0 0 1 5.5 2h9A2.5 2.5 0 0 1 17 4.5v6a2.5 2.5 0 0 1-2.5 2.5H8l-4.5 4v-5.2A2.5 2.5 0 0 1 3 10.5z"></path></svg>
                              </button>
                            {/if}
                          </div>
                        {:else}
                          {claim[header]}
                        {/if}
                      </td>
                    {/each}
                  </tr>
                {/each}
              {:else}
                <tr><td colspan={visibleHeaders.length} class="empty-state">No claims found for this service date.</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <dialog bind:this={filtersDialog} class="modal modal-end filters-modal">
      <div class="modal-box filters-box">
        <div class="drawer-header">
          <div><h2 class="text-lg font-bold">Filters</h2><p>Choose a year, date, and claim status.</p></div>
          <form method="dialog"><button class="btn btn-circle btn-ghost btn-sm" aria-label="Close filters">×</button></form>
        </div>
        <div class="filter-toolbar"><button class="btn btn-ghost btn-sm" type="button" disabled={resetDisabled} on:click={resetFilters}>Reset filters</button></div>
        <div class="filter-controls">
          <fieldset>
            <legend class="filter-label">Service year</legend>
            <div class="year-tabs">
              {#each years as year}
                <button class="btn btn-sm" class:btn-primary={selectedYear === year} type="button" aria-pressed={selectedYear === year} on:click={() => { selectedYear = year; selectedDate = ""; }}>
                  {year === "unknown" ? "Unknown" : year} ({yearCounts[year]})
                </button>
              {/each}
            </div>
          </fieldset>
          <div class="date-search">
            <label class="filter-label" for="service-date">Service date</label>
            <div class="date-inputs">
              <input class="input input-bordered" id="service-date" type="date" bind:value={selectedDate} on:change={syncSelectedDateYear}>
              <button class="btn btn-outline btn-sm" type="button" disabled={!selectedDate} on:click={() => (selectedDate = "")}>Clear</button>
            </div>
          </div>
          <fieldset>
            <legend class="filter-label">Status</legend>
            <div class="status-options">
              {#each CLAIM_STATUSES as status}
                <label class="label cursor-pointer status-option">
                  <input class="checkbox checkbox-primary checkbox-sm" type="checkbox" checked={selectedStatuses.includes(status)} on:change={() => toggleStatus(status)}>
                  <span>{status}</span>
                </label>
              {/each}
            </div>
            <button class="btn btn-ghost btn-sm" type="button" disabled={allStatusesSelected} on:click={() => (selectedStatuses = [...CLAIM_STATUSES])}>Select all</button>
          </fieldset>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop"><button aria-label="Close filters">close</button></form>
    </dialog>

    <dialog bind:this={reviewDialog} class="modal review-modal">
      <div class="modal-box">
        <form on:submit={saveReview}>
          <div class="drawer-header">
            <div><h2 class="text-lg font-bold">{reviewReadOnly ? "Review comment" : "Review claim"}</h2><p>{reviewTarget?.["Claim Number"]}</p></div>
            <button class="btn btn-circle btn-ghost btn-sm" type="button" aria-label="Close review" on:click={() => reviewDialog.close()}>×</button>
          </div>
          <div class="review-content">
            {#if !reviewReadOnly}
              <label class="label cursor-pointer justify-start gap-3">
                <input class="checkbox checkbox-primary" type="checkbox" bind:checked={reviewedDraft}>
                <span>Mark as reviewed</span>
              </label>
            {/if}
            <label for="review-comment">Comments</label>
            <textarea class="textarea textarea-bordered" id="review-comment" maxlength="5000" rows="6" bind:value={reviewCommentDraft} readonly={reviewReadOnly}></textarea>
            <div class="review-actions">
              <button class="btn btn-ghost" type="button" on:click={() => reviewDialog.close()}>{reviewReadOnly ? "Close" : "Cancel"}</button>
              {#if !reviewReadOnly}<button class="btn btn-primary" type="submit" disabled={reviewSaving}>{reviewSaving ? "Saving…" : "Save review"}</button>{/if}
            </div>
          </div>
        </form>
      </div>
      <form method="dialog" class="modal-backdrop"><button aria-label="Close review">close</button></form>
    </dialog>
  {:else}
    <section class="empty-panel card bg-base-100">
      <div class="empty-icon" aria-hidden="true">↥</div>
      <h2>Start with a claims export</h2>
      <p>Upload your CSV file to see claim details, status, and yearly totals in one place.</p>
      <button class="btn btn-primary" type="button" on:click={openFilePicker}>Load CSV file</button>
    </section>
  {/if}
</main>
