import {
  ClaimGroup,
  ClaimRecord,
  ClaimReview,
  ClaimStatus,
  ParsedClaims,
  REQUIRED_COLUMNS,
} from './claim.models';

const CURRENCY_COLUMNS = [
  'Total Charges',
  'SavDisc',
  'Inelig',
  'Ded',
  'CoPay',
  'Amount Paid',
];
const SETTLEMENT_COLUMNS = ['SavDisc', 'Ded', 'CoPay', 'CoIns', 'Amount Paid'];

export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, '');
  if (!input) return [];

  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
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

    if (
      afterQuote &&
      character !== ',' &&
      character !== '\r' &&
      character !== '\n' &&
      character !== ' ' &&
      character !== '\t'
    ) {
      throw new Error(`Unexpected character after a quoted field at character ${index + 1}.`);
    }

    if (character === '"') {
      if (field.length !== 0 || afterQuote) {
        throw new Error(`Unexpected quote at character ${index + 1}.`);
      }
      inQuotes = true;
    } else if (character === ',') {
      record.push(field);
      field = '';
      afterQuote = false;
    } else if (character === '\r' || character === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      afterQuote = false;
      recordStarted = false;
      if (character === '\r' && input[index + 1] === '\n') index += 1;
    } else if (!afterQuote || (character !== ' ' && character !== '\t')) {
      field += character;
    }
  }

  if (inQuotes) {
    throw new Error('The file ends inside a quoted field.');
  }

  if (recordStarted || field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  return records;
}

export function parseClaimsExport(records: string[][]): ParsedClaims {
  if (records.length === 0) {
    throw new Error('The selected file is empty.');
  }

  const sourceHeaders = records[0].map((header) => header.trim());
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !sourceHeaders.includes(column));
  if (missingColumns.length > 0) {
    throw new Error(`Expected claims-export columns are missing: ${missingColumns.join(', ')}.`);
  }

  const rows = records
    .slice(1)
    .filter((values) => values.some((value) => value !== ''))
    .map((values, index) => {
      const claimData = Object.fromEntries(
        sourceHeaders.map((header, column) => [header, values[column] ?? '']),
      ) as Record<string, string>;
      if (!claimData['Claim Number'].trim()) {
        throw new Error(`CSV record ${index + 2} is missing a Claim Number.`);
      }

      CURRENCY_COLUMNS.forEach((column) => parseAmountCents(claimData[column]));
      const claim: ClaimRecord = {
        ...claimData,
        coInsCents: 0,
        reviewed: false,
        reviewComment: '',
        originalStatus: 'Pending',
        Status: 'Pending',
      };
      const ineligibleAmount = claimData['Inelig'].trim();
      if (ineligibleAmount !== '' && parseAmountCents(ineligibleAmount) === 0) {
        claim.coInsCents =
          parseAmountCents(claimData['Total Charges']) -
          ['SavDisc', 'Ded', 'CoPay', 'Amount Paid'].reduce(
            (total, column) => total + parseAmountCents(claimData[column]),
            0,
          );
        claim['CoIns'] = formatCurrencyCents(claim.coInsCents);
      } else {
        claim['CoIns'] = '$0.00';
      }

      claim.Status = getClaimStatus(claim);
      claim.originalStatus = claim.Status;
      return claim;
    });

  groupClaimsByPrefix(rows).forEach((group) => {
    if (group.claims.length < 2) return;

    const ineligibleTotal = group.claims.reduce(
      (total, claim) => total + parseAmountCents(getText(claim, 'Inelig')),
      0,
    );
    const paidTotal = group.claims.reduce(
      (total, claim) => total + parseAmountCents(getText(claim, 'Amount Paid')),
      0,
    );
    const groupStatus: ClaimStatus =
      ineligibleTotal > 0 && paidTotal <= 0 ? 'Needs Review' : 'Paid';

    group.claims.forEach((claim) => {
      claim.Status = groupStatus;
      claim.originalStatus = groupStatus;
    });
  });

  const headers = [...sourceHeaders];
  headers.splice(headers.indexOf('Service Date'), 1);
  headers.unshift('Service Date');
  headers.splice(headers.indexOf('CoPay') + 1, 0, 'CoIns');
  headers.push('Status');
  return { headers, rows };
}

export function applyReviewMetadata(
  claims: ClaimRecord[],
  reviews: Record<string, ClaimReview>,
): ClaimRecord[] {
  return claims.map((claim) => {
    const review = reviews[getText(claim, 'Claim Number').trim()];
    const reviewed = review?.reviewed ?? false;
    return {
      ...claim,
      reviewed,
      reviewComment: review?.comment ?? '',
      Status: reviewed ? 'Reviewed' : claim.originalStatus,
    };
  });
}

export function groupClaimsByPrefix(claims: ClaimRecord[]): ClaimGroup[] {
  const groups = new Map<string, ClaimGroup>();

  claims.forEach((claim, index) => {
    const claimNumber = getText(claim, 'Claim Number');
    const revisionMarker = /R\d+$/.exec(claimNumber);
    const prefix = revisionMarker ? claimNumber.slice(0, revisionMarker.index) : null;
    const key = prefix === null ? `unmatched-${index}` : `prefix-${prefix}`;
    const label =
      prefix === null
        ? `${claimNumber || '(blank claim number)'} (no R)`
        : prefix || '(empty prefix)';

    if (!groups.has(key)) {
      groups.set(key, { label, claims: [] });
    }
    groups.get(key)!.claims.push(claim);
  });

  return [...groups.values()].map((group) => {
    if (group.claims.length > 1) {
      group.claims.sort((left, right) => {
        const leftRevision = Number(/R(\d+)$/.exec(getText(left, 'Claim Number'))?.[1]);
        const rightRevision = Number(/R(\d+)$/.exec(getText(right, 'Claim Number'))?.[1]);
        return leftRevision - rightRevision;
      });
    }
    return group;
  });
}

export function getServiceYear(date: string): string {
  const inputDate = toInputDate(date);
  return inputDate ? inputDate.slice(0, 4) : 'unknown';
}

export function toInputDate(date: string): string {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date);
  if (!match) return '';

  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export function parseAmountCents(value: string): number {
  const trimmed = value.trim();
  if (trimmed === '') return 0;

  const isParenthesized = trimmed.startsWith('(') && trimmed.endsWith(')');
  const amount = trimmed.replace(/^\(|\)$/g, '').replace(/[$,\s]/g, '');
  if (!/^-?\d+(?:\.\d+)?$/.test(amount)) {
    throw new Error(`Invalid currency amount: "${value}".`);
  }

  const cents = Math.round(Math.abs(Number(amount)) * 100);
  return isParenthesized || amount.startsWith('-') ? -cents : cents;
}

export function formatCurrencyCents(amount: number): string {
  const sign = amount < 0 ? '-$' : '$';
  const absoluteAmount = Math.abs(amount);
  return `${sign}${Math.floor(absoluteAmount / 100).toLocaleString('en-US')}.${String(absoluteAmount % 100).padStart(2, '0')}`;
}

export function getText(claim: ClaimRecord, column: string): string {
  const value = claim[column];
  return typeof value === 'string' ? value : '';
}

function getClaimStatus(claim: ClaimRecord): ClaimStatus {
  if (getText(claim, 'SavDisc').trim() === '') {
    return 'Pending';
  }

  const paidTotal = SETTLEMENT_COLUMNS.reduce(
    (total, column) => total + parseAmountCents(getText(claim, column)),
    0,
  );
  return parseAmountCents(getText(claim, 'Total Charges')) === paidTotal
    ? 'Paid'
    : 'Needs Review';
}
