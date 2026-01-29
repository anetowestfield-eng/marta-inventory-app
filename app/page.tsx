"use client";
import React, { useState, useEffect } from 'react';
import { db, auth } from './firebaseConfig'; 
import { collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, serverTimestamp, updateDoc, getDoc, setDoc } from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "firebase/auth";
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

export default function MartaInventory() {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('fleet'); 
  const [isApproved, setIsApproved] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false); 
  const [message, setMessage] = useState({ text: '', type: '' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [view, setView] = useState('login');

  const [buses, setBuses] = useState([]);
  const [history, setHistory] = useState([]);
  const [allUsers, setAllUsers] = useState([]);

  const [searchTerm, setSearchTerm] = useState('');
  const [busNumber, setBusNumber] = useState('');
  const [status, setStatus] = useState('Active');
  const [notes, setNotes] = useState('');
  const [editingId, setEditingId] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        const adminEmail = 'anetowestfield@gmail.com'; 
        const currentIsAdmin = currentUser.email === adminEmail;
        setIsAdmin(currentIsAdmin);

        const userSnap = await getDoc(doc(db, "users", currentUser.uid));
        if (userSnap.exists()) {
          setIsApproved(userSnap.data().approved || currentIsAdmin);
        } else if (currentIsAdmin) {
          await setDoc(doc(db, "users", currentUser.uid), { email: currentUser.email, approved: true });
          setIsApproved(true);
        } else {
          setIsApproved(false);
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
    let unsubUsers = () => {};
    if (isAdmin) {
      unsubUsers = onSnapshot(collection(db, "users"), (snap) => {
        setAllUsers(snap.docs.map(doc => ({ ...doc.data(), uid: doc.id })));
      });
    }
    return () => { unsubBuses(); unsubHistory(); unsubUsers(); };
  }, [user, isApproved, isAdmin]);

  // Restored Styled Excel Export
  const exportToExcel = async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('MARTA Fleet');

    // Define Columns
    worksheet.columns = [
      { header: 'Unit #', key: 'number', width: 15 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Diagnostics/Notes', key: 'notes', width: 50 },
      { header: 'Modified By', key: 'tech', width: 25 },
      { header: 'Last Updated', key: 'time', width: 25 },
    ];

    // Style the Header Row
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '002D72' } };

    // Add Data with Conditional Coloring
    buses.forEach(bus => {
      const row = worksheet.addRow({
        number: bus.number,
        status: bus.status === 'Active' ? 'READY' : bus.status.toUpperCase(),
        notes: bus.notes || '---',
        tech: bus.modifiedBy,
        time: bus.timestamp?.toDate().toLocaleString() || 'N/A'
      });

      // Apply status colors
      const statusCell = row.getCell('status');
      if (bus.status === 'Active') {
        statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'C6EFCE' } };
        statusCell.font = { color: { argb: '006100' }, bold: true };
      } else if (bus.status === 'On Hold') {
        statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC7CE' } };
        statusCell.font = { color: { argb: '9C0006' }, bold: true };
      } else if (bus.status === 'In Shop') {
        statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEB9C' } };
        statusCell.font = { color: { argb: '9C6500' }, bold: true };
      }
    });

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `MARTA_Fleet_Report_${new Date().toLocaleDateString()}.xlsx`);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const isValid = /^[a-zA-Z0-9]{4}$/.test(busNumber); 
    if (!isValid) {
      alert("Error: Unit number must be exactly 4 alphanumeric characters (e.g., G123).");
      return;
    }

    const data = { 
      number: busNumber.toUpperCase(), 
      status, 
      notes, 
      modifiedBy: user.email, 
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
      <div className="min-h-screen flex items-center justify-center bg-[#002d72] p-4 font-sans">
        <form onSubmit={async (e) => {
          e.preventDefault();
          try {
            if (view === 'login') await signInWithEmailAndPassword(auth, email, password);
            else {
              const res = await createUserWithEmailAndPassword(auth, email, password);
              await setDoc(doc(db, "users", res.user.uid), { email, approved: false });
              setMessage({ text: "Registration Success! Waiting for Approval.", type: 'success' });
            }
          } catch (err) { setMessage({ text: err.message, type: 'error' }); }
        }} className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md border-t-8 border-[#ef7c00]">
          <h2 className="text-2xl font-black text-center mb-6 uppercase text-[#002d72]">{view}</h2>
          <input type="email" placeholder="MARTA Email" className="w-full p-4 border-2 rounded-xl mb-4 font-bold" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input type="password" placeholder="Password" className="w-full p-4 border-2 rounded-xl mb-6" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button className="w-full bg-[#ef7c00] text-white font-black py-4 rounded-xl shadow-lg uppercase">{view}</button>
          <button type="button" onClick={() => setView(view === 'login' ? 'signup' : 'login')} className="w-full mt-4 text-[10px] uppercase font-bold text-[#002d72] underline text-center block">Switch Account Mode</button>
        </form>
      </div>
    );
  }

  if (!isApproved) return <div className="p-20 text-center font-black text-[#002d72] uppercase tracking-widest">Access Pending Approval</div>;

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

      <main className="max-w-5xl mx-auto p-4 md:p-10">
        {activeTab === 'fleet' ? (
          <>
            <div className="flex flex-wrap gap-4 mb-10">
              <div className="flex-1 bg-white p-4 rounded-xl shadow-sm border-b-4 border-[#002d72] min-w-[120px]"><p className="text-[9px] font-black text-slate-400 uppercase">Total</p><p className="text-xl font-black">{buses.length}</p></div>
              <div className="flex-1 bg-white p-4 rounded-xl shadow-sm border-b-4 border-green-500 min-w-[120px]"><p className="text-[9px] font-black text-slate-400 uppercase">Ready</p><p className="text-xl font-black text-green-600">{buses.filter(b=>b.status==='Active').length}</p></div>
              <div className="flex-1 bg-white p-4 rounded-xl shadow-sm border-b-4 border-red-600 min-w-[120px]"><p className="text-[9px] font-black text-slate-400 uppercase">Hold</p><p className="text-xl font-black text-red-600">{buses.filter(b=>b.status==='On Hold').length}</p></div>
              <div className="flex-1 bg-white p-4 rounded-xl shadow-sm border-b-4 border-amber-500 min-w-[120px]"><p className="text-[9px] font-black text-slate-400 uppercase">Shop</p><p className="text-xl font-black text-amber-600">{buses.filter(b=>b.status==='In Shop').length}</p></div>
            </div>

            <section className="bg-white p-6 rounded-2xl shadow-xl mb-12 border border-slate-200">
              <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <input 
                  type="text" 
                  placeholder="Unit # (4-Digit Alphanumeric)" 
                  maxLength={4} 
                  className="p-4 border-2 border-slate-100 rounded-xl font-black focus:border-[#ef7c00] outline-none transition-all uppercase" 
                  value={busNumber} 
                  onChange={(e) => setBusNumber(e.target.value)} 
                  required 
                />
                <select className="p-4 border-2 border-slate-100 rounded-xl font-bold bg-slate-50" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="Active">Ready</option><option value="On Hold">Hold</option><option value="In Shop">Shop</option>
                </select>
                <input type="text" placeholder="Diagnosis/Notes" className="p-4 border-2 border-slate-100 rounded-xl" value={notes} onChange={(e) => setNotes(e.target.value)} />
                <button type="submit" className="bg-[#ef7c00] text-white font-black py-4 rounded-xl shadow-lg uppercase hover:bg-black transition-all">
                  {editingId ? "Save Change" : "Update Fleet"}
                </button>
              </form>
            </section>

            <div className="mb-6 flex gap-4">
              <input type="text" placeholder="🔍 Search by Unit #..." className="flex-1 p-4 border-2 border-slate-200 rounded-xl shadow-sm outline-none focus:border-[#002d72]" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
              {isAdmin && (
                <button onClick={exportToExcel} className="bg-[#002d72] text-white px-6 py-4 rounded-xl font-black text-[10px] uppercase shadow-lg hover:bg-slate-800 transition-all">
                  Export Excel
                </button>
              )}
            </div>
            
            <div className="space-y-3">
              {buses.filter(b => b.number.includes(searchTerm.toUpperCase())).map((bus) => (
                <div key={bus.docId} className={`flex flex-col md:flex-row items-center justify-between bg-white p-4 rounded-xl shadow-sm border-l-8 transition-all hover:shadow-md ${bus.status === 'Active' ? 'border-green-500' : bus.status === 'On Hold' ? 'border-red-600' : 'border-amber-500'}`}>
                  <div className="flex items-center gap-6 w-full md:w-auto">
                    <span className="text-2xl font-black text-[#002d72] w-20 tracking-tighter">#{bus.number}</span>
                    <span className={`text-[10px] font-black px-3 py-1 rounded-full uppercase min-w-[70px] text-center ${bus.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{bus.status === 'Active' ? 'Ready' : bus.status}</span>
                  </div>
                  
                  <div className="flex-1 px-0 md:px-8 py-2 md:py-0 w-full md:w-auto min-w-0">
                    <p className="text-slate-500 text-xs font-medium italic break-all">"{bus.notes || "---"}"</p>
                  </div>

                  <div className="flex items-center gap-6 w-full md:w-auto justify-between md:justify-end">
                    <span className="text-[9px] font-bold text-slate-300 uppercase tracking-widest">{bus.modifiedBy.split('@')[0]}</span>
                    {isAdmin && (
                      <div className="flex gap-4">
                        <button onClick={() => { setEditingId(bus.docId); setBusNumber(bus.number); setStatus(bus.status); setNotes(bus.notes); window.scrollTo({top: 0, behavior: 'smooth'}); }} className="text-[#002d72] font-black text-[10px] uppercase hover:underline">Edit</button>
                        <button onClick={() => deleteDoc(doc(db, "buses", bus.docId))} className="text-red-300 font-bold text-[10px] uppercase hover:text-red-600">Del</button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : activeTab === 'history' ? (
          <div className="bg-white p-8 rounded-2xl shadow-xl border border-slate-100">
            <h2 className="text-xl font-black text-[#002d72] uppercase mb-6 tracking-widest">Maintenance Timeline</h2>
            <div className="space-y-4">
              {history.map((log, i) => (
                <div key={i} className="flex justify-between items-center p-4 border-b text-sm">
                   <div className="flex items-center gap-4">
                      <span className="font-black text-[#002d72]">#{log.number}</span>
                      <span className="font-bold uppercase text-[10px] text-slate-400">{log.status}</span>
                   </div>
                   <span className="font-mono text-[9px] text-slate-300">{(log.timestamp?.toDate().toLocaleString())}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-white p-10 rounded-2xl shadow-xl text-center font-black text-slate-300 uppercase italic">
            User authorization management.
          </div>
        )}
      </main>
    </div>
  );
}