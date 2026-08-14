// Self-tests for the schema reader in `tests/kernel/prisma-schema.ts`.
//
// These exist for one reason: every assertion in `kernel-schema.test.ts` is
// only as trustworthy as the parser underneath it. A reader that silently
// returns no fields would turn "no paid boolean anywhere" into a test that
// passes on an empty result, which is exactly the vacuous green this suite is
// meant to prevent. The fixtures below are hand-written Prisma, not read from
// `prisma/schema.prisma`.
import { describe, expect, it } from "vitest";
import {
  blockAttributes,
  enumNamed,
  everyField,
  fieldNamed,
  hasAttribute,
  modelNamed,
  normalise,
  normalisedValues,
  parseSchema,
  sameFieldSet,
} from "@/tests/kernel/prisma-schema";

const FIXTURE = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum Direction {
  inbound
  outbound
}

/// A document.
model Document {
  id          String    @id @default(cuid())
  direction   Direction // not nullable
  supersededA String?
  tags        String[]
  amount      Decimal   @db.Decimal(14, 4)
  legacyPaid  Boolean   @default(false)

  @@index([direction])
}

model JurisdictionEnrolment {
  id             String   @id
  legalEntityId  String
  regimeId       String
  activeTo       DateTime?

  @@unique([legalEntityId, regimeId])
  @@map("jurisdiction_enrolment")
}

model Wrapped {
  legalEntityId String
  regimeId      String

  @@unique(
    fields: [legalEntityId, regimeId],
    name: "wrapped_pair"
  )
}
`;

describe("prisma schema reader", () => {
  const schema = parseSchema(FIXTURE);

  it("understands every statement it was given", () => {
    expect(schema.unparsed, "an unparsed statement is a blind spot, not a pass").toEqual([]);
  });

  it("finds models, enums and skips datasource/generator blocks", () => {
    expect(schema.models.map((model) => model.name)).toEqual([
      "Document",
      "JurisdictionEnrolment",
      "Wrapped",
    ]);
    expect(schema.enums.map((block) => block.name)).toEqual(["Direction"]);
  });

  it("reads enum members", () => {
    expect(normalisedValues(enumNamed(schema, "Direction")!)).toEqual(["inbound", "outbound"]);
  });

  it("distinguishes a required field from an optional one and from a list", () => {
    const document = modelNamed(schema, "Document")!;
    const direction = fieldNamed(document, "direction")!;
    expect(direction.type).toBe("Direction");
    expect(direction.optional).toBe(false);
    expect(direction.list).toBe(false);
    expect(fieldNamed(document, "supersededA")!.optional).toBe(true);
    expect(fieldNamed(document, "tags")!.list).toBe(true);
    expect(fieldNamed(document, "tags")!.optional).toBe(false);
  });

  it("does not mistake a trailing comment for part of the type", () => {
    // `direction Direction // not nullable` must not parse as optional
    const document = modelNamed(schema, "Document")!;
    expect(fieldNamed(document, "direction")!.raw).not.toContain("not nullable");
  });

  it("reads field attributes, including native types", () => {
    const document = modelNamed(schema, "Document")!;
    expect(hasAttribute(fieldNamed(document, "id")!, "id")).toBe(true);
    expect(hasAttribute(fieldNamed(document, "id")!, "default")).toBe(true);
    expect(hasAttribute(fieldNamed(document, "direction")!, "unique")).toBe(false);
    expect(
      fieldNamed(document, "amount")!.attributes.map((attribute) => attribute.name),
    ).toContain("db.Decimal");
  });

  it("reads block attributes and the field list of a compound unique", () => {
    const enrolment = modelNamed(schema, "JurisdictionEnrolment")!;
    const [unique, ...rest] = blockAttributes(enrolment, "unique");
    expect(rest).toEqual([]);
    expect(unique.fields).toEqual(["legalEntityId", "regimeId"]);
    expect(blockAttributes(enrolment, "index")).toEqual([]);
  });

  it("reads a compound unique written across several lines with named arguments", () => {
    const wrapped = modelNamed(schema, "Wrapped")!;
    const [unique] = blockAttributes(wrapped, "unique");
    expect(unique.fields).toEqual(["legalEntityId", "regimeId"]);
  });

  it("enumerates every field of every model", () => {
    const boolean = everyField(schema).filter(({ field }) => field.type === "Boolean");
    expect(boolean.map(({ model, field }) => `${model.name}.${field.name}`)).toEqual([
      "Document.legacyPaid",
    ]);
  });

  it("normalises names and compares field sets order-insensitively", () => {
    expect(normalise("CORPORATE_TAX")).toBe(normalise("CorporateTax"));
    expect(normalise("redact_personal")).toBe("redactpersonal");
    expect(sameFieldSet(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameFieldSet(["a"], ["a", "b"])).toBe(false);
  });
});
