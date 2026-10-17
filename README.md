# CSV Loader

A dependency-free Node.js web app for opening and previewing claims-export CSV files. CSV files are read locally in the browser and are not uploaded to the server.

## Run

Requires Node.js 18 or newer.

```sh
npm start
```

Open <http://localhost:3000>, then choose a claims-export `.csv` file to load and preview it. The export must include the `Claim Number`, `Provider`, `Service Date`, `Total Charges`, `SavDisc`, `Inelig`, `Ded`, `CoPay`, and `Amount Paid` columns.

Year, service-date, and status controls are consolidated in a compact slide-out **Filters** drawer. The preview toolbar summarizes current selections and shows how many filters differ from their defaults. Open the drawer to change filters; selections stay applied when it is closed. The most recent service year is selected by default; records with invalid or missing service dates are available under **Unknown**. Use the service-date field to filter the selected year to an exact date and status checkboxes to choose which statuses to show. **Reset filters** restores the most recent year, clears the date, and selects every status.

Records are grouped automatically by the claim-number prefix before its trailing revision marker (`R` followed by digits) and sorted by revision number within each group.

The table combines `Claim Number` and `Provider` into one column, showing the provider name subtly beneath the claim number.

Use the status checkboxes to show any combination of `Pending`, `Paid`, and `Needs Review` records. All statuses are selected by default, and **Select all** restores the full status selection.

The summary above the table shows the selected year's totals for `Ded`, `CoPay`, and `CoIns`, plus their combined total. A second summary row shows totals for `Total Charges`, `SavDisc`, and `Amount Paid`. Each record's calculated `CoIns` amount is accumulated in cents for the summary. Currency values in accounting parentheses (for example, `($18,492.68)`) are treated as negative. Summary totals cover the full selected year and do not change when filtering the table by an exact service date.

Records with an `Inelig` amount greater than zero are highlighted in a warning color.

Records with a `Ded` or `CoPay` amount greater than zero are highlighted in an information color. If a record meets both conditions, the warning color for `Inelig` takes precedence.

The preview includes a calculated `CoIns` column immediately after `CoPay`: `Total Charges - SavDisc - Ded - CoPay - Amount Paid`. Blank amounts are treated as zero, and the result is displayed as currency.

The final `Status` column is `Pending` when `SavDisc` is blank, `Paid` when `Total Charges` equals the sum of `SavDisc`, `Ded`, `CoPay`, `CoIns`, and `Amount Paid`, and `Needs Review` otherwise.

Set the `PORT` environment variable to use a different port.
