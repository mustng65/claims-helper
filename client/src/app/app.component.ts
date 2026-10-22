import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import {
  CLAIM_STATUSES,
  ClaimRecord,
  ClaimStatus,
  ClaimTableRow,
  ReviewUpdate,
  StoredClaims,
} from './claims/claim.models';
import { ClaimsApiService } from './claims/claims-api.service';
import {
  applyReviewMetadata,
  formatCurrencyCents,
  getServiceYear,
  getText,
  groupClaimsByPrefix,
  parseAmountCents,
  parseClaimsExport,
  parseCsv,
} from './claims/claims-data';
import {
  FiltersDialogComponent,
  FiltersDialogData,
  FiltersDialogResult,
} from './dialogs/filters-dialog.component';
import {
  ReviewDialogComponent,
  ReviewDialogData,
} from './dialogs/review-dialog.component';

interface YearSummary {
  ded: number;
  copay: number;
  coins: number;
  charges: number;
  savdisc: number;
  amountPaid: number;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatCardModule,
    MatDialogModule,
    MatMenuModule,
    MatSnackBarModule,
    MatTableModule,
    MatTooltipModule,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnInit {
  private readonly api = inject(ClaimsApiService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly claims = signal<ClaimRecord[]>([]);
  protected readonly headers = signal<string[]>([]);
  protected readonly previewVisible = signal(false);
  protected readonly loading = signal(true);
  protected readonly selectedYear = signal<string | null>(null);
  protected readonly defaultYear = signal<string | null>(null);
  protected readonly serviceDate = signal('');
  protected readonly selectedStatuses = signal<ReadonlySet<ClaimStatus>>(
    new Set(CLAIM_STATUSES),
  );

  protected readonly years = computed(() => {
    const found = new Set(this.claims().map((claim) => getServiceYear(getText(claim, 'Service Date'))));
    return [...found].sort((left, right) => {
      if (left === 'unknown') return 1;
      if (right === 'unknown') return -1;
      return Number(right) - Number(left);
    });
  });
  protected readonly displayedColumns = computed(() =>
    this.headers().filter((header) => header !== 'Provider'),
  );
  protected readonly selectedYearClaims = computed(() => {
    const year = this.selectedYear();
    if (year === null) return [];
    return this.claims().filter(
      (claim) => getServiceYear(getText(claim, 'Service Date')) === year,
    );
  });
  protected readonly filteredClaims = computed(() => {
    const year = this.selectedYear();
    if (year === null) return [];

    const date = this.serviceDate();
    const statuses = this.selectedStatuses();
    return this.claims().filter((claim) => {
      const serviceDate = getText(claim, 'Service Date');
      const claimDate = toInputDate(serviceDate);
      return (
        getServiceYear(serviceDate) === year &&
        (!date || claimDate === date) &&
        statuses.has(claim.Status)
      );
    });
  });
  protected readonly tableRows = computed<ClaimTableRow[]>(() =>
    groupClaimsByPrefix(this.filteredClaims()).flatMap((group) => [
      { kind: 'group' as const, group },
      ...group.claims.map((claim) => ({ kind: 'claim' as const, claim })),
    ]),
  );
  protected readonly summary = computed<YearSummary>(() =>
    this.selectedYearClaims().reduce<YearSummary>(
      (total, claim) => ({
        ded: total.ded + parseAmountCents(getText(claim, 'Ded')),
        copay: total.copay + parseAmountCents(getText(claim, 'CoPay')),
        coins: total.coins + claim.coInsCents,
        charges: total.charges + parseAmountCents(getText(claim, 'Total Charges')),
        savdisc: total.savdisc + parseAmountCents(getText(claim, 'SavDisc')),
        amountPaid: total.amountPaid + parseAmountCents(getText(claim, 'Amount Paid')),
      }),
      { ded: 0, copay: 0, coins: 0, charges: 0, savdisc: 0, amountPaid: 0 },
    ),
  );
  protected readonly rowCountText = computed(() => {
    const year = this.selectedYear();
    const yearLabel = year === 'unknown' ? 'Unknown service year' : year;
    const claims = this.filteredClaims();
    const groups = groupClaimsByPrefix(claims);
    return `${yearLabel} · ${claims.length} ${claims.length === 1 ? 'row' : 'rows'} · ${this.headers().length} columns · ${groups.length} claim groups`;
  });
  protected readonly filterSummary = computed(() => {
    const year = this.selectedYear();
    const selected = this.selectedStatuses();
    const summary = [year === 'unknown' ? 'Unknown year' : year ?? ''];
    if (this.serviceDate()) summary.push(this.serviceDate());
    summary.push(
      selected.size === CLAIM_STATUSES.length
        ? 'All statuses'
        : selected.size === 0
          ? 'No statuses'
          : [...selected].join(', '),
    );
    return summary.filter(Boolean).join(' · ');
  });
  protected readonly activeFilterCount = computed(
    () =>
      Number(this.selectedYear() !== this.defaultYear()) +
      Number(this.serviceDate() !== '') +
      Number(this.selectedStatuses().size !== CLAIM_STATUSES.length),
  );

  public ngOnInit(): void {
    this.api.getClaims().subscribe({
      next: (result) => {
        if (result.records.length > 0) {
          this.showStoredClaims(result);
        }
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.showError('Could not load stored claims', error);
        this.loading.set(false);
      },
    });
  }

  protected async importCsv(event: Event): Promise<void> {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0];
    if (!file) return;

    this.loading.set(true);
    try {
      const csvRecords = parseCsv(await file.text());
      parseClaimsExport(csvRecords);
      const headers = csvRecords[0].map((header) => header.trim());
      const result = await firstValueFrom(
        this.api.importClaims(headers, csvRecords.slice(1)),
      );
      this.showStoredClaims(result);
      this.snackBar.open(
        `Created ${result.inserted} new, ${result.updated} updated, and ${result.unchanged} unchanged claims.`,
        'Dismiss',
        { duration: 6000 },
      );
    } catch (error: unknown) {
      this.showError('Could not import claims export', error);
    } finally {
      this.loading.set(false);
      input.value = '';
    }
  }

  protected openFilters(): void {
    const selectedYear = this.selectedYear();
    if (selectedYear === null) return;

    this.dialog
      .open<FiltersDialogComponent, FiltersDialogData, FiltersDialogResult>(
        FiltersDialogComponent,
        {
          data: {
            years: this.years(),
            defaultYear: this.defaultYear() ?? selectedYear,
            selectedYear,
            serviceDate: this.serviceDate(),
            selectedStatuses: [...this.selectedStatuses()],
          },
          width: 'min(520px, calc(100vw - 32px))',
          maxWidth: '100vw',
        },
      )
      .afterClosed()
      .subscribe((filters) => {
        if (filters) this.applyFilters(filters);
      });
  }

  protected openReview(claim: ClaimRecord): void {
    if (claim.Status !== 'Needs Review') return;
    this.openReviewDialog(claim, false);
  }

  protected viewComment(claim: ClaimRecord): void {
    this.openReviewDialog(claim, true);
  }

  protected isGroupRow(_index: number, row: ClaimTableRow): boolean {
    return row.kind === 'group';
  }

  protected isClaimRow(_index: number, row: ClaimTableRow): boolean {
    return row.kind === 'claim';
  }

  protected rowClass(row: ClaimTableRow): string {
    if (row.kind !== 'claim') return '';
    if (row.claim.Status === 'Needs Review') return 'warning-row';
    const hasCostShare =
      parseAmountCents(getText(row.claim, 'Ded')) > 0 ||
      parseAmountCents(getText(row.claim, 'CoPay')) > 0;
    return hasCostShare ? 'info-row' : '';
  }

  protected formatCurrency(value: number): string {
    return formatCurrencyCents(value);
  }

  protected claimText(claim: ClaimRecord, column: string): string {
    return getText(claim, column);
  }

  private showStoredClaims(result: StoredClaims): void {
    const parsed = parseClaimsExport([result.headers, ...result.records]);
    this.headers.set(parsed.headers);
    this.claims.set(applyReviewMetadata(parsed.rows, result.reviews ?? {}));
    const years = this.years();
    const defaultYear = years[0] ?? 'unknown';
    this.defaultYear.set(defaultYear);
    this.selectedYear.set(defaultYear);
    this.serviceDate.set('');
    this.selectedStatuses.set(new Set(CLAIM_STATUSES));
    this.previewVisible.set(true);
  }

  private applyFilters(filters: FiltersDialogResult): void {
    this.selectedYear.set(filters.selectedYear);
    this.serviceDate.set(filters.serviceDate);
    this.selectedStatuses.set(new Set(filters.selectedStatuses));
  }

  private openReviewDialog(claim: ClaimRecord, readOnly: boolean): void {
    const dialogRef = this.dialog.open<
      ReviewDialogComponent,
      ReviewDialogData,
      ReviewUpdate
    >(ReviewDialogComponent, {
      data: {
        claimNumber: getText(claim, 'Claim Number').trim(),
        reviewed: claim.reviewed,
        comment: claim.reviewComment,
        readOnly,
      },
      width: 'min(560px, calc(100vw - 32px))',
      maxWidth: '100vw',
    });

    if (readOnly) return;
    dialogRef.afterClosed().subscribe((review) => {
      if (!review) return;
      this.claims.update((claims) =>
        claims.map((storedClaim) =>
          getText(storedClaim, 'Claim Number').trim() === review.claimNumber
            ? {
                ...storedClaim,
                reviewed: review.reviewed,
                reviewComment: review.comment,
                Status: review.reviewed ? 'Reviewed' : storedClaim.originalStatus,
              }
            : storedClaim,
        ),
      );
      this.snackBar.open(`Review saved for claim ${review.claimNumber}.`, 'Dismiss', {
        duration: 5000,
      });
    });
  }

  private showError(context: string, error: unknown): void {
    const detail =
      error instanceof HttpErrorResponse
        ? this.apiErrorMessage(error)
        : error instanceof Error
          ? error.message
          : 'An unknown error occurred.';
    this.snackBar.open(`${context}: ${detail}`, 'Dismiss', { duration: 8000 });
  }

  private apiErrorMessage(error: HttpErrorResponse): string {
    const body: unknown = error.error;
    if (
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'string'
    ) {
      return body.error;
    }
    return error.message || `The server returned ${error.status}.`;
  }
}

function toInputDate(date: string): string {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date);
  if (!match) return '';
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}
