// Works in both server and client components — pure render, no server-only APIs.
// Displays USD as the primary amount, native currency as secondary, with rate note.
import { toUSD } from "@/lib/fx";

function fmt(v: number) {
  return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

type Props = {
  amount: number;
  currency: string;
  rates: Record<string, number>;
  size?: "sm" | "md" | "lg";
  align?: "left" | "right";
  showRate?: boolean;
  muted?: boolean; // for paid/faded rows
};

export default function Money({
  amount,
  currency,
  rates,
  size = "md",
  align = "right",
  showRate = true,
  muted = false,
}: Props) {
  const isUsd = currency === "USD";
  const usd   = isUsd ? amount : toUSD(amount, currency, rates);
  const rate  = rates[currency];

  const usdFontSize  = size === "lg" ? "text-2xl" : size === "sm" ? "text-xs" : "text-sm";
  const natFontSize  = size === "lg" ? "text-sm"  : "text-xs";
  const alignClass   = align === "right" ? "text-right" : "text-left";
  const primaryColor = muted ? "text-gray-400" : "text-gray-900";

  return (
    <div className={alignClass}>
      <p className={`${usdFontSize} font-semibold tabular-nums ${primaryColor}`}>
        USD {fmt(usd)}
      </p>
      {!isUsd && (
        <p className={`${natFontSize} tabular-nums mt-0.5 ${muted ? "text-gray-300" : "text-gray-400"}`}>
          {currency} {fmt(amount)}
        </p>
      )}
      {!isUsd && showRate && rate != null && (
        <p className={`text-[10px] tabular-nums mt-0.5 ${muted ? "text-gray-200" : "text-gray-300"}`}>
          1 USD = {rate.toLocaleString(undefined, { maximumFractionDigits: 2 })} {currency}
        </p>
      )}
    </div>
  );
}
