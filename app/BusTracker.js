"use client";
import { useEffect, useState, useMemo } from "react";
import Map from "./Map";

export default function BusTracker() {
  const [vehicles, setVehicles] = useState([]);
  const [routes, setRoutes] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("unit");

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [vegRes, routeRes] = await Promise.all([
          fetch("/api/vehicles"),
          fetch("/api/routes")
        ]);
        const vehicleData = await vegRes.json();
        const routeData = await routeRes.json();
        
        setVehicles(prev => {
          // Renamed to 'fleetMap' to avoid conflict with the Map component
          const fleetMap = new window.Map(prev.map(v => [v.id, v]));
          vehicleData.entity?.forEach(v => fleetMap.set(v.id, v));
          return Array.from(fleetMap.values());
        });
        setRoutes(routeData || {});
      } catch (error) {
        console.error("Error loading MARTA data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 15000); 
    return () => clearInterval(interval);
  }, []);

  // Professional Metrics (Persistent from Inventory)
  const stats = useMemo(() => {
    const total = vehicles.length;
    const active = vehicles.filter(v => (Date.now() - (v.vehicle?.timestamp * 1000)) < 300000).length;
    return { total, active, hold: total - active };
  }, [vehicles]);

  // Search & Sorting Logic
  const processedVehicles = useMemo(() => {
    let filtered = vehicles.filter(v => {
      const busNum = (v.vehicle?.vehicle?.label || v.vehicle?.vehicle?.id || "").toLowerCase();
      return busNum.includes(searchTerm.toLowerCase());
    });

    return filtered.sort((a, b) => {
      if (sortBy === "route") {
        const routeA = routes[a.vehicle?.trip?.route_id] || "999";
        const routeB = routes[b.vehicle?.trip?.route_id] || "999";
        return routeA.localeCompare(routeB);
      }
      return (a.vehicle?.vehicle?.label || "").localeCompare(b.vehicle?.vehicle?.label || "");
    });
  }, [vehicles, routes, searchTerm, sortBy]);

  if (loading) return <div className="h-screen flex items-center justify-center bg-[#002d72] text-white font-black italic">FLEET COMMAND INITIALIZING...</div>;

  return (
    <div className="flex flex-col h-screen bg-white text-slate-900">
      {/* PROFESSIONAL METRICS HEADER */}
      <div className="flex items-center justify-between px-6 py-4 bg-[#002d72] text-white shadow-xl z-10">
        <div className="flex gap-10">
          <div><p className="text-[9px] font-bold opacity-50 uppercase tracking-widest">Total Fleet</p><p className="text-xl font-black">{stats.total}</p></div>
          <div><p className="text-[9px] font-bold opacity-50 uppercase tracking-widest text-green-400">Live Active</p><p className="text-xl font-black text-green-400">{stats.active}</p></div>
          <div><p className="text-[9px] font-bold opacity-50 uppercase tracking-widest text-[#ef7c00]">OOS / On Hold</p><p className="text-xl font-black text-[#ef7c00]">{stats.hold}</p></div>
        </div>
        
        <div className="flex items-center gap-3">
          <input 
            type="text" 
            placeholder="Search Unit #..."
            className="bg-white/10 border border-white/20 rounded px-3 py-1.5 text-xs font-bold outline-none placeholder:text-white/40 focus:bg-white/20 transition-all w-40"
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <select 
            onChange={(e) => setSortBy(e.target.value)}
            className="bg-[#002d72] text-[10px] font-black uppercase p-2 rounded border border-white/30 outline-none cursor-pointer"
          >
            <option value="unit">Sort: Unit #</option>
            <option value="route">Sort: Route</option>
          </select>
        </div>
      </div>

      <div className="flex flex-grow overflow-hidden">
        {/* ENHANCED SIDEBAR */}
        <div className="w-80 bg-slate-50 border-r border-slate-200 flex flex-col shadow-inner">
          <div className="flex-grow overflow-y-auto">
            {processedVehicles.map((v) => {
              const vehicle = v.vehicle;
              const busNum = vehicle?.vehicle?.label || vehicle?.vehicle?.id;
              const routeInfo = routes[vehicle?.trip?.route_id] || "Special / Yard Move";
              const lastSeenMs = vehicle?.timestamp * 1000;
              const isStale = (Date.now() - lastSeenMs) > 300000;

              return (
                <button 
                  key={v.id}
                  onClick={() => setSelectedId(vehicle?.vehicle?.id)}
                  className={`w-full p-4 text-left border-b border-slate-100 transition-all flex items-center justify-between group ${selectedId === vehicle?.vehicle?.id ? 'bg-blue-100 border-l-8 border-[#002d72]' : 'hover:bg-white border-l-8 border-transparent'}`}
                >
                  <div>
                    <p className={`font-black text-sm italic tracking-tighter ${isStale ? 'text-slate-400' : 'text-slate-900'}`}>UNIT #{busNum}</p>
                    <p className="text-[10px] font-bold text-[#ef7c00] uppercase truncate w-52 leading-none mt-1">{routeInfo.split(' - ')[1] || routeInfo}</p>
                  </div>
                  <div className={`text-[9px] font-black px-2 py-1 rounded ${isStale ? 'bg-slate-200 text-slate-500' : 'bg-green-100 text-green-700 animate-pulse'}`}>
                    {isStale ? 'OFFLINE' : 'LIVE'}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-grow relative">
          <Map buses={vehicles} selectedId={selectedId} routes={routes} />
        </div>
      </div>
    </div>
  );
}