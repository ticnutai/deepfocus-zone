export type ClientSource = "web" | "desktop";

export const clientSource = (): ClientSource =>
  typeof window !== "undefined" && window.desktop?.isElectron ? "desktop" : "web";

export const clientSourceTag = (): string => `source:client:${clientSource()}`;

export function withClientSource(tags: string[] | null | undefined): string[] {
  const next = (tags ?? []).filter((tag) => !tag.startsWith("source:client:"));
  next.push(clientSourceTag());
  return next;
}

export function sourceFromTags(tags: string[] | null | undefined): ClientSource | null {
  if (tags?.includes("source:client:desktop")) return "desktop";
  if (tags?.includes("source:client:web")) return "web";
  return null;
}
