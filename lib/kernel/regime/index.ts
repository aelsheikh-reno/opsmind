// Regime — the law itself: a jurisdiction crossed with an obligation type,
// holding the rate, the brackets, the thresholds and the filing deadline days
// that the previous build kept as hardcoded values and in TaxesClient
// (components-kernel.md).
//
// There is not a single rate, threshold or deadline number in this file, and
// there must not be one anywhere else under lib/ either. That is the whole
// point of the table: a rate change, a new country or a new obligation is a
// row, not a release (ADR-017). A constant in TypeScript is a value nobody can
// correct without a deployment, and the one place it will be wrong is the month
// the law changed.
//
// OpsMind is not the tax engine (CLAUDE.md rule 10). This component states what
// the law says; computing a return is Zoho's and the accredited provider's job.

/**
 * The obligations a jurisdiction can impose. A closed set, not a free string:
 * an unvalidated type lets an extraction write `VAT`, `vat_uae` and `Vat` as
 * three regimes that no filing query ever reunites (data-model.md). The set
 * grows by migration, in step with the ObligationType enum in schema.prisma.
 */
export type ObligationType = "vat" | "corporate_tax" | "social_insurance";

/** The law for one obligation in one jurisdiction. */
export interface Regime {
  id: string;
  jurisdictionId: string;
  obligationType: ObligationType;
  name: string;
  /**
   * An exact decimal string ("0.050000"), never a JavaScript number. A rate
   * multiplies money, so a binary rounding error here lands directly in an
   * amount (CLAUDE.md, money and dates). The caller parses it into whatever
   * decimal type it computes in; the kernel does no arithmetic with it.
   */
  rate: string;
  /**
   * Plain CALENDAR days after period end by which the filing is due — not
   * business days. UAE VAT is 28 (Federal Decree-Law No. 8 of 2017, Art. 64);
   * read as business days it would land about twelve days late, which is a
   * filing penalty. Rolling the resulting date off a closed day belongs to the
   * deadline monitor, which already separates the statutory date from the date
   * a human must act on.
   */
  deadlineDays: number;
  /**
   * Registration and exemption thresholds, and banded rates such as the
   * Egyptian income tax bands, exactly as the row holds them.
   *
   * Deliberately opaque. No document in this build states the shape of a band
   * or of a threshold, and the legacy build has none to copy — it carried a
   * single `profitThreshold` float on TaxConfig and no brackets at all. Giving
   * them a shape here would be inventing a business rule (CLAUDE.md working
   * style), so the kernel guarantees only what it can: that they are data on a
   * row. The consuming tax or payroll work defines and validates its own shape.
   */
  thresholds: unknown;
  brackets: unknown;
}

/** Everything a regime needs at creation; the id is the database's. */
export type NewRegime = Omit<Regime, "id">;

export { createRegime, getRegime, listRegimes, updateRegime } from "./repository";
