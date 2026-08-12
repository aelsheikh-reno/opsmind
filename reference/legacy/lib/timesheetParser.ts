import * as XLSX from "xlsx";

function scoreSheetColumns(rows: Array<Record<string, unknown>>): number {
  if (rows.length === 0) return 0;
  const keys = Object.keys(rows[0]).map(k => k.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const hasName  = keys.some(k => ["resourcename", "resource", "employeename", "employee", "name", "username", "member"].some(c => k.includes(c)));
  const hasHours = keys.some(k => ["work", "hours", "duration", "hrs", "timespent", "hourslogged"].some(c => k.includes(c)));
  const hasTask  = keys.some(k => ["taskname", "task", "activity", "issue"].some(c => k.includes(c)));
  return (hasName ? 2 : 0) + (hasHours ? 2 : 0) + (hasTask ? 1 : 0);
}

export function parseSheet(buffer: Buffer): Array<Record<string, unknown>> {
  const wb = XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: true });

  let bestRows: Array<Record<string, unknown>> = [];
  let bestScore = -1;

  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: "" });
    const score = scoreSheetColumns(rows);
    if (score > bestScore) { bestScore = score; bestRows = rows; }
  }

  return bestRows;
}

export function norm(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 2);
}

export function findCol(
  row: Record<string, unknown>,
  candidates: string[],
  containsFallback?: string[],
): string {
  const keys = Object.keys(row);
  for (const c of candidates) {
    const match = keys.find(k => norm(k) === norm(c));
    if (match) {
      const v = row[match];
      const s = v != null ? String(v).trim() : "";
      if (s) return s;
    }
  }
  if (containsFallback) {
    for (const kw of containsFallback) {
      const match = keys.find(k => norm(k).includes(norm(kw)));
      if (match) {
        const v = row[match];
        const s = v != null ? String(v).trim() : "";
        if (s) return s;
      }
    }
  }
  return "";
}

// Returns the key name (not value) of the first matching column, or null.
function findColKey(
  row: Record<string, unknown>,
  candidates: string[],
  containsFallback: string[],
): string | null {
  const keys = Object.keys(row);
  for (const c of candidates) {
    const match = keys.find(k => norm(k) === norm(c));
    if (match && row[match] != null && String(row[match]).trim()) return match;
  }
  for (const kw of containsFallback) {
    const match = keys.find(k => norm(k).includes(norm(kw)));
    if (match && row[match] != null && String(row[match]).trim()) return match;
  }
  return null;
}

export function parseDuration(val: string): number {
  if (!val) return NaN;
  // HH:MM:SS
  const hhmmss = val.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (hhmmss) return parseInt(hhmmss[1]) + parseInt(hhmmss[2]) / 60 + parseInt(hhmmss[3]) / 3600;
  // HH:MM
  const hhmm = val.match(/^(\d+):(\d{2})$/);
  if (hhmm) return parseInt(hhmm[1]) + parseInt(hhmm[2]) / 60;
  // "1.5h", "2hr", "1h 30m", "1 hour 30 minutes", etc.
  const hm = val.match(/^(\d+(?:\.\d+)?)\s*h(?:r(?:s)?|ours?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?)?$/i);
  if (hm) return parseFloat(hm[1]) + (hm[2] ? parseFloat(hm[2]) / 60 : 0);
  // "90m", "90min", "90mins", "90 minutes" — returns hours
  const monly = val.match(/^(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?$/i);
  if (monly) return parseFloat(monly[1]) / 60;
  return parseFloat(val);
}

// Returns "YYYY-MM-DD" from various date representations (Date objects, ISO strings,
// DD/MM/YYYY strings, Excel serial numbers, etc.) — or null if unrecognisable.
export function parseDateToISO(val: unknown): string | null {
  function fmt(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  // XLSX cellDates:true gives real Date objects for date cells
  if (val instanceof Date && !isNaN(val.getTime())) return fmt(val);
  if (typeof val === "number") {
    // Excel serial date (Dec 30 1899 epoch, with Lotus leap-year bug skipped)
    if (val < 30000 || val > 100000) return null;
    const d = new Date(new Date(1899, 11, 30).getTime() + val * 86400000);
    if (isNaN(d.getTime())) return null;
    return fmt(d);
  }
  const s = String(val ?? "").trim();
  if (!s) return null;

  // ISO: YYYY-MM-DD or YYYY/MM/DD
  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;

  // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY (UAE-standard)
  const dmy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (dmy) {
    const a = parseInt(dmy[1]), b = parseInt(dmy[2]), y = parseInt(dmy[3]);
    // If first part > 12 it must be the day; otherwise assume DD/MM/YYYY
    const [day, mon] = a > 12 ? [a, b] : [a, b];
    return `${y}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // Fallback: native Date parse ("Mar 15, 2025", "15 March 2025", etc.)
  const d = new Date(s);
  if (!isNaN(d.getTime()) && d.getFullYear() > 1970) return fmt(d);
  return null;
}

// Looks for a date column value and returns "YYYY-MM-DD" or null
function findDateISO(row: Record<string, unknown>): string | null {
  const keys = Object.keys(row);
  const dateCandidates = [
    "Date", "Work Date", "WorkDate", "Entry Date", "EntryDate",
    "Log Date", "LogDate", "Activity Date", "ActivityDate",
    "Start Date", "StartDate", "Start", "Day",
    // "entered on" / "recorded on" / "logged on" style
    "Entered On", "EnteredOn", "Entered",
    "Recorded On", "RecordedOn", "Recorded",
    "Logged On", "LoggedOn",
    "Submitted On", "SubmittedOn",
    "Date Of Entry", "DateOfEntry",
    "Time Entry Date", "TimeEntryDate",
    "Transaction Date", "TransactionDate",
    "Performed On", "PerformedOn",
    "Worked On", "WorkedOn",
  ];
  const dateContains = ["date", "day", "enteredon", "recordedon", "loggedon"];

  for (const c of dateCandidates) {
    const key = keys.find(k => norm(k) === norm(c));
    if (key) {
      const iso = parseDateToISO(row[key]);
      if (iso) return iso;
    }
  }
  for (const kw of dateContains) {
    const key = keys.find(k => norm(k).includes(norm(kw)));
    if (key) {
      const iso = parseDateToISO(row[key]);
      if (iso) return iso;
    }
  }
  return null;
}

export function autoMatchMilestone(
  taskName: string | null,
  milestones: Array<{ id: string; name: string }>,
): string | null {
  if (!taskName || milestones.length === 0) return null;
  const t = norm(taskName);
  for (const m of milestones) {
    const mn = norm(m.name);
    if (t.includes(mn) || mn.includes(t)) return m.id;
  }
  const taskWords = t.split(/\s+/).filter(w => w.length >= 4);
  for (const m of milestones) {
    const mWords = norm(m.name).split(/\s+/).filter(w => w.length >= 4);
    if (taskWords.some(tw => mWords.some(mw => tw.includes(mw) || mw.includes(tw)))) return m.id;
  }
  return null;
}

// Returns 0–1. Uses Jaccard similarity (overlap / union) so a single shared word
// in a multi-word name doesn't produce a misleadingly high score.
export function scoreProjectMatch(value: string, projectNames: string[]): number {
  if (!value || projectNames.length === 0) return 0;
  const vNorm = norm(value);
  let best = 0;
  for (const pn of projectNames) {
    const pNorm = norm(pn);
    // Exact substring containment → perfect match
    if (vNorm === pNorm || vNorm.includes(pNorm) || pNorm.includes(vNorm)) return 1;
    const vWords = normWords(value);
    const pWords = normWords(pn);
    if (!vWords.length || !pWords.length) continue;
    const common = vWords.filter(w => pWords.some(pw => pw === w)).length;
    // Jaccard: intersection / union
    const union = vWords.length + pWords.length - common;
    const score = union > 0 ? common / union : 0;
    if (score > best) best = score;
  }
  return best;
}

export const NAME_CANDIDATES = [
  "Employee Name", "EmployeeName", "Employee", "Full Name", "FullName",
  "Display Name", "DisplayName", "Name", "User", "UserName", "Username",
  "Member", "Team Member", "TeamMember", "Person", "PersonName",
  "Staff", "Resource", "Resource Name", "ResourceName", "Assignee", "Worker", "Consultant", "Contractor", "Agent",
];
export const NAME_CONTAINS = ["employee", "name", "user", "member", "person", "staff", "resource", "assignee", "worker"];

export const HOURS_CANDIDATES = [
  "Hours", "Hours Logged", "HoursLogged", "Logged Hours", "LoggedHours",
  "Actual Hours", "ActualHours", "Billable Hours", "BillableHours",
  "Total Hours", "TotalHours", "Worked Hours", "WorkedHours",
  "Work", "Work (h)", "Work(h)",
  "Duration", "Duration (h)", "Duration(h)", "Hrs",
  "Time Spent", "TimeSpent", "Time Logged", "TimeLogged",
  "Time (h)", "Time(h)", "Time", "Total Time", "TotalTime",
  // Minute-based column names
  "Minutes", "Total Minutes", "TotalMinutes", "Billable Minutes", "BillableMinutes",
  "Logged Minutes", "LoggedMinutes", "Duration (min)", "Duration(min)",
  "Time (min)", "Time(min)", "Mins",
];
export const HOURS_CONTAINS = ["hour", "hrs", "duration", "time", "logged", "minutes", "mins"];

export const TASK_CANDIDATES = [
  "Task", "Task Name", "TaskName", "Task Title", "TaskTitle",
  "Activity", "Activity Name", "ActivityName",
  "Issue", "Issue Name", "IssueName", "Issue Key", "IssueKey",
  "Story", "Epic", "Work Item", "WorkItem",
  "Subject", "Ticket", "Ticket Name", "TicketName",
  "Description", "Work Description", "WorkDescription",
  "Project Task", "ProjectTask", "Item",
];
export const TASK_CONTAINS = ["task", "activity", "issue", "story", "ticket", "subject"];

export const PROJECT_COL_CANDIDATES = [
  "Project", "Project Name", "ProjectName", "Client", "Client Name", "ClientName",
  "Account", "Account Name", "AccountName", "Workspace", "Team",
];
export const PROJECT_COL_CONTAINS = ["project", "client", "account"];

export type ParsedRow = {
  index: number;
  employeeName: string;
  role: string | null;
  taskName: string | null;
  hoursLogged: number;
  hourlyRate: number | null;
  currency: string;
  notes: string | null;
  projectColValue: string | null;
  matchScore: number;
  suggested: boolean;
  milestoneId: string | null;
  date: string | null; // "YYYY-MM-DD" full ISO date, e.g. "2025-03-15"
};

// Returns all column keys in `row` that look like a project/client column.
// Uses the key NAME (not value) so detection works even when a row's value is empty.
function detectProjectColKeys(row: Record<string, unknown>): string[] {
  const keys = Object.keys(row);
  const found = new Set<string>();
  for (const c of PROJECT_COL_CANDIDATES) {
    const match = keys.find(k => norm(k) === norm(c));
    if (match) found.add(match);
  }
  for (const kw of PROJECT_COL_CONTAINS) {
    const match = keys.find(k => norm(k).includes(norm(kw)));
    if (match) found.add(match);
  }
  return [...found];
}

export function parseTimesheetRows(
  rows: Array<Record<string, unknown>>,
  projectNames: string[],
  milestones: Array<{ id: string; name: string }>,
): { parsed: ParsedRow[]; hasProjectCol: boolean; hasDateCol: boolean } {
  const sampleRow = rows[0] ?? {};
  const projectColKeys = detectProjectColKeys(sampleRow);
  const hasProjectCol = projectColKeys.length > 0;

  // Detect whether the hours column is measured in minutes (e.g. "Duration (min)", "Minutes")
  const hoursColKey = findColKey(sampleRow, HOURS_CANDIDATES, HOURS_CONTAINS);
  const isMinutesCol = hoursColKey != null &&
    (() => { const n = norm(hoursColKey); return n.endsWith("min") || n.endsWith("mins") || n.endsWith("minutes"); })();

  // Detect whether any row has a parseable date column
  let hasDateCol = false;

  const parsed: ParsedRow[] = [];
  rows.forEach((row, index) => {
    const employeeName = findCol(row, NAME_CANDIDATES, NAME_CONTAINS);
    const hoursRaw = findCol(row, HOURS_CANDIDATES, HOURS_CONTAINS);
    const rateRaw = findCol(
      row,
      ["Rate", "HourlyRate", "Hourly Rate", "Cost Rate", "CostRate", "Billing Rate", "BillingRate"],
      ["rate"],
    );
    const role =
      findCol(row, ["Role", "Job Title", "JobTitle", "Position", "Title", "Designation"], [
        "role", "title", "position",
      ]) || null;
    const taskName = findCol(row, TASK_CANDIDATES, TASK_CONTAINS) || null;
    const notes = findCol(row, ["Notes", "Note", "Comment", "Comments"], []) || null;
    const currency = findCol(row, ["Currency", "Ccy"], ["currency"]) || "AED";

    let hours = parseDuration(hoursRaw);
    if (isMinutesCol && !isNaN(hours)) hours = hours / 60;
    const hourlyRate = rateRaw ? parseFloat(rateRaw) : null;

    if (!employeeName || isNaN(hours) || hours <= 0) return;

    const date = findDateISO(row);
    if (date) hasDateCol = true;

    let projectColValue: string | null = null;
    let matchScore = hasProjectCol ? 0 : 1;

    if (hasProjectCol) {
      const vals = projectColKeys
        .map(k => row[k] != null ? String(row[k]).trim() : "")
        .filter(Boolean);

      for (const v of vals) {
        const s = scoreProjectMatch(v, projectNames);
        if (s > matchScore) {
          matchScore = s;
          projectColValue = v;
        }
      }
    }

    parsed.push({
      index,
      employeeName,
      role,
      taskName,
      hoursLogged: Math.round(hours * 100) / 100,
      hourlyRate: hourlyRate && !isNaN(hourlyRate) ? hourlyRate : null,
      currency,
      notes,
      projectColValue,
      matchScore,
      suggested: matchScore >= 0.5,
      milestoneId: autoMatchMilestone(taskName, milestones),
      date,
    });
  });

  return { parsed, hasProjectCol, hasDateCol };
}
