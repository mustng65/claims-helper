import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ImportResult, ReviewUpdate, StoredClaims } from './claim.models';

@Injectable({ providedIn: 'root' })
export class ClaimsApiService {
  private readonly http = inject(HttpClient);

  getClaims(): Observable<StoredClaims> {
    return this.http.get<StoredClaims>('/api/claims');
  }

  importClaims(headers: string[], records: string[][]): Observable<ImportResult> {
    return this.http.post<ImportResult>('/api/claims', { headers, records });
  }

  saveReview(review: ReviewUpdate): Observable<ReviewUpdate> {
    return this.http.put<ReviewUpdate>('/api/reviews', review);
  }
}
