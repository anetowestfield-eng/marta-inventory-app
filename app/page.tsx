"use client";
import React, { useState, useEffect } from 'react';
import { db, auth } from './firebaseConfig'; 
import { collection, onSnapshot, query, orderBy, doc, serverTimestamp, setDoc, writeBatch, getDocs } from "firebase/firestore";
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

// --- COMPONENT: Read-Only Bus Details (Inventory Tab) ---
const BusDetailView = ({ bus, onClose }: { bus: any; onClose: () => void }) => {
    const [showHistory, setShowHistory] = useState(false);

    // Placeholder history data - in a real app this would query a sub-collection
    const historyLog = [
        { date: '2025-01-15', event: 'Preventative Maintenance', type: 'Routine' },
        { date: '2024-11-20', event: 'Brake Replacement', type: 'Repair' },
        { date: '2024-08-05', event: 'AC Unit Service', type: 'Vendor' }
    ];

    if (showHistory) {
        return (
            <div className="bg-white p-6 rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg h-[500px] flex flex-col animate-in zoom-in-95">
                <div className="flex justify-between items-center mb-4 border-b pb-4">
                    <h3 className="text-xl font-black text-[#002d72] uppercase">History: Bus #{bus.number}</h3>
                    <button onClick={() => setShowHistory(false)} className="text-sm font-bold text-slate-400 hover:text-[#002d72]">Back</button>
                </div>
                <div className="flex-grow overflow-y-auto space-y-3">
                    {historyLog.map((log, i) => (
                        <div key={i} className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                            <div className="flex justify-between text-[10px] font-black uppercase text-slate-400 mb-1">
                                <span>{log.date}</span>
                                <span>{log.type}</span>
                            </div>
                            <p className="text-sm font-bold text-slate-700">{log.event}</p>
                        </div>
                    ))}
                    <div className="text-center text-xs text-slate-400 italic mt-4">End of recent records</div>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white p-8 rounded-xl shadow-2xl border border-slate-200 w-full max-w-2xl animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-start mb-8 border-b border-slate-100 pb-6">
                <div>
                    <h3 className="text-4xl font-black text-[#002d72] italic uppercase tracking-tighter">Bus #{bus.number}</h3>
                    <span className={`inline-block mt-2 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${bus.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {bus.status}
                    </span>
                </div>
                <button onClick={onClose} className="w-10 h-10 flex items-center justify-center bg-slate-100 hover:bg-slate-200 rounded-full text-slate-500 font-bold text-xl transition-colors">✕</button>
            </div>
            
            <div className="grid grid-cols-2 gap-8 mb-8">
                <div className="col-span-2 bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <label className="text-[9px] font-black uppercase text-slate-400 block mb-2">Fault Details / Notes</label>
                    <p className="text-lg font-medium text-slate-800 leading-relaxed">
                        {bus.notes || <span className="italic text-slate-400 opacity-50">No active fault details recorded.</span>}
                    </p>
                </div>
                
                <div className="space-y-1">
                    <label className="text-[9px] font-black uppercase text-slate-400">OOS Date</label>
                    <p className="text-xl font-black text-[#002d72]">{bus.oosStartDate || '--'}</p>
                </div>
                <div className="space-y-1">
                    <label className="text-[9px] font-black uppercase text-slate-400">Location</label>
                    <p className="text-xl font-black text-slate-700">{bus.location || '---'}</p>
                </div>
                <div className="space-y-1">
                    <label className="text-[9px] font-black uppercase text-slate-400">Expected Return</label>
                    <p className="text-xl font-black text-[#ef7c00]">{bus.expectedReturnDate || '--'}</p>
                </div>
                <div className="space-y-1">
                    <label className="text-[9px] font-black uppercase text-slate-400">Actual Return</label>
                    <p className="text-xl font-black text-green-600">{bus.actualReturnDate || '--'}</p>
                </div>
            </div>

            <div className="flex justify-between items-center pt-6 border-t border-slate-100">
                <button onClick={() => setShowHistory(true)} className="flex items-center gap-2 px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-black uppercase transition-all">
                    <span>📜</span> View History
                </button>
                <button onClick={onClose} className="px-8 py-3 bg-[#002d72] hover:bg-[#001a3d] text-white rounded-lg text-xs font-black uppercase transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5">
                    Close Profile
                </button>
            </div>
        </div>
    );
};

// --- COMPONENT: Data Entry Form (With Clear All) ---
const BusInputForm = () => {
    const [formData, setFormData] = useState({
        number: '',
        status: 'Active',
        location: '',
        notes: '',
        oosStartDate: '',
        expectedReturnDate: '',
        actualReturnDate: ''
    });

    const handleChange = (e: any) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.number) return;

        try {
            await setDoc(doc(db, "buses", formData.number), {
                ...formData,
                timestamp: serverTimestamp()
            }, { merge: true });
            
            alert(`Bus #${formData.number} Saved!`);
            setFormData(prev => ({ ...prev, number: '', status: 'Active', notes: '' })); 
        } catch (err) {
            console.error(err);
            alert("Error saving record.");
        }
    };

    // --- NEW: Global Clear Function ---
    const handleGlobalReset = async () => {
        if (!confirm("⚠️ DANGER: This will set EVERY bus in the fleet to 'Active' status and clear all fault notes.\n\nAre you absolutely sure?")) return;
        
        try {
            const querySnapshot = await getDocs(collection(db, "buses"));
            const batch = writeBatch(db);
            
            querySnapshot.docs.forEach((document) => {
                batch.update(doc(db, "buses", document.id), {
                    status: 'Active',
                    notes: '',
                    location: '',
                    oosStartDate: '',
                    expectedReturnDate: '',
                    actualReturnDate: ''
                });
            });

            await batch.commit();
            alert("✅ Fleet Reset Complete. All buses are now Active.");
        } catch (err) {
            console.error("Batch reset failed:", err);
            alert("Failed to reset fleet.");
        }
    };

    return (
        <div className="max-w-2xl mx-auto mt-10 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
            <div className="bg-white p-8 rounded-2xl shadow-xl border-t-8 border-[#002d72]">
                <div className="mb-8 text-center">
                    <h2 className="text-3xl font-black text-[#002d72] italic uppercase tracking-tighter">Data Entry Terminal</h2>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-2">Add or Update Fleet Units</p>
                </div>
                
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="grid grid-cols-2 gap-6">
                        <div className="col-span-1">
                            <label className="text-[10px] font-black uppercase text-slate-500 mb-1 block">Bus Number</label>
                            <input name="number" type="text" placeholder="e.g. 1402" className="w-full p-4 bg-slate-50 border-2 border-slate-200 rounded-xl text-lg font-black text-[#002d72] outline-none focus:border-[#ef7c00] transition-all" value={formData.number} onChange={handleChange} required autoFocus />
                        </div>
                        <div className="col-span-1">
                            <label className="text-[10px] font-black uppercase text-slate-500 mb-1 block">Status</label>
                            <select name="status" className="w-full p-4 bg-slate-50 border-2 border-slate-200 rounded-xl font-bold outline-none focus:border-[#002d72] transition-all" value={formData.status} onChange={handleChange}>
                                <option value="Active">Ready for Service</option>
                                <option value="On Hold">Maintenance Hold</option>
                                <option value="In Shop">In Shop</option>
                                <option value="Engine">Engine</option>
                                <option value="Body Shop">Body Shop</option>
                                <option value="Vendor">Vendor</option>
                                <option value="Brakes">Brakes</option>
                                <option value="Safety">Safety</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="text-[10px] font-black uppercase text-slate-500 mb-1 block">Location</label>
                        <input name="location" type="text" placeholder="e.g. Hamilton / Annex / Perry" className="w-full p-3 bg-slate-50 border-2 border-slate-200 rounded-xl font-bold outline-none focus:border-[#002d72] transition-all" value={formData.location} onChange={handleChange} />
                    </div>

                    <div>
                        <label className="text-[10px] font-black uppercase text-slate-500 mb-1 block">Fault Details / Notes</label>
                        <textarea name="notes" className="w-full p-4 bg-slate-50 border-2 border-slate-200 rounded-xl font-medium outline-none focus:border-[#002d72] h-24 resize-none transition-all" placeholder="Enter maintenance notes..." value={formData.notes} onChange={handleChange} />
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <label className="text-[9px] font-black uppercase text-slate-400 block mb-1">OOS Date</label>
                            <input name="oosStartDate" type="date" className="w-full p-2 bg-slate-50 border-2 border-slate-200 rounded-lg text-xs font-bold outline-none focus:border-[#002d72]" value={formData.oosStartDate} onChange={handleChange} />
                        </div>
                        <div>
                            <label className="text-[9px] font-black uppercase text-slate-400 block mb-1">Exp Return</label>
                            <input name="expectedReturnDate" type="date" className="w-full p-2 bg-slate-50 border-2 border-slate-200 rounded-lg text-xs font-bold outline-none focus:border-[#002d72]" value={formData.expectedReturnDate} onChange={handleChange} />
                        </div>
                        <div>
                            <label className="text-[9px] font-black uppercase text-slate-400 block mb-1">Act Return</label>
                            <input name="actualReturnDate" type="date" className="w-full p-2 bg-slate-50 border-2 border-slate-200 rounded-lg text-xs font-bold outline-none focus:border-[#002d72]" value={formData.actualReturnDate} onChange={handleChange} />
                        </div>
                    </div>

                    <button className="w-full py-4 bg-[#002d72] hover:bg-[#ef7c00] text-white rounded-xl font-black uppercase tracking-widest shadow-lg transform active:scale-95 transition-all">
                        Save Record
                    </button>
                </form>

                {/* CLEAR ALL BUTTON */}
                <div className="mt-12 pt-8 border-t border-slate-100 text-center">
                    <button onClick={handleGlobalReset} className="text-red-500 hover:text-red-700 hover:bg-red-50 px-6 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all">
                        ⚠️ Reset Entire Fleet to Ready
                    </button>
                </div>
            </div>
        </div>
    );
};

export default function MartaInventory() {
  const [user, setUser] = useState<any>(null);
  const [view, setView] = useState<'inventory' | 'tracker' | 'input'>('inventory');
  const [inventoryMode, setInventoryMode] = useState<'list' | 'grid'>('grid');
  const [buses, setBuses] = useState<any[]>([]);
  const [selectedBusDetail, setSelectedBusDetail] = useState<any>(null); // For Read-Only Modal
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

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.readAsArrayBuffer(file);
    
    reader.onload = async () => {
      try {
        const buffer = reader.result as ArrayBuffer;
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        const worksheet = workbook.getWorksheet(1);

        const uploadQueue: any[] = [];
        worksheet?.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return; 
          
          const busNum = row.getCell(1).value?.toString();
          if (busNum) {
            uploadQueue.push({
              number: busNum,
              status: row.getCell(3).value || 'Active',
              location: row.getCell(4).value || '',
              notes: row.getCell(5).value || '',
              expectedReturnDate: row.getCell(6).value || '',
              actReturnDate: row.getCell(7).value || '',
              oosStartDate: row.getCell(8).value || ''
            });
          }
        });

        for (const data of uploadQueue) {
          await setDoc(doc(db, "buses", data.number), data, { merge: true });
        }
        alert(`Successfully synced ${uploadQueue.length} units from Excel.`);
      } catch (err) {
        console.error("Upload Error:", err);
        alert("Failed to process Excel file.");
      }
    };
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
    const q = query(collection(db, "buses"), orderBy("number", "asc"));
    return onSnapshot(q, (snap) => setBuses(snap.docs.map(doc => ({ ...doc.data(), docId: doc.id }))));
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
    if (activeFilter === 'Ready') return b.status === 'Active';
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
      
      {/* DISPLAY MODAL (Read Only) */}
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
        <div className="flex gap-6 items-center">
          <button onClick={() => setView('inventory')} className={`text-[10px] font-black uppercase transition-all tracking-widest border-b-2 pb-1 ${view === 'inventory' ? 'border-[#ef7c00] text-[#002d72]' : 'border-transparent text-slate-400 hover:text-[#002d72]'}`}>Inventory</button>
          <button onClick={() => setView('input')} className={`text-[10px] font-black uppercase transition-all tracking-widest border-b-2 pb-1 ${view === 'input' ? 'border-[#ef7c00] text-[#002d72]' : 'border-transparent text-slate-400 hover:text-[#002d72]'}`}>Data Entry</button>
          <button onClick={() => setView('tracker')} className={`text-[10px] font-black uppercase transition-all tracking-widest border-b-2 pb-1 ${view === 'tracker' ? 'border-[#ef7c00] text-[#002d72]' : 'border-transparent text-slate-400 hover:text-[#002d72]'}`}>Route Viewer</button>
          
          <div className="h-4 w-[1px] bg-slate-200"></div>
          
          <div className="flex gap-4">
              <label className="text-green-600 hover:text-green-800 text-[10px] font-black uppercase transition-all tracking-widest cursor-pointer">
                Upload Excel
                <input type="file" accept=".xlsx, .xls" className="hidden" onChange={handleExcelUpload} />
              </label>
              <button onClick={exportToExcel} className="text-[#002d72] hover:text-[#ef7c00] text-[10px] font-black uppercase transition-all tracking-widest">Export Excel</button>
          </div>
          
          <button onClick={() => signOut(auth)} className="text-red-500 hover:text-red-700 text-[10px] font-black uppercase tracking-widest">Logout</button>
        </div>
      </nav>

      <main className="max-w-[1600px] mx-auto p-6">
        {view === 'tracker' ? (
          <div className="h-[85vh] bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden relative"><BusTracker /></div>
        ) : view === 'input' ? (
          <BusInputForm />
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {[
                { label: 'Total Fleet', val: buses.length, color: 'text-slate-900' },
                { label: 'Ready', val: buses.filter(b => b.status === 'Active').length, color: 'text-green-600' },
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
                            {/* No action column */}
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