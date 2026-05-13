"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";

import {
  STATUS_COLORS,
  bubbleRadius,
  dominantStatus,
  formatMoneyShort,
  type CityAggregate,
} from "@/lib/placements-map-geo";

const BRAND_GREEN = "#5A9642";

// When every placement coordinate falls within this much lat/lng span,
// we zoom to fit the cluster instead of showing the full US. Two degrees
// is roughly metro-area scale (Pittsburgh ⇄ Cleveland is ~1.1° apart),
// which is exactly the case we want to auto-zoom into on a recruiter's
// first visit. Once they pan or zoom, the saved view in localStorage
// takes over on subsequent loads.
const CLUSTER_SPAN_DEGREES = 2;

// localStorage key for the persisted map view. Schema: { lat, lng, zoom }.
// Read once on mount as the initial center/zoom (else auto-fit cluster
// bounds, else full US). Re-written on every Leaflet `moveend` so the
// recruiter's zoom and position survive navigation away and back.
const VIEW_STORAGE_KEY = "ace.placementMap.view";

type SavedView = { lat: number; lng: number; zoom: number };

function readSavedView(): SavedView | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as SavedView).lat === "number" &&
      typeof (parsed as SavedView).lng === "number" &&
      typeof (parsed as SavedView).zoom === "number"
    ) {
      return parsed as SavedView;
    }
  } catch {
    // Malformed JSON or unavailable storage — fall through to defaults.
  }
  return null;
}

type Props = {
  cities: CityAggregate[];
};

export function PlacementsLeafletMap({ cities }: Props) {
  const maxFee = useMemo(
    () => cities.reduce((max, c) => Math.max(max, c.totalFee), 0),
    [cities],
  );

  // Lazy state so localStorage is read exactly once, before MapContainer
  // mounts. MapContainer's center/zoom are baked in at creation time —
  // changing them later does nothing — so this has to land before first
  // render. The component is client-only (use client + dynamic
  // ssr:false), so window access here is safe.
  const [savedView] = useState<SavedView | null>(() => readSavedView());

  const clusterBounds = useMemo<LatLngBoundsExpression | null>(() => {
    if (cities.length === 0) return null;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    for (const c of cities) {
      if (c.lat < minLat) minLat = c.lat;
      if (c.lat > maxLat) maxLat = c.lat;
      if (c.lng < minLng) minLng = c.lng;
      if (c.lng > maxLng) maxLng = c.lng;
    }
    if (
      maxLat - minLat > CLUSTER_SPAN_DEGREES ||
      maxLng - minLng > CLUSTER_SPAN_DEGREES
    ) {
      return null;
    }
    return [
      [minLat, minLng],
      [maxLat, maxLng],
    ];
  }, [cities]);

  // Saved view wins over cluster auto-fit which wins over the full-US
  // default. Once a user pans/zooms, the moveend handler persists their
  // view and every subsequent load lands them back there.
  const mapProps = savedView
    ? ({
        center: [savedView.lat, savedView.lng] as [number, number],
        zoom: savedView.zoom,
      } as const)
    : clusterBounds
      ? ({
          bounds: clusterBounds,
          boundsOptions: { padding: [80, 80] as [number, number] },
        } as const)
      : ({ center: [39.5, -98.35] as [number, number], zoom: 4 } as const);

  return (
    <MapContainer
      {...mapProps}
      minZoom={3}
      maxZoom={12}
      scrollWheelZoom
      style={{ height: "380px", width: "100%", borderRadius: "0.75rem" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <MapViewPersistor />

      {cities.map((city) => {
        const radius = bubbleRadius(city.totalFee, maxFee);
        const borderColor = STATUS_COLORS[dominantStatus(city.statusMix)];
        const feeLabel =
          city.totalFee > 0 ? formatMoneyShort(city.totalFee) : "—";
        return (
          <CircleMarker
            key={city.key}
            center={[city.lat, city.lng]}
            radius={radius}
            pathOptions={{
              color: borderColor,
              weight: 2,
              fillColor: BRAND_GREEN,
              fillOpacity: 0.85,
            }}
          >
            <Popup>
              <div style={{ minWidth: "140px" }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>
                  {city.city}
                </div>
                <div style={{ fontSize: 12 }}>
                  {feeLabel} · {city.count}{" "}
                  {city.count === 1 ? "placement" : "placements"}
                </div>
              </div>
            </Popup>
            <Tooltip direction="bottom" offset={[0, radius]} opacity={0.9}>
              <span style={{ fontWeight: 600 }}>{city.city}</span>
              {city.totalFee > 0 ? ` · ${feeLabel}` : ""}
            </Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}

// Listens for Leaflet's `moveend` (fires after both pan and zoom) and
// writes the current center + zoom to localStorage so the recruiter's
// last view is restored on the next visit. Rendered as a no-op child
// of MapContainer purely so `useMap()` can grab the map instance.
function MapViewPersistor() {
  const map = useMap();
  useEffect(() => {
    const handler = () => {
      const center = map.getCenter();
      try {
        window.localStorage.setItem(
          VIEW_STORAGE_KEY,
          JSON.stringify({
            lat: center.lat,
            lng: center.lng,
            zoom: map.getZoom(),
          }),
        );
      } catch {
        // localStorage can throw in private-mode Safari or when over
        // quota — best-effort persistence is fine; the map still works.
      }
    };
    map.on("moveend", handler);
    return () => {
      map.off("moveend", handler);
    };
  }, [map]);
  return null;
}
