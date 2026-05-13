"use client";

import "leaflet/dist/leaflet.css";
import { useMemo } from "react";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  Tooltip,
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
// which is exactly the case we want to auto-zoom into.
const CLUSTER_SPAN_DEGREES = 2;

type Props = {
  cities: CityAggregate[];
};

export function PlacementsLeafletMap({ cities }: Props) {
  const maxFee = useMemo(
    () => cities.reduce((max, c) => Math.max(max, c.totalFee), 0),
    [cities],
  );

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

  const mapProps = clusterBounds
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
