"use client";
import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// Standard icon for active buses
const blueIcon = L.icon({ 
  iconUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png", 
  shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png", 
  iconSize: [25, 41], 
  iconAnchor: [12, 41] 
});

// Grey icon for buses with lost signals (Ghosts)
const greyIcon = L.icon({ 
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-grey.png", 
  shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png", 
  iconSize: [25, 41], 
  iconAnchor: [12, 41] 
});

function MapController({ selectedBus }) {
  const map = useMap();
  useEffect(() => {
    if (selectedBus?.vehicle?.position) {
      map.flyTo([selectedBus.vehicle.position.latitude, selectedBus.vehicle.position.longitude], 17);
    }
  }, [selectedBus, map]);
  return null;
}

export default function Map({ buses = [], selectedId, routes = {} }) {
  const position = [33.7490, -84.3880];
  const selectedBus = buses.find(b => b.vehicle?.vehicle?.id === selectedId);

  return (
    <MapContainer center={position} zoom={11} style={{ height: "100%", width: "100%" }}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <MapController selectedBus={selectedBus} />
      
      {buses.map((bus) => {
        const vData = bus.vehicle;
        const id = vData?.vehicle?.id;
        if (!id || !vData?.position) return null;

        const busNumber = vData?.vehicle?.label || id;
        
        // --- ROUTE FIX LOGIC ---
        const rId = vData?.trip?.route_id || vData?.trip?.routeId;
        const cleanId = rId ? String(rId).trim() : "";
        
        let fullRouteName = "Special / Yard Move";
        let routeNum = "N/A";

        if (routes && cleanId && routes[cleanId]) {
            fullRouteName = routes[cleanId];
            routeNum = fullRouteName.split(' - ')[0];
        } else if (cleanId) {
            fullRouteName = `Route ${cleanId}`;
            routeNum = cleanId;
        }

        const lastSeenMs = vData?.timestamp * 1000;
        const isStale = (Date.now() - lastSeenMs) > 300000;
        const timeString = new Date(lastSeenMs).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

        return (
          <Marker key={id} position={[vData.position.latitude, vData.position.longitude]} icon={isStale ? greyIcon : blueIcon}>
            {/* Tooltip displays Ghost Bus for grey markers */}
            <Tooltip direction="top" offset={[0, -40]} opacity={1}>
              <span className="font-black text-[10px] text-[#002d72]">
                Bus #{busNumber} | {isStale ? "GHOST BUS" : `Route ${routeNum}`}
              </span>
            </Tooltip>
            
            <Popup>
              <div className="p-2 min-w-[200px] font-sans">
                <div className="flex justify-between items-center border-b border-slate-100 pb-2 mb-2">
                   <p className="font-black text-[#002d72] uppercase italic text-sm">Bus #{busNumber}</p>
                   {/* Badge changes to Ghost Bus or Route Number based on signal status */}
                   <p className={`${isStale ? 'bg-slate-500' : 'bg-[#ef7c00]'} text-white text-[9px] font-black px-2 py-0.5 rounded uppercase`}>
                     {isStale ? "Ghost Bus" : `Route ${routeNum}`}
                   </p>
                </div>
                
                <p className="text-[10px] font-bold text-slate-500 uppercase leading-tight mb-2">
                    {fullRouteName.split(' - ')[1] || fullRouteName}
                </p>
                
                <div className="flex justify-between items-center text-[9px] font-black text-slate-400 border-t pt-2 mt-2">
                    <span>SIGNAL LAST SEEN:</span>
                    <span>{timeString}</span>
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}