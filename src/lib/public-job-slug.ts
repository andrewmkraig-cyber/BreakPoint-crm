export function publicJobSlug(job: {
  id: string;
  title: string;
  locationCity: string | null;
  locationState: string | null;
}): string {
  const readable = [job.title, job.locationCity, job.locationState]
    .filter(Boolean)
    .join(" ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);

  // The id suffix prevents collisions between same-title roles and keeps
  // every generated URL tied to one Ace record.
  return `${readable || "open-role"}-${job.id.slice(-8)}`;
}
