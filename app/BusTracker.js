"use client";
import { useEffect, useState, useMemo } from "react";
import Map from "./Map";

export default function BusTracker() {
  const [vehicles, setVehicles] = useState([]);
  const [routes, setRoutes] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  
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

  const stats = useMemo(() => {
    const total = vehicles.length;
    const active = vehicles.filter(v => (Date.now() - (v.vehicle?.timestamp * 1000)) < 300000).length;
    return { total, active, hold: total - active };
  }, [vehicles]);

  const processedVehicles = useMemo(() => {
    let filtered = vehicles.filter(v => {
      const busNum = (v.vehicle?.vehicle?.label || v.vehicle?.vehicle?.id || "").toLowerCase();
      return busNum.includes(searchTerm.toLowerCase());
    });

    return filtered.sort((a, b) => {
      if (sortBy === "route") {
        const idA = a.vehicle?.trip?.route_id || a.vehicle?.trip?.routeId;
        const idB = b.vehicle?.trip?.route_id || b.vehicle?.trip?.routeId;
        const cleanA = idA ? String(idA).trim() : "";
        const cleanB = idB ? String(idB).trim() : "";
        
        const routeA = (routes && cleanA && routes[cleanA]) ? routes[cleanA] : "zzz";
        const routeB = (routes && cleanB && routes[cleanB]) ? routes[cleanB] : "zzz";
        
        return routeA.localeCompare(routeB);
      }
      return (a.vehicle?.vehicle?.label || "").localeCompare(b.vehicle?.vehicle?.label || "");
    });
  }, [vehicles, routes, searchTerm, sortBy]);

  if (loading) return <div className="h-screen flex items-center justify-center bg-[#002d72] text-white font-black italic">FLEET COMMAND INITIALIZING...</div>;

  return (
    <div className="flex flex-col h-screen bg-white text-slate-900 overflow-hidden">
      {/* FIX: Z-INDEX BOOST (z-[2000]) 
         This ensures the header stays on top of the Leaflet map (which uses z-400 to z-1000)
      */}
      <div className="flex-none flex items-center justify-between px-6 py-4 bg-[#002d72] text-white shadow-xl z-[2000] relative">
        <div className="flex gap-12">
          <div><p className="text-[9px] font-bold opacity-50 uppercase tracking-widest">Total Fleet</p><p className="text-2xl font-black">{stats.total}</p></div>
          <div><p className="text-[9px] font-bold opacity-50 uppercase tracking-widest text-green-400">Live Active</p><p className="text-2xl font-black text-green-400">{stats.active}</p></div>
          <div><p className="text-[9px] font-bold opacity-50 uppercase tracking-widest text-[#ef7c00]">OOS / On Hold</p><p className="text-2xl font-black text-[#ef7c00]">{stats.hold}</p></div>
        </div>
        <div className="text-right">
           <h1 className="text-xl font-black italic tracking-tighter">MARTA FLEET OPS</h1>
           <p className="text-[10px] opacity-60 font-bold uppercase tracking-widest">Live Supervisor View</p>
        </div>
      </div>

      <div className="flex flex-grow overflow-hidden relative z-0">
        {/* SIDEBAR */}
        <div className="w-80 bg-slate-50 border-r border-slate-200 flex flex-col shadow-2xl z-10">
          
          {/* NEW: SIDEBAR CONTROLS HEADER */}
          <div className="p-3 bg-white border-b border-slate-200 flex flex-col gap-2 shadow-sm">
            <input 
              type="text" 
              placeholder="🔍 Search Bus #..."
              value={searchTerm}
              className="w-full bg-slate-100 border border-slate-300 rounded px-3 py-2 text-xs font-bold outline-none focus:bg-white focus:border-[#002d72] transition-colors text-slate-700"
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <div className="flex items-center justify-between">
               <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Sort List By:</span>
               <select 
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="bg-white text-[10px] font-black uppercase py-1 px-2 rounded border border-slate-300 outline-none cursor-pointer hover:border-[#002d72] text-[#002d72]"
               >
                  <option value="unit">Bus Number</option>
                  <option value="route">Route Number</option>
               </select>
            </div>
          </div>

          {/* LIST */}
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
                  className={`w-full p-4 text-left border-b border-slate-100 transition-all flex items-center justify-between group ${selectedId === vehicle?.vehicle?.id ? 'bg-blue-50 border-l-4 border-[#002d72]' : 'hover:bg-white border-l-4 border-transparent'}`}
                >
                  <div>
                    <p className={`font-black text-sm italic tracking-tighter ${isStale ? 'text-slate-400' : 'text-slate-900'}`}>BUS #{busNum}</p>
                    <p className="text-[10px] font-bold text-[#ef7c00] uppercase truncate w-52 leading-none mt-1">{displayRoute}</p>
                  </div>
                  <div className={`text-[9px] font-black px-2 py-1 rounded ${isStale ? 'bg-slate-200 text-slate-500' : 'bg-green-100 text-green-700'}`}>
                    {isStale ? 'OFFLINE' : 'LIVE'}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* MAP AREA */}
        <div className="flex-grow relative z-0">
          <Map buses={vehicles} selectedId={selectedId} routes={routes} />
        </div>
      </div>
    </div>
  );
}