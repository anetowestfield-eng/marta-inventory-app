"use client";
import React, { useState, useEffect } from 'react';
import { db, auth } from './firebaseConfig'; 
import { collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, serverTimestamp, updateDoc, getDoc, setDoc } from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut } from "firebase/auth";
import * as XLSX from 'xlsx';

export default function MartaInventory() {
  // Authentication & Security States
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('fleet'); 
  const [view, setView] = useState('login'); 
  const [email, setEmail] = useState('');     
  const [password, setPassword] = useState(''); 
  const [message, setMessage] = useState({ text: '', type: '' });
  const [isApproved, setIsApproved] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false); 
  const [allUsers, setAllUsers] = useState([]);

  // Fleet & History States
  const [buses, setBuses] = useState([]);
  const [history, setHistory] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [busNumber, setBusNumber] = useState('');
  const [status, setStatus] = useState('Active');
  const [notes, setNotes] = useState('');
  const [editingId, setEditingId] = useState(null);

  // 1. Auth & Admin Setup
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        const adminEmail = 'anetowestfield@gmail.com'; // Jay's Admin Email
        const currentIsAdmin = currentUser.email === adminEmail;
        setIsAdmin(currentIsAdmin);

        const userRef = doc(db, "users", currentUser.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          setIsApproved(userSnap.data().approved || currentIsAdmin);
        } else if (currentIsAdmin) {
          await setDoc(userRef, { email: currentUser.email, approved: true });
          setIsApproved(true);
        } else {
          setIsApproved(false);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // 2. Data Synchronization
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

  // 3. Metric Calculations
  const totalFleet = buses.length; 
  const activeCount = buses.filter(b => b.status === 'Active').length;
  const holdCount = buses.filter(b => b.status === 'On Hold').length;
  const shopCount = buses.filter(b => b.status === 'In Shop').length;

  // 4. Admin Actions
  const toggleApproval = async (uid, currentStatus) => {
    await updateDoc(doc(db, "users", uid), { approved: !currentStatus });
  };

  const handleAuthAction = async (e) => {
    e.preventDefault();
    setMessage({ text: '', type: '' });
    try {
      if (view === 'login') await signInWithEmailAndPassword(auth, email, password);
      else if (view === 'signup') {
        const res = await createUserWithEmailAndPassword(auth, email, password);
        await setDoc(doc(db, "users", res.user.uid), { email: email, approved: false });
        setMessage({ text: "Account created! Access is pending approval.", type: 'success' });
      }
    } catch (err) { setMessage({ text: err.message, type: 'error' }); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!busNumber) return;
    const data = { number: busNumber, status: status, notes: notes, modifiedBy: user.email, timestamp: serverTimestamp() };
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

  const exportToExcel = () => {
    const worksheet = XLSX.utils.json_to_sheet(buses.map(bus => ({
      "Unit #": bus.number, "Status": bus.status, "Notes": bus.notes, "Tech": bus.modifiedBy
    })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Fleet_Status");
    XLSX.writeFile(workbook, "MARTA_Fleet_Report.xlsx");
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#002d72] p-4">
        <form onSubmit={handleAuthAction} className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md border-t-8 border-[#ef7c00]">
          <h2 className="text-2xl font-black text-center mb-6 uppercase text-[#002d72] tracking-tighter">{view}</h2>
          {message.text && <p className={`p-3 rounded mb-4 text-[10px] font-black uppercase ${message.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{message.text}</p>}
          <div className="space-y-4">
            <input type="email" placeholder="Email" className="w-full p-4 border-2 border-slate-200 rounded-xl outline-none" value={email || ''} onChange={(e) => setEmail(e.target.value)} required />
            <input type="password" placeholder="Password" className="w-full p-4 border-2 border-slate-200 rounded-xl outline-none" value={password || ''} onChange={(e) => setPassword(e.target.value)} required />
            <button className="w-full bg-[#ef7c00] text-white font-black py-4 rounded-xl shadow-lg uppercase active:scale-95 transition-all">{view}</button>
          </div>
          <button type="button" onClick={() => setView(view === 'login' ? 'signup' : 'login')} className="mt-6 w-full text-[10px] font-bold text-[#002d72] uppercase underline">
            {view === 'login' ? 'New Technician? Create Account' : 'Already have access? Log In'}
          </button>
        </form>
      </div>
    );
  }

  if (!isApproved) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#002d72] p-4 text-center">
        <div className="bg-white p-10 rounded-2xl shadow-2xl max-w-md border-t-8 border-red-600">
          <h2 className="text-2xl font-black text-[#002d72] uppercase mb-4 tracking-tighter">Access Pending</h2>
          <p className="text-slate-600 mb-6 font-medium">Your account (<b>{user.email}</b>) is waiting for Admin Approval by a MARTA Superintendent.</p>
          <button onClick={() => signOut(auth)} className="bg-slate-800 text-white font-black px-8 py-3 rounded-xl uppercase text-xs">Logout</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20">
      <nav className="bg-[#002d72] text-white p-4 flex justify-between items-center sticky top-0 z-50 shadow-md">
        <div className="flex items-center space-x-6">
          <span className="font-black text-lg tracking-tighter">MARTA PORTAL</span>
          <div className="flex bg-slate-800 p-1 rounded-lg">
            <button onClick={() => setActiveTab('fleet')} className={`px-4 py-1.5 rounded-md text-[10px] font-black ${activeTab === 'fleet' ? 'bg-[#ef7c00]' : ''}`}>FLEET</button>
            <button onClick={() => setActiveTab('history')} className={`px-4 py-1.5 rounded-md text-[10px] font-black ${activeTab === 'history' ? 'bg-[#ef7c00]' : ''}`}>HISTORY</button>
            {isAdmin && <button onClick={() => setActiveTab('admin')} className={`px-4 py-1.5 rounded-md text-[10px] font-black ${activeTab === 'admin' ? 'bg-red-600' : ''}`}>ADMIN</button>}
          </div>
        </div>
        <div className="flex items-center space-x-4">
          <button onClick={exportToExcel} className="hidden md:block text-[9px] font-black bg-[#ef7c00] px-3 py-1 rounded uppercase">Export</button>
          <button onClick={() => signOut(auth)} className="text-[10px] bg-red-600 px-3 py-1 rounded font-bold uppercase">Logout</button>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-4 md:p-10">
        
        {/* Metrics Section */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white p-5 rounded-2xl border-t-4 border-[#002d72] shadow-sm"><p className="text-[9px] font-black uppercase text-slate-400 mb-1">Total</p><p className="text-2xl font-black">{totalFleet}</p></div>
          <div className="bg-white p-5 rounded-2xl border-t-4 border-green-500 shadow-sm"><p className="text-[9px] font-black uppercase text-slate-400 mb-1">Ready</p><p className="text-2xl font-black text-green-600">{activeCount}</p></div>
          <div className="bg-white p-5 rounded-2xl border-t-4 border-red-600 shadow-sm"><p className="text-[9px] font-black uppercase text-slate-400 mb-1">Hold</p><p className="text-2xl font-black text-red-600">{holdCount}</p></div>
          <div className="bg-white p-5 rounded-2xl border-t-4 border-amber-500 shadow-sm"><p className="text-[9px] font-black uppercase text-slate-400 mb-1">Shop</p><p className="text-2xl font-black text-amber-600">{shopCount}</p></div>
        </div>

        {activeTab === 'admin' ? (
          /* User Management Tab */
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">
            <h2 className="p-6 font-black text-[#002d72] uppercase border-b bg-slate-50">Team Member Management</h2>
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-[10px] font-black uppercase">
                <tr><th className="p-4">Email Address</th><th className="p-4">Status</th><th className="p-4 text-right">Actions</th></tr>
              </thead>
              <tbody className="divide-y">
                {allUsers.filter(u => u.email !== 'anetowestfield@gmail.com').map((member, i) => (
                  <tr key={i} className="text-sm">
                    <td className="p-4 font-bold">{member.email}</td>
                    <td className="p-4"><span className={`px-2 py-1 rounded text-[9px] font-black uppercase ${member.approved ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{member.approved ? 'Authorized' : 'Pending'}</span></td>
                    <td className="p-4 text-right">
                      <button onClick={() => toggleApproval(member.uid, member.approved)} className="bg-slate-800 text-white text-[10px] px-3 py-1 rounded font-black uppercase">
                        {member.approved ? 'Revoke Access' : 'Approve User'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : activeTab === 'history' ? (
          /* Maintenance History Tab */
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden border">
            <h2 className="p-6 font-black text-[#002d72] uppercase border-b bg-slate-50">Maintenance Timeline</h2>
            <div className="p-4 bg-slate-100 border-b">
              <input type="text" placeholder="🔍 Search Units in History..." className="w-full p-3 border rounded-xl" value={searchTerm || ''} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
            <table className="w-full text-left">
              <tbody className="divide-y">
                {history.filter(h => h.number.includes(searchTerm)).map((log, i) => (
                  <tr key={i} className="text-sm">
                    <td className="p-4 font-black text-[#002d72]">#{log.number}</td>
                    <td className="p-4 font-bold uppercase text-[10px]">{log.status}</td>
                    <td className="p-4 text-slate-500 italic font-medium">{log.notes || "No notes recorded."}</td>
                    <td className="p-4 text-right font-mono text-[9px] text-slate-400">{(log.timestamp?.toDate().toLocaleString())}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* Live Fleet Tab */
          <>
            <section className="bg-white p-6 md:p-8 rounded-3xl shadow-xl mb-10 border-2 border-slate-200">
              <h3 className="text-xs font-black text-[#002d72] uppercase mb-6 tracking-widest">{editingId ? "✏️ Edit Record" : "➕ Log Unit Status"}</h3>
              <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="space-y-1"><label className="text-[10px] font-black text-[#002d72] uppercase block ml-1">Unit #</label><input type="text" className="w-full p-4 border-2 border-[#002d72] rounded-xl font-bold" value={busNumber || ''} onChange={(e) => setBusNumber(e.target.value)} /></div>
                <div className="space-y-1"><label className="text-[10px] font-black text-[#002d72] uppercase block ml-1">Status</label><select className="w-full p-4 border-2 border-[#002d72] rounded-xl font-bold" value={status || 'Active'} onChange={(e) => setStatus(e.target.value)}><option value="Active">Ready</option><option value="On Hold">Hold</option><option value="In Shop">Shop</option></select></div>
                <div className="space-y-1"><label className="text-[10px] font-black text-[#002d72] uppercase block ml-1">Notes</label><input type="text" className="w-full p-4 border-2 border-[#002d72] rounded-xl" value={notes || ''} onChange={(e) => setNotes(e.target.value)} /></div>
                <div className="flex items-end"><button type="submit" className="w-full bg-[#ef7c00] text-white font-black py-4 rounded-xl shadow-lg uppercase transition-all">{editingId ? "Save" : "Update"}</button></div>
              </form>
            </section>

            <div className="mb-6"><input type="text" placeholder="🔍 Search Bus Number..." className="w-full p-4 border-2 border-slate-200 rounded-2xl outline-none focus:border-[#002d72]" value={searchTerm || ''} onChange={(e) => setSearchTerm(e.target.value)} /></div>

            {/* Desktop Table View */}
            <div className="hidden md:block bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-[#002d72] text-[10px] font-black uppercase border-b">
                  <tr><th className="p-5">Unit</th><th className="p-5">Status</th><th className="p-5">Notes</th>{isAdmin && <th className="p-5 text-right">System</th>}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {buses.filter(b => b.number.includes(searchTerm)).map((bus) => (
                    <tr key={bus.docId} className="hover:bg-slate-50 transition-colors">
                      <td className="p-5 font-black text-2xl text-[#002d72]">#{bus.number}</td>
                      <td className="p-5"><span className={`px-2 py-1 rounded text-[10px] font-black uppercase border ${bus.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{bus.status}</span></td>
                      <td className="p-5 text-slate-600 text-sm font-medium italic">{bus.notes || "---"}<br/><span className="text-[8px] uppercase font-bold text-slate-400">Modified by {bus.modifiedBy}</span></td>
                      {isAdmin && (
                        <td className="p-5 text-right space-x-4">
                          <button onClick={() => { setEditingId(bus.docId); setBusNumber(bus.number); setStatus(bus.status); setNotes(bus.notes); window.scrollTo(0,0); }} className="text-[#002d72] font-black text-[10px] uppercase hover:underline">Edit</button>
                          <button onClick={() => deleteDoc(doc(db, "buses", bus.docId))} className="text-red-300 font-bold text-[10px] uppercase">Del</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden space-y-4">
              {buses.filter(b => b.number.includes(searchTerm)).map((bus) => (
                <div key={bus.docId} className={`bg-white p-5 rounded-2xl shadow-md border-l-8 ${bus.status === 'Active' ? 'border-green-500' : 'border-red-600'}`}>
                  <div className="flex justify-between items-start mb-2"><span className="text-2xl font-black text-[#002d72]">#{bus.number}</span><span className={`px-2 py-1 rounded text-[9px] font-black uppercase ${bus.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{bus.status}</span></div>
                  <p className="text-slate-600 text-sm italic mb-4">{bus.notes || "No notes."}</p>
                  <div className="flex justify-between items-center pt-3 border-t border-slate-100">
                    <span className="text-[9px] text-slate-400 font-bold uppercase">Tech: {bus.modifiedBy}</span>
                    {isAdmin && <button onClick={() => { setEditingId(bus.docId); setBusNumber(bus.number); setStatus(bus.status); setNotes(bus.notes); window.scrollTo(0,0); }} className="text-[#002d72] font-black text-[10px] uppercase">Edit</button>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}