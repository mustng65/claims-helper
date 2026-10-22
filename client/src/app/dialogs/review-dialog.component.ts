import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';
import { ClaimsApiService } from '../claims/claims-api.service';
import { ReviewUpdate } from '../claims/claim.models';

export interface ReviewDialogData {
  claimNumber: string;
  reviewed: boolean;
  comment: string;
  readOnly: boolean;
}

@Component({
  selector: 'app-review-dialog',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.readOnly ? 'Review comment' : 'Review claim' }}</h2>
    <mat-dialog-content>
      <p class="claim-reference">{{ data.claimNumber }}</p>
      @if (!data.readOnly) {
        <mat-checkbox [(ngModel)]="reviewed">Mark as reviewed</mat-checkbox>
      }
      <mat-form-field appearance="outline" class="comment-field">
        <mat-label>Comments</mat-label>
        <textarea
          matInput
          [(ngModel)]="comment"
          [readonly]="data.readOnly"
          maxlength="5000"
          rows="6"
        ></textarea>
        <mat-hint align="end">{{ comment.length }}/5000</mat-hint>
      </mat-form-field>
      @if (saveError()) {
        <p class="save-error" role="alert">{{ saveError() }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close [disabled]="saving()">
        {{ data.readOnly ? 'Close' : 'Cancel' }}
      </button>
      @if (!data.readOnly) {
        <button mat-flat-button type="button" (click)="save()" [disabled]="saving()">
          {{ saving() ? 'Saving…' : 'Save review' }}
        </button>
      }
    </mat-dialog-actions>
  `,
  styles: `
    .claim-reference {
      margin: 0 0 16px;
      color: var(--mat-sys-on-surface-variant, #526477);
      font-size: 0.9rem;
    }

    .comment-field {
      display: block;
      width: min(100%, 520px);
      margin-top: 16px;
    }

    textarea {
      min-height: 130px;
      resize: vertical;
    }

    .save-error {
      color: #b42318;
      font-size: 0.88rem;
    }
  `,
})
export class ReviewDialogComponent {
  protected readonly data = inject<ReviewDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(ClaimsApiService);
  private readonly dialogRef = inject<
    MatDialogRef<ReviewDialogComponent, ReviewUpdate>
  >(MatDialogRef);

  protected reviewed = this.data.reviewed;
  protected comment = this.data.comment;
  protected readonly saving = signal(false);
  protected readonly saveError = signal('');

  protected async save(): Promise<void> {
    if (this.saving()) return;

    this.saving.set(true);
    this.saveError.set('');
    try {
      const savedReview = await firstValueFrom(
        this.api.saveReview({
          claimNumber: this.data.claimNumber,
          reviewed: this.reviewed,
          comment: this.comment,
        }),
      );
      this.dialogRef.close(savedReview);
    } catch (error: unknown) {
      this.saveError.set(this.errorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
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
    return error instanceof Error ? error.message : 'An unknown error occurred.';
  }
}
