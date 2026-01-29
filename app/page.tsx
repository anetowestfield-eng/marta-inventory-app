"use client";
import React, { useState, useEffect } from 'react';
import { db, auth } from './firebaseConfig'; 
import { 
  collection, addDoc, onSnapshot, query, orderBy, 
  deleteDoc, doc, serverTimestamp, updateDoc, getDoc, setDoc, getDocs, writeBatch 
} from "firebase/firestore";
import { 
  onAuthStateChanged, signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, signOut, User 
} from "firebase/auth";
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

export default function MartaInventory() {
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState('fleet'); 
  const [viewMode, setViewMode] = useState('list'); 
  const [sortKey, setSortKey] = useState('timestamp'); 
  const [historySortKey, setHistorySortKey] = useState('timestamp'); 
  const [isApproved, setIsApproved] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false); 
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [view, setView] = useState('login');

  const [buses, setBuses] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);

  const [searchTerm, setSearchTerm] = useState('');
  const [historySearchTerm, setHistorySearchTerm] = useState(''); 
  const [busNumber, setBusNumber] = useState('');
  const [status, setStatus] = useState('Active');
  const [notes, setNotes] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        const adminEmail = 'anetowestfield@gmail.com'; 
        const userSnap = await getDoc(doc(db, "users", currentUser.uid));
        
        if (userSnap.exists()) {
          const data = userSnap.data();
          setIsApproved(data.approved || currentUser.email === adminEmail);
          setIsAdmin(data.role === 'admin' || currentUser.email === adminEmail);
        } else if (currentUser.email === adminEmail) {
          await setDoc(doc(db, "users", currentUser.uid), { 
            email: currentUser.email, 
            approved: true, 
            role: 'admin' 
          });
          setIsApproved(true);
          setIsAdmin(true);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !isApproved) return;
    const unsubBuses = onSnapshot(query(collection(db, "buses"), orderBy("timestamp", "desc")), (snap) => {
      setBuses(snap.docs.map(doc => ({ ...doc.data(), docId: doc.id })));
    });
    const unsubHistory = onSnapshot(query(collection(db, "history"), orderBy("timestamp", "desc")), (snap) => {
      setHistory(snap.docs.map(doc => ({ ...doc.data(), docId: doc.id })));
    });
    
    if (isAdmin) {
      onSnapshot(collection(db, "users"), (snap) => {
        setAllUsers(snap.docs.map(doc => ({ ...doc.data(), uid: doc.id })));
      });
    }
  }, [user, isApproved, isAdmin]);

  // Admin Only: Clear Entire History
  const clearHistory = async () => {
    if (!window.confirm("ARE YOU SURE? This will permanently delete all maintenance logs.")) return;
    const batch = writeBatch(db);
    const snap = await getDocs(collection(db, "history"));
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    alert("History cleared.");
  };

  const sortedBuses = [...buses]
    .filter(b => b.number.includes(searchTerm.toUpperCase()))
    .sort((a, b) => {
      if (sortKey === 'number') return a.number.localeCompare(b.number);
      if (sortKey === 'status') return a.status.localeCompare(b.status);
      return 0; 
    });

  const sortedHistory = [...history]
    .filter(h => h.number.includes(historySearchTerm.toUpperCase()))
    .sort((a, b) => {
      if (historySortKey === 'number') return a.number.localeCompare(b.number);
      return 0; 
    });

  const exportToExcel = async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('MARTA Fleet');
    worksheet.columns = [
      { header: 'Unit #', key: 'number', width: 15 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Notes', key: 'notes', width: 50 },
      { header: 'Tech', key: 'tech', width: 25 },
    ];
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '002D72' } };

    sortedBuses.forEach(bus => {
      const row = worksheet.addRow({
        number: bus.number,
        status: bus.status.toUpperCase(),
        notes: bus.notes || '---',
        tech: bus.modifiedBy,
      });
      const statusCell = row.getCell('status');
      if (bus.status === 'Active') {
        statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'C6EFCE' } };
      } else if (bus.status === 'On Hold') {
        statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC7CE' } };
      }
    });

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `MARTA_Report.xlsx`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[a-zA-Z0-9]{4}$/.test(busNumber)) return;
    const data = { 
      number: busNumber.toUpperCase(), 
      status, 
      notes, 
      modifiedBy: user?.email, 
      timestamp: serverTimestamp() 
    };
    if (editingId) {
      await updateDoc(doc(db, "buses", editingId), data);
      await addDoc(collection(db, "history"), { ...data, action: "EDIT" });
      setEditingId(null);
    } else {
      await addDoc(collection(db, "buses"), data);
      await addDoc(collection(db, "history"), { ...data, action: "NEW" });
    }
    setBusNumber(''); setNotes(''); setStatus('Active');
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#002d72] p-4 text-slate-900">
        <form onSubmit={async (e) => {
          e.preventDefault();
          try {
            if (view === 'login') await signInWithEmailAndPassword(auth, email, password);
            else {
              const res = await createUserWithEmailAndPassword(auth, email, password);
              await setDoc(doc(db, "users", res.user.uid), { email, approved: false, role: 'user' });
            }
          } catch (err: any) { alert(err.message); }
        }} className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md border-t-8 border-[#ef7c00]">
          <h2 className="text-2xl font-black text-center mb-6 uppercase text-[#002d72]">{view}</h2>
          <input type="email" placeholder="Email" className="w-full p-4 border-2 rounded-xl mb-4 font-bold" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input type="password" placeholder="Password" className="w-full p-4 border-2 rounded-xl mb-6 font-bold" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button className="w-full bg-[#ef7c00] text-white font-black py-4 rounded-xl shadow-lg uppercase">{view}</button>
          <button type="button" onClick={() => setView(view === 'login' ? 'signup' : 'login')} className="w-full mt-4 text-[10px] uppercase font-bold text-[#002d72] underline text-center block tracking-widest">Switch Mode</button>
        </form>
      </div>
    );
  }

  if (!isApproved) return <div className="p-20 text-center font-black text-[#002d72] uppercase">Access Pending Approval</div>;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20 font-sans">
      <nav className="bg-[#002d72] text-white p-4 flex justify-between items-center sticky top-0 z-[1001] shadow-lg">
        <span className="font-black text-lg tracking-tighter uppercase italic">MARTA Fleet Portal</span>
        <div className="flex bg-slate-800 p-1 rounded-lg">
          {['fleet', 'history', 'admin'].map((tab) => (
            (tab !== 'admin' || isAdmin) && (
              <button key={tab} onClick={() => setActiveTab(tab)} className={`px-6 py-1.5 rounded-md text-[10px] font-black uppercase transition-all ${activeTab === tab ? 'bg-[#ef7c00]' : ''}`}>
                {tab}
              </button>
            )
          ))}
        </div>
        <button onClick={() => signOut(auth)} className="text-[10px] bg-red-600 px-3 py-1 rounded font-bold uppercase">Logout</button>
      </nav>

      <main className="max-w-6xl mx-auto p-4 md:p-10">
        {activeTab === 'fleet' ? (
          <>
            <div className="flex flex-wrap gap-4 mb-10">
              <div className="flex-1 bg-white p-4 rounded-xl shadow-sm border-b-4 border-[#002d72] min-w-[120px]"><p className="text-[9px] font-black text-slate-400 uppercase">Total</p><p className="text-xl font-black">{buses.length}</p></div>
              <div className="flex-1 bg-white p-4 rounded-xl shadow-sm border-b-4 border-green-500 min-w-[120px]"><p className="text-[9px] font-black text-slate-400 uppercase">Ready</p><p className="text-xl font-black text-green-600 text-slate-900">{buses.filter(b=>b.status==='Active').length}</p></div>
              <div className="flex-1 bg-white p-4 rounded-xl shadow-sm border-b-4 border-red-600 min-w-[120px]"><p className="text-[9px] font-black text-slate-400 uppercase">Hold</p><p className="text-xl font-black text-red-600">{buses.filter(b=>b.status==='On Hold').length}</p></div>
              <div className="flex-1 bg-white p-4 rounded-xl shadow-sm border-b-4 border-amber-500 min-w-[120px]"><p className="text-[9px] font-black text-slate-400 uppercase">Shop</p><p className="text-xl font-black text-amber-600 text-slate-900">{buses.filter(b=>b.status==='In Shop').length}</p></div>
            </div>

            <section className="bg-white p-6 rounded-2xl shadow-xl mb-12 border border-slate-200">
              <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <input type="text" placeholder="Unit #" maxLength={4} className="p-4 border-2 border-slate-100 rounded-xl font-black uppercase text-slate-900" value={busNumber} onChange={(e) => setBusNumber(e.target.value)} required />
                <select className="p-4 border-2 border-slate-100 rounded-xl font-bold bg-slate-50 text-slate-900" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="Active">Ready</option><option value="On Hold">Hold</option><option value="In Shop">Shop</option>
                </select>
                <input type="text" placeholder="Diagnostics..." className="p-4 border-2 border-slate-100 rounded-xl text-slate-900" value={notes} onChange={(e) => setNotes(e.target.value)} />
                <button type="submit" className="bg-[#ef7c00] text-white font-black py-4 rounded-xl shadow-lg uppercase">{editingId ? "Save" : "Update"}</button>
              </form>
            </section>

            <div className="mb-6 flex flex-col md:flex-row gap-4 items-center">
              <input type="text" placeholder="🔍 Search Unit #..." className="flex-1 p-4 border-2 border-slate-200 rounded-xl shadow-sm outline-none font-bold text-slate-900" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
              <div className="flex bg-slate-200 p-1 rounded-xl w-full md:w-auto">
                <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} className="bg-transparent text-[10px] font-black uppercase px-4 outline-none text-[#002d72]">
                    <option value="timestamp">Newest</option>
                    <option value="number">Unit #</option>
                    <option value="status">Status</option>
                </select>
                {['card', 'list', 'compact'].map((mode) => (
                  <button key={mode} onClick={() => setViewMode(mode)} className={`flex-1 px-4 py-2 rounded-lg text-[10px] font-black uppercase ${viewMode === mode ? 'bg-white shadow-sm text-[#002d72]' : 'text-slate-400'}`}>
                    {mode}
                  </button>
                ))}
              </div>
              <button onClick={exportToExcel} className="w-full md:w-auto bg-[#002d72] text-white px-6 py-4 rounded-xl font-black text-[10px] uppercase shadow-lg">Export</button>
            </div>
            
            <div className={viewMode === 'card' ? "grid grid-cols-1 md:grid-cols-3 gap-6" : "space-y-3"}>
              {sortedBuses.map((bus) => (
                <div key={bus.docId} className={`bg-white p-4 rounded-xl shadow-sm border-l-8 transition-all hover:shadow-md ${bus.status === 'Active' ? 'border-green-500' : bus.status === 'On Hold' ? 'border-red-600' : 'border-amber-500'} ${viewMode === 'list' ? 'flex flex-col md:flex-row items-center justify-between' : ''}`}>
                  <div className="flex items-center gap-6">
                    <span className="text-2xl font-black text-[#002d72] w-20 tracking-tighter">#{bus.number}</span>
                    <span className={`text-[10px] font-black px-3 py-1 rounded-full uppercase min-w-[70px] text-center ${bus.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{bus.status === 'Active' ? 'Ready' : bus.status}</span>
                  </div>
                  <div className="flex-1 px-0 md:px-8 py-2 md:py-0 min-w-0">
                    <p className="text-slate-500 text-xs font-medium italic break-all">"{bus.notes || "---"}"</p>
                  </div>
                  <div className="flex gap-4 items-center">
                    <span className="text-[9px] font-bold text-slate-300 uppercase tracking-widest">{bus.modifiedBy?.split('@')[0]}</span>
                    {isAdmin && <button onClick={() => deleteDoc(doc(db, "buses", bus.docId))} className="text-red-300 font-bold text-[10px] uppercase">Del</button>}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : activeTab === 'history' ? (
          <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-100 text-slate-900">
            <div className="flex justify-between items-center mb-8 border-b pb-4">
                <h2 className="text-xl font-black text-[#002d72] uppercase tracking-widest italic">Maintenance Timeline</h2>
                {/* Admin Only Clear Button */}
                {isAdmin && (
                    <button onClick={clearHistory} className="bg-red-600 text-white px-4 py-2 rounded-lg text-[10px] font-black uppercase hover:bg-black transition-all shadow-md">
                        Clear History
                    </button>
                )}
            </div>
            
            <div className="mb-6 flex flex-col md:flex-row gap-4 items-center">
                <input type="text" placeholder="🔍 Search History Unit #..." className="flex-1 p-4 border-2 border-slate-200 rounded-xl shadow-sm outline-none font-bold" value={historySearchTerm} onChange={(e) => setHistorySearchTerm(e.target.value)} />
                <select value={historySortKey} onChange={(e) => setHistorySortKey(e.target.value)} className="bg-slate-100 text-[10px] font-black uppercase px-6 py-4 rounded-xl outline-none text-[#002d72] shadow-sm">
                    <option value="timestamp">Newest First</option>
                    <option value="number">Unit #</option>
                </select>
            </div>

            <div className="space-y-4">
              {sortedHistory.slice(0, 100).map((log, i) => (
                <div key={i} className="flex flex-col md:flex-row items-center justify-between p-4 bg-slate-50 rounded-xl border-l-4 border-slate-200 hover:shadow-md transition-all">
                  <div className="flex items-center gap-6 w-full md:w-auto">
                    <span className="text-lg font-black text-[#002d72] w-16 tracking-tighter font-black">#{log.number}</span>
                    <span className={`text-[8px] font-black px-2 py-1 rounded-full uppercase ${log.action === 'NEW' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>{log.action}</span>
                  </div>
                  <div className="flex-1 px-0 md:px-8 py-2 md:py-0 w-full md:w-auto min-w-0">
                    <p className="text-slate-400 text-[11px] font-medium italic break-all">"{log.notes || "---"}"</p>
                  </div>
                  <div className="text-right w-full md:w-auto">
                    <span className="font-mono text-[9px] text-slate-300 block">{(log.timestamp?.toDate().toLocaleString())}</span>
                    <span className="text-[8px] font-bold text-[#002d72] uppercase opacity-40 tracking-widest">{log.modifiedBy?.split('@')[0]}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-100 text-slate-900">
            <h2 className="text-xl font-black text-[#002d72] uppercase mb-8 tracking-widest border-b pb-4">Team Management</h2>
            <div className="space-y-4">
              {allUsers.filter(u => u.email !== 'anetowestfield@gmail.com').map((member, i) => (
                <div key={i} className="flex flex-col md:flex-row items-center justify-between p-6 bg-slate-50 rounded-2xl border border-slate-100 gap-6 text-slate-900">
                  <div className="flex flex-col flex-1">
                    <span className="font-black text-[#002d72] text-lg">{member.email}</span>
                    <p className="text-[9px] font-black uppercase text-slate-400">Role: {member.role || 'user'}</p>
                  </div>
                  <div className="flex gap-3 w-full md:w-auto">
                    <button onClick={async () => await updateDoc(doc(db, "users", member.uid), { approved: !member.approved })} className={`flex-1 md:flex-none px-4 py-3 rounded-xl font-black text-[10px] uppercase shadow-md ${member.approved ? 'bg-red-500 text-white' : 'bg-green-600 text-white'}`}>{member.approved ? 'Revoke' : 'Approve'}</button>
                    <button onClick={async () => await updateDoc(doc(db, "users", member.uid), { role: member.role === 'admin' ? 'user' : 'admin' })} className={`flex-1 md:flex-none px-4 py-3 rounded-xl font-black text-[10px] uppercase bg-amber-500 text-white`}>{member.role === 'admin' ? 'Demote' : 'Promote'}</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}