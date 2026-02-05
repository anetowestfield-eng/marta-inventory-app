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
        // Fetch both live buses and the local routes.json
        const [vegRes, routeRes] = await Promise.all([
          fetch("/api/vehicles"),
          fetch("/api/routes")
        ]);
        
        const vehicleData = await vegRes.json();
        const routeData = await routeRes.json();
        
        if (vehicleData.entity) {
          setVehicles(vehicleData.entity);
        }
        setRoutes(routeData || {});
      } catch (error) {
        console.error("Error loading MARTA data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return (
    <div className="h-full flex items-center justify-center bg-slate-900">
      <p className="text-[#ef7c00] font-black italic animate-pulse uppercase tracking-widest">
        Syncing MARTA Fleet...
      </p>
    </div>
  );

  return (
    <div className="flex h-screen bg-white overflow-hidden text-slate-900">
      {/* SIDEBAR */}
      <div className="w-64 bg-slate-50 border-r border-slate-200 flex flex-col">
        <div className="p-4 bg-[#002d72] text-white">
          <h2 className="text-[10px] font-black uppercase tracking-widest">Active Units ({vehicles.length})</h2>
        </div>
        <div className="flex-grow overflow-y-auto divide-y divide-slate-100">
          {vehicles.map((v) => {
            const busNum = v.vehicle?.vehicle?.label || v.vehicle?.vehicle?.id;
            const id = v.vehicle?.vehicle?.id;
            return (
              <button 
                key={id}
                onClick={() => setSelectedId(id)}
                className={`w-full p-3 text-left transition-colors hover:bg-white ${selectedId === id ? 'bg-blue-100 border-l-4 border-[#002d72]' : ''}`}
              >
                <span className="font-black text-slate-700 text-sm italic">#{busNum}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-grow relative">
        <Map buses={vehicles} selectedId={selectedId} routes={routes} />
      </div>
    </div>
  );
}