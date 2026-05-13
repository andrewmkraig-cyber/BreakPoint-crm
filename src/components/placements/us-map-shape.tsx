import { MAP_VIEW_BOX, projectLngLat } from "@/lib/placements-map-geo";

// Continental US silhouette as a stylized polyline. Vertices in
// lng/lat, projected into the shared map viewBox by projectLngLat so
// every dot, bubble, and outline lives in the same coordinate space.
//
// This is deliberately low-fidelity cartography: the placement map is a
// backdrop for bubbles, not a reference geography. Real state outlines
// would balloon the bundle for an internal tool that doesn't need them.
// Faint regional "creases" (Mississippi, Rockies, etc.) below give the
// map enough internal texture to read as a US map at a glance.

const OUTLINE_LNGLAT: ReadonlyArray<readonly [number, number]> = [
  // Pacific NW down the West coast
  [-124.7, 48.4],
  [-124.5, 46.3],
  [-124.0, 43.4],
  [-124.2, 40.4],
  [-123.0, 38.9],
  [-122.4, 37.8],
  [-121.5, 36.6],
  [-120.6, 35.1],
  [-119.0, 34.0],
  [-117.3, 32.7],
  // Mexico border
  [-114.7, 32.7],
  [-111.0, 31.3],
  [-108.2, 31.3],
  [-106.5, 31.8],
  [-104.5, 30.6],
  [-103.0, 29.1],
  [-101.4, 29.8],
  [-99.5, 27.6],
  [-97.4, 25.9],
  // Gulf coast east to Florida
  [-97.1, 27.8],
  [-95.4, 28.8],
  [-94.0, 29.7],
  [-91.5, 29.4],
  [-89.6, 30.0],
  [-88.0, 30.4],
  [-86.5, 30.3],
  [-84.5, 30.0],
  [-83.2, 29.0],
  [-82.5, 27.5],
  [-81.8, 25.9],
  [-80.9, 25.2],
  // East coast back up
  [-80.1, 26.3],
  [-80.4, 28.5],
  [-81.0, 30.5],
  [-79.6, 32.8],
  [-77.0, 35.0],
  [-76.0, 36.6],
  [-75.5, 37.5],
  [-75.0, 38.5],
  [-74.6, 39.4],
  [-74.0, 40.5],
  [-71.9, 41.3],
  [-70.6, 41.7],
  [-70.0, 42.0],
  [-70.7, 42.7],
  [-70.8, 43.3],
  [-69.0, 43.8],
  [-67.0, 44.7],
  [-67.2, 45.2],
  // Northern border — Maine inland, across the Great Lakes, to the
  // northwest. We slightly smooth the Great Lakes for visual cleanness;
  // a faithful Lake Superior carve would add a lot of vertices for
  // little payoff at this zoom.
  [-69.0, 47.4],
  [-71.1, 45.3],
  [-73.4, 45.0],
  [-74.7, 45.0],
  [-76.8, 44.0],
  [-78.9, 43.6],
  [-81.0, 42.3],
  [-82.5, 41.7],
  [-83.0, 42.0],
  [-83.0, 43.0],
  [-84.2, 45.0],
  [-86.6, 46.0],
  [-88.5, 47.0],
  [-90.7, 47.5],
  [-92.3, 47.0],
  [-94.6, 48.5],
  [-95.2, 49.0],
  [-100.0, 49.0],
  [-105.0, 49.0],
  [-110.0, 49.0],
  [-115.0, 49.0],
  [-122.0, 49.0],
  [-124.7, 48.4],
] as const;

function pointsToPath(
  points: ReadonlyArray<readonly [number, number]>,
  closed: boolean,
): string {
  if (points.length === 0) return "";
  const parts: string[] = [];
  for (let i = 0; i < points.length; i++) {
    const [lng, lat] = points[i];
    const { x, y } = projectLngLat(lng, lat);
    parts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  if (closed) parts.push("Z");
  return parts.join(" ");
}

// Faint internal "creases" — purely visual texture that suggests state
// divisions without claiming cartographic accuracy. Each entry is two
// lng/lat endpoints for a stroke. We pick a handful of recognizable
// long-form borders: Mississippi River corridor, Appalachian spine,
// continental divide, Mason-Dixon-ish, Texas/Oklahoma north line.
const REGIONAL_CREASES: ReadonlyArray<
  readonly [readonly [number, number], readonly [number, number]]
> = [
  // Mississippi corridor (Minneapolis -> Memphis -> Gulf)
  [
    [-92.5, 46.5],
    [-90.2, 38.6],
  ],
  [
    [-90.2, 38.6],
    [-90.0, 35.0],
  ],
  [
    [-90.0, 35.0],
    [-89.6, 30.0],
  ],
  // Appalachian spine (NY -> Atlanta)
  [
    [-75.0, 42.5],
    [-78.5, 39.5],
  ],
  [
    [-78.5, 39.5],
    [-82.5, 36.0],
  ],
  [
    [-82.5, 36.0],
    [-84.4, 33.8],
  ],
  // Continental Divide (loose Rockies line)
  [
    [-114.0, 48.5],
    [-110.5, 44.5],
  ],
  [
    [-110.5, 44.5],
    [-106.8, 39.5],
  ],
  [
    [-106.8, 39.5],
    [-105.5, 35.0],
  ],
  [
    [-105.5, 35.0],
    [-106.5, 31.8],
  ],
  // Mason-Dixon-ish horizontal
  [
    [-77.0, 39.7],
    [-87.5, 39.0],
  ],
  // Texas / Oklahoma north line
  [
    [-103.0, 36.5],
    [-94.5, 36.5],
  ],
  // Great Lakes hint (Lake Michigan east shore)
  [
    [-87.5, 41.8],
    [-86.2, 45.0],
  ],
];

const OUTLINE_PATH = pointsToPath(OUTLINE_LNGLAT, true);

const CREASE_PATHS = REGIONAL_CREASES.map(([a, b]) => {
  const pa = projectLngLat(a[0], a[1]);
  const pb = projectLngLat(b[0], b[1]);
  return `M${pa.x.toFixed(1)},${pa.y.toFixed(1)} L${pb.x.toFixed(1)},${pb.y.toFixed(1)}`;
});

export function UsMapShape() {
  return (
    <g aria-hidden="true">
      <path
        d={OUTLINE_PATH}
        fill="rgb(var(--court-surface-subtle))"
        stroke="rgb(var(--court-border))"
        strokeWidth={1.25}
        strokeLinejoin="round"
      />
      {CREASE_PATHS.map((d, i) => (
        <path
          key={i}
          d={d}
          stroke="rgb(var(--court-border))"
          strokeWidth={0.85}
          strokeOpacity={0.55}
          strokeLinecap="round"
          fill="none"
        />
      ))}
    </g>
  );
}

export { MAP_VIEW_BOX };
