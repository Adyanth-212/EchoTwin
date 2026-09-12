interface AlertBannersProps {
  warnings: string[];
  anomalies: string[];
}

export default function AlertBanners({ warnings, anomalies }: AlertBannersProps) {
  if (warnings.length === 0 && anomalies.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {anomalies.map((anomaly, index) => (
        <div
          key={`anomaly-${index}`}
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300"
        >
          ⚠ {anomaly}
        </div>
      ))}
      {warnings.map((warning, index) => (
        <div
          key={`warning-${index}`}
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-300"
        >
          ▲ {warning}
        </div>
      ))}
    </div>
  );
}
