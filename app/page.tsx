"use client";
import React, { useState, useEffect, useMemo } from 'react';
import { db, auth } from './firebaseConfig'; 
import { collection, query, onSnapshot, orderBy, doc, serverTimestamp, setDoc, writeBatch, getDocs, getDoc, addDoc, deleteDoc, limit, updateDoc, increment } from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import dynamic from 'next/dynamic';

// Import your local data file from the same 'app' folder
import localParts from './partsData.json';

const BusTracker = dynamic(() => import('./BusTracker'), { 
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-[85vh] bg-slate-900 rounded-2xl border border-slate-700">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-[#002d72] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-[#ef7c00] font-black uppercase tracking-widest text-xs">Initializing Fleet Sync...</p>
      </div>
    </div>
  )
});

// --- COMPONENT: TOAST NOTIFICATION ---
const Toast = ({ message, type, onClose }: { message: string, type: 'success' | 'error', onClose: () => void }) => {
    useEffect(() => {
        const timer = setTimeout(onClose, 3000);
        return () => clearTimeout(timer);
    }, [onClose]);

    return (
        <div className={`fixed bottom-6 right-6 z-[3000] px-6 py-4 rounded-xl shadow-2xl flex items-center gap-4 animate-in slide-in-from-right-10 duration-300 border-l-8 ${type === 'success' ? 'bg-white border-green-500 text-slate-800' : 'bg-white border-red-500 text-slate-800'}`}>
            <span className="text-2xl">{type === 'success' ? '✅' : '⛔'}</span>
            <div>
                <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">{type === 'success' ? 'Success' : 'Error'}</p>
                <p className="text-sm font-bold text-slate-800">{message}</p>
            </div>
        </div>
    );
};

// --- HELPERS ---
const formatTime = (timestamp: any) => {
    if (!timestamp) return 'Just now';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
};

const logHistory = async (busNumber: string, action: string, details: string, userEmail: string) => {
    if (!busNumber) return;
    try {
        await addDoc(collection(db, "buses", busNumber, "history"), {
            action, details, user: userEmail, timestamp: serverTimestamp()
        });
    } catch (err) { console.error("History log failed", err); }
};

const getBusSpecs = (num: string) => {
    const n = parseInt(num);
    const thirtyFt = [1951, 1958, 1959];
    const thirtyFiveFt = [1887, 1888, 1889, 1895, 1909, 1912, 1913, 1921, 1922, 1923, 1924, 1925, 1926, 1927, 1928, 1929, 1930, 1931, 1932, 1933, 1935, 2326, 2343];
    if (thirtyFt.includes(n)) return { length: "30'", type: "S" };
    if (thirtyFiveFt.includes(n)) return { length: "35'", type: "M" };
    return { length: "40'", type: "L" };
};

const calculateDaysOOS = (start: string, end: string) => {
    if (!start) return 0;
    const s = new Date(start);
    const e = end ? new Date(end) : new Date();
    return Math.max(0, Math.ceil((e.getTime() - s.getTime()) / (1000 * 3600 * 24)));
};

// --- COMPONENT: READ-ONLY LOCAL PARTS LIST (OPTIMIZED) ---
const PartsInventory = () => {
    const [searchTerm, setSearchTerm] = useState('');
    const [displayLimit, setDisplayLimit] = useState(100);

    const filteredParts = useMemo(() => {
        if (!searchTerm) return localParts;
        const lowerSearch = searchTerm.toLowerCase();
        return localParts.filter((p: any) => 
            (p.partNumber && String(p.partNumber).toLowerCase().includes(lowerSearch)) || 
            (p.name && String(p.name).toLowerCase().includes(lowerSearch))
        );
    }, [searchTerm]);

    const visibleParts = filteredParts.slice(0, displayLimit);

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col">
            <div className="flex justify-between items-end mb-6 px-2">
                <div>
                    <h2 className="text-3xl font-black text-[#002d72] italic uppercase tracking-tighter">Parts Registry</h2>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">High-Speed Local Search ({localParts.length.toLocaleString()} Items)</p>
                </div>
                <div className="w-full max-w-md relative">
                    <input 
                        type="text" 
                        placeholder="Search Part # or Description..." 
                        className="w-full p-4 pl-12 bg-white border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-[#002d72] transition-all shadow-sm" 
                        value={searchTerm} 
                        onChange={e => { setSearchTerm(e.target.value); setDisplayLimit(100); }} 
                    />
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl">🔍</span>
                </div>
            </div>

            <div className="bg-white rounded-3xl shadow-xl border border-slate-100 flex-grow overflow-hidden flex flex-col">
                <div className="bg-[#002d72] grid grid-cols-12 gap-4 p-5 text-[10px] font-black uppercase text-white tracking-widest">
                    <div className="col-span-3">Part Number</div>
                    <div className="col-span-9">Description</div>
                </div>

                <div className="overflow-y-auto flex-grow bg-slate-50/30 custom-scrollbar">
                    {visibleParts.length === 0 ? <div className="p-20 text-center text-slate-300 italic font-bold">No results found.</div> : (
                        <div className="divide-y divide-slate-100">
                            {visibleParts.map((p: any, i: number) => (
                                <div key={i} className="grid grid-cols-12 gap-4 p-4 hover:bg-white transition-all cursor-default group">
                                    <div className="col-span-3 font-mono font-black text-[#002d72] bg-blue-50 w-fit px-3 py-1 rounded-lg group-hover:bg-[#ef7c00] group-hover:text-white transition-colors">
                                        {p.partNumber}
                                    </div>
                                    <div className="col-span-9 font-bold text-slate-600 uppercase text-[11px] flex items-center leading-tight">
                                        {p.name}
                                    </div>
                                </div>
                            ))}
                            {filteredParts.length > displayLimit && (
                                <button 
                                    onClick={() => setDisplayLimit(prev => prev + 200)} 
                                    className="w-full p-8 text-xs font-black text-[#002d72] uppercase tracking-widest hover:bg-white hover:text-[#ef7c00] transition-all italic underline"
                                >
                                    Load More Results...
                                </button>
                            )}
                        </div>
                    )}
                </div>
                <div className="bg-white border-t border-slate-100 p-4 flex justify-between items-center px-8">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total Reference: {localParts.length.toLocaleString()}</p>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest text-[#ef7c00]">Matches: {filteredParts.length.toLocaleString()}</p>
                </div>
            </div>
        </div>
    );
};

// --- COMPONENT: STATUS CHARTS ---
const StatusCharts = ({ buses }: { buses: any[] }) => {
    const statusCounts: {[key: string]: number} = { 'Active': 0, 'In Shop': 0, 'Engine': 0, 'Body Shop': 0, 'Vendor': 0, 'Brakes': 0, 'Safety': 0 };
    buses.forEach(b => { if (statusCounts[b.status] !== undefined) statusCounts[b.status]++; });
    const maxCount = Math.max(...Object.values(statusCounts), 1);

    const trendData = [...Array(7)].map((_, i) => {
        const d = new Date(); d.setDate(d.getDate() - (6 - i));
        const ds = d.toISOString().split('T')[0];
        return { label: ds.slice(5), count: buses.filter(b => b.oosStartDate === ds).length };
    });

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                <h3 className="text-[10px] font-black text-[#002d72] uppercase tracking-widest mb-6">Current Fleet Status</h3>
                <div className="flex items-end gap-3 h-40">
                    {Object.entries(statusCounts).map(([s, c]) => (
                        <div key={s} className="flex-1 flex flex-col justify-end items-center group relative">
                            <div className="absolute -top-6 text-[10px] font-bold text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity">{c}</div>
                            <div className={`w-full rounded-t-md transition-all duration-500 ${s==='Active'?'bg-green-500':s==='In Shop'?'bg-[#ef7c00]':'bg-red-500'}`} style={{ height: `${(c/maxCount)*100 || 2}%` }}></div>
                            <p className="text-[8px] font-black text-slate-400 uppercase mt-2 -rotate-45 origin-left translate-y-2 whitespace-nowrap">{s}</p>
                        </div>
                    ))}
                </div>
            </div>
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                <h3 className="text-[10px] font-black text-[#002d72] uppercase tracking-widest mb-6">7-Day Fail Trend</h3>
                <div className="flex items-end gap-2 h-40 border-l border-b border-slate-100">
                    {trendData.map((d, i) => (
                        <div key={i} className="flex-1 flex flex-col justify-end items-center group relative">
                            <div className="absolute -top-6 text-[10px] font-bold text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity">{d.count}</div>
                            <div className="w-full bg-blue-100 hover:bg-[#002d72] rounded-t-sm transition-all" style={{ height: `${(d.count/Math.max(...trendData.map(t=>t.count),1))*100 || 2}%` }}></div>
                            <p className="text-[8px] font-bold text-slate-300 mt-2">{d.label}</p>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

// --- COMPONENT: SHIFT HANDOVER ---
const ShiftHandover = ({ buses, showToast }: { buses: any[], showToast: (m:string, t:'success'|'error')=>void }) => {
    const [report, setReport] = useState<any[]>([]);
    useEffect(() => {
        const fetchRecent = async () => {
            const twelveHoursAgo = Date.now() - (12 * 60 * 60 * 1000);
            let logs: any[] = [];
            for (const b of buses.filter(x => x.status !== 'Active' || x.notes).slice(0,30)) {
                const hSnap = await getDocs(query(collection(db, "buses", b.number, "history"), orderBy("timestamp", "desc"), limit(2)));
                hSnap.forEach(d => { if((d.data().timestamp?.toMillis() || 0) > twelveHoursAgo) logs.push({ bus: b.number, ...d.data() }); });
            }
            setReport(logs.sort((a,b) => (b.timestamp?.toMillis() || 0) - (a.timestamp?.toMillis() || 0)));
        };
        if(buses.length > 0) fetchRecent();
    }, [buses]);

    const copyReport = () => {
        const text = report.map(r => `[Unit ${r.bus}] ${r.action}: ${r.details}`).join('\n');
        navigator.clipboard.writeText(`SHIFT REPORT - ${new Date().toLocaleDateString()}\n\n${text}`);
        showToast("Report copied to clipboard!", 'success');
    };

    return (
        <div className="max-w-4xl mx-auto p-8 animate-in fade-in slide-in-from-bottom-4">
            <div className="flex justify-between items-center mb-8">
                <h2 className="text-3xl font-black text-[#002d72] uppercase italic">Shift Handover</h2>
                <button onClick={copyReport} className="px-6 py-3 bg-[#002d72] text-white rounded-xl font-black uppercase text-xs shadow-lg hover:bg-[#ef7c00] transition-all">Copy Report</button>
            </div>
            <div className="space-y-4">
                {report.map((l, i) => (
                    <div key={i} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex gap-6 items-center">
                        <div className="w-16 h-16 bg-[#002d72]/5 rounded-xl flex items-center justify-center font-black text-[#002d72] text-lg">#{l.bus}</div>
                        <div className="flex-grow">
                            <div className="flex justify-between mb-1"><span className="text-[10px] font-black text-[#ef7c00] uppercase">{l.action}</span><span className="text-[10px] font-bold text-slate-400">{formatTime(l.timestamp)}</span></div>
                            <p className="text-sm font-bold text-slate-700 whitespace-pre-wrap">{l.details}</p>
                            <p className="text-[9px] text-slate-400 mt-2 uppercase tracking-widest">{l.user}</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- COMPONENT: BUS DETAIL POPUP ---
const BusDetailView = ({ bus, onClose, showToast }: { bus: any; onClose: () => void; showToast: (m:string, t:'success'|'error')=>void }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [historyLogs, setHistoryLogs] = useState<any[]>([]); 
    const [editData, setEditData] = useState({ status: bus.status || 'Active', location: bus.location || '', notes: bus.notes || '', oosStartDate: bus.oosStartDate || '', expectedReturnDate: bus.expectedReturnDate || '', actualReturnDate: bus.actualReturnDate || '' });

    useEffect(() => {
        if (showHistory) {
            return onSnapshot(query(collection(db, "buses", bus.number, "history"), orderBy("timestamp", "desc")), (snap) => {
                setHistoryLogs(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            });
        }
    }, [showHistory, bus.number]);

    const handleSave = async () => {
        try {
            const busRef = doc(db, "buses", bus.number);
            const currentSnap = await getDoc(busRef);
            const old = currentSnap.data() || {};
            let changes = [];
            if (old.status !== editData.status) changes.push(`STATUS: ${old.status} ➝ ${editData.status}`);
            if (old.notes !== editData.notes) changes.push(`NOTES CHANGED:\nFROM: "${old.notes || ''}"\nTO: "${editData.notes}"`);
            if (old.location !== editData.location) changes.push(`LOC: ${old.location || '—'} ➝ ${editData.location}`);
            
            await setDoc(busRef, { ...editData, timestamp: serverTimestamp() }, { merge: true });
            if (changes.length > 0) await logHistory(bus.number, "EDIT", changes.join('\n\n'), auth.currentUser?.email || 'Unknown');
            showToast(`Bus #${bus.number} updated`, 'success');
            setIsEditing(false);
        } catch (err) { showToast("Save failed", 'error'); }
    };

    if (showHistory) return (
        <div className="bg-white p-6 rounded-xl shadow-2xl w-full max-w-lg h-[600px] flex flex-col animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-4 border-b pb-4 font-black text-[#002d72] uppercase"><span>History: #{bus.number}</span><button onClick={()=>setShowHistory(false)} className="text-xs text-slate-400">Back</button></div>
            <div className="flex-grow overflow-y-auto space-y-3">
                {historyLogs.map(l => (
                    <div key={l.id} className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                        <div className="flex justify-between text-[8px] font-black uppercase text-slate-400 mb-1"><span>{l.action}</span><span>{formatTime(l.timestamp)}</span></div>
                        <p className="text-xs font-bold text-slate-700 whitespace-pre-wrap leading-tight">{l.details}</p>
                        <p className="text-[8px] text-slate-400 italic mt-1 text-right">{l.user}</p>
                    </div>
                ))}
            </div>
        </div>
    );

    if (isEditing) return (
        <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-2xl animate-in zoom-in-95">
            <h3 className="text-2xl font-black text-[#002d72] mb-6 uppercase italic">Edit Bus #{bus.number}</h3>
            <div className="grid grid-cols-2 gap-4 mb-4">
                <select className="p-3 bg-slate-50 border-2 rounded-lg font-bold" value={editData.status} onChange={e=>setEditData({...editData, status:e.target.value})}><option value="Active">Ready</option><option value="On Hold">Maintenance Hold</option><option value="In Shop">In Shop</option><option value="Engine">Engine</option><option value="Body Shop">Body Shop</option><option value="Vendor">Vendor</option><option value="Brakes">Brakes</option><option value="Safety">Safety</option></select>
                <input className="p-3 bg-slate-50 border-2 rounded-lg font-bold" value={editData.location} onChange={e=>setEditData({...editData, location:e.target.value})} placeholder="Location" />
            </div>
            <textarea className="w-full p-3 bg-slate-50 border-2 rounded-lg h-24 mb-4 font-bold" value={editData.notes} onChange={e=>setEditData({...editData, notes:e.target.value})} placeholder="Maintenance Notes" />
            <div className="grid grid-cols-3 gap-4 mb-6 text-[9px] font-black uppercase text-slate-400">
                <div>OOS Date<input type="date" className="w-full p-2 border rounded mt-1 font-bold text-slate-900" value={editData.oosStartDate} onChange={e=>setEditData({...editData, oosStartDate:e.target.value})} /></div>
                <div>Exp Return<input type="date" className="w-full p-2 border rounded mt-1 font-bold text-slate-900" value={editData.expectedReturnDate} onChange={e=>setEditData({...editData, expectedReturnDate:e.target.value})} /></div>
                <div>Act Return<input type="date" className="w-full p-2 border rounded mt-1 font-bold text-slate-900" value={editData.actualReturnDate} onChange={e=>setEditData({...editData, actualReturnDate:e.target.value})} /></div>
            </div>
            <div className="flex gap-4">
                <button onClick={()=>setIsEditing(false)} className="w-1/2 py-3 bg-slate-100 rounded-xl font-black uppercase text-xs">Cancel</button>
                <button onClick={handleSave} className="w-1/2 py-3 bg-[#002d72] text-white rounded-xl font-black uppercase text-xs shadow-lg">Save Changes</button>
            </div>
        </div>
    );

    return (
        <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-2xl animate-in zoom-in-95">
            <div className="flex justify-between items-start mb-6 border-b pb-4">
                <div><h3 className="text-4xl font-black text-[#002d72] italic uppercase">Bus #{bus.number}</h3><span className={`inline-block mt-2 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${bus.status==='Active'?'bg-green-100 text-green-700':'bg-red-100 text-red-700'}`}>{bus.status}</span></div>
                <button onClick={onClose} className="text-slate-400 text-2xl font-bold hover:text-slate-600 transition-colors">✕</button>
            </div>
            <div className="bg-slate-50 p-4 rounded-xl mb-6"><p className="text-[10px] font-black uppercase text-slate-400 mb-2">Fault Details</p><p className="text-lg font-medium text-slate-800">{bus.notes || "No active faults."}</p></div>
            <div className="grid grid-cols-3 gap-4 mb-6">
                <div><p className="text-[9px] font-black uppercase text-slate-400">OOS Date</p><p className="text-xl font-black text-[#002d72]">{bus.oosStartDate || '--'}</p></div>
                <div><p className="text-[9px] font-black uppercase text-slate-400">Exp Return</p><p className="text-xl font-black text-[#ef7c00]">{bus.expectedReturnDate || '--'}</p></div>
                <div><p className="text-[9px] font-black uppercase text-slate-400">Act Return</p><p className="text-xl font-black text-green-600">{bus.actualReturnDate || '--'}</p></div>
            </div>
            <div className="flex justify-between pt-6 border-t">
                <button onClick={()=>setShowHistory(true)} className="px-5 py-3 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-slate-200">📜 History</button>
                <div className="flex gap-3">
                    <button onClick={()=>setIsEditing(true)} className="px-8 py-3 bg-slate-100 text-[#002d72] rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 transition-colors">Edit</button>
                    <button onClick={onClose} className="px-8 py-3 bg-[#002d72] text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-[#001a3d] transition-colors">Close</button>
                </div>
            </div>
        </div>
    );
};

// --- COMPONENT: DATA ENTRY ---
const BusInputForm = ({ showToast }: { showToast: (m:string, t:'success'|'error')=>void }) => {
    const [formData, setFormData] = useState({ number: '', status: 'Active', location: '', notes: '', oosStartDate: '', expectedReturnDate: '', actualReturnDate: '' });
    const handleChange = (e: any) => setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const busRef = doc(db, "buses", formData.number);
        const busSnap = await getDoc(busRef);
        if (!busSnap.exists()) return showToast(`⛔ ACCESS DENIED: Bus #${formData.number} not in registry.`, 'error');
        
        const old = busSnap.data();
        let changes = [];
        if (old.status !== formData.status) changes.push(`STATUS: ${old.status} ➝ ${formData.status}`);
        if (old.notes !== formData.notes) changes.push(`📝 NOTES CHANGED:\nFROM: "${old.notes || ''}"\nTO: "${formData.notes}"`);
        if (old.oosStartDate !== formData.oosStartDate) changes.push(`OOS: ${old.oosStartDate || '—'} ➝ ${formData.oosStartDate}`);

        await setDoc(busRef, { ...formData, timestamp: serverTimestamp() }, { merge: true });
        if (changes.length > 0) await logHistory(formData.number, "UPDATE", changes.join('\n\n'), auth.currentUser?.email || 'Unknown');
        else await logHistory(formData.number, "UPDATE", "Routine Update via Terminal", auth.currentUser?.email || 'Unknown');

        showToast(`Bus #${formData.number} Updated`, 'success');
        setFormData({ number: '', status: 'Active', location: '', notes: '', oosStartDate: '', expectedReturnDate: '', actualReturnDate: '' });
    };

    return (
        <div className="max-w-2xl mx-auto mt-10 p-8 bg-white rounded-2xl shadow-xl border-t-8 border-[#002d72] animate-in slide-in-from-bottom-4 duration-500">
            <h2 className="text-3xl font-black text-[#002d72] italic uppercase mb-8 text-center tracking-tighter">Data Entry Terminal</h2>
            <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-2 gap-6">
                    <input type="text" placeholder="Unit #" className="p-4 bg-slate-50 border-2 rounded-xl font-black text-[#002d72] outline-none focus:border-[#002d72] transition-colors" value={formData.number} onChange={handleChange} name="number" required />
                    <select className="p-4 bg-slate-50 border-2 rounded-xl font-bold outline-none focus:border-[#002d72] transition-colors" value={formData.status} onChange={handleChange} name="status"><option value="Active">Ready for Service</option><option value="On Hold">Maintenance Hold</option><option value="In Shop">In Shop</option><option value="Engine">Engine</option><option value="Body Shop">Body Shop</option><option value="Vendor">Vendor</option><option value="Brakes">Brakes</option><option value="Safety">Safety</option></select>
                </div>
                <input type="text" placeholder="Location" className="w-full p-4 bg-slate-50 border-2 rounded-xl outline-none focus:border-[#002d72] transition-colors" value={formData.location} onChange={handleChange} name="location" />
                <textarea placeholder="Maintenance Notes" className="w-full p-4 bg-slate-50 border-2 rounded-xl h-24 outline-none focus:border-[#002d72] transition-colors" value={formData.notes} onChange={handleChange} name="notes" />
                <div className="grid grid-cols-3 gap-4">
                    <div><label className="text-[9px] font-black uppercase text-slate-400 block mb-1">OOS Date</label><input name="oosStartDate" type="date" className="w-full p-2 bg-slate-50 border-2 rounded-lg text-xs font-bold outline-none focus:border-[#002d72]" value={formData.oosStartDate} onChange={handleChange} /></div>
                    <div><label className="text-[9px] font-black uppercase text-slate-400 block mb-1">Exp Return</label><input name="expectedReturnDate" type="date" className="w-full p-2 bg-slate-50 border-2 rounded-lg text-xs font-bold outline-none focus:border-[#002d72]" value={formData.expectedReturnDate} onChange={handleChange} /></div>
                    <div><label className="text-[9px] font-black uppercase text-slate-400 block mb-1">Act Return</label><input name="actualReturnDate" type="date" className="w-full p-2 bg-slate-50 border-2 rounded-lg text-xs font-bold outline-none focus:border-[#002d72]" value={formData.actualReturnDate} onChange={handleChange} /></div>
                </div>
                <button className="w-full py-4 bg-[#002d72] hover:bg-[#ef7c00] text-white rounded-xl font-black uppercase tracking-widest transition-all transform active:scale-95 shadow-lg">Update Record</button>
            </form>
        </div>
    );
};

export default function MartaInventory() {
  const [user, setUser] = useState<any>(null);
  const [view, setView] = useState<'inventory' | 'tracker' | 'input' | 'analytics' | 'handover' | 'parts'>('inventory');
  const [inventoryMode, setInventoryMode] = useState<'list' | 'grid'>('grid');
  const [buses, setBuses] = useState<any[]>([]);
  const [selectedBusDetail, setSelectedBusDetail] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'number', direction: 'asc' });
  const [activeFilter, setActiveFilter] = useState('Total Fleet');
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);

  const holdStatuses = ['On Hold', 'Engine', 'Body Shop', 'Vendor', 'Brakes', 'Safety'];

  useEffect(() => { onAuthStateChanged(auth, u => setUser(u)); }, []);
  useEffect(() => { if (!user) return; return onSnapshot(query(collection(db, "buses"), orderBy("number", "asc")), s => setBuses(s.docs.map(d => ({...d.data(), docId: d.id})))); }, [user]);

  const sortedBuses = [...buses].filter(b => {
    const matchesSearch = b.number.includes(searchTerm);
    if (!matchesSearch) return false;
    if (activeFilter === 'Total Fleet') return true;
    if (activeFilter === 'Ready') return b.status === 'Active' || b.status === 'In Shop';
    if (activeFilter === 'On Hold') return holdStatuses.includes(b.status);
    if (activeFilter === 'In Shop') return b.status === 'In Shop';
    return true;
  }).sort((a, b) => {
    let aV = a[sortConfig.key] || ''; let bV = b[sortConfig.key] || '';
    if (sortConfig.key === 'daysOOS') { aV = calculateDaysOOS(a.oosStartDate, ""); bV = calculateDaysOOS(b.oosStartDate, ""); }
    if (aV < bV) return sortConfig.direction === 'asc' ? -1 : 1;
    if (aV > bV) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  const exportExcel = async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('OOS Detail');
    ws.columns = [{header:'Bus #',key:'number',width:10},{header:'Status',key:'status',width:15},{header:'Fault',key:'notes',width:30},{header:'OOS Start',key:'start',width:15}];
    buses.forEach(b => ws.addRow({number:b.number, status:b.status, notes:b.notes||'', start:b.oosStartDate||''}));
    const buf = await wb.xlsx.writeBuffer(); saveAs(new Blob([buf]), `MARTA_Fleet_Report.xlsx`);
    setToast({msg:"Excel Downloaded", type:'success'});
  };

  if (!user) return (
    <div className="min-h-screen flex items-center justify-center bg-[#001a3d] p-4 relative overflow-hidden">
      <form onSubmit={async e => { e.preventDefault(); try { await signInWithEmailAndPassword(auth, email, password); } catch(e){} }} className="bg-white p-10 rounded-2xl shadow-2xl w-full max-w-md border-t-[12px] border-[#ef7c00] relative z-10 animate-in fade-in zoom-in">
        <h2 className="text-4xl font-black text-[#002d72] italic mb-8 text-center leading-none uppercase">MARTA OPS</h2>
        <div className="space-y-4">
          <input className="w-full p-4 bg-slate-50 border-2 rounded-xl font-bold" placeholder="Supervisor Email" value={email} onChange={e=>setEmail(e.target.value)} required />
          <input className="w-full p-4 bg-slate-50 border-2 rounded-xl font-bold" placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} required />
          <button className="w-full bg-[#002d72] text-white py-5 rounded-xl font-black uppercase tracking-widest hover:bg-[#ef7c00] transition-all transform active:scale-95 shadow-xl">Authorized Login</button>
        </div>
      </form>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-[#ef7c00] selection:text-white">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      {selectedBusDetail && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <BusDetailView bus={selectedBusDetail} onClose={() => setSelectedBusDetail(null)} showToast={(m, t) => setToast({msg:m, type:t})} />
        </div>
      )}

      <nav className="bg-white/90 backdrop-blur-md border-b border-slate-200 sticky top-0 z-[1001] px-6 py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-2"><div className="w-2 h-6 bg-[#002d72] rounded-full"></div><span className="font-black text-lg italic uppercase tracking-tighter text-[#002d72]">Fleet Manager</span></div>
        <div className="flex gap-4 items-center">
          {['inventory', 'input', 'tracker', 'analytics', 'handover', 'parts'].map(v => (
            <button key={v} onClick={() => setView(v as any)} className={`text-[9px] font-black uppercase tracking-widest border-b-2 pb-1 transition-all ${view === v ? 'border-[#ef7c00] text-[#002d72]' : 'border-transparent text-slate-400 hover:text-[#002d72]'}`}>{v.replace('input', 'Data Entry').replace('parts', 'Parts List')}</button>
          ))}
          <button onClick={exportExcel} className="text-[#002d72] text-[10px] font-black uppercase hover:text-[#ef7c00]">Excel</button>
          <button onClick={() => signOut(auth)} className="text-red-500 text-[10px] font-black uppercase">Logout</button>
        </div>
      </nav>

      <main className="max-w-[1600px] mx-auto p-6">
        {view === 'tracker' ? <div className="h-[85vh] bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden relative"><BusTracker /></div> :
         view === 'input' ? <BusInputForm showToast={(m, t) => setToast({msg:m, type:t})} /> :
         view === 'analytics' ? <div className="animate-in fade-in duration-500"><StatusCharts buses={buses} /><AnalyticsDashboard buses={buses} showToast={(m, t) => setToast({msg:m, type:t})} /></div> :
         view === 'handover' ? <ShiftHandover buses={buses} showToast={(m, t) => setToast({msg:m, type:t})} /> :
         view === 'parts' ? <PartsInventory /> : (
          <>
            <div className="grid grid-cols-4 gap-4 mb-8">
              {[{label:'Total Fleet',val:buses.length,c:'text-slate-900'},{label:'Ready',val:buses.filter(b=>b.status==='Active'||b.status==='In Shop').length,c:'text-green-600'},{label:'On Hold',val:buses.filter(b=>holdStatuses.includes(b.status)).length,c:'text-red-600'},{label:'In Shop',val:buses.filter(b=>b.status==='In Shop').length,c:'text-[#ef7c00]'}].map(m=>(
                <div key={m.label} onClick={()=>setActiveFilter(m.label)} className={`bg-white p-5 rounded-2xl shadow-sm border flex flex-col items-center cursor-pointer transition-all hover:scale-105 ${activeFilter===m.label?'border-[#002d72] bg-blue-50':'border-slate-100'}`}><p className="text-[8px] font-black uppercase text-slate-400 mb-1 tracking-widest">{m.label}</p><p className={`text-2xl font-black ${m.c}`}>{m.val}</p></div>
              ))}
            </div>

            <div className="mb-6 flex justify-between items-end gap-4">
                <input type="text" placeholder="Search Unit #..." className="w-full max-w-md pl-4 pr-10 py-3 bg-white border border-slate-200 rounded-lg text-sm font-bold focus:border-[#002d72] outline-none shadow-sm" value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} />
                <div className="bg-white border rounded-lg p-1 flex">
                    <button onClick={()=>setInventoryMode('list')} className={`px-4 py-1.5 text-[10px] font-black uppercase rounded ${inventoryMode==='list'?'bg-[#002d72] text-white shadow-md':'text-slate-400'}`}>List</button>
                    <button onClick={()=>setInventoryMode('grid')} className={`px-4 py-1.5 text-[10px] font-black uppercase rounded ${inventoryMode==='grid'?'bg-[#002d72] text-white shadow-md':'text-slate-400'}`}>Grid</button>
                </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden min-h-[500px]">
                {inventoryMode === 'list' ? (
                    <>
                        <div className="grid grid-cols-10 gap-4 p-5 border-b bg-slate-50/50 text-[9px] font-black uppercase text-slate-400 tracking-widest">
                            <div onClick={()=>requestSort('number')} className="cursor-pointer hover:text-[#002d72]">Unit #</div>
                            <div>Series</div><div>Status</div><div>Location</div><div className="col-span-2">Fault Preview</div><div>Exp Return</div><div>Act Return</div><div>Days OOS</div>
                        </div>
                        <div className="divide-y divide-slate-100">
                            {sortedBuses.map(b => (
                                <div key={b.docId} onClick={()=>setSelectedBusDetail(b)} className={`grid grid-cols-10 gap-4 p-5 items-center cursor-pointer hover:bg-slate-50 transition-all border-l-4 ${b.status==='Active'?'border-green-500':'border-red-500'}`}>
                                    <div className="text-lg font-black text-[#002d72]">#{b.number}</div>
                                    <div className="text-[9px] font-bold text-slate-400">{getBusSpecs(b.number).length}</div>
                                    <div className={`text-[9px] font-black uppercase px-2 py-1 rounded-full w-fit ${b.status==='Active'?'bg-green-100 text-green-700':'bg-red-100 text-red-700'}`}>{b.status}</div>
                                    <div className="text-xs font-bold text-slate-600">{b.location||'—'}</div>
                                    <div className="col-span-2 text-xs font-bold text-slate-500 truncate italic">{b.notes||'No faults.'}</div>
                                    <div className="text-xs font-bold text-slate-700">{b.expectedReturnDate||'—'}</div>
                                    <div className="text-xs font-bold text-slate-700">{b.actualReturnDate||'—'}</div>
                                    <div className="text-xs font-black text-red-600">{b.status!=='Active' ? `${calculateDaysOOS(b.oosStartDate, "")} days` : '—'}</div>
                                </div>
                            ))}
                        </div>
                    </>
                ) : (
                    <div className="p-8 grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 gap-3">
                        {sortedBuses.map(b => (
                            <div key={b.docId} onClick={()=>setSelectedBusDetail(b)} className={`h-14 rounded-lg border-2 flex flex-col items-center justify-center cursor-pointer transition-all hover:scale-110 shadow-sm ${b.status==='Active'?'bg-green-50 border-green-200 text-green-800':'bg-red-50 border-red-200 text-red-800'}`}>
                                <span className="text-xs font-black italic tracking-tighter">#{b.number}</span>
                                {b.status!=='Active'&&<span className="text-[7px] font-bold uppercase opacity-60 leading-none">{b.status}</span>}
                            </div>
                        ))}
                    </div>
                )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}