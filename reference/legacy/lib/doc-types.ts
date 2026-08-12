export const DOC_TYPE_LABELS: Record<string, string> = {
  client_contract:     "Client Contract",
  lease_contract:      "Lease / Rental",
  employee_contract:   "Employment Contract",
  insurance:           "Insurance",
  purchase_order:      "Purchase Order",
  government_document: "Government Document",
  invoice:             "Invoice",
  invoice_report:      "Invoice Report",
  payroll:             "Payroll",
  other:               "Other",
  // Legacy — kept for backwards-compat display of existing records
  visa:                "Visa",
  emirates_id:         "Emirates ID",
  labor_card:          "Labor Card",
  trade_license:       "Trade License",
  government_permit:   "Government Permit",
};

export const DOC_TYPE_COLORS: Record<string, string> = {
  client_contract:     "bg-teal-50 text-teal-700",
  lease_contract:      "bg-violet-50 text-violet-700",
  employee_contract:   "bg-green-50 text-green-700",
  insurance:           "bg-cyan-50 text-cyan-700",
  purchase_order:      "bg-blue-50 text-blue-700",
  government_document: "bg-amber-50 text-amber-700",
  invoice:             "bg-orange-50 text-orange-700",
  invoice_report:      "bg-orange-50 text-orange-700",
  payroll:             "bg-pink-50 text-pink-700",
  other:               "bg-gray-100 text-gray-700",
  // Legacy
  visa:                "bg-blue-50 text-blue-700",
  emirates_id:         "bg-purple-50 text-purple-700",
  labor_card:          "bg-indigo-50 text-indigo-700",
  trade_license:       "bg-amber-50 text-amber-700",
  government_permit:   "bg-red-50 text-red-700",
};

export const GOV_DOC_CATEGORIES = [
  "Trade License",
  "Business Permit",
  "Work Permit",
  "Residency Visa",
  "Entry Visa",
  "Passport",
  "National ID",
  "Labor Card",
  "Tax Certificate",
  "Regulatory Approval",
  "Other Government Document",
] as const;
