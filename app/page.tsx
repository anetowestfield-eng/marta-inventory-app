"use client";
import React, { useState, useEffect } from 'react';
import { db, auth } from './firebaseConfig'; 
import { collection, onSnapshot, query, orderBy, doc, serverTimestamp, setDoc, writeBatch, getDocs, getDoc, addDoc, deleteDoc, limit } from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import dynamic from 'next/dynamic';

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

// --- HELPER: FORMAT TIMESTAMP ---
const formatTime = (timestamp: any) => {
    if (!timestamp) return 'Just now';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
};

// --- HELPER: LOG HISTORY ---
const logHistory = async (busNumber: string, action: string, details: string, userEmail: string) => {
    if (!busNumber) return;
    try {
        await addDoc(collection(db, "buses", busNumber, "history"), {
            action,
            details,
            user: userEmail,
            timestamp: serverTimestamp()
        });
    } catch (err) {
        console.error("Failed to log history", err);
    }
};

// --- COMPONENT: VISUAL CHARTS (Analytics) ---
const StatusCharts = ({ buses }: { buses: any[] }) => {
    const statusCounts: {[key: string]: number} = {
        'Active': 0, 'In Shop': 0, 'Engine': 0, 'Body Shop': 0, 'Vendor': 0, 'Brakes': 0, 'Safety': 0
    };
    buses.forEach(b => {
        const s = b.status || 'Active';
        if (statusCounts[s] !== undefined) statusCounts[s]++;
    });
    const maxCount = Math.max(...Object.values(statusCounts), 1);

    const last7Days = [...Array(7)].map((_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        return d.toISOString().split('T')[0];
    });
    const trendData = last7Days.map(date => buses.filter(b => b.oosStartDate === date).length);
    const maxTrend = Math.max(...trendData, 1);

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                <h3 className="text-[10px] font-black text-[#002d72] uppercase tracking-widest mb-6">Current Fleet Status</h3>
                <div className="flex items-end gap-3 h-40">
                    {Object.entries(statusCounts).map(([status, count]) => {
                        const height = (count / maxCount) * 100;
                        const color = status === 'Active' ? 'bg-green-500' : status === 'In Shop' ? 'bg-[#ef7c00]' : 'bg-red-500';
                        return (
                            <div key={status} className="flex-1 flex flex-col justify-end items-center group relative">
                                <div className="absolute -top-6 text-[10px] font-bold text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity">{count}</div>
                                <div className={`w-full rounded-t-md transition-all duration-500 ${color} ${height < 2 ? 'h-1' : ''}`} style={{ height: `${height}%` }}></div>
                                <p className="text-[8px] font-black text-slate-400 uppercase mt-2 -rotate-45 origin-left translate-y-2 whitespace-nowrap">{status}</p>
                            </div>
                        );
                    })}
                </div>
            </div>
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                <h3 className="text-[10px] font-black text-[#002d72] uppercase tracking-widest mb-6">7-Day Failure Trend</h3>
                <div className="flex items-end gap-2 h-40 border-l border-b border-slate-100 pl-2 pb-2">
                    {trendData.map((count, i) => {
                        const height = (count / maxTrend) * 100;
                        return (
                            <div key={i} className="flex-1 flex flex-col justify-end items-center group relative">
                                <div className="absolute -top-6 text-[10px] font-bold text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity">{count}</div>
                                <div className="w-full bg-blue-100 hover:bg-blue-300 rounded-t-sm transition-all relative" style={{ height: `${height || 2}%` }}>
                                    <div className="absolute w-full top-0 h-1 bg-blue-500"></div>
                                </div>
                                <p className="text-[8px] font-bold text-slate-300 mt-2">{last7Days[i].slice(5)}</p>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

// --- COMPONENT: ANALYTICS DASHBOARD ---
const AnalyticsDashboard = ({ buses }: { buses: any[] }) => {
    const [shopQueens, setShopQueens] = useState<{number: string, count: number}[]>([]);
    const [isResetting, setIsResetting] = useState(false);
    
    // Function to calculate rankings
    const fetchRankings = async () => {
        const rankings: {number: string, count: number}[] = [];
        const sampleBuses = buses.slice(0, 50); 
        for (const bus of sampleBuses) {
            const hSnap = await getDocs(query(collection(db, "buses", bus.number, "history"), limit(20)));
            if (hSnap.size > 0) rankings.push({ number: bus.number, count: hSnap.size });
        }
        setShopQueens(rankings.sort((a,b) => b.count - a.count).slice(0, 5));
    };

    useEffect(() => {
        if(buses.length > 0) fetchRankings();
    }, [buses]);

    const handleResetMetrics = async () => {
        if(!confirm("⚠️ WARNING: This will WIPE ALL HISTORY logs for the entire fleet.\n\n• 'Shop Buses' counts will reset to 0.\n• '7-Day Trend' will flatten.\n• Shift Handover reports will be cleared.\n\nAre you sure you want to delete all historical data?")) return;
        
        setIsResetting(true);
        try {
            let deletedCount = 0;
            // Iterate through buses and delete their history subcollections
            for (const bus of buses) {
                const hSnap = await getDocs(collection(db, "buses", bus.number, "history"));
                if (!hSnap.empty) {
                    const batch = writeBatch(db);
                    hSnap.docs.forEach(doc => batch.delete(doc.ref));
                    await batch.commit();
                    deletedCount += hSnap.size;
                }
            }
            alert(`Analytics Reset Complete. Cleared ${deletedCount} records.`);
            setShopQueens([]); // Clear local state immediately
        } catch (err) {
            console.error("Reset failed", err);
            alert("Failed to reset some records. Check console.");
        }
        setIsResetting(false);
    };

    const avgOOS = buses.reduce((acc, b) => acc + (b.status !== 'Active' ? 1 : 0), 0);

    return (
        <div className="p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-black text-[#002d72] italic uppercase">Fleet Analytics</h2>
                <button 
                    onClick={handleResetMetrics} 
                    disabled={isResetting}
                    className="px-4 py-2 bg-red-50 text-red-500 hover:bg-red-500 hover:text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50"
                >
                    {isResetting ? "Resetting..." : "⚠️ Reset Metrics"}
                </button>
            </div>

            <StatusCharts buses={buses} />
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Fleet Availability</p>
                    <p className="text-4xl font-black text-[#002d72] italic">{Math.round(((buses.length - avgOOS) / Math.max(buses.length, 1)) * 100)}%</p>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Down Units</p>
                    <p className="text-4xl font-black text-red-500 italic">{avgOOS}</p>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Top Offender</p>
                    <p className="text-4xl font-black text-slate-700 italic">{shopQueens[0]?.number || '---'}</p>
                </div>
            </div>
            
            <div className="bg-white p-8 rounded-2xl shadow-lg border border-slate-200">
                <h3 className="text-xl font-black text-[#002d72] uppercase mb-6 flex items-center gap-2"> Top "Shop Buses" (High Activity)</h3>
                <div className="space-y-4">
                    {shopQueens.map((queen, i) => (
                        <div key={i} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
                            <span className="text-lg font-black text-slate-700">Bus #{queen.number}</span>
                            <div className="flex items-center gap-4">
                                <div className="h-2 w-32 bg-slate-200 rounded-full overflow-hidden">
                                    <div className="h-full bg-red-500" style={{ width: `${Math.min((queen.count / 10) * 100, 100)}%` }}></div>
                                </div>
                                <span className="text-sm font-black text-red-600">{queen.count} Logs</span>
                            </div>
                        </div>
                    ))}
                    {shopQueens.length === 0 && <p className="text-center text-slate-400 italic text-sm">No significant repair history found.</p>}
                </div>
            </div>
        </div>
    );
};

// --- COMPONENT: SHIFT HANDOVER ---
const ShiftHandover = ({ buses }: { buses: any[] }) => {
    const [report, setReport] = useState<any[]>([]);

    useEffect(() => {
        const fetchRecentLogs = async () => {
            const twelveHoursAgo = Date.now() - (12 * 60 * 60 * 1000);
            let recentActivity: any[] = [];
            const activeBuses = buses.filter(b => b.status !== 'Active' || b.notes); 
            
            for (const bus of activeBuses.slice(0, 30)) {
                const hRef = collection(db, "buses", bus.number, "history");
                const q = query(hRef, orderBy("timestamp", "desc"), limit(2));
                const snap = await getDocs(q);
                snap.forEach(d => {
                    const data = d.data();
                    if ((data.timestamp?.toMillis() || 0) > twelveHoursAgo) {
                        recentActivity.push({ bus: bus.number, ...data });
                    }
                });
            }
            setReport(recentActivity.sort((a,b) => (b.timestamp?.toMillis() || 0) - (a.timestamp?.toMillis() || 0)));
        };
        if(buses.length > 0) fetchRecentLogs();
    }, [buses]);

    const copyReport = () => {
        const text = report.map(r => `[Bus ${r.bus}] ${r.action}: ${r.details} (${r.user})`).join('\n');
        navigator.clipboard.writeText(`SHIFT HANDOVER REPORT - ${new Date().toLocaleDateString()}\n\n${text}`);
        alert("Report copied to clipboard!");
    };

    return (
        <div className="max-w-4xl mx-auto p-8 animate-in fade-in slide-in-from-bottom-4">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h2 className="text-3xl font-black text-[#002d72] uppercase italic">Shift Handover</h2>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Activity in last 12 hours</p>
                </div>
                <button onClick={copyReport} className="px-6 py-3 bg-[#002d72] text-white rounded-xl font-black uppercase text-xs shadow-lg hover:bg-[#ef7c00] transition-all">Copy Report</button>
            </div>
            <div className="space-y-4">
                {report.length === 0 ? <div className="p-12 text-center border-2 border-dashed border-slate-200 rounded-3xl text-slate-300 italic">No recent activity found.</div> : report.map((log, i) => (
                    <div key={i} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex gap-6 items-center">
                        <div className="w-16 h-16 bg-[#002d72]/5 rounded-xl flex items-center justify-center border border-[#002d72]/10"><span className="text-lg font-black text-[#002d72]">#{log.bus}</span></div>
                        <div className="flex-grow">
                            <div className="flex justify-between mb-1"><span className="text-[10px] font-black text-[#ef7c00] uppercase">{log.action}</span><span className="text-[10px] font-bold text-slate-400">{formatTime(log.timestamp)}</span></div>
                            <p className="text-sm font-bold text-slate-700 whitespace-pre-wrap line-clamp-2">{log.details}</p>
                            <p className="text-[9px] text-slate-400 mt-2 uppercase tracking-widest">{log.user}</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- COMPONENT: BUS DETAIL POPUP ---
const BusDetailView = ({ bus, onClose }: { bus: any; onClose: () => void }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [historyLogs, setHistoryLogs] = useState<any[]>([]); 
    const [editData, setEditData] = useState({ status: bus.status || 'Active', location: bus.location || '', notes: bus.notes || '', oosStartDate: bus.oosStartDate || '', expectedReturnDate: bus.expectedReturnDate || '', actualReturnDate: bus.actualReturnDate || '' });

    useEffect(() => {
        if (showHistory) {
            const unsub = onSnapshot(query(collection(db, "buses", bus.number, "history"), orderBy("timestamp", "desc")), (snap) => {
                setHistoryLogs(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            });
            return () => unsub();
        }
    }, [showHistory, bus.number]);

    const handleChange = (e: any) => setEditData(prev => ({ ...prev, [e.target.name]: e.target.value }));

    const handleSave = async () => {
        try {
            const busRef = doc(db, "buses", bus.number);
            const currentSnap = await getDoc(busRef);
            const oldData = currentSnap.exists() ? currentSnap.data() : {};
            let changes = [];
            if (oldData.status !== editData.status) changes.push(`STATUS: ${oldData.status} ➝ ${editData.status}`);
            if (oldData.location !== editData.location) changes.push(`LOC: ${oldData.location} ➝ ${editData.location}`);
            if (oldData.notes !== editData.notes) changes.push(`NOTES CHANGED:\nFROM: "${oldData.notes || ''}"\nTO: "${editData.notes}"`);
            if (oldData.oosStartDate !== editData.oosStartDate) changes.push(`OOS DATE: ${oldData.oosStartDate || 'N/A'} ➝ ${editData.oosStartDate}`);
            if (oldData.expectedReturnDate !== editData.expectedReturnDate) changes.push(`EXP: ${oldData.expectedReturnDate || 'N/A'} ➝ ${editData.expectedReturnDate}`);
            if (oldData.actualReturnDate !== editData.actualReturnDate) changes.push(`ACT: ${oldData.actualReturnDate || 'N/A'} ➝ ${editData.actualReturnDate}`);

            await setDoc(busRef, { ...editData, timestamp: serverTimestamp() }, { merge: true });
            
            if (changes.length > 0) {
                await logHistory(bus.number, "EDIT", changes.join('\n\n'), auth.currentUser?.email || 'Unknown');
            }
            setIsEditing(false);
        } catch (err) { alert("Save failed"); }
    };

    const deleteLog = async (id: string) => { if(confirm("Delete log?")) await deleteDoc(doc(db, "buses", bus.number, "history", id)); };

    const handleReset = async () => {
        if (!confirm("Reset bus to Active?")) return;
        await setDoc(doc(db, "buses", bus.number), { status: 'Active', notes: '', location: '', oosStartDate: '', expectedReturnDate: '', actualReturnDate: '', timestamp: serverTimestamp() }, { merge: true });
        await logHistory(bus.number, "RESET", "Unit reset to Active/Ready.", auth.currentUser?.email || 'Unknown');
        setIsEditing(false); onClose();
    };

    if (showHistory) {
        return (
            <div className="bg-white p-6 rounded-xl shadow-2xl w-full max-w-lg h-[600px] flex flex-col animate-in zoom-in-95">
                <div className="flex justify-between items-center mb-4 border-b pb-4"><h3 className="text-xl font-black text-[#002d72] uppercase">History: #{bus.number}</h3><button onClick={() => setShowHistory(false)} className="text-sm font-bold text-slate-400">Back</button></div>
                <div className="flex-grow overflow-y-auto space-y-3">
                    {historyLogs.map((log) => (
                        <div key={log.id} className="group relative p-3 bg-slate-50 rounded-lg border border-slate-100">
                            <button onClick={() => deleteLog(log.id)} className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity">✕</button>
                            <div className="flex justify-between text-[8px] font-black uppercase text-slate-400 mb-1"><span className={log.action === 'RESET' ? 'text-red-500' : 'text-blue-500'}>{log.action}</span><span>{formatTime(log.timestamp)}</span></div>
                            <p className="text-xs font-bold text-slate-700 leading-snug whitespace-pre-wrap">{log.details}</p>
                            <p className="text-[8px] text-slate-400 italic mt-1 text-right">{log.user}</p>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (isEditing) {
        return (
            <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-2xl animate-in zoom-in-95">
                <h3 className="text-2xl font-black text-[#002d72] mb-6 uppercase italic tracking-tighter">Edit Bus #{bus.number}</h3>
                <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="space-y-1"><label className="text-[9px] font-black uppercase text-slate-400">Status</label><select name="status" className="w-full p-3 bg-slate-50 border-2 rounded-lg font-bold" value={editData.status} onChange={handleChange}><option value="Active">Ready for Service</option><option value="On Hold">Maintenance Hold</option><option value="In Shop">In Shop</option><option value="Engine">Engine</option><option value="Body Shop">Body Shop</option><option value="Vendor">Vendor</option><option value="Brakes">Brakes</option><option value="Safety">Safety</option></select></div>
                    <div className="space-y-1"><label className="text-[9px] font-black uppercase text-slate-400">Location</label><input name="location" type="text" className="w-full p-3 bg-slate-50 border-2 rounded-lg font-bold" value={editData.location} onChange={handleChange} /></div>
                </div>
                <div className="space-y-1 mb-6"><label className="text-[9px] font-black uppercase text-slate-400">Fault Details</label><textarea name="notes" className="w-full p-3 bg-slate-50 border-2 rounded-lg h-24" value={editData.notes} onChange={handleChange} /></div>
                <div className="grid grid-cols-3 gap-4 mb-6">
                    <div><label className="text-[9px] font-black uppercase text-slate-400 block mb-1">OOS Date</label><input name="oosStartDate" type="date" className="w-full p-2 bg-slate-50 border-2 rounded-lg text-xs font-bold" value={editData.oosStartDate} onChange={handleChange} /></div>
                    <div><label className="text-[9px] font-black uppercase text-slate-400 block mb-1">Exp Return</label><input name="expectedReturnDate" type="date" className="w-full p-2 bg-slate-50 border-2 rounded-lg text-xs font-bold" value={editData.expectedReturnDate} onChange={handleChange} /></div>
                    <div><label className="text-[9px] font-black uppercase text-slate-400 block mb-1">Act Return</label><input name="actualReturnDate" type="date" className="w-full p-2 bg-slate-50 border-2 rounded-lg text-xs font-bold" value={editData.actualReturnDate} onChange={handleChange} /></div>
                </div>
                <div className="flex gap-4">
                    <button onClick={handleReset} className="w-1/3 py-3 bg-red-50 text-red-500 font-black rounded-xl uppercase text-xs hover:bg-red-100 transition-colors">Reset to Default</button>
                    <button onClick={handleSave} className="w-2/3 py-3 bg-[#002d72] text-white font-black rounded-xl uppercase text-xs shadow-lg hover:bg-[#ef7c00] transition-colors">Save Changes</button>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-2xl animate-in zoom-in-95">
            <div className="flex justify-between items-start mb-8 border-b pb-6">
                <div><h3 className="text-4xl font-black text-[#002d72] italic uppercase">Bus #{bus.number}</h3><span className={`inline-block mt-2 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${bus.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{bus.status}</span></div>
                <button onClick={onClose} className="text-slate-400 text-2xl font-bold hover:text-slate-600">✕</button>
            </div>
            <div className="bg-slate-50 p-4 rounded-xl mb-6"><p className="text-[10px] font-black uppercase text-slate-400 mb-2">Fault Details</p><p className="text-lg font-medium text-slate-800">{bus.notes || "No active faults."}</p></div>
            
            <div className="grid grid-cols-3 gap-4 mb-6">
                <div><p className="text-[9px] font-black uppercase text-slate-400">OOS Date</p><p className="text-xl font-black text-[#002d72]">{bus.oosStartDate || '--'}</p></div>
                <div><p className="text-[9px] font-black uppercase text-slate-400">Exp Return</p><p className="text-xl font-black text-[#ef7c00]">{bus.expectedReturnDate || '--'}</p></div>
                <div><p className="text-[9px] font-black uppercase text-slate-400">Act Return</p><p className="text-xl font-black text-green-600">{bus.actualReturnDate || '--'}</p></div>
            </div>

            <div className="flex justify-between pt-6 border-t">
                <button onClick={() => setShowHistory(true)} className="px-5 py-3 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-slate-200">📜 History</button>
                <div className="flex gap-3">
                    <button onClick={() => setIsEditing(true)} className="px-8 py-3 bg-slate-100 text-[#002d72] rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-slate-200">Edit</button>
                    <button onClick={onClose} className="px-8 py-3 bg-[#002d72] text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-[#001a3d]">Close</button>
                </div>
            </div>
        </div>
    );
};

// --- COMPONENT: Data Entry Form ---
const BusInputForm = () => {
    const [formData, setFormData] = useState({ number: '', status: 'Active', location: '', notes: '', oosStartDate: '', expectedReturnDate: '', actualReturnDate: '' });
    const handleChange = (e: any) => setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const busRef = doc(db, "buses", formData.number);
        const busSnap = await getDoc(busRef);
        if (!busSnap.exists()) return alert("⛔ ACCESS DENIED: Bus not in registry.");
        
        const oldData = busSnap.data();
        let changes = [];
        if (oldData.status !== formData.status) changes.push(`STATUS: ${oldData.status || 'Active'} ➝ ${formData.status}`);
        if (oldData.location !== formData.location) changes.push(`LOC: ${oldData.location || 'Blank'} ➝ ${formData.location}`);
        if (oldData.notes !== formData.notes) changes.push(`📝 NOTES CHANGED:\nFROM: "${oldData.notes || ''}"\nTO: "${formData.notes}"`);
        if (oldData.oosStartDate !== formData.oosStartDate) changes.push(`OOS: ${oldData.oosStartDate || 'N/A'} ➝ ${formData.oosStartDate}`);
        if (oldData.expectedReturnDate !== formData.expectedReturnDate) changes.push(`EXP: ${oldData.expectedReturnDate || 'N/A'} ➝ ${formData.expectedReturnDate}`);
        if (oldData.actualReturnDate !== formData.actualReturnDate) changes.push(`ACT: ${oldData.actualReturnDate || 'N/A'} ➝ ${formData.actualReturnDate}`);

        await setDoc(busRef, { ...formData, timestamp: serverTimestamp() }, { merge: true });
        
        if (changes.length > 0) {
            await logHistory(formData.number, "UPDATE", changes.join('\n\n'), auth.currentUser?.email || 'Unknown');
        } else {
            await logHistory(formData.number, "UPDATE", "Routine Update via Data Entry", auth.currentUser?.email || 'Unknown');
        }

        alert("Unit Updated!");
        setFormData({ number: '', status: 'Active', location: '', notes: '', oosStartDate: '', expectedReturnDate: '', actualReturnDate: '' });
    };

    const handleGlobalReset = async () => {
        if (!confirm("⚠️ DANGER: This will set EVERY bus in the fleet to 'Active' status and clear all fault notes.\n\nAre you absolutely sure?")) return;
        try {
            const querySnapshot = await getDocs(collection(db, "buses"));
            const batch = writeBatch(db);
            querySnapshot.docs.forEach((document) => {
                batch.update(doc(db, "buses", document.id), { status: 'Active', notes: '', location: '', oosStartDate: '', expectedReturnDate: '', actualReturnDate: '' });
            });
            await batch.commit();
            alert("✅ Fleet Reset Complete. All buses are now Active.");
        } catch (err) { console.error("Batch reset failed:", err); alert("Failed to reset fleet."); }
    };

    return (
        <div className="max-w-2xl mx-auto mt-10 pb-20 animate-in fade-in slide-in-from-bottom-4">
            <div className="bg-white p-8 rounded-2xl shadow-xl border-t-8 border-[#002d72]">
                <h2 className="text-3xl font-black text-[#002d72] italic uppercase mb-8 text-center">Data Entry Terminal</h2>
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="grid grid-cols-2 gap-6">
                        <input type="text" placeholder="Unit #" className="p-4 bg-slate-50 border-2 rounded-xl font-black text-[#002d72]" value={formData.number} onChange={handleChange} name="number" required />
                        <select className="p-4 bg-slate-50 border-2 rounded-xl font-bold" value={formData.status} onChange={handleChange} name="status"><option value="Active">Ready for Service</option><option value="On Hold">Maintenance Hold</option><option value="In Shop">In Shop</option><option value="Engine">Engine</option><option value="Body Shop">Body Shop</option><option value="Vendor">Vendor</option><option value="Brakes">Brakes</option><option value="Safety">Safety</option></select>
                    </div>
                    <input type="text" placeholder="Location" className="w-full p-4 bg-slate-50 border-2 rounded-xl" value={formData.location} onChange={handleChange} name="location" />
                    <textarea placeholder="Maintenance Notes" className="w-full p-4 bg-slate-50 border-2 rounded-xl h-24" value={formData.notes} onChange={handleChange} name="notes" />
                    
                    <div className="grid grid-cols-3 gap-4">
                        <div><label className="text-[9px] font-black uppercase text-slate-400 block mb-1">OOS Date</label><input name="oosStartDate" type="date" className="w-full p-2 bg-slate-50 border-2 rounded-lg text-xs font-bold" value={formData.oosStartDate} onChange={handleChange} /></div>
                        <div><label className="text-[9px] font-black uppercase text-slate-400 block mb-1">Exp Return</label><input name="expectedReturnDate" type="date" className="w-full p-2 bg-slate-50 border-2 rounded-lg text-xs font-bold" value={formData.expectedReturnDate} onChange={handleChange} /></div>
                        <div><label className="text-[9px] font-black uppercase text-slate-400 block mb-1">Act Return</label><input name="actualReturnDate" type="date" className="w-full p-2 bg-slate-50 border-2 rounded-lg text-xs font-bold" value={formData.actualReturnDate} onChange={handleChange} /></div>
                    </div>

                    <button className="w-full py-4 bg-[#002d72] hover:bg-[#ef7c00] text-white rounded-xl font-black uppercase tracking-widest transition-all shadow-lg">Update Record</button>
                </form>
                <div className="mt-12 pt-8 border-t border-slate-100 text-center">
                    <button onClick={handleGlobalReset} className="text-red-500 hover:text-red-700 hover:bg-red-50 px-6 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all">⚠️ Reset Entire Fleet to Ready</button>
                </div>
            </div>
        </div>
    );
};

export default function MartaInventory() {
  const [user, setUser] = useState<any>(null);
  const [view, setView] = useState<'inventory' | 'tracker' | 'input' | 'analytics' | 'handover'>('inventory');
  const [inventoryMode, setInventoryMode] = useState<'list' | 'grid'>('grid');
  const [buses, setBuses] = useState<any[]>([]);
  const [selectedBusDetail, setSelectedBusDetail] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'number', direction: 'asc' });
  const [activeFilter, setActiveFilter] = useState<string>('Total Fleet');

  const holdStatuses = ['On Hold', 'Engine', 'Body Shop', 'Vendor', 'Brakes', 'Safety'];

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

  const requestSort = (key: string) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  const exportToExcel = async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Vehicle OOS Details');
    
    worksheet.columns = [
        { header: 'Bus #', key: 'number', width: 15 },
        { header: 'Series', key: 'series', width: 10 },
        { header: 'Status', key: 'status', width: 15 },
        { header: 'Location', key: 'location', width: 20 },
        { header: 'Fault Details', key: 'notes', width: 40 },
        { header: 'Exp Return', key: 'exp', width: 15 },
        { header: 'Act Return', key: 'act', width: 15 },
        { header: 'OOS Start', key: 'start', width: 15 }
    ];

    buses.forEach(bus => {
        worksheet.addRow({
            number: bus.number,
            series: getBusSpecs(bus.number).length,
            status: bus.status,
            location: bus.location || '',
            notes: bus.notes || '',
            exp: bus.expectedReturnDate || '',
            act: bus.actualReturnDate || '',
            start: bus.oosStartDate || ''
        });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `MARTA_Fleet_Report.xlsx`);
  };

  useEffect(() => {
    return onAuthStateChanged(auth, (currentUser) => setUser(currentUser));
  }, []);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(query(collection(db, "buses"), orderBy("number", "asc")), (snap) => setBuses(snap.docs.map(doc => ({ ...doc.data(), docId: doc.id }))));
  }, [user]);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#001a3d] p-4 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-2 bg-[#ef7c00]"></div>
        <form onSubmit={async (e) => { e.preventDefault(); try { await signInWithEmailAndPassword(auth, email, password); } catch (err) {} }} 
          className="bg-white p-10 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] w-full max-w-md border-t-[12px] border-[#ef7c00] z-10 animate-in fade-in zoom-in duration-500">
          <div className="text-center mb-10">
            <h2 className="text-4xl font-black text-[#002d72] italic tracking-tighter uppercase leading-none">MARTA OPS</h2>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-2">Fleet Management Portal</p>
          </div>
          <div className="space-y-6">
            <div className="space-y-1">
                <label className="text-[9px] font-black uppercase text-slate-400 ml-1">Supervisor Email</label>
                <input type="email" placeholder="email@marta.com" className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-xl font-bold outline-none focus:border-[#002d72] focus:bg-white transition-all" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1">
                <label className="text-[9px] font-black uppercase text-slate-400 ml-1">Secure Password</label>
                <input type="password" placeholder="••••••••" className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-xl font-bold outline-none focus:border-[#002d72] focus:bg-white transition-all" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <button className="w-full bg-[#002d72] text-white font-black py-5 rounded-xl uppercase tracking-widest hover:bg-[#ef7c00] transition-all transform active:scale-95 shadow-xl mt-4">Authorized Login</button>
          </div>
        </form>
        <div className="absolute -bottom-20 -right-20 w-80 h-80 bg-[#ef7c00]/10 rounded-full blur-3xl"></div>
        <div className="absolute -top-20 -left-20 w-80 h-80 bg-[#002d72]/30 rounded-full blur-3xl"></div>
      </div>
    );
  }

  const sortedBuses = [...buses].filter(b => {
    const matchesSearch = b.number.includes(searchTerm);
    if (!matchesSearch) return false;
    if (activeFilter === 'Total Fleet') return true;
    if (activeFilter === 'Ready') return b.status === 'Active' || b.status === 'In Shop';
    if (activeFilter === 'On Hold') return holdStatuses.includes(b.status);
    if (activeFilter === 'In Shop') return b.status === 'In Shop';
    return true;
  }).sort((a, b) => {
    let aValue: any = a[sortConfig.key] || '';
    let bValue: any = b[sortConfig.key] || '';
    if (sortConfig.key === 'daysOOS') {
        const today = new Date().toISOString().split('T')[0];
        aValue = calculateDaysOOS(a.oosStartDate, today);
        bValue = calculateDaysOOS(b.oosStartDate, today);
    } else {
        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
    }
    return 0;
  });

  const getSortIcon = (key: string) => {
      if (sortConfig.key !== key) return <span className="opacity-20 ml-2 text-lg">⇅</span>;
      return <span className="ml-2 text-lg font-black text-[#ef7c00]">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>;
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-[#ef7c00] selection:text-white relative">
      
      {/* DISPLAY MODAL (Read Only with Edit Toggle) */}
      {inventoryMode === 'grid' && selectedBusDetail && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <BusDetailView bus={selectedBusDetail} onClose={() => setSelectedBusDetail(null)} />
        </div>
      )}

      <nav className="bg-white border-b border-slate-200 sticky top-0 z-[1001] px-6 py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-3">
            <div className="w-2 h-6 bg-[#002d72] rounded-full"></div>
            <span className="font-black text-lg italic uppercase tracking-tighter text-[#002d72]">Fleet Manager</span>
        </div>
        <div className="flex gap-4 items-center">
          {['inventory', 'input', 'tracker', 'analytics', 'handover'].map(v => (
            <button key={v} onClick={() => setView(v as any)} className={`text-[9px] font-black uppercase tracking-widest border-b-2 pb-1 ${view === v ? 'border-[#ef7c00] text-[#002d72]' : 'border-transparent text-slate-400 hover:text-[#002d72]'}`}>{v.replace('input', 'Data Entry').replace('handover', 'Handover').replace('analytics', 'Analytics')}</button>
          ))}
          <div className="h-4 w-[1px] bg-slate-200"></div>
          <button onClick={exportToExcel} className="text-[#002d72] hover:text-[#ef7c00] text-[10px] font-black uppercase transition-all tracking-widest">Export Excel</button>
          <button onClick={() => signOut(auth)} className="text-red-500 hover:text-red-700 text-[10px] font-black uppercase tracking-widest">Logout</button>
        </div>
      </nav>

      <main className="max-w-[1600px] mx-auto p-6">
        {view === 'tracker' ? (
          <div className="h-[85vh] bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden relative"><BusTracker /></div>
        ) : view === 'input' ? (
          <BusInputForm />
        ) : view === 'analytics' ? (
          <AnalyticsDashboard buses={buses} />
        ) : view === 'handover' ? (
          <ShiftHandover buses={buses} />
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {[
                { label: 'Total Fleet', val: buses.length, color: 'text-slate-900' },
                { label: 'Ready', val: buses.filter(b => b.status === 'Active' || b.status === 'In Shop').length, color: 'text-green-600' },
                { label: 'On Hold', val: buses.filter(b => holdStatuses.includes(b.status)).length, color: 'text-red-600' },
                { label: 'In Shop', val: buses.filter(b => b.status === 'In Shop').length, color: 'text-[#ef7c00]' }
              ].map((m, i) => (
                <div key={i} onClick={() => setActiveFilter(m.label)} className={`bg-white py-4 px-6 rounded-xl shadow-sm border flex flex-col items-center justify-center cursor-pointer transition-all hover:scale-[1.02] ${activeFilter === m.label ? 'border-[#002d72] bg-blue-50/50 shadow-inner' : 'border-slate-100 hover:border-slate-300'}`}>
                    <p className="text-[8px] font-black uppercase text-slate-400 mb-0.5 tracking-widest">{m.label}</p>
                    <p className={`text-2xl font-black tabular-nums ${m.color}`}>{m.val}</p>
                </div>
              ))}
            </div>

            <div className="mb-6 flex flex-col md:flex-row justify-between items-end gap-4">
                <div className="relative w-full max-w-md">
                    <input type="text" placeholder="Search Unit #..." className="w-full pl-4 pr-10 py-3 bg-white border border-slate-200 rounded-lg text-sm font-bold outline-none focus:border-[#002d72] transition-all" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 font-black text-xs">🔍</span>
                </div>
                <div className="flex items-center gap-4">
                    <div className="bg-white border border-slate-200 rounded-lg p-1 flex">
                        {['list', 'grid'].map((mode) => (
                            <button key={mode} onClick={() => setInventoryMode(mode as any)} className={`px-4 py-1.5 text-[10px] font-black uppercase rounded-md transition-all ${inventoryMode === mode ? 'bg-[#002d72] text-white shadow-md' : 'text-slate-400 hover:text-[#002d72]'}`}>{mode} View</button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden min-h-[500px]">
                {inventoryMode === 'list' ? (
                    <>
                        <div className="grid grid-cols-10 gap-4 p-5 border-b border-slate-100 bg-slate-50/50 text-[9px] font-black uppercase tracking-widest text-slate-400 select-none">
                            <div onClick={() => requestSort('number')} className="col-span-1 cursor-pointer hover:text-[#002d72] flex items-center">Unit # {getSortIcon('number')}</div>
                            <div onClick={() => requestSort('series')} className="col-span-1 cursor-pointer hover:text-[#002d72] flex items-center">Series {getSortIcon('series')}</div>
                            <div onClick={() => requestSort('status')} className="col-span-1 cursor-pointer hover:text-[#002d72] flex items-center">Status {getSortIcon('status')}</div>
                            <div onClick={() => requestSort('location')} className="col-span-1 cursor-pointer hover:text-[#002d72] flex items-center">Location {getSortIcon('location')}</div>
                            <div className="col-span-2">Fault Preview</div>
                            <div onClick={() => requestSort('expectedReturnDate')} className="col-span-1 cursor-pointer hover:text-[#002d72] flex items-center">Exp Return {getSortIcon('expectedReturnDate')}</div>
                            <div onClick={() => requestSort('actualReturnDate')} className="col-span-1 cursor-pointer hover:text-[#002d72] flex items-center">Act Return {getSortIcon('actualReturnDate')}</div>
                            <div onClick={() => requestSort('daysOOS')} className="col-span-1 cursor-pointer hover:text-[#002d72] flex items-center">Days OOS {getSortIcon('daysOOS')}</div>
                        </div>

                        <div className="divide-y divide-slate-100">
                            {sortedBuses.length === 0 ? (
                                <div className="p-12 text-center text-slate-400 italic">No buses found in this category.</div>
                            ) : (
                                sortedBuses.map((bus) => {
                                    const specs = getBusSpecs(bus.number);
                                    const isDown = bus.status !== 'Active';
                                    const days = calculateDaysOOS(bus.oosStartDate, new Date().toISOString().split('T')[0]);
                                    const isHoldGroup = holdStatuses.includes(bus.status);
                                    const rowClass = bus.status === 'Active' ? 'bg-white hover:bg-slate-50 border-l-4 border-l-green-500' :
                                                    isHoldGroup ? 'bg-red-50 hover:bg-red-100 border-l-4 border-l-red-500' :
                                                    'bg-orange-50 hover:bg-orange-100 border-l-4 border-l-orange-500';
                                    const statusTextColor = isHoldGroup ? 'text-red-700' : 
                                                            bus.status === 'Active' ? 'text-[#002d72]' : 'text-orange-700';
                                    const statusBadgeClass = bus.status === 'Active' ? 'bg-green-100 text-green-700 border-green-200' : 
                                                            isHoldGroup ? 'bg-red-100 text-red-700 border-red-200' : 
                                                            'bg-orange-100 text-orange-700 border-orange-200';

                                    return (
                                        <div key={bus.docId} className={`group ${rowClass}`}>
                                            <div onClick={() => setSelectedBusDetail(bus)} className="grid grid-cols-10 gap-4 p-5 items-center cursor-pointer">
                                                <div className={`col-span-1 text-lg font-black ${statusTextColor}`}>#{bus.number}</div>
                                                <div className="col-span-1"><span className="bg-white/50 border border-black/5 text-slate-500 text-[9px] font-bold px-2 py-1 rounded-md">{specs.length}</span></div>
                                                <div className="col-span-1"><span className={`text-[9px] font-black uppercase px-2 py-1 rounded-full border ${statusBadgeClass}`}>{bus.status}</span></div>
                                                <div className="col-span-1 text-xs font-bold text-slate-600">{bus.location || '---'}</div>
                                                <div className="col-span-2 text-xs font-bold text-slate-500 truncate pr-4 italic">{bus.notes ? bus.notes : <span className="opacity-30">No faults</span>}</div>
                                                <div className="col-span-1 text-xs font-bold text-slate-700">{bus.expectedReturnDate || '--'}</div>
                                                <div className="col-span-1 text-xs font-bold text-slate-700">{bus.actualReturnDate || '--'}</div>
                                                <div className="col-span-1 text-xs font-bold text-slate-600">{isDown ? `${days} days` : '-'}</div>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </>
                ) : (
                    <div className="p-8">
                        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 gap-3">
                            {sortedBuses.map((bus) => {
                                let colors = "bg-green-50 border-green-200 text-green-800 hover:border-green-400";
                                if (holdStatuses.includes(bus.status)) colors = "bg-red-50 border-red-200 text-red-800 hover:border-red-400";
                                else if (bus.status !== 'Active') colors = "bg-orange-50 border-orange-200 text-orange-800 hover:border-orange-400";

                                return (
                                    <div key={bus.docId} onClick={() => setSelectedBusDetail(bus)} className={`h-14 rounded-lg border-2 flex flex-col items-center justify-center cursor-pointer shadow-sm ${colors}`}>
                                        <span className="text-xs font-black italic tracking-tighter">#{bus.number}</span>
                                        {bus.status !== 'Active' && <span className="text-[7px] font-bold uppercase opacity-60 leading-none mt-0.5">{bus.status}</span>}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}