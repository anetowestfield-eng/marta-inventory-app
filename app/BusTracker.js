"use client";
import { useEffect, useState, useMemo } from "react";
import Map from "./Map";

export default function BusTracker() {
  const [vehicles, setVehicles] = useState([]);
  const [routes, setRoutes] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  
  // --- RESTORED CONTROLS STATE ---
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("unit"); // 'unit' or 'route'

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
          // fleetMap stores unique buses to keep maintenance "Ghosts" visible
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

  // Metrics Logic
  const stats = useMemo(() => {
    const total = vehicles.length;
    const active = vehicles.filter(v => (Date.now() - (v.vehicle?.timestamp * 1000)) < 300000).length;
    return { total, active, hold: total - active };
  }, [vehicles]);

  // --- SEARCH & SORT LOGIC ---
  const processedVehicles = useMemo(() => {
    // 1. Filter by Search Term
    let filtered = vehicles.filter(v => {
      const busNum = (v.vehicle?.vehicle?.label || v.vehicle?.vehicle?.id || "").toLowerCase();
      return busNum.includes(searchTerm.toLowerCase());
    });

    // 2. Sort Logic
    return filtered.sort((a, b) => {
      if (sortBy === "route") {
        // Get clean Route IDs
        const idA = a.vehicle?.trip?.route_id || a.vehicle?.trip?.routeId;
        const idB = b.vehicle?.trip?.route_id || b.vehicle?.trip?.routeId;
        const cleanA = idA ? String(idA).trim() : "";
        const cleanB = idB ? String(idB).trim() : "";
        
        // Get Route Names (or use "999" to push unknown routes to the bottom)
        const routeA = (routes && cleanA && routes[cleanA]) ? routes[cleanA] : "zzz";
        const routeB = (routes && cleanB && routes[cleanB]) ? routes[cleanB] : "zzz";
        
        return routeA.localeCompare(routeB);
      }
      // Default: Sort by Bus Number
      return (a.vehicle?.vehicle?.label || "").localeCompare(b.vehicle?.vehicle?.label || "");
    });
  }, [vehicles, routes, searchTerm, sortBy]);

  if (loading) return <div className="h-screen flex items-center justify-center bg-[#002d72] text-white font-black italic">FLEET COMMAND INITIALIZING...</div>;

  return (
    <div className="flex flex-col h-screen bg-white text-slate-900">
      {/* HEADER WITH METRICS & CONTROLS */}
      <div className="flex items-center justify-between px-6 py-4 bg-[#002d72] text-white shadow-xl z-10">
        <div className="flex gap-10">
          <div><p className="text-[9px] font-bold opacity-50 uppercase tracking-widest">Total Fleet</p><p className="text-xl font-black">{stats.total}</p></div>
          <div><p className="text-[9px] font-bold opacity-50 uppercase tracking-widest text-green-400">Live Active</p><p className="text-xl font-black text-green-400">{stats.active}</p></div>
          <div><p className="text-[9px] font-bold opacity-50 uppercase tracking-widest text-[#ef7c00]">OOS / On Hold</p><p className="text-xl font-black text-[#ef7c00]">{stats.hold}</p></div>
        </div>
        
        {/* --- RESTORED SEARCH & SORT BAR --- */}
        <div className="flex items-center gap-3">
          <input 
            type="text" 
            placeholder="Search Bus #..."
            value={searchTerm}
            className="bg-white/10 border border-white/20 rounded px-3 py-1.5 text-xs font-bold outline-none placeholder:text-white/40 focus:bg-white/20 transition-all w-40 text-white"
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <select 
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="bg-[#002d72] text-[10px] font-black uppercase p-2 rounded border border-white/30 outline-none cursor-pointer hover:bg-white/10 transition-colors"
          >
            <option value="unit">Sort: Bus #</option>
            <option value="route">Sort: Route</option>
          </select>
        </div>
      </div>

      <div className="flex flex-grow overflow-hidden">
        {/* SIDEBAR LIST */}
        <div className="w-80 bg-slate-50 border-r border-slate-200 flex flex-col shadow-inner">
          <div className="flex-grow overflow-y-auto">
            {processedVehicles.map((v) => {
              const vehicle = v.vehicle;
              const busNum = vehicle?.vehicle?.label || vehicle?.vehicle?.id;
              
              const rId = vehicle?.trip?.route_id || vehicle?.trip?.routeId;
              const cleanId = rId ? String(rId).trim() : "";
              
              let displayRoute = "Special / Yard Move";
              if (routes && cleanId && routes[cleanId]) {
                 const name = routes[cleanId];
                 displayRoute = name.split(' - ')[1] || name; 
              } else if (cleanId) {
                 displayRoute = `Route ${cleanId}`;
              }

              const lastSeenMs = vehicle?.timestamp * 1000;
              const isStale = (Date.now() - lastSeenMs) > 300000;

              return (
                <button 
                  key={v.id}
                  onClick={() => setSelectedId(vehicle?.vehicle?.id)}
                  className={`w-full p-4 text-left border-b border-slate-100 transition-all flex items-center justify-between group ${selectedId === vehicle?.vehicle?.id ? 'bg-blue-100 border-l-8 border-[#002d72]' : 'hover:bg-white border-l-8 border-transparent'}`}
                >
                  <div>
                    <p className={`font-black text-sm italic tracking-tighter ${isStale ? 'text-slate-400' : 'text-slate-900'}`}>BUS #{busNum}</p>
                    <p className="text-[10px] font-bold text-[#ef7c00] uppercase truncate w-52 leading-none mt-1">{displayRoute}</p>
                  </div>
                  <div className={`text-[9px] font-black px-2 py-1 rounded ${isStale ? 'bg-slate-200 text-slate-500' : 'bg-green-100 text-green-700 animate-pulse'}`}>
                    {isStale ? 'OFFLINE' : 'LIVE'}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* MAP AREA */}
        <div className="flex-grow relative">
          <Map buses={vehicles} selectedId={selectedId} routes={routes} />
        </div>
      </div>
    </div>
  );
}