"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useMemo } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Tooltip,
} from "react-leaflet";

import {
  BREAKPOINT_HQ,
  STATUS_COLORS,
  bubbleRadius,
  dominantStatus,
  formatMoneyShort,
  type CityAggregate,
} from "@/lib/placements-map-geo";

// Leaflet ships its default marker icons as relative paths it resolves
// at runtime. webpack/Next.js rewrite asset URLs, so the bundled icons
// can't find their PNGs — point Leaflet at the CDN copies instead.
// Doing this at module-import time means every Marker rendered on this
// page picks up the corrected URLs without per-instance configuration.
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })
  ._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const BRAND_GREEN = "#5A9642";

// Inline SVG diamond used as the HQ marker. Kept small + muted so it
// reads as "home base" without competing with the placement bubbles.
const HQ_ICON = L.divIcon({
  className: "",
  iconSize: [10, 10],
  iconAnchor: [5, 5],
  html: `<div style="
    width: 10px;
    height: 10px;
    background: #6B7280;
    border: 1px solid white;
    transform: rotate(45deg);
    box-shadow: 0 0 0 1px rgba(0,0,0,0.1);
  "></div>`,
});

type Props = {
  cities: CityAggregate[];
};

export function PlacementsLeafletMap({ cities }: Props) {
  const maxFee = useMemo(
    () => cities.reduce((max, c) => Math.max(max, c.totalFee), 0),
    [cities],
  );

  return (
    <MapContainer
      center={[39.5, -98.35]}
      zoom={4}
      minZoom={3}
      maxZoom={12}
      scrollWheelZoom
      style={{ height: "440px", width: "100%", borderRadius: "0.75rem" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <Marker
        position={[BREAKPOINT_HQ.lat, BREAKPOINT_HQ.lng]}
        icon={HQ_ICON}
        interactive={false}
        keyboard={false}
      >
        <Tooltip
          permanent
          direction="right"
          offset={[8, 0]}
          opacity={0.9}
          className="bp-hq-tooltip"
        >
          BreakPoint HQ · Solon, OH
        </Tooltip>
      </Marker>

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
