// LegalEntity — any organisation: your own companies, clients and vendors, in
// one table with a stated role (components-kernel.md).
//
// The role is why this component exists in the shape it does. In the previous
// build entities were auto-created from fuzzy name matches, so "Acme FZ-LLC"
// and "ACME FZE" became two counterparties and the same client's balance was
// split across both. Nothing here creates an entity as a side effect of a
// lookup: a name that does not match exactly returns null, and deciding whether
// that is a new entity or a spelling of an existing one is a human's call
// (CLAUDE.md rule 8).

/** Whose organisation this is. Stated on the row, never inferred from a name. */
export type EntityRole = "self" | "client" | "vendor";

export interface LegalEntity {
  id: string;
  name: string;
  /** Where the entity is registered. */
  country: string;
  /** Its functional currency, ISO-4217, where one is known. */
  currency: string | null;
  active: boolean;
  role: EntityRole;
}

/** A role is required at creation; there is no default and no inferred one. */
export type NewLegalEntity = Pick<LegalEntity, "name" | "country" | "role"> &
  Partial<Omit<LegalEntity, "id" | "name" | "country" | "role">>;

export {
  createLegalEntity,
  getLegalEntity,
  legalEntityByName,
  listLegalEntities,
  updateLegalEntity,
} from "./repository";
