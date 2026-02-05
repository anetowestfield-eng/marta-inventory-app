"use client";
import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap, Polyline, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// --- ICONS ---
const blueIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

const greyIcon = L.icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-grey.png",
  shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

const redIcon = L.icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
  shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

function MapController({ selectedBus }) {
  const map = useMap();
  useEffect(() => {
    if (selectedBus?.vehicle?.position) {
      map.flyTo(
        [selectedBus.vehicle.position.latitude, selectedBus.vehicle.position.longitude], 
        16, { duration: 1.5 }
      );
    }
  }, [selectedBus, map]);
  return null;
}

export default function Map({ buses = [], selectedId, pinnedIds = [], routes = {} }) {
  const position = [33.7490, -84.3880];
  const selectedBus = Array.isArray(buses) ? buses.find(b => b.vehicle?.vehicle?.id === selectedId) : null;
  
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  return (
    <MapContainer center={position} zoom={11} style={{ height: "100%", width: "100%" }}>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='© OpenStreetMap'
      />
      <MapController selectedBus={selectedBus} />
      
      {Array.isArray(buses) && buses.map((bus) => {
        const vehicle = bus.vehicle?.vehicle;
        const id = vehicle?.id;
        if (!id) return null;

        // --- DECODING LOGIC ---
        // 1. Bus Number
        const busNumber = vehicle?.label || id;
        
        // 2. Route Name (Safe lookup with fallback to prevent "undefined")
        const rawRouteId = bus.vehicle?.trip?.route_id ? String(bus.vehicle.trip.route_id).trim() : "";
        const fullRouteName = (routes && routes[rawRouteId]) 
          ? routes[rawRouteId] 
          : (rawRouteId ? `Route ${rawRouteId}` : "No Route Assigned");
        
        const routeShortNumber = fullRouteName.includes(" - ") ? fullRouteName.split(' - ')[0] : fullRouteName;

        const isSelected = id === selectedId;
        const isPinned = pinnedIds.includes(id); 
        const lat = bus.vehicle?.position?.latitude;
        const lon = bus.vehicle?.position?.longitude;
        
        if (!lat || !lon) return null;

        const miles = bus.distanceToGarage ? bus.distanceToGarage.toFixed(1) : "?";
        const trail = bus.trail && bus.trail.length > 0 ? bus.trail : [[lat, lon]];

        // --- GHOST LOGIC ---
        const lastSeen = bus.vehicle?.timestamp ? bus.vehicle.timestamp * 1000 : Date.now();
        const isStale = (Date.now() - lastSeen) > 300000;
        const timeString = new Date(lastSeen).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

        let currentIcon = blueIcon;
        let trailColor = "#3388ff"; 

        if (isPinned) {
            currentIcon = redIcon;
            trailColor = "red"; 
        } else if (isStale) {
            currentIcon = greyIcon;
            trailColor = "grey";
        }

        return (
          <div key={id}>
            <Polyline 
                positions={trail} 
                pathOptions={{ color: trailColor, weight: 3, opacity: 0.6, dashArray: '5, 10' }} 
            />

            <Marker 
                position={[lat, lon]}
                icon={currentIcon}
                opacity={isSelected ? 1.0 : (isStale && !isPinned ? 0.6 : 0.9)}
                zIndexOffset={isSelected ? 1000 : 0}
            >
                <Tooltip direction="top" offset={[0, -40]}>
                    <span className="font-black text-[#002d72]">#{busNumber} | RT {routeShortNumber}</span>
                </Tooltip>

                <Popup>
                    <div className="font-sans min-w-[150px]">
                        <strong className="text-lg text-[#002d72]">Unit #{busNumber}</strong> 
                        <br />
                        <span className="font-bold text-[#ef7c00]">{fullRouteName}</span>
                        <br />
                        
                        <div style={{fontWeight: "bold", color: "#d9534f", margin: "4px 0"}}>
                            {miles} miles from garage
                        </div>
                        
                        <div className="my-2 border-t pt-2">
                          {isStale ? (
                             <span className="text-[12px] text-gray-400 font-bold uppercase tracking-tighter">
                               👻 GHOST (OFFLINE {timeString})
                             </span>
                          ) : (
                             <span className="text-[12px] text-green-600 font-bold uppercase tracking-tighter flex items-center gap-1">
                               <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                               LIVE ({timeString})
                             </span>
                          )}
                        </div>

                        <div style={{ marginTop: "10px" }}>
                            <a 
                            href={`https://www.google.com/maps/search/?api=1&query=${lat},${lon}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                                display: "block",
                                backgroundColor: "#4285F4",
                                color: "white",
                                textAlign: "center",
                                padding: "8px 10px",
                                borderRadius: "4px",
                                textDecoration: "none",
                                fontSize: "12px",
                                fontWeight: "bold"
                            }}
                            >
                            🚗 Navigate to Unit
                            </a>
                        </div>
                    </div>
                </Popup>
            </Marker>
          </div>
        );
      })}
    </MapContainer>
  );
}