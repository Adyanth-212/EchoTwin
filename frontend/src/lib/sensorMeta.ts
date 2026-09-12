export interface SensorMeta {
  label: string;
  unit: string;
  icon: string;
}

const SENSOR_META: Record<string, SensorMeta> = {
  temperature: { label: "Temperature", unit: "°C", icon: "🌡️" },
  humidity: { label: "Humidity", unit: "%", icon: "💧" },
  eco2: { label: "eCO₂", unit: "ppm", icon: "🧪" },
  tvoc: { label: "TVOC", unit: "ppb", icon: "🧬" },
  aqi: { label: "AQI", unit: "", icon: "🌫️" },
  ir_temperature: { label: "Surface Temp (IR)", unit: "°C", icon: "🎯" },
  vibration: { label: "Vibration", unit: "g", icon: "📳" },
};

function toTitleCase(text: string): string {
  return text
    .split("_")
    .map((word) => (word.length > 0 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

export function getSensorMeta(readingType: string): SensorMeta {
  return (
    SENSOR_META[readingType] ?? {
      label: toTitleCase(readingType),
      unit: "",
      icon: "📊",
    }
  );
}
