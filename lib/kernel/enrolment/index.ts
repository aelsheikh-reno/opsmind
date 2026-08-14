// JurisdictionEnrolment — an entity's standing under a regime: the registration
// number, how often it files, what its periods align to and the certificate
// that evidences it. Replaces the legacy VatConfig and TaxConfig, which were
// two near-identical tables that had to be kept in step by hand.
//
// It applies to counterparties, not only to your own companies: a UAE VAT
// invoice carries the customer's TRN, so a client entity holds an enrolment
// exactly as a self entity does (components-kernel.md).
//
// A person's own registrations are a different thing and live with Person —
// one is a company's registration under a law, the other is an individual's
// social insurance or tax identifier.

/**
 * How often a registration files. `annual` is not optional decoration: UAE
 * corporate tax is filed annually, so without it a CT registration is
 * unrepresentable. Mirrors the EnrolmentFrequency enum in schema.prisma.
 */
export type EnrolmentFrequency = "monthly" | "quarterly" | "semiannual" | "annual";

export interface JurisdictionEnrolment {
  id: string;
  legalEntityId: string;
  regimeId: string;
  /** The TRN, or whatever the jurisdiction calls its registration number. */
  identifier: string;
  frequency: EnrolmentFrequency;
  /** What the filing period aligns to — periods are counted from this date. */
  anchor: Date;
  /** Registration is not permanent. A null activeTo means still registered. */
  activeFrom: Date;
  activeTo: Date | null;
  /** The certificate, as evidence (rule 7). Proof can arrive after the number. */
  sourceDocumentId: string | null;
}

export type NewJurisdictionEnrolment = Omit<JurisdictionEnrolment, "id" | "sourceDocumentId"> &
  Partial<Pick<JurisdictionEnrolment, "sourceDocumentId">>;

export { enrolmentFor, listEnrolments, recordEnrolment } from "./repository";
