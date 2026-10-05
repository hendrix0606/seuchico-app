import type { TicketCategory } from "../types/tickets";

export const colorPalettes = [
  { name: "Tecnologico", primary: "#12364A", accent: "#38D6D2" },
  { name: "Elegante", primary: "#503C48", accent: "#E7BFA7" },
  { name: "Noturno", primary: "#17152F", accent: "#A879FF" },
  { name: "Solar", primary: "#5B3427", accent: "#FFB66B" },
  { name: "Natural", primary: "#24493E", accent: "#A9D7B8" },
];

export function categoryDetails(category: TicketCategory) {
  if (category === "wedding") return { icon: "💍", label: "Casamento" };
  if (category === "show") return { icon: "🎵", label: "Show" };
  if (category === "corporate") return { icon: "💼", label: "Corporativo" };
  return { icon: "🎉", label: "Festa" };
}

export function formatDatabaseDate(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

export function formatCurrency(cents: number) {
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}

export function normalizeDate(value: string) {
  const trimmed = value.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return isValidDate(trimmed) ? trimmed : null;
  }

  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (!match) return null;

  const normalized = `${match[3]}-${match[2]}-${match[1]}`;
  return isValidDate(normalized) ? normalized : null;
}

function isValidDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
