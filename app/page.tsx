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
  const [isAdmin, setIsAdmin] = useState(false); 
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [view, setView] = useState('login');
  const [authMsg, setAuthMsg] = useState('');

  const [buses, setBuses] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);

  const [searchTerm, setSearchTerm] = useState('');
  const [busNumber, setBusNumber] = useState('');
  const [status, setStatus] = useState('Active');
  const [notes, setNotes] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        const adminEmail = 'anetowestfield@gmail.com'; 
        const userSnap = await getDoc(doc(db, "users", currentUser.uid));
        const isSuperAdmin = currentUser.email === adminEmail;
        const isApproved = userSnap.exists() && userSnap.data().approved;

        if (!isApproved && !isSuperAdmin) {
          setAuthMsg("Access Pending Verification. Please contact a superintendent.");
          await signOut(auth);
          setUser(null);
          setIsAdmin(false);
          return;
        }

        setUser(currentUser);
        setAuthMsg('');
        if (userSnap.exists()) {
          setIsAdmin(userSnap.data().role === 'admin' || isSuperAdmin);
        } else if (isSuperAdmin) {
          await setDoc(doc(db, "users", currentUser.uid), { 
            email: currentUser.email, approved: true, role: 'admin' 
          });
          setIsAdmin(true);
        }
      } else {
        setUser(null);
        setIsAdmin(false);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
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
  }, [user, isAdmin]);

  const exportToExcel = async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('MARTA Fleet');
    worksheet.columns = [
      { header: 'Unit #', key: 'number', width: 12 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Notes', key: 'notes', width: 60, style: { alignment: { wrapText: true } } },
    ];
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '002D72' } };
    buses.forEach(bus => worksheet.addRow({ number: bus.number, status: bus.status.toUpperCase(), notes: bus.notes || '---' }));
    const now = new Date();
    const ts = `${now.getMonth() + 1}-${now.getDate()}_${now.getHours() % 12 || 12}${now.getMinutes()}${now.getHours() >= 12 ? 'PM' : 'AM'}`;
    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `MARTA_Report_${ts}.xlsx`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[a-zA-Z0-9]{4}$/.test(busNumber)) return;
    const data = { number: busNumber.toUpperCase(), status, notes, modifiedBy: user?.email, timestamp: serverTimestamp() };
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
          setAuthMsg('');
          try {
            if (view === 'login') await signInWithEmailAndPassword(auth, email, password);
            else {
              const res = await createUserWithEmailAndPassword(auth, email, password);
              await setDoc(doc(db, "users", res.user.uid), { email, approved: false, role: 'user' });
              setAuthMsg("Access Pending Verification. Please contact a superintendent.");
              await signOut(auth);
            }
          } catch (err: any) { setAuthMsg(err.message); }
        }} className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md border-t-8 border-[#ef7c00]">
          <h2 className="text-2xl font-black text-center mb-6 uppercase text-[#002d72]">
            {view === 'login' ? 'Login' : 'Register'}
          </h2>
          
          {authMsg && (
            <div className="bg-amber-50 border-2 border-amber-200 text-amber-800 p-4 rounded-xl mb-6 text-xs font-black uppercase text-center leading-relaxed">
              {authMsg}
            </div>
          )}

          <input type="email" placeholder="Email" className="w-full p-4 border-2 rounded-xl mb-4 font-bold" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input type="password" placeholder="Password" className="w-full p-4 border-2 rounded-xl mb-6 font-bold" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button className="w-full bg-[#ef7c00] text-white font-black py-4 rounded-xl uppercase shadow-lg">
            {view === 'login' ? 'Enter Portal' : 'Submit Registration'}
          </button>
          
          {/* UPDATED LABELS */}
          <button 
            type="button" 
            onClick={() => { setView(view === 'login' ? 'signup' : 'login'); setAuthMsg(''); }} 
            className="w-full mt-4 text-[10px] uppercase font-bold text-[#002d72] underline text-center block tracking-widest"
          >
            {view === 'login' ? 'No account? Create one here' : 'Already registered? Login here'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20 font-sans">
      <nav className="bg-[#002d72] text-white p-4 flex justify-between items-center sticky top-0 z-[1001] shadow-lg">
        <span className="font-black text-lg tracking-tighter uppercase italic">MARTA Fleet Portal</span>
        <div className="flex bg-slate-800 p-1 rounded-lg">
          {['fleet', 'history', 'admin'].map((tab) => (
            (tab !== 'admin' || isAdmin) && (
              <button key={tab} onClick={() => setActiveTab(tab)} className={`px-5 py-1.5 rounded-md text-[10px] font-black uppercase ${activeTab === tab ? 'bg-[#ef7c00]' : ''}`}>
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
            <section className="bg-white p-6 rounded-2xl shadow-xl mb-12 border border-slate-200">
              <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <input type="text" placeholder="Unit #" maxLength={4} className="p-4 border-2 border-slate-100 rounded-xl font-black uppercase text-slate-900" value={busNumber} onChange={(e) => setBusNumber(e.target.value)} required />
                <select className="p-4 border-2 border-slate-100 rounded-xl font-bold bg-slate-50 text-slate-900" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="Active">Ready</option><option value="On Hold">Hold</option><option value="In Shop">Shop</option>
                </select>
                <input type="text" placeholder="Diagnostics..." className="p-4 border-2 border-slate-100 rounded-xl text-slate-900" value={notes} onChange={(e) => setNotes(e.target.value)} />
                <button type="submit" className="bg-[#ef7c00] text-white font-black py-4 rounded-xl uppercase">Update</button>
              </form>
            </section>

            <div className="mb-6 flex flex-col md:flex-row gap-4 items-center">
              <input type="text" placeholder="🔍 Search Unit #..." className="flex-1 p-4 border-2 border-slate-200 rounded-xl shadow-sm text-slate-900 font-bold" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
              <div className="flex bg-slate-200 p-1 rounded-xl w-full md:w-auto">
                {['card', 'list'].map((mode) => (
                  <button key={mode} onClick={() => setViewMode(mode)} className={`flex-1 px-6 py-2 rounded-lg text-[10px] font-black uppercase ${viewMode === mode ? 'bg-white shadow-sm text-[#002d72]' : 'text-slate-400'}`}>
                    {mode}
                  </button>
                ))}
              </div>
              <button onClick={exportToExcel} className="w-full md:w-auto bg-[#002d72] text-white px-8 py-4 rounded-xl font-black text-[10px] uppercase shadow-lg">Export Report</button>
            </div>
            
            <div className={viewMode === 'card' ? "grid grid-cols-1 md:grid-cols-3 gap-6" : "space-y-3"}>
              {buses.filter(b => b.number.includes(searchTerm.toUpperCase())).map((bus) => (
                <div key={bus.docId} className={`bg-white p-4 rounded-xl shadow-sm border-l-8 ${bus.status === 'Active' ? 'border-green-500' : 'border-red-600'} ${viewMode === 'list' ? 'flex justify-between items-center' : ''}`}>
                  <span className="text-2xl font-black text-[#002d72] w-20">#{bus.number}</span>
                  <p className="flex-1 px-8 text-slate-500 text-xs italic">"{bus.notes || "---"}"</p>
                  {isAdmin && <button onClick={() => deleteDoc(doc(db, "buses", bus.docId))} className="text-red-300 font-bold text-[10px] uppercase">Del</button>}
                </div>
              ))}
            </div>
          </>
        ) : activeTab === 'history' ? (
          <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-100">
            <h2 className="text-xl font-black text-[#002d72] uppercase mb-8 border-b pb-4">Timeline</h2>
            <div className="space-y-3">
              {history.slice(0, 50).map((log, i) => (
                <div key={i} className="flex flex-col md:flex-row items-center justify-between p-4 bg-slate-50 rounded-xl border-l-4 border-slate-200">
                  <span className="text-lg font-black text-[#002d72] w-16">#{log.number}</span>
                  <p className="flex-1 px-4 text-slate-400 text-[10px] italic">"{log.notes || "---"}"</p>
                  <span className="font-mono text-[9px] text-slate-300">{(log.timestamp?.toDate().toLocaleString())}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-100">
            <h2 className="text-xl font-black text-[#002d72] uppercase mb-8 tracking-widest border-b pb-4 text-slate-900">Team</h2>
            <div className="space-y-4 text-slate-900">
              {allUsers.filter(u => u.email !== 'anetowestfield@gmail.com').map((member, i) => (
                <div key={i} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                  <span className="font-black text-[#002d72]">{member.email}</span>
                  <button onClick={async () => await updateDoc(doc(db, "users", member.uid), { approved: !member.approved })} className={`px-4 py-2 rounded-lg font-black text-[10px] uppercase ${member.approved ? 'bg-red-500 text-white' : 'bg-green-600 text-white'}`}>
                    {member.approved ? 'Revoke' : 'Approve'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}