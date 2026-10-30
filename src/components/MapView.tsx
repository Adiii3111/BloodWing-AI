import L from 'leaflet';
import { useEffect, useRef, useState } from 'react';
import { bearingDeg } from '../engine/geo';
import { siteTotals } from '../engine/inventory';
import { ambulancePosition } from '../engine/sentinel';
import { currentWeather } from '../engine/simulation';
import type { Decision, LatLon, SimState } from '../engine/types';
import { store } from '../lib/store';

const DRONE_SVG = (rot: number, hot: boolean) => `
<svg class="drone-ico" viewBox="0 0 32 32" style="transform:rotate(${rot}deg)">
  <g stroke="${hot ? '#22d3ee' : '#7dd3fc'}" stroke-width="2" fill="none">
    <line x1="8" y1="8" x2="24" y2="24"/><line x1="24" y1="8" x2="8" y2="24"/>
  </g>
  <g fill="#07111f" stroke="#22d3ee" stroke-width="1.6">
    <circle cx="7" cy="7" r="4.5"/><circle cx="25" cy="7" r="4.5"/><circle cx="7" cy="25" r="4.5"/><circle cx="25" cy="25" r="4.5"/>
  </g>
  <rect x="11.5" y="11.5" width="9" height="9" rx="2.5" fill="#e63946"/>
  <path d="M16 13.3v5.4M13.3 16h5.4" stroke="#fff" stroke-width="1.6"/>
  <path d="M16 3l2.5 3.5h-5z" fill="#22d3ee"/>
</svg>`;

const AMB_SVG = `
<svg viewBox="0 0 34 22" width="30" height="20" style="filter:drop-shadow(0 0 6px rgba(230,57,70,.9))">
  <rect x="1" y="5" width="22" height="12" rx="2" fill="#f8fafc"/>
  <path d="M23 8h5l4 5v4h-9z" fill="#f8fafc"/>
  <rect x="24.5" y="9.3" width="3.5" height="3" fill="#0b1626"/>
  <path d="M9 7.5v7M5.5 11h7" stroke="#e63946" stroke-width="2.4"/>
  <rect x="10" y="2" width="4" height="3" rx="1" fill="#e63946"><animate attributeName="opacity" values="1;.2;1" dur=".6s" repeatCount="indefinite"/></rect>
  <circle cx="7" cy="18" r="2.6" fill="#0b1626"/><circle cx="26" cy="18" r="2.6" fill="#0b1626"/>
</svg>`;

export interface MapProps {
  height?: number | string;
  /** Show feasible alternatives for this decision as faint dashed lines. */
  decision?: Decision | null;
  /** Extra polylines to draw (e.g. ORBIT preview). */
  overlays?: { path: LatLon[]; color: string; dashed?: boolean; weight?: number }[];
  showLabels?: boolean;
  fit?: LatLon[];
  compact?: boolean;
}

const CENTER: [number, number] = [42.3505, -71.074];

/** Longwood hospitals sit ~200 m apart — fan their labels out so they never overlap. */
const LABEL_POS: Record<string, string> = {
  BIDMC: 'left:26px;top:-12px',
  BCH: 'right:26px;top:-6px',
  BWH: 'left:26px;top:12px',
};

export function MapView({ height = 560, decision, overlays, showLabels = true, fit, compact }: MapProps) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layers = useRef<{
    sites: Map<string, L.Marker>;
    drones: Map<string, L.Marker>;
    vans: Map<string, L.Marker>;
    routes: Map<string, L.Polyline>;
    ambulances: Map<string, L.Marker>;
    ambRoutes: Map<string, L.Polyline>;
    incidents: Map<string, L.Marker>;
    zones: L.LayerGroup;
    alt: L.LayerGroup;
    overlay: L.LayerGroup;
    stateRef: SimState | null;
    alertKey: string;
  } | null>(null);
  const [fallback, setFallback] = useState(false);

  // ---------------------------------------------------------------- init
  useEffect(() => {
    if (!el.current || mapRef.current) return;
    const map = L.map(el.current, { zoomControl: !compact, attributionControl: true, scrollWheelZoom: false, preferCanvas: false }).setView(CENTER, compact ? 12 : 13);
    mapRef.current = map;
    // Keyless basemaps: Esri dark gray canvas, falling back to inverted OSM, then a schematic grid.
    let errors = 0;
    let fellBack = false;
    const base = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
      maxZoom: 16,
    });
    const labels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, opacity: 0.55 });
    base
      .on('tileerror', () => {
        errors++;
        if (errors > 4 && !fellBack) {
          fellBack = true;
          map.removeLayer(base);
          map.removeLayer(labels);
          let osmErrors = 0;
          L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 18, className: 'osm-dark' })
            .on('tileerror', () => {
              osmErrors++;
              if (osmErrors > 4) setFallback(true);
            })
            .addTo(map);
        }
      })
      .addTo(map);
    labels.addTo(map);
    layers.current = {
      sites: new Map(),
      drones: new Map(),
      vans: new Map(),
      routes: new Map(),
      ambulances: new Map(),
      ambRoutes: new Map(),
      incidents: new Map(),
      zones: L.layerGroup().addTo(map),
      alt: L.layerGroup().addTo(map),
      overlay: L.layerGroup().addTo(map),
      stateRef: null,
      alertKey: '',
    };
    map.on('click', () => map.scrollWheelZoom.enable());
    map.on('mouseout', () => map.scrollWheelZoom.disable());
    const draw = () => frame();
    const unsub = store.subscribeFrame(draw);
    const unsubSlow = store.subscribe(draw);
    frame();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el.current);
    return () => {
      unsub();
      unsubSlow();
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      layers.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------- per-frame update
  function frame() {
    const map = mapRef.current;
    const ly = layers.current;
    if (!map || !ly) return;
    const s = store.state;
    if (ly.stateRef !== s) {
      // New scenario: clear dynamic layers and redraw static ones.
      for (const m of [ly.drones, ly.vans, ly.routes, ly.ambulances, ly.ambRoutes, ly.incidents, ly.sites]) {
        m.forEach((x) => x.remove());
        m.clear();
      }
      ly.zones.clearLayers();
      for (const z of s.config.restrictedZones) {
        L.circle([z.lat, z.lon], { radius: z.radiusKm * 1000, color: '#e63946', weight: 1, opacity: 0.35, fillOpacity: 0.025, dashArray: '4 6' })
          .bindTooltip(`${z.name} — simplified assumption`, { className: 'bw-tip' })
          .addTo(ly.zones);
      }
      ly.stateRef = s;
      ly.alertKey = '';
    }

    // Sites (re-icon only when alert state changes)
    const alerting = new Set(s.requests.filter((r) => r.status === 'queued' || r.status === 'dispatched' || r.status === 'awaiting-auth').map((r) => r.hospitalId));
    for (const inc of s.incidents) if (inc.emsStatus !== 'arrived') alerting.add(inc.hospitalId);
    const key = [...alerting].sort().join(',');
    if (key !== ly.alertKey || ly.sites.size === 0) {
      ly.alertKey = key;
      for (const site of s.sites) {
        const hot = alerting.has(site.id);
        const html =
          site.kind === 'hospital'
            ? `<div style="position:relative"><div class="node-h ${hot ? 'alert' : ''}">H</div>${showLabels ? `<div style="position:absolute;${LABEL_POS[site.id] ?? 'left:28px;top:3px'};white-space:nowrap" class="mono text-[10.5px] ${hot ? 'text-[#ffb3b9]' : 'text-[#cbd5e1]'}" >${site.short}</div>` : ''}</div>`
            : `<div style="position:relative"><div class="node-d"><span>${site.short[0]}</span></div>${showLabels ? `<div style="position:absolute;left:31px;top:5px;white-space:nowrap" class="mono text-[10.5px] text-[#22d3ee]">${site.short.toUpperCase()} DEPOT</div>` : ''}</div>`;
        const icon = L.divIcon({ html, className: '', iconSize: site.kind === 'hospital' ? [22, 22] : [26, 26], iconAnchor: site.kind === 'hospital' ? [11, 11] : [13, 13] });
        let m = ly.sites.get(site.id);
        if (!m) {
          m = L.marker([site.lat, site.lon], { icon, keyboard: true, title: site.name, zIndexOffset: site.kind === 'depot' ? 100 : 200 }).addTo(map);
          m.bindTooltip(() => siteTooltip(site.id), { className: 'bw-tip', direction: 'top', offset: [0, -12] });
          ly.sites.set(site.id, m);
        } else m.setIcon(icon);
      }
    }

    // Routes for active missions
    const activeIds = new Set<string>();
    for (const m of s.missions) {
      if (m.phase === 'complete') continue;
      activeIds.add(m.id);
      if (!ly.routes.has(m.id)) {
        const color = m.kind === 'milkrun' ? '#2dd4bf' : m.mode === 'drone' ? '#22d3ee' : '#3b82f6';
        const pl = L.polyline(
          m.path.map((p) => [p.lat, p.lon] as [number, number]),
          { color, weight: m.kind === 'milkrun' ? 3 : 2.5, opacity: 0.9, className: m.mode === 'drone' ? 'route-drone' : 'route-ground' },
        ).addTo(map);
        pl.bindTooltip(`${m.id} · ${m.kind === 'milkrun' ? 'milk run' : m.mode} · ${m.units} units${m.mode === 'ground' && m.kind === 'request' ? ' · illustrative road path' : m.mode === 'drone' ? ' · straight-line illustration, not an authorised flight path' : ''}`, { className: 'bw-tip', sticky: true });
        ly.routes.set(m.id, pl);
      }
    }
    ly.routes.forEach((pl, id) => {
      if (!activeIds.has(id)) {
        pl.remove();
        ly.routes.delete(id);
      }
    });

    // Drones (only when away from base or busy)
    for (const d of s.drones) {
      const busy = d.status !== 'idle' && d.status !== 'maintenance';
      let mk = ly.drones.get(d.id);
      if (!busy) {
        if (mk) {
          mk.remove();
          ly.drones.delete(d.id);
        }
        continue;
      }
      const mission = s.missions.find((m) => m.id === d.missionId);
      let rot = 0;
      if (mission) {
        const a = d.status === 'returning' ? mission.path[mission.path.length - 1] : mission.path[0];
        const b = d.status === 'returning' ? mission.path[0] : mission.path[mission.path.length - 1];
        rot = bearingDeg(a, b);
      }
      const icon = L.divIcon({ html: DRONE_SVG(rot, d.status === 'outbound'), className: '', iconSize: [26, 26], iconAnchor: [13, 13] });
      if (!mk) {
        mk = L.marker([d.lat, d.lon], { icon, zIndexOffset: 1000 }).addTo(map);
        mk.bindTooltip(() => `<b class="mono">${d.id}</b><br/>${d.status} · battery ${Math.round(d.battery)}%`, { className: 'bw-tip' });
        ly.drones.set(d.id, mk);
      } else {
        mk.setLatLng([d.lat, d.lon]);
        if (Math.round(rot) !== (mk as unknown as { _rot?: number })._rot) {
          mk.setIcon(icon);
          (mk as unknown as { _rot?: number })._rot = Math.round(rot);
        }
      }
    }
    // Ground vehicles
    for (const c of s.couriers) {
      let mk = ly.vans.get(c.id);
      if (c.status === 'idle') {
        if (mk) {
          mk.remove();
          ly.vans.delete(c.id);
        }
        continue;
      }
      if (!mk) {
        const milk = c.missionId?.startsWith('MR-');
        mk = L.marker([c.lat, c.lon], {
          icon: L.divIcon({ html: `<div class="van-ico" style="${milk ? 'background:#2dd4bf;border-color:#ccfbf1;box-shadow:0 0 10px #2dd4bf' : ''}"></div>`, className: '', iconSize: [14, 14], iconAnchor: [7, 7] }),
          zIndexOffset: 900,
        }).addTo(map);
        mk.bindTooltip(() => `<b class="mono">${c.id}</b><br/>${c.status}${c.missionId ? ` · ${c.missionId}` : ''}`, { className: 'bw-tip' });
        ly.vans.set(c.id, mk);
      } else mk.setLatLng([c.lat, c.lon]);
    }

    // SENTINEL incidents + ambulances
    for (const inc of s.incidents) {
      if (!ly.incidents.has(inc.id)) {
        const mk = L.marker([inc.lat, inc.lon], {
          icon: L.divIcon({
            html: `<div style="position:relative;width:18px;height:18px"><div class="node-h alert" style="width:18px;height:18px;border-radius:50%;font-size:10px">!</div></div>`,
            className: '',
            iconSize: [18, 18],
            iconAnchor: [9, 9],
          }),
          zIndexOffset: 800,
        }).addTo(map);
        mk.bindTooltip(`<b>${inc.ref}</b><br/>${inc.label}`, { className: 'bw-tip' });
        ly.incidents.set(inc.id, mk);
        const pl = L.polyline(inc.ambulancePath.map((p) => [p.lat, p.lon] as [number, number]), { color: '#e63946', weight: 2.5, opacity: 0.75, className: 'route-ground' }).addTo(map);
        pl.bindTooltip(`${inc.ref} ambulance · illustrative road path`, { className: 'bw-tip', sticky: true });
        ly.ambRoutes.set(inc.id, pl);
      }
      const pos = ambulancePosition(inc, s.t);
      let amb = ly.ambulances.get(inc.id);
      if (inc.emsStatus === 'alert') {
        amb?.remove();
        ly.ambulances.delete(inc.id);
        continue;
      }
      if (!amb) {
        amb = L.marker([pos.lat, pos.lon], { icon: L.divIcon({ html: AMB_SVG, className: '', iconSize: [30, 20], iconAnchor: [15, 10] }), zIndexOffset: 1100 }).addTo(map);
        amb.bindTooltip(() => `<b>${inc.ref} ambulance</b><br/>EMS: ${inc.emsStatus}`, { className: 'bw-tip' });
        ly.ambulances.set(inc.id, amb);
      } else amb.setLatLng([pos.lat, pos.lon]);
      if (inc.emsStatus === 'arrived') ly.ambRoutes.get(inc.id)?.setStyle({ opacity: 0.2 });
    }
  }

  // ---------------------------------------------------------------- decision alternatives
  useEffect(() => {
    const ly = layers.current;
    if (!ly) return;
    ly.alt.clearLayers();
    if (!decision) return;
    const s = store.state;
    const dest = s.sites.find((x) => x.id === s.requests.find((r) => r.id === decision.requestId)?.hospitalId);
    if (!dest) return;
    for (const o of decision.alternatives.slice(0, 5)) {
      const src = s.sites.find((x) => x.id === o.sourceId)!;
      L.polyline(
        [
          [src.lat, src.lon],
          [dest.lat, dest.lon],
        ],
        { color: o.mode === 'drone' ? '#22d3ee' : '#94a3b8', weight: 1.2, opacity: 0.35, className: 'route-alt' },
      )
        .bindTooltip(`Alternative: ${src.short} by ${o.mode} · ETA ${o.etaMin.toFixed(1)} min`, { className: 'bw-tip', sticky: true })
        .addTo(ly.alt);
    }
  }, [decision]);

  useEffect(() => {
    const ly = layers.current;
    if (!ly) return;
    ly.overlay.clearLayers();
    for (const o of overlays ?? []) {
      L.polyline(o.path.map((p) => [p.lat, p.lon] as [number, number]), { color: o.color, weight: o.weight ?? 3, opacity: 0.85, dashArray: o.dashed ? '6 8' : undefined }).addTo(ly.overlay);
    }
  }, [overlays]);

  useEffect(() => {
    if (fit && fit.length > 1 && mapRef.current) mapRef.current.fitBounds(L.latLngBounds(fit.map((p) => [p.lat, p.lon] as [number, number])), { padding: [60, 60], maxZoom: 14 });
  }, [fit]);

  const w = currentWeather(store.state);
  return (
    <div className={`relative overflow-hidden rounded-[14px] border border-line ${fallback ? 'map-fallback' : ''}`} style={{ height }}>
      <div ref={el} className="map-grid h-full w-full" role="application" aria-label="Simulated Boston blood logistics network map" />
      {!compact && (
        <div className="pointer-events-none absolute bottom-7 left-3 z-[500] flex flex-wrap gap-1.5">
          <span className="chip bg-space/85">
            <span className="inline-block h-2 w-2 rounded-sm border border-med bg-ink" /> Hospital (illustrative)
          </span>
          <span className="chip bg-space/85">
            <span className="inline-block h-2 w-2 rotate-45 bg-signal" /> Fictional depot
          </span>
          <span className="chip bg-space/85 text-signal">— drone</span>
          <span className="chip bg-space/85 text-[#93c5fd]">- - ground</span>
          <span className="chip bg-space/85 text-[#5eead4]">— milk run</span>
        </div>
      )}
      <div className="pointer-events-none absolute right-3 top-3 z-[500] flex flex-col items-end gap-1.5">
        <span className="chip bg-space/85">
          {w ? `wind ${w.windKmh} km/h · vis ${w.visibilityKm} km · ${w.precip}` : 'weather feed missing'} · traffic ×{store.state.config.trafficMultiplier.toFixed(1)}
        </span>
        {fallback && <span className="chip bg-space/85 text-warn">Map tiles unavailable — schematic view</span>}
      </div>
    </div>
  );
}

function siteTooltip(siteId: string): string {
  const s = store.state;
  const site = s.sites.find((x) => x.id === siteId)!;
  const t = siteTotals(s.lots, siteId, s.t);
  const drones = s.drones.filter((d) => d.baseId === siteId);
  const reserved = s.lots.filter((l) => l.siteId === siteId && l.status === 'reserved' && l.units > 0).reduce((a, l) => a + l.units, 0);
  return `<div style="min-width:180px"><b>${site.name}</b><div style="color:#94a3b8;font-size:11px">${site.kind === 'depot' ? 'Fictional simulation depot' : 'Illustrative node — no affiliation implied'}</div>
  <div class="mono" style="margin-top:6px;font-size:11px">RBC ${t.RBC} · PLT ${t.PLT} · FFP ${t.PLASMA}${reserved ? ` · held ${reserved}` : ''}</div>
  ${drones.length ? `<div class="mono" style="font-size:11px;color:#22d3ee">drones ${drones.filter((d) => d.status === 'idle').length}/${drones.length} idle</div>` : ''}
  <div style="font-size:10px;color:#64748b;margin-top:4px">synthetic eligible units</div></div>`;
}
