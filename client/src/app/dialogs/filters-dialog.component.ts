import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { CLAIM_STATUSES, ClaimStatus } from '../claims/claim.models';

export interface FiltersDialogData {
  years: string[];
  defaultYear: string;
  selectedYear: string;
  serviceDate: string;
  selectedStatuses: ClaimStatus[];
}

export interface FiltersDialogResult {
  selectedYear: string;
  serviceDate: string;
  selectedStatuses: ClaimStatus[];
}

@Component({
  selector: 'app-filters-dialog',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatCheckboxModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>Filters</h2>
    <mat-dialog-content class="filter-content">
      <section aria-labelledby="year-label">
        <h3 id="year-label">Service year</h3>
        <div class="year-options">
          @for (year of data.years; track year) {
            <button
              mat-stroked-button
              type="button"
              [class.selected]="selectedYear() === year"
              [attr.aria-pressed]="selectedYear() === year"
              (click)="chooseYear(year)"
            >
              {{ year === 'unknown' ? 'Unknown' : year }}
            </button>
          }
        </div>
      </section>
      <section>
        <label for="service-date">Service date</label>
        <input
          id="service-date"
          type="date"
          [ngModel]="serviceDate()"
          (ngModelChange)="changeServiceDate($event)"
          [disabled]="selectedYear() === 'unknown'"
        >
      </section>
      <fieldset>
        <legend>Status</legend>
        <div class="status-options">
          @for (status of statuses; track status) {
            <mat-checkbox
              [checked]="selectedStatuses().has(status)"
              (change)="toggleStatus(status, $event.checked)"
            >
              {{ status }}
            </mat-checkbox>
          }
        </div>
      </fieldset>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="resetFilters()">Reset filters</button>
      <button mat-button type="button" (click)="selectAll()">Select all statuses</button>
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button mat-flat-button type="button" (click)="apply()">Apply filters</button>
    </mat-dialog-actions>
  `,
  styles: `
    .filter-content {
      display: grid;
      gap: 24px;
      min-width: min(420px, calc(100vw - 80px));
      padding-top: 8px;
    }

    section h3,
    section label,
    legend {
      display: block;
      margin: 0 0 10px;
      font-size: 0.9rem;
      font-weight: 600;
    }

    .year-options,
    .status-options {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .year-options button.selected {
      color: var(--mat-sys-primary, #155eef);
      border-color: currentColor;
    }

    input[type='date'] {
      min-height: 42px;
      padding: 8px 10px;
      border: 1px solid #cbd5df;
      border-radius: 6px;
      font: inherit;
    }

    fieldset {
      margin: 0;
      padding: 0;
      border: 0;
    }
  `,
})
export class FiltersDialogComponent {
  protected readonly data = inject<FiltersDialogData>(MAT_DIALOG_DATA);
  protected readonly statuses = CLAIM_STATUSES;
  private readonly dialogRef = inject<
    MatDialogRef<FiltersDialogComponent, FiltersDialogResult>
  >(MatDialogRef);

  protected readonly selectedYear = signal(this.data.selectedYear);
  protected readonly serviceDate = signal(this.data.serviceDate);
  protected readonly selectedStatuses = signal<ReadonlySet<ClaimStatus>>(
    new Set(this.data.selectedStatuses),
  );

  protected toggleStatus(status: ClaimStatus, checked: boolean): void {
    const selected = new Set(this.selectedStatuses());
    if (checked) {
      selected.add(status);
    } else {
      selected.delete(status);
    }
    this.selectedStatuses.set(selected);
  }

  protected chooseYear(year: string): void {
    this.selectedYear.set(year);
    this.serviceDate.set('');
  }

  protected changeServiceDate(date: string): void {
    this.serviceDate.set(date);
    if (date) this.selectedYear.set(date.slice(0, 4));
  }

  protected selectAll(): void {
    this.selectedStatuses.set(new Set(this.statuses));
  }

  protected resetFilters(): void {
    this.selectedYear.set(this.data.defaultYear);
    this.serviceDate.set('');
    this.selectedStatuses.set(new Set(this.statuses));
  }

  protected apply(): void {
    this.dialogRef.close({
      selectedYear: this.selectedYear(),
      serviceDate: this.serviceDate(),
      selectedStatuses: [...this.selectedStatuses()],
    });
  }
}
