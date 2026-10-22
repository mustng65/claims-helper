export const REQUIRED_COLUMNS = [
  'Claim Number',
  'Provider',
  'Service Date',
  'Total Charges',
  'SavDisc',
  'Inelig',
  'Ded',
  'CoPay',
  'Amount Paid',
] as const;

export const CLAIM_STATUSES = [
  'Pending',
  'Paid',
  'Needs Review',
  'Reviewed',
] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export type ClaimCellValue = string | number | boolean;

export interface ClaimRecord {
  [column: string]: ClaimCellValue;
  Status: ClaimStatus;
  coInsCents: number;
  reviewed: boolean;
  reviewComment: string;
  originalStatus: ClaimStatus;
}

export interface ClaimReview {
  reviewed: boolean;
  comment: string;
}

export interface StoredClaims {
  headers: string[];
  records: string[][];
  reviews: Record<string, ClaimReview>;
}

export interface ImportResult extends StoredClaims {
  inserted: number;
  updated: number;
  unchanged: number;
}

export interface ReviewUpdate {
  claimNumber: string;
  reviewed: boolean;
  comment: string;
}

export interface ParsedClaims {
  headers: string[];
  rows: ClaimRecord[];
}

export interface ClaimGroup {
  label: string;
  claims: ClaimRecord[];
}

export type ClaimTableRow =
  | { kind: 'group'; group: ClaimGroup }
  | { kind: 'claim'; claim: ClaimRecord };
