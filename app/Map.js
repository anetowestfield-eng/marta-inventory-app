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
        15, { duration: 2 }
      );
    }
  }, [selectedBus, map]);
  return null;
}

export default function Map({ buses = [], selectedId, pinnedIds = [], routes = {} }) {
  const position = [33.7490, -84.3880];
  const selectedBus = buses?.find(b => b.vehicle?.vehicle?.id === selectedId);
  
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
      
      {buses.map((bus) => {
        const vehicleData = bus.vehicle;
        const vehicle = vehicleData?.vehicle;
        const id = vehicle?.id;
        if (!id) return null;

        // --- PROPER DECODING (FIXED LOOKUP) ---
        // Checks both route_id and routeId to prevent 'undefined'
        const rawRouteId = vehicleData?.trip?.route_id || vehicleData?.trip?.routeId;
        const cleanId = rawRouteId ? String(rawRouteId).trim() : "";
        
        const fullRouteName = (routes && routes[cleanId]) 
          ? routes[cleanId] 
          : (cleanId ? `ID: ${cleanId}` : "No Route Assigned");
        
        const routeShortNumber = fullRouteName.includes(" - ") ? fullRouteName.split(' - ')[0] : fullRouteName;
        const busNumber = vehicle?.label || id;

        const isSelected = id === selectedId;
        const isPinned = pinnedIds.includes(id); 
        const lat = vehicleData.position?.latitude;
        const lon = vehicleData.position?.longitude;
        
        if (!lat || !lon) return null;

        // MARTA sends seconds; JS needs milliseconds
        const lastUpdated = vehicleData?.timestamp ? vehicleData.timestamp * 1000 : Date.now();
        const isStale = (Date.now() - lastUpdated) > 300000;
        const timeString = new Date(lastUpdated).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

        return (
          <div key={id}>
            <Marker 
                position={[lat, lon]}
                icon={isStale ? greyIcon : (isPinned ? redIcon : blueIcon)}
            >
                <Tooltip direction="top" offset={[0, -40]}>
                    <span className="font-black text-[#002d72]">#{busNumber} | RT {routeShortNumber}</span>
                </Tooltip>

                <Popup>
                    <div className="font-sans">
                        <strong className="text-lg text-[#002d72]">Unit #{busNumber}</strong><br/>
                        <span className="font-bold text-[#ef7c00]">{fullRouteName}</span>
                        <div className="mt-2 border-t pt-2 text-[10px] text-gray-500 font-bold uppercase">
                           {isStale ? `👻 OFFLINE (${timeString})` : `🟢 LIVE (${timeString})`}
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