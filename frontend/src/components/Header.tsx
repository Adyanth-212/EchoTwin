import type { ConnectionStatus } from "@/lib/types";

interface HeaderProps {
  status: ConnectionStatus;
  lastUpdated: Date | null;
}

const STATUS_CONFIG: Record<ConnectionStatus, { label: string; dot: string; badge: string }> = {
  live: {
    label: "Live",
    dot: "bg-emerald-400",
    badge: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  },
  demo: {
    label: "Demo data",
    dot: "bg-amber-400",
    badge: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  },
  error: {
    label: "Error",
    dot: "bg-red-400",
    badge: "border-red-400/30 bg-red-400/10 text-red-300",
  },
};

export default function Header({ status, lastUpdated }: HeaderProps) {
  const config = STATUS_CONFIG[status];

  return (
    <header className="flex items-center justify-between border-b border-white/10 bg-slate-950/80 px-6 py-4 backdrop-blur">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-cyan-400 to-teal-600" />
        <div>
          <h1 className="text-lg font-semibold text-white">EchoTwin</h1>
          <p className="text-xs text-slate-400">Room digital twin dashboard</p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <span
          className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${config.badge}`}
        >
          <span className={`h-2 w-2 rounded-full ${config.dot}`} />
          {config.label}
        </span>
        <span className="hidden text-xs text-slate-500 sm:inline">
          {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Waiting for data…"}
        </span>
      </div>
    </header>
  );
}
