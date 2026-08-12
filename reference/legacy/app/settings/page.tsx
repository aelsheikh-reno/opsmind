import { prisma } from "@/lib/prisma";
import { getUsdRates, getHistoricalUsdRates, getRatesCachedAt } from "@/lib/fx";
import SidebarWrapper from "../components/SidebarWrapper";
import TopBar from "../components/TopBar";
import PayrollDayForm from "./PayrollDayForm";
import PayrollHorizonForm from "./PayrollHorizonForm";
import EntityNameForm from "./EntityNameForm";
import LockRateToggle from "./LockRateToggle";
import ExchangeRateTable, { type RateRowData } from "./ExchangeRateTable";
import FetchRateButton from "./FetchRateButton";
import ContractTemplates from "./ContractTemplates";
import VatConfigSection from "./VatConfigSection";
import TaxConfigSection from "./TaxConfigSection";
import SettingsTabs from "./SettingsTabs";
import AsanaSection from "./AsanaSection";
import WhatsappSection from "./WhatsappSection";
import NotificationRecipientsSection from "./NotificationRecipientsSection";
import EmailConfigSection from "./EmailConfigSection";
import AnthropicUsageCard from "./AnthropicUsageCard";
import CurrenciesSection from "./CurrenciesSection";
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const now = new Date();
  const nowMonth = now.getMonth() + 1;
  const nowYear  = now.getFullYear();

  const contractTemplates = await prisma.contractTemplate.findMany({ orderBy: { createdAt: "desc" } });

  const vatConfigs = await prisma.vatConfig.findMany({ orderBy: { createdAt: "asc" } });
  const taxConfigs = await prisma.taxConfig.findMany({ orderBy: { createdAt: "asc" } });


  const [asanaTokenSetting, asanaUserGidSetting, asanaWorkspaceGidSetting, asanaSyncFromSetting, zohoConn, whatsappPhoneSetting, notificationRecipients, anthropicKeySetting, resendApiKeySetting, claimFromEmailSetting, digestHourSetting, payslipCcEmailsSetting] = await Promise.all([
    prisma.setting.findUnique({ where: { key: "asanaAccessToken" } }),
    prisma.setting.findUnique({ where: { key: "asanaUserGid" } }),
    prisma.setting.findUnique({ where: { key: "asanaWorkspaceGid" } }),
    prisma.setting.findUnique({ where: { key: "asanaSyncFrom" } }),
    prisma.zohoConnection.findFirst({ select: { organizationName: true, accountName: true } }),
    prisma.setting.findUnique({ where: { key: "whatsappPhone" } }),
    prisma.notificationRecipient.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.setting.findUnique({ where: { key: "anthropicAdminKey" } }),
    prisma.setting.findUnique({ where: { key: "resendApiKey" } }),
    prisma.setting.findUnique({ where: { key: "claimFromEmail" } }),
    prisma.setting.findUnique({ where: { key: "digestHourUtc" } }),
    prisma.setting.findUnique({ where: { key: "payslipCcEmails" } }),
  ]);
  const whatsappPhone = whatsappPhoneSetting?.value ?? "";
  const asanaToken = asanaTokenSetting?.value || process.env.ASANA_ACCESS_TOKEN || null;
  const asanaUserGid = asanaUserGidSetting?.value || process.env.ASANA_USER_GID || null;
  const asanaWorkspaceGid = asanaWorkspaceGidSetting?.value || process.env.ASANA_WORKSPACE_GID || null;
  const asanaSyncFrom = asanaSyncFromSetting?.value ?? null;
  const anthropicAdminKey = anthropicKeySetting?.value || process.env.ANTHROPIC_ADMIN_KEY || null;
  const anthropicKeyPreview = anthropicAdminKey
    ? `${anthropicAdminKey.slice(0, 16)}${"•".repeat(6)}${anthropicAdminKey.slice(-4)}`
    : null;
  const resendApiKey = resendApiKeySetting?.value || process.env.RESEND_API_KEY || null;
  const resendApiKeyPreview = resendApiKey
    ? `${resendApiKey.slice(0, 8)}${"•".repeat(8)}`
    : null;
  const claimFromEmail = claimFromEmailSetting?.value || process.env.CLAIM_FROM_EMAIL || null;
  const digestHourUtc  = digestHourSetting ? parseInt(digestHourSetting.value) : 4;
  const payslipCcEmails = payslipCcEmailsSetting?.value ?? "";

  const [payrollDaySetting, entitySetting, lockSetting, horizonSetting, currenciesSetting, allProcessedRuns, allRunBounds, liveRates, ratesCachedAt] = await Promise.all([
    prisma.setting.findUnique({ where: { key: "payrollDay" } }),
    prisma.setting.findUnique({ where: { key: "entityName" } }),
    prisma.setting.findUnique({ where: { key: "lockRateOnProcessing" } }),
    prisma.setting.findUnique({ where: { key: "payrollHorizonYear" } }),
    prisma.setting.findUnique({ where: { key: "activeCurrencies" } }),
    // Processed runs — for locked snapshots
    prisma.payrollRun.findMany({
      where: { isProcessed: true, month: { not: null }, year: { not: null } },
      select: { id: true, month: true, year: true, fxRateSnapshot: true, processedAt: true },
      orderBy: [{ year: "asc" }, { month: "asc" }],
    }),
    // All runs — to determine full window extent
    prisma.payrollRun.findMany({
      where: { month: { not: null }, year: { not: null } },
      select: { month: true, year: true },
    }),
    getUsdRates(),
    getRatesCachedAt(),
  ]);

  const payrollDay = payrollDaySetting ? parseInt(payrollDaySetting.value, 10) : null;
  const entityName = entitySetting?.value || "";
  const lockOnProcessing = lockSetting ? lockSetting.value === "true" : true;
  const horizonYear = horizonSetting ? parseInt(horizonSetting.value, 10) : null;
  const activeCurrencies: string[] = currenciesSetting
    ? JSON.parse(currenciesSetting.value)
    : ["USD", "AED"];

  const toKey = (y: number, m: number) => y * 12 + m;

  // Index all processed runs by month key
  const runByKey = new Map<string, { id: string; fxRateSnapshot: string | null; processedAt: Date | null }>();
  for (const run of allProcessedRuns) {
    if (!run.month || !run.year) continue;
    runByKey.set(`${run.year}-${run.month}`, {
      id: run.id,
      fxRateSnapshot: run.fxRateSnapshot,
      processedAt: run.processedAt,
    });
  }

  // Determine display window start: earliest of any payroll run or January of the previous year
  let startYear = nowYear - 1;
  let startMonth = 1;
  for (const run of allRunBounds) {
    if (!run.month || !run.year) continue;
    if (run.year < startYear || (run.year === startYear && run.month < startMonth)) {
      startYear = run.year;
      startMonth = run.month;
    }
  }

  // Latest year across all payroll runs — used to enforce the minimum selectable horizon
  let latestRunYear = nowYear;
  for (const run of allRunBounds) {
    if (run.year && run.year > latestRunYear) latestRunYear = run.year;
  }

  // Determine display window end — horizon is a hard cap and floor
  let endKey: number;
  if (horizonYear) {
    endKey = toKey(horizonYear, 12);
  } else {
    endKey = toKey(nowYear, nowMonth) + 3;
    for (const run of allRunBounds) {
      if (!run.month || !run.year) continue;
      endKey = Math.max(endKey, toKey(run.year, run.month));
    }
  }

  // Fetch historical rates in parallel for past months with no locked snapshot
  const pastNeedingHistory: Array<{ year: number; month: number; key: string }> = [];
  for (let k = toKey(startYear, startMonth); k < toKey(nowYear, nowMonth); k++) {
    const y = Math.floor((k - 1) / 12);
    const m = ((k - 1) % 12) + 1;
    const mapKey = `${y}-${m}`;
    const run = runByKey.get(mapKey);
    if (!run?.fxRateSnapshot) pastNeedingHistory.push({ year: y, month: m, key: mapKey });
  }

  const historicalByKey = new Map<string, Record<string, number>>();
  await Promise.all(
    pastNeedingHistory.map(async ({ year, month, key }) => {
      const rates = await getHistoricalUsdRates(new Date(year, month, 0));
      if (rates) historicalByKey.set(key, rates);
    })
  );

  // Assemble rate rows
  const rateRows: RateRowData[] = [];
  for (let k = toKey(startYear, startMonth); k <= endKey; k++) {
    const y = Math.floor((k - 1) / 12);
    const m = ((k - 1) % 12) + 1;
    const mapKey = `${y}-${m}`;
    const isPast    = toKey(y, m) < toKey(nowYear, nowMonth);
    const isCurrent = y === nowYear && m === nowMonth;
    const run = runByKey.get(mapKey);

    if (run?.fxRateSnapshot) {
      // Locked — has a snapshot
      try {
        const snap = JSON.parse(run.fxRateSnapshot);
        rateRows.push({
          year: y, month: m,
          rates: Object.fromEntries(activeCurrencies.map((c) => [c, snap[c] ?? null])),
          source: "locked",
          lockedOn: run.processedAt
            ? new Date(run.processedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
            : null,
          runId: run.id,
        });
      } catch {
        rateRows.push({ year: y, month: m, rates: Object.fromEntries(activeCurrencies.map((c) => [c, null])), source: "locked", runId: run.id });
      }
    } else if (isPast) {
      // Historical — from public API
      const h = historicalByKey.get(mapKey);
      rateRows.push({
        year: y, month: m,
        rates: Object.fromEntries(activeCurrencies.map((c) => [c, h?.[c] ?? null])),
        source: "historical",
        runId: run?.id ?? null,
      });
    } else {
      // Current or future — live/forecast
      rateRows.push({
        year: y, month: m,
        rates: Object.fromEntries(activeCurrencies.map((c) => [c, liveRates[c] ?? null])),
        source: isCurrent ? "live" : "forecast",
        runId: run?.id ?? null,
      });
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      <SidebarWrapper />
      <div className="flex-1 overflow-y-auto flex flex-col">
        <TopBar breadcrumb={[{ label: "Settings" }]} />

        <main className="p-4 sm:p-6 max-w-5xl w-full">
          <div className="mb-6">
            <h1 className="text-xl font-bold text-gray-900">Settings</h1>
            <p className="text-sm text-gray-400 mt-0.5">Configure how OpsMind tracks and displays your operations.</p>
          </div>

          <SettingsTabs tabs={[
            {
              id: "general",
              label: "General",
              content: (
                <>
                <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
                  <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-border">
                    <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                        <rect x="1" y="4" width="14" height="9" rx="1.5" stroke="#4f46e5" strokeWidth="1.4" fill="none" />
                        <path d="M5 4V3a3 3 0 0 1 6 0v1" stroke="#4f46e5" strokeWidth="1.4" strokeLinecap="round" fill="none" />
                        <circle cx="8" cy="8.5" r="1.5" fill="#4f46e5" />
                      </svg>
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-gray-900">Entity name</h2>
                      <p className="text-xs text-gray-400">Your organisation&apos;s name shown across the app</p>
                    </div>
                    {entityName && (
                      <span className="ml-auto text-xs font-semibold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-full truncate max-w-[160px]">
                        {entityName}
                      </span>
                    )}
                  </div>
                  <div className="px-5 py-5">
                    <EntityNameForm initialName={entityName} />
                  </div>
                </div>

                {/* Active currencies */}
                <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
                  <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-border">
                    <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                        <circle cx="8" cy="8" r="6" stroke="#4f46e5" strokeWidth="1.4" fill="none" />
                        <path d="M8 5v1.5m0 3V11m-2-2.5h3.5a1 1 0 0 0 0-2H6.5a1 1 0 0 1 0-2H10" stroke="#4f46e5" strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-gray-900">Currencies</h2>
                      <p className="text-xs text-gray-400">Enable the currencies available across the platform. USD is the base for all calculations.</p>
                    </div>
                    <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end shrink-0">
                      {activeCurrencies.filter(c => c !== "USD").map(c => (
                        <span key={c} className="text-[10px] font-bold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">{c}</span>
                      ))}
                    </div>
                  </div>
                  <div className="px-5 py-4">
                    <CurrenciesSection
                      initialCurrencies={activeCurrencies}
                      rates={Object.fromEntries(
                        activeCurrencies.filter(c => c !== "USD").map(c => [c, liveRates[c] ?? 0])
                      )}
                    />
                  </div>
                </div>

</>
              ),
            },
            {
              id: "payroll",
              label: "Payroll",
              content: (
                <>
                  {/* Payroll processing day */}
                  <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
                    <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-border">
                      <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                          <circle cx="8" cy="8" r="6" stroke="#4f46e5" strokeWidth="1.5" fill="none" />
                          <path d="M8 5v1.5m0 3V11m-2-2.5h3.5a1 1 0 0 0 0-2H6.5a1 1 0 0 1 0-2H10" stroke="#4f46e5" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      </div>
                      <div>
                        <h2 className="text-sm font-semibold text-gray-900">Payroll processing day</h2>
                        <p className="text-xs text-gray-400">Which day of the month is payroll processed?</p>
                      </div>
                      {payrollDay && (
                        <span className="ml-auto text-xs font-semibold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-full">
                          Day {payrollDay}
                        </span>
                      )}
                    </div>
                    <div className="px-5 py-5">
                      <PayrollDayForm initialDay={payrollDay} />
                    </div>
                  </div>

                  {/* Exchange rates */}
                  <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
                    <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-border">
                      <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                          <path d="M2 5h9M8 2l3 3-3 3" stroke="#4f46e5" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                          <path d="M14 11H5M8 14l-3-3 3-3" stroke="#4f46e5" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                        </svg>
                      </div>
                      <div>
                        <h2 className="text-sm font-semibold text-gray-900">Exchange rates</h2>
                        <p className="text-xs text-gray-400">USD rates per month — lock on processing or use historical</p>
                      </div>
                      <div className="ml-auto flex items-center gap-3 shrink-0">
                        <span className="text-xs font-medium text-gray-500">
                          {activeCurrencies.filter(c => c !== "USD").map((c, i) => (
                            <span key={c}>
                              {i > 0 && <span className="mx-1.5 text-gray-300">·</span>}
                              1 USD = {liveRates[c]?.toFixed(4)} {c}
                            </span>
                          ))}
                        </span>
                        <FetchRateButton cachedAt={ratesCachedAt?.toISOString() ?? null} />
                      </div>
                    </div>
                    <div className="px-5 py-4 border-b border-surface-border">
                      <div className="flex items-start gap-3 mb-3">
                        <div className="w-6 h-6 rounded-md bg-surface-inset flex items-center justify-center shrink-0 mt-0.5">
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                            <rect x="3" y="7" width="10" height="8" rx="1.5" stroke="#6b7280" strokeWidth="1.5" fill="none" />
                            <path d="M5.5 7V4a2.5 2.5 0 0 1 5 0v3" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round" fill="none" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-800">Lock rate when processing payroll</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            When enabled, the live USD rate is captured the moment you mark a run as processed and stored permanently for that month.
                            Disable to always derive the rate from historical data.
                          </p>
                        </div>
                      </div>
                      <LockRateToggle initialValue={lockOnProcessing} />
                    </div>
                    <ExchangeRateTable rows={rateRows} nowMonth={nowMonth} nowYear={nowYear} currencies={activeCurrencies} />
                  </div>

                  {/* Payroll horizon */}
                  <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
                    <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-border">
                      <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                          <rect x="1" y="3" width="14" height="12" rx="2" stroke="#4f46e5" strokeWidth="1.3" fill="none" />
                          <path d="M5 1v4M11 1v4M1 7h14" stroke="#4f46e5" strokeWidth="1.3" strokeLinecap="round" />
                          <path d="M4 11h4M4 9h6" stroke="#4f46e5" strokeWidth="1.1" strokeLinecap="round" />
                        </svg>
                      </div>
                      <div>
                        <h2 className="text-sm font-semibold text-gray-900">Payroll horizon</h2>
                        <p className="text-xs text-gray-400">Show payroll calendar and exchange rates through this year</p>
                      </div>
                      {horizonYear && (
                        <span className="ml-auto text-xs font-semibold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-full">
                          Through {horizonYear}
                        </span>
                      )}
                    </div>
                    <div className="px-5 py-5">
                      <PayrollHorizonForm initialYear={horizonYear} minYear={latestRunYear} />
                    </div>
                  </div>
                </>
              ),
            },
            {
              id: "taxes",
              label: "Taxes",
              content: (
                <>
                  {/* VAT obligations */}
                  <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
                    <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-border">
                      <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                          <rect x="1" y="3" width="14" height="10" rx="1.5" stroke="#4f46e5" strokeWidth="1.4" fill="none" />
                          <path d="M5 8h2m0 0h2m-2 0V6m0 2v2" stroke="#4f46e5" strokeWidth="1.3" strokeLinecap="round" />
                        </svg>
                      </div>
                      <div>
                        <h2 className="text-sm font-semibold text-gray-900">VAT obligations</h2>
                        <p className="text-xs text-gray-400">Filing schedule and rates per country</p>
                      </div>
                      {vatConfigs.length > 0 && (
                        <span className="ml-auto text-xs font-semibold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-full">
                          {vatConfigs.length} configured
                        </span>
                      )}
                    </div>
                    <div className="px-5 py-5">
                      <VatConfigSection configs={vatConfigs.map((c) => ({ ...c, startDate: c.startDate.toISOString() }))} />
                    </div>
                  </div>

                  {/* Tax obligations */}
                  <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
                    <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-border">
                      <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="#4f46e5" strokeWidth="1.4" fill="none" />
                          <path d="M4.5 8h3M4.5 10.5h2" stroke="#4f46e5" strokeWidth="1.3" strokeLinecap="round" />
                          <path d="M10 6.5l1.5 4M11.5 6.5L10 10.5" stroke="#4f46e5" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M1.5 5h13" stroke="#4f46e5" strokeWidth="1.3" />
                        </svg>
                      </div>
                      <div>
                        <h2 className="text-sm font-semibold text-gray-900">Tax obligations</h2>
                        <p className="text-xs text-gray-400">Corporate, income, and withholding tax filing schedules</p>
                      </div>
                      {taxConfigs.length > 0 && (
                        <span className="ml-auto text-xs font-semibold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-full">
                          {taxConfigs.length} configured
                        </span>
                      )}
                    </div>
                    <div className="px-5 py-5">
                      <TaxConfigSection configs={taxConfigs.map((c) => ({ ...c, startDate: c.startDate.toISOString() }))} />
                    </div>
                  </div>
                </>
              ),
            },
            {
              id: "integrations",
              label: "Integrations",
              content: (
                <>
                <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
                  <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-border">
                    <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                        <circle cx="3.5" cy="8" r="2" stroke="#4f46e5" strokeWidth="1.3" fill="none" />
                        <circle cx="12.5" cy="3.5" r="2" stroke="#4f46e5" strokeWidth="1.3" fill="none" />
                        <circle cx="12.5" cy="12.5" r="2" stroke="#4f46e5" strokeWidth="1.3" fill="none" />
                        <path d="M5.5 8h3.5M9 5.5l3-1.5M9 10.5l3 1.5" stroke="#4f46e5" strokeWidth="1.2" strokeLinecap="round" />
                      </svg>
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-gray-900">Asana</h2>
                      <p className="text-xs text-gray-400">Sync claims and expenses from Asana tasks</p>
                    </div>
                    <span className={`ml-auto text-xs font-semibold px-2.5 py-1 rounded-full ${
                      asanaToken && asanaUserGid && asanaWorkspaceGid
                        ? "text-emerald-700 bg-emerald-50"
                        : "text-gray-400 bg-surface-inset"
                    }`}>
                      {asanaToken && asanaUserGid && asanaWorkspaceGid ? "Connected" : "Not configured"}
                    </span>
                  </div>
                  <div className="px-5 py-5">
                    <AsanaSection
                      hasToken={!!asanaToken}
                      tokenPreview={asanaToken ? `${asanaToken.slice(0, 6)}${"•".repeat(8)}${asanaToken.slice(-4)}` : null}
                      userGid={asanaUserGid}
                      workspaceGid={asanaWorkspaceGid}
                      syncFromSaved={asanaSyncFrom}
                    />
                  </div>
                </div>

                {/* WhatsApp reminders */}
                <div className="bg-white border border-surface-border rounded-xl overflow-hidden mt-4">
                  <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-border">
                    <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center shrink-0">
                      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                        <path d="M8 1.5A6.5 6.5 0 1 0 14.5 8a6.5 6.5 0 0 0-6.5-6.5zm0 11.2a4.7 4.7 0 1 1 0-9.4 4.7 4.7 0 0 1 0 9.4z" fill="#16a34a" opacity=".2"/>
                        <path d="M5.5 10.5S6.8 9.5 8 9.5c1.2 0 2.5 1 2.5 1M8 5.5v.5m0 2v.5" stroke="#16a34a" strokeWidth="1.3" strokeLinecap="round"/>
                        <circle cx="8" cy="8" r="6.5" stroke="#16a34a" strokeWidth="1.3" fill="none"/>
                      </svg>
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-gray-900">WhatsApp reminders</h2>
                      <p className="text-xs text-gray-400">Renewal and payment alerts via Twilio WhatsApp</p>
                    </div>
                    <span className={`ml-auto text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 ${
                      whatsappPhone ? "text-emerald-700 bg-emerald-50" : "text-gray-400 bg-surface-inset"
                    }`}>
                      {whatsappPhone ? whatsappPhone : "Not configured"}
                    </span>
                  </div>
                  <div className="px-5 py-5">
                    <WhatsappSection initialPhone={whatsappPhone} />
                  </div>
                </div>

                {/* Anthropic AI Usage */}
                <div className="bg-white border border-surface-border rounded-xl overflow-hidden mt-4">
                  <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-border">
                    <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center shrink-0">
                      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                        <path d="M8 2L10.5 6.5H14L10.5 9.5L12 14L8 11.5L4 14L5.5 9.5L2 6.5H5.5L8 2Z" stroke="#ea580c" strokeWidth="1.3" fill="none" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-gray-900">Anthropic AI</h2>
                      <p className="text-xs text-gray-400">Current month API usage and cost</p>
                    </div>
                    <span className={`ml-auto text-xs font-semibold px-2.5 py-1 rounded-full ${
                      anthropicAdminKey
                        ? "text-emerald-700 bg-emerald-50"
                        : "text-gray-400 bg-surface-inset"
                    }`}>
                      {anthropicAdminKey ? "Admin key set" : "Not configured"}
                    </span>
                  </div>
                  <div className="px-5 py-5">
                    <AnthropicUsageCard hasKey={!!anthropicAdminKey} keyPreview={anthropicKeyPreview} />
                  </div>
                </div>

                {/* Zoho Books */}
                <div className="bg-white border border-surface-border rounded-xl overflow-hidden mt-4">
                  <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-border">
                    <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center shrink-0">
                      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                        <rect width="16" height="16" rx="4" fill="#E42527" />
                        <path d="M3 11L7 5H3.5M6 5h7L9 11h4" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-gray-900">Zoho Books</h2>
                      <p className="text-xs text-gray-400">Push approved expense claims to Zoho Books</p>
                    </div>
                    <span className={`ml-auto text-xs font-semibold px-2.5 py-1 rounded-full ${
                      zohoConn ? "text-emerald-700 bg-emerald-50" : "text-gray-400 bg-surface-inset"
                    }`}>
                      {zohoConn ? "Connected" : "Not connected"}
                    </span>
                  </div>
                  <div className="px-5 py-4 flex items-center justify-between">
                    <div>
                      {zohoConn ? (
                        <>
                          <p className="text-sm text-gray-700">{zohoConn.organizationName ?? "Organisation connected"}</p>
                          {zohoConn.accountName && (
                            <p className="text-xs text-gray-400 mt-0.5">Default account: {zohoConn.accountName}</p>
                          )}
                        </>
                      ) : (
                        <p className="text-sm text-gray-400">Connect to push approved claims directly to Zoho Books.</p>
                      )}
                    </div>
                    <a
                      href="/integrations/zoho"
                      className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors whitespace-nowrap ml-4"
                    >
                      {zohoConn ? "Manage →" : "Configure →"}
                    </a>
                  </div>
                </div>
                </>
              ),
            },
            {
              id: "compliance",
              label: "Compliance",
              content: (
                <>
                  {/* Contract templates */}
                  <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
                    <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-border">
                      <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                          <rect x="2" y="1" width="10" height="13" rx="1.5" stroke="#4f46e5" strokeWidth="1.3" fill="none" />
                          <path d="M5 5h6M5 7.5h6M5 10h4" stroke="#4f46e5" strokeWidth="1.1" strokeLinecap="round" />
                          <path d="M10 1v3.5h3.5" stroke="#4f46e5" strokeWidth="1.1" strokeLinecap="round" />
                        </svg>
                      </div>
                      <div>
                        <h2 className="text-sm font-semibold text-gray-900">Contract templates</h2>
                        <p className="text-xs text-gray-400">Upload DOCX templates to generate employment contracts</p>
                      </div>
                      {contractTemplates.some((t) => t.isActive) && (
                        <span className="ml-auto text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">Active</span>
                      )}
                    </div>
                    <ContractTemplates
                      initialTemplates={contractTemplates.map((t) => ({
                        ...t,
                        placeholders: t.placeholders ? JSON.parse(t.placeholders) : [],
                        createdAt: t.createdAt.toISOString(),
                      }))}
                    />
                  </div>

                  <div className="bg-white border border-surface-border rounded-xl overflow-hidden opacity-50 pointer-events-none select-none">
                    <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-border">
                      <div className="w-8 h-8 rounded-lg bg-surface-inset flex items-center justify-center shrink-0">
                        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                          <path d="M8 1l6 2.5v5C14 11 11.5 13.5 8 15c-3.5-1.5-6-4-6-6.5v-5L8 1z" stroke="#9ca3af" strokeWidth="1.5" fill="none" />
                        </svg>
                      </div>
                      <div>
                        <h2 className="text-sm font-semibold text-gray-900">Compliance thresholds</h2>
                        <p className="text-xs text-gray-400">Coming soon — set renewal warning windows</p>
                      </div>
                      <span className="ml-auto text-xs text-gray-400 bg-surface-inset px-2.5 py-1 rounded-full">Soon</span>
                    </div>
                  </div>

                  <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
                    <div className="flex items-center gap-3 px-5 py-4">
                      <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center shrink-0">
                        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                          <circle cx="8" cy="8" r="6.5" stroke="#16a34a" strokeWidth="1.3" fill="none"/>
                          <path d="M5 8l2 2 4-4" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                      <div>
                        <h2 className="text-sm font-semibold text-gray-900">WhatsApp reminders</h2>
                        <p className="text-xs text-gray-400">
                          {whatsappPhone
                            ? `Alerts will be sent to ${whatsappPhone} — configure in the Integrations tab`
                            : "Not configured — go to Integrations tab to set up"}
                        </p>
                      </div>
                      <span className={`ml-auto text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 ${
                        whatsappPhone ? "text-emerald-700 bg-emerald-50" : "text-gray-400 bg-surface-inset"
                      }`}>
                        {whatsappPhone ? "Active" : "Not set"}
                      </span>
                    </div>
                  </div>
                </>
              ),
            },
            {
              id: "notifications",
              label: "Notifications",
              content: (
                <div className="space-y-4">
                  <div className="bg-white border border-surface-border rounded-xl p-5">
                    <EmailConfigSection
                      hasApiKey={!!resendApiKey}
                      apiKeyPreview={resendApiKeyPreview}
                      currentFromEmail={claimFromEmail}
                      currentDigestHourUtc={digestHourUtc}
                      currentPayslipCc={payslipCcEmails}
                    />
                  </div>
                  <div className="bg-white border border-surface-border rounded-xl p-5">
                    <NotificationRecipientsSection initial={notificationRecipients} digestHourUtc={digestHourUtc} />
                  </div>
                </div>
              ),
            },
          ]} />
        </main>
      </div>
    </div>
  );
}
