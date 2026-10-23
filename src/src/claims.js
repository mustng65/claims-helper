export const REQUIRED_COLUMNS = [
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

export const CLAIM_STATUSES = ["Pending", "Paid", "Needs Review", "Reviewed"];

export function parseCsv(text) {
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

  if (inQuotes) throw new Error("The file ends inside a quoted field.");
  if (recordStarted || field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

export function parseClaimsExport(records) {
  if (records.length === 0) throw new Error("The selected file is empty.");

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
    const ineligibleAmount = claim.Inelig.trim();

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

    const ineligibleTotal = group.claims.reduce((total, claim) => total + parseAmountCents(claim.Inelig), 0);
    const paidTotal = group.claims.reduce((total, claim) => total + parseAmountCents(claim["Amount Paid"]), 0);
    const groupStatus = ineligibleTotal > 0 && paidTotal <= 0 ? "Needs Review" : "Paid";
    group.claims.forEach((claim) => {
      claim.Status = groupStatus;
    });
  });

  return { headers, rows };
}

function getClaimStatus(claim) {
  if (claim.SavDisc.trim() === "") return "Pending";
  const paidTotal = ["SavDisc", "Ded", "CoPay", "CoIns", "Amount Paid"]
    .reduce((total, header) => total + parseAmountCents(claim[header]), 0);
  return parseAmountCents(claim["Total Charges"]) === paidTotal ? "Paid" : "Needs Review";
}

export function groupClaimsByPrefix(claims) {
  const groups = new Map();
  claims.forEach((claim, index) => {
    const claimNumber = claim["Claim Number"];
    const revisionMarker = /R\d+$/.exec(claimNumber);
    const prefix = revisionMarker ? claimNumber.slice(0, revisionMarker.index) : null;
    const key = prefix === null ? `unmatched-${index}` : `prefix-${prefix}`;
    const label = prefix === null
      ? `${claimNumber || "(blank claim number)"} (no R)`
      : prefix || "(empty prefix)";
    if (!groups.has(key)) groups.set(key, { label, claims: [] });
    groups.get(key).claims.push(claim);
  });

  return [...groups.values()].map((group) => {
    if (group.claims.length > 1) {
      group.claims.sort((left, right) => (
        Number(/R(\d+)$/.exec(left["Claim Number"])?.[1])
        - Number(/R(\d+)$/.exec(right["Claim Number"])?.[1])
      ));
    }
    return group;
  });
}

export function toInputDate(date) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date);
  if (!match) return "";
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function parseAmountCents(value) {
  const trimmed = value.trim();
  if (trimmed === "") return 0;
  const isParenthesized = trimmed.startsWith("(") && trimmed.endsWith(")");
  const amount = trimmed.replace(/^\(|\)$/g, "").replace(/[$,\s]/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(amount)) {
    throw new Error(`Invalid currency amount: "${value}".`);
  }
  const cents = Math.round(Math.abs(Number(amount)) * 100);
  return isParenthesized || amount.startsWith("-") ? -cents : cents;
}

export function formatCurrencyCents(amount) {
  const sign = amount < 0 ? "-$" : "$";
  const absoluteAmount = Math.abs(amount);
  return `${sign}${Math.floor(absoluteAmount / 100).toLocaleString("en-US")}.${String(absoluteAmount % 100).padStart(2, "0")}`;
}
