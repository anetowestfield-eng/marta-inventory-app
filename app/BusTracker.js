"use client";
import { useEffect, useState } from "react";
import Map from "./Map";

export default function BusTracker() {
  const [vehicles, setVehicles] = useState([]);
  const [routes, setRoutes] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [vegRes, routeRes] = await Promise.all([
          fetch("/api/vehicles"),
          fetch("/api/routes")
        ]);
        
        const vehicleData = await vegRes.json();
        const routeData = await routeRes.json();
        
        // MARTA realtime uses 'entity' for the bus list
        setVehicles(vehicleData?.entity || []);
        // Set the dictionary from your routes.json
        setRoutes(routeData || {}); 
      } catch (error) {
        console.error("Error loading MARTA data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 10000); // Refresh every 10 seconds
    return () => clearInterval(interval);
  }, []);

  if (loading) return (
    <div className="h-full flex items-center justify-center bg-slate-900">
      <div className="text-center">
        <p className="text-[#ef7c00] font-black italic animate-pulse uppercase tracking-widest">
          Syncing MARTA Fleet...
        </p>
      </div>
    </div>
  );

  return (
    <div className="flex h-full bg-white overflow-hidden">
      {/* SIDEBAR */}
      <div className="w-64 bg-slate-50 border-r border-slate-200 flex flex-col">
        <div className="p-4 bg-[#002d72] text-white flex justify-between items-center">
          <h2 className="text-[10px] font-black uppercase tracking-widest">Active Units ({vehicles.length})</h2>
          <button 
            onClick={() => window.location.reload()} 
            className="text-[9px] bg-white/10 px-2 py-1 rounded hover:bg-white/20"
          >
            REFRESH
          </button>
        </div>
        <div className="flex-grow overflow-y-auto divide-y divide-slate-100">
          {vehicles.map((v) => {
            const busNum = v.vehicle?.vehicle?.label || v.vehicle?.vehicle?.id;
            const isSelected = selectedId === v.vehicle?.vehicle?.id;
            return (
              <button 
                key={v.id}
                onClick={() => setSelectedId(v.vehicle?.vehicle?.id)}
                className={`w-full p-3 text-left transition-colors hover:bg-white group ${isSelected ? 'bg-blue-100 border-l-4 border-[#002d72]' : ''}`}
              >
                <div className="flex justify-between items-center">
                  <span className="font-black text-slate-700 text-sm italic">#{busNum}</span>
                  <span className="text-[8px] font-bold text-slate-400 group-hover:text-[#ef7c00]">VIEW</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* MAIN MAP AREA */}
      <div className="flex-grow relative">
        <Map buses={vehicles} selectedId={selectedId} routes={routes} />
      </div>
    </div>
  );
}