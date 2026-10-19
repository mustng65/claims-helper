# Claims Helper

A Node.js web app for importing and previewing claims-export CSV files. Imported claims are stored in a SQLite database on the server.

## Run

Requires Node.js 18 or newer.

```sh
cd src
npm start
```

Open <http://localhost:3000>, then choose a claims-export `.csv` file to import it. The export must include the `Claim Number`, `Provider`, `Service Date`, `Total Charges`, `SavDisc`, `Inelig`, `Ded`, `CoPay`, and `Amount Paid` columns. Claims are matched by `Claim Number`: new claims are inserted, changed claims are updated, and unchanged claims are left as-is. Claims omitted from a later upload remain in the database and appear alongside new imports. The page loads stored claims automatically when opened.

By default, the database is written to `src/data/claims.sqlite` locally and `/app/data/claims.sqlite` in Docker. Set `CLAIMS_DB_PATH` to choose another database file.

Year, service-date, and status controls are consolidated in a compact slide-out **Filters** drawer. The preview toolbar summarizes current selections and shows how many filters differ from their defaults. Open the drawer to change filters; selections stay applied when it is closed. The most recent service year is selected by default; records with invalid or missing service dates are available under **Unknown**. Use the service-date field to filter the selected year to an exact date and status checkboxes to choose which statuses to show. **Reset filters** restores the most recent year, clears the date, and selects every status.

Records are grouped automatically by the claim-number prefix before its trailing revision marker (`R` followed by digits) and sorted by revision number within each group.

The table combines `Claim Number` and `Provider` into one column, showing the provider name subtly beneath the claim number.

Use the status checkboxes to show any combination of `Pending`, `Paid`, and `Needs Review` records. All statuses are selected by default, and **Select all** restores the full status selection.

The selected year's totals appear in a left-side summary panel beside the main claims table. The panel shows totals for `Ded`, `CoPay`, and `CoIns`, their combined total, plus a second row with `Total Charges`, `SavDisc`, and `Amount Paid`. On narrow screens, the summary stacks above the table. Each record's calculated `CoIns` amount is accumulated in cents for the summary. Currency values in accounting parentheses (for example, `($18,492.68)`) are treated as negative. Summary totals cover the full selected year and do not change when filtering the table by an exact service date.

Records with an `Inelig` amount greater than zero are highlighted in a warning color.

Records with a `Ded` or `CoPay` amount greater than zero are highlighted in an information color. If a record meets both conditions, the warning color for `Inelig` takes precedence.

The preview includes a calculated `CoIns` column immediately after `CoPay`: `Total Charges - SavDisc - Ded - CoPay - Amount Paid`. Blank amounts are treated as zero, and the result is displayed as currency.

The final `Status` column is `Pending` when `SavDisc` is blank, `Paid` when `Total Charges` equals the sum of `SavDisc`, `Ded`, `CoPay`, `CoIns`, and `Amount Paid`, and `Needs Review` otherwise. For claim-prefix groups with multiple records, the group status overrides the individual statuses: the app sums `Inelig` and `Amount Paid` across the group and marks every record `Needs Review` when that sum is zero or less, otherwise `Paid`.

Set the `PORT` environment variable to use a different port.

## Run with Docker

Build the image from the repository root:

```sh
docker build -t claims-helper .
```

Run the app with a named Docker volume so the database survives container removal, then open <http://localhost:3000>:

```sh
docker run --rm -p 3000:3000 -v claims-data:/app/data claims-helper
```

To use a different host port, map it to the container's port 3000 (for example, `-p 8080:3000`), then open <http://localhost:8080>.

## Publish with GitHub Actions

The **Build and publish Docker image** workflow builds the image for pull requests targeting `main`. On pushes to `main` and version tags (`v*`), it publishes the image to GitHub Container Registry:

```sh
docker pull ghcr.io/mustng65/claims-helper:latest
```

Version tags are also published using the matching tag name, such as `ghcr.io/mustng65/claims-helper:v1.0.0`. The workflow uses the repository's `GITHUB_TOKEN`; no additional registry secrets are required.
