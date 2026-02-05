"use client";
import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

const blueIcon = L.icon({ iconUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png", shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png", iconSize: [25, 41], iconAnchor: [12, 41] });
const greyIcon = L.icon({ iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-grey.png", shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png", iconSize: [25, 41], iconAnchor: [12, 41] });

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
        const vehicleData = bus.vehicle;
        const id = vehicleData?.vehicle?.id;
        if (!id || !vehicleData?.position) return null;

        const busNumber = vehicleData?.vehicle?.label || id;
        const rawRouteId = vehicleData?.trip?.route_id;
        const fullRouteName = routes[rawRouteId] || "Special / Yard Move";
        const routeNum = fullRouteName.split(' - ')[0];

        const lastSeenMs = vehicleData?.timestamp * 1000;
        const isStale = (Date.now() - lastSeenMs) > 300000;
        const timeString = new Date(lastSeenMs).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

        return (
          <Marker key={id} position={[vehicleData.position.latitude, vehicleData.position.longitude]} icon={isStale ? greyIcon : blueIcon}>
            <Tooltip direction="top" offset={[0, -40]} opacity={1}>
              <span className="font-black text-[10px] text-[#002d72]">#{busNumber} | RT {routeNum}</span>
            </Tooltip>
            <Popup>
              <div className="p-2 min-w-[200px] font-sans">
                <div className="flex justify-between items-center border-b border-slate-100 pb-2 mb-2">
                   <p className="font-black text-[#002d72] uppercase italic text-sm">Unit #{busNumber}</p>
                   <p className="bg-[#ef7c00] text-white text-[9px] font-black px-2 py-0.5 rounded tracking-tighter">ROUTE {routeNum}</p>
                </div>
                
                <p className="text-[10px] font-bold text-slate-500 uppercase leading-tight mb-3">
                    {fullRouteName.split(' - ')[1] || fullRouteName}
                </p>

                <div className="flex items-center justify-between">
                   <div className="flex items-center gap-1.5">
                      <div className={`w-2 h-2 rounded-full ${isStale ? 'bg-slate-300' : 'bg-green-500 animate-pulse'}`}></div>
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">
                        {isStale ? "Last Seen" : "Live Feed"}
                      </span>
                   </div>
                   <span className="text-[10px] font-bold text-slate-800">{timeString}</span>
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}