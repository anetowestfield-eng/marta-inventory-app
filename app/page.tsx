"use client";
import React, { useState, useEffect } from 'react';
import { db, auth } from './firebaseConfig'; 
import { collection, onSnapshot, query, orderBy, doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

export default function MartaInventory() {
  const [user, setUser] = useState<any>(null);
  const [buses, setBuses] = useState<any[]>([]);
  const [expandedBus, setExpandedBus] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'number', direction: 'asc' });

  const getBusSpecs = (num: string) => {
    const n = parseInt(num);
    const thirtyFt = [1951, 1958, 1959];
    const thirtyFiveFt = [1887, 1888, 1889, 1895, 1909, 1912, 1913, 1921, 1922, 1923, 1924, 1925, 1926, 1927, 1928, 1929, 1930, 1931, 1932, 1933, 1935, 2326, 2343];
    if (thirtyFt.includes(n)) return { length: "30'", type: "S" };
    if (thirtyFiveFt.includes(n)) return { length: "35'", type: "M" };
    return { length: "40'", type: "L" };
  };

  const calculateDaysOOS = (start: string, end: string) => {
    if (!start || !end) return 0;
    const s = new Date(start);
    const e = new Date(end);
    return Math.max(0, Math.ceil((e.getTime() - s.getTime()) / (1000 * 3600 * 24)));
  };

  const requestSort = (key: string) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const sortedBuses = [...buses].filter(b => b.number.includes(searchTerm)).sort((a, b) => {
    let aValue: any = a[sortConfig.key];
    let bValue: any = b[sortConfig.key];

    if (sortConfig.key === 'daysOOS') {
        const today = new Date().toISOString().split('T')[0];
        aValue = calculateDaysOOS(a.oosStartDate, today);
        bValue = calculateDaysOOS(b.oosStartDate, today);
    }
    else if (sortConfig.key === 'series') {
        aValue = getBusSpecs(a.number).length;
        bValue = getBusSpecs(b.number).length;
    }
    else {
        aValue = aValue ? aValue.toLowerCase() : '';
        bValue = bValue ? bValue.toLowerCase() : '';
    }

    if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  const getSortIcon = (key: string) => {
      if (sortConfig.key !== key) return <span className="opacity-20 ml-1">⇅</span>;
      return <span className="ml-1">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>;
  };

  const exportToExcel = async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Vehicle OOS Details');
    worksheet.columns = [
      { header: 'Vehicle Number', key: 'number', width: 15 },
      { header: 'Vehicle Type', key: 'type', width: 12 },
      { header: 'Current Location', key: 'location', width: 20 },
      { header: 'OOS Start Date', key: 'oosStart', width: 25 },
      { header: 'Fault Details', key: 'fault', width: 50 }, 
      { header: 'Expected Return', key: 'expReturn', width: 30 },
      { header: 'Actual Return', key: 'actReturn', width: 30 },
      { header: 'Days OOS', key: 'daysOOS', width: 12 }
    ];
    
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '002D72' } };

    sortedBuses.forEach(bus => {
      const specs = getBusSpecs(bus.number);
      worksheet.addRow({
        number: bus.number,
        type: specs.length,
        location: bus.location || '---',
        oosStart: bus.oosStartDate || '---',
        fault: bus.notes || '---',
        expReturn: bus.expectedReturnDate || '---',
        actReturn: bus.actualReturnDate || '---',
        daysOOS: calculateDaysOOS(bus.oosStartDate, new Date().toISOString().split('T')[0])
      }).getCell('fault').alignment = { wrapText: true, vertical: 'top' };
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
    return onSnapshot(q, (snap) => {
      setBuses(snap.docs.map(doc => ({ ...doc.data(), docId: doc.id })));
    });
  }, [user]);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <form onSubmit={async (e) => { e.preventDefault(); try { await signInWithEmailAndPassword(auth, email, password); } catch (err) {} }} 
          className="bg-white p-10 rounded-2xl shadow-xl w-full max-w-sm border-t-8 border-[#ef7c00]">
          <h2 className="text-2xl font-black text-center mb-8 uppercase text-[#002d72] tracking-tighter italic">MARTA Ops</h2>
          <input type="email" placeholder="Email" className="w-full p-4 border-2 rounded-xl mb-4 font-bold outline-none" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input type="password" placeholder="Password" className="w-full p-4 border-2 rounded-xl mb-8 font-bold outline-none" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button className="w-full bg-[#002d72] text-white font-black py-4 rounded-xl uppercase tracking-widest hover:bg-[#ef7c00] transition-all">Login</button>
        </form>
      </div>
    );
  }

  // Define new maintenance statuses for cleaner logic
  const shopStatuses = ['In Shop', 'Engine', 'Body Shop', 'Vendor', 'Brakes'];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-[#ef7c00] selection:text-white">
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-[1001] px-6 py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-3">
            <div className="w-2 h-6 bg-[#002d72] rounded-full"></div>
            <span className="font-black text-lg italic uppercase tracking-tighter text-[#002d72]">Fleet Manager</span>
        </div>
        <div className="flex gap-4">
          <button onClick={exportToExcel} className="text-[#002d72] hover:text-[#ef7c00] text-[10px] font-black uppercase transition-all tracking-widest">Export Excel</button>
          <button onClick={() => signOut(auth)} className="text-red-500 hover:text-red-700 text-[10px] font-black uppercase transition-all tracking-widest">Logout</button>
        </div>
      </nav>

      <main className="max-w-[1600px] mx-auto p-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
          {[
            { label: 'Total Fleet', val: buses.length, color: 'text-slate-900' },
            { label: 'Ready', val: buses.filter(b => b.status === 'Active').length, color: 'text-green-600' },
            { label: 'On Hold', val: buses.filter(b => b.status === 'On Hold').length, color: 'text-red-600' },
            /* Updated In Shop logic to include new statuses */
            { label: 'In Shop', val: buses.filter(b => shopStatuses.includes(b.status)).length, color: 'text-[#ef7c00]' }
          ].map((m, i) => (
            <div key={i} className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col items-center justify-center">
                <p className="text-[9px] font-black uppercase text-slate-400 mb-1 tracking-widest">{m.label}</p>
                <p className={`text-4xl font-black tabular-nums ${m.color}`}>{m.val}</p>
            </div>
          ))}
        </div>

        <div className="mb-6 flex justify-between items-end">
            <div className="relative w-full max-w-md">
                <input type="text" placeholder="Search Unit #..." 
                  className="w-full pl-4 pr-10 py-3 bg-white border border-slate-200 rounded-lg text-sm font-bold outline-none focus:border-[#002d72] transition-all" 
                  value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 font-black text-xs">🔍</span>
            </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="grid grid-cols-10 gap-4 p-5 border-b border-slate-100 bg-slate-50/50 text-[9px] font-black uppercase tracking-widest text-slate-400 select-none">
                <div onClick={() => requestSort('number')} className="col-span-1 cursor-pointer hover:text-[#002d72] flex items-center">Unit # {getSortIcon('number')}</div>
                <div onClick={() => requestSort('series')} className="col-span-1 cursor-pointer hover:text-[#002d72] flex items-center">Series {getSortIcon('series')}</div>
                <div onClick={() => requestSort('status')} className="col-span-1 cursor-pointer hover:text-[#002d72] flex items-center">Status {getSortIcon('status')}</div>
                <div onClick={() => requestSort('location')} className="col-span-1 cursor-pointer hover:text-[#002d72] flex items-center">Location {getSortIcon('location')}</div>
                <div className="col-span-2">Fault Preview</div>
                <div onClick={() => requestSort('expectedReturnDate')} className="col-span-1 cursor-pointer hover:text-[#002d72] flex items-center">Exp Return {getSortIcon('expectedReturnDate')}</div>
                <div onClick={() => requestSort('actualReturnDate')} className="col-span-1 cursor-pointer hover:text-[#002d72] flex items-center">Act Return {getSortIcon('actualReturnDate')}</div>
                <div onClick={() => requestSort('daysOOS')} className="col-span-1 cursor-pointer hover:text-[#002d72] flex items-center">Days OOS {getSortIcon('daysOOS')}</div>
                <div className="col-span-1 text-right">Action</div>
            </div>

            <div className="divide-y divide-slate-100">
                {sortedBuses.map((bus) => {
                    const specs = getBusSpecs(bus.number);
                    const isDown = bus.status !== 'Active';
                    const isExpanded = expandedBus === bus.docId;
                    const days = calculateDaysOOS(bus.oosStartDate, new Date().toISOString().split('T')[0]);

                    /* Updated Row Coloring Logic for new statuses */
                    const rowClass = bus.status === 'Active' ? 'bg-white hover:bg-slate-50 border-l-4 border-l-green-500' :
                                     bus.status === 'On Hold' ? 'bg-red-50 hover:bg-red-100 border-l-4 border-l-red-500' :
                                     'bg-orange-50 hover:bg-orange-100 border-l-4 border-l-orange-500';

                    const statusTextColor = bus.status === 'On Hold' ? 'text-red-700' : 
                                            bus.status === 'Active' ? 'text-[#002d72]' : 'text-orange-700';

                    const statusBadgeClass = bus.status === 'Active' ? 'bg-green-100 text-green-700 border-green-200' : 
                                             bus.status === 'On Hold' ? 'bg-red-100 text-red-700 border-red-200' : 
                                             'bg-orange-100 text-orange-700 border-orange-200';

                    return (
                        <div key={bus.docId} className={`group transition-all duration-200 ${rowClass}`}>
                            <div onClick={() => setExpandedBus(isExpanded ? null : bus.docId)} className="grid grid-cols-10 gap-4 p-5 items-center cursor-pointer">
                                <div className={`col-span-1 text-lg font-black ${statusTextColor}`}>#{bus.number}</div>
                                <div className="col-span-1"><span className="bg-white/50 border border-black/5 text-slate-500 text-[9px] font-bold px-2 py-1 rounded-md">{specs.length}</span></div>
                                <div className="col-span-1"><span className={`text-[9px] font-black uppercase px-2 py-1 rounded-full border ${statusBadgeClass}`}>{bus.status}</span></div>
                                <div className="col-span-1 text-xs font-bold text-slate-600">{bus.location || '---'}</div>
                                <div className="col-span-2 text-xs font-bold text-slate-500 truncate pr-4 italic">{bus.notes ? bus.notes : <span className="opacity-30">No faults</span>}</div>
                                
                                <div className="col-span-1 text-xs font-bold text-slate-700">{bus.expectedReturnDate || '--'}</div>
                                <div className="col-span-1 text-xs font-bold text-slate-700">{bus.actualReturnDate || '--'}</div>

                                <div className="col-span-1 text-xs font-bold text-slate-600">{isDown ? `${days} days` : '-'}</div>
                                <div className="col-span-1 text-right"><span className="text-[#002d72] font-black text-[10px] uppercase opacity-50 group-hover:opacity-100 transition-opacity">{isExpanded ? 'Close' : 'Edit'}</span></div>
                            </div>

                            {isExpanded && (
                                <div className="bg-white/50 border-t border-black/5 p-6 animate-in slide-in-from-top-2">
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                        <div className="space-y-4">
                                            <div>
                                                <label className="text-[9px] font-black uppercase text-slate-400">Change Status</label>
                                                {/* ADDED NEW STATUS OPTIONS HERE */}
                                                <select className="w-full p-3 bg-white border border-slate-200 rounded-lg text-xs font-bold mt-1 outline-none focus:border-[#002d72]" 
                                                    value={bus.status}
                                                    onChange={async (e) => await setDoc(doc(db, "buses", bus.docId), { status: e.target.value, timestamp: serverTimestamp() }, { merge: true })}>
                                                    <option value="Active">Ready for Service</option>
                                                    <option value="On Hold">Maintenance Hold</option>
                                                    <option value="In Shop">In Shop</option>
                                                    <option value="Engine">Engine</option>
                                                    <option value="Body Shop">Body Shop</option>
                                                    <option value="Vendor">Vendor</option>
                                                    <option value="Brakes">Brakes</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="text-[9px] font-black uppercase text-slate-400">Location</label>
                                                <input type="text" className="w-full p-3 bg-white border border-slate-200 rounded-lg text-xs font-bold mt-1 outline-none focus:border-[#002d72]" 
                                                    value={bus.location || ''} placeholder="e.g. Hamilton"
                                                    onChange={async (e) => await setDoc(doc(db, "buses", bus.docId), { location: e.target.value }, { merge: true })} />
                                            </div>
                                            <div>
                                                <label className="text-[9px] font-black uppercase text-slate-400">OOS Start Date</label>
                                                <input type="date" className="w-full p-3 bg-white border border-slate-200 rounded-lg text-xs font-bold mt-1 outline-none focus:border-[#002d72]" 
                                                    value={bus.oosStartDate || ''}
                                                    onChange={async (e) => await setDoc(doc(db, "buses", bus.docId), { oosStartDate: e.target.value }, { merge: true })} />
                                            </div>
                                        </div>
                                        <div className="md:col-span-2 flex flex-col space-y-4">
                                            <div>
                                                <label className="text-[9px] font-black uppercase text-slate-400 mb-1">Fault Details / Notes</label>
                                                <textarea className="w-full p-4 bg-white border border-slate-200 rounded-lg text-xs font-medium outline-none focus:border-[#002d72] h-24" 
                                                    placeholder="Enter technical details here..." value={bus.notes || ''}
                                                    onChange={async (e) => await setDoc(doc(db, "buses", bus.docId), { notes: e.target.value }, { merge: true })} />
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <label className="text-[9px] font-black uppercase text-slate-400">Expected Return</label>
                                                    <input type="date" className="w-full p-3 bg-white border border-slate-200 rounded-lg text-xs font-bold mt-1 outline-none focus:border-[#002d72]" 
                                                        value={bus.expectedReturnDate || ''}
                                                        onChange={async (e) => await setDoc(doc(db, "buses", bus.docId), { expectedReturnDate: e.target.value }, { merge: true })} />
                                                </div>
                                                <div>
                                                    <label className="text-[9px] font-black uppercase text-slate-400">Actual Return</label>
                                                    <input type="date" className="w-full p-3 bg-white border border-slate-200 rounded-lg text-xs font-bold mt-1 outline-none focus:border-[#002d72]" 
                                                        value={bus.actualReturnDate || ''}
                                                        onChange={async (e) => await setDoc(doc(db, "buses", bus.docId), { actualReturnDate: e.target.value }, { merge: true })} />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-slate-200/50">
                                        <button 
                                            onClick={async () => {
                                                if(confirm('Clear data for this unit?')) {
                                                    await updateDoc(doc(db, "buses", bus.docId), {
                                                        notes: '', location: '', oosStartDate: '', expectedReturnDate: '', actualReturnDate: ''
                                                    });
                                                }
                                            }}
                                            className="px-4 py-2 text-red-500 hover:bg-red-50 rounded-lg text-[10px] font-black uppercase transition-colors"
                                        >
                                            Clear Form
                                        </button>
                                        <button 
                                            onClick={() => setExpandedBus(null)} 
                                            className="px-6 py-2 bg-[#002d72] hover:bg-[#001a3d] text-white rounded-lg text-[10px] font-black uppercase transition-colors shadow-md"
                                        >
                                            Save & Close
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
      </main>
    </div>
  );
}