"use client";
import React, { useState, useEffect, useMemo } from 'react';
import { db, auth } from './firebaseConfig'; 
import { collection, onSnapshot, query, orderBy, doc, serverTimestamp, setDoc, addDoc, deleteDoc, getDoc, limit, writeBatch, updateDoc, arrayUnion, increment } from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import dynamic from 'next/dynamic';

// Ensure partsData.json is in the same 'app' folder
import localParts from './partsData.json';

// --- DYNAMIC IMPORTS ---
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

// --- HELPER COMPONENTS ---
const Toast = ({ message, type, onClose }: { message: string, type: 'success' | 'error', onClose: () => void }) => {
    useEffect(() => { const timer = setTimeout(onClose, 3000); return () => clearTimeout(timer); }, [onClose]);
    return (
        <div className={`fixed bottom-6 right-6 z-[3000] px-6 py-4 rounded-xl shadow-2xl flex items-center gap-4 animate-in slide-in-from-right-10 duration-300 border-l-8 ${type === 'success' ? 'bg-white border-green-500 text-slate-800' : 'bg-white border-red-500 text-slate-800'}`}>
            <span className="text-2xl">{type === 'success' ? '✅' : '📋'}</span>
            <div><p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">{type === 'success' ? 'Success' : 'Notice'}</p><p className="text-sm font-bold text-slate-800">{message}</p></div>
        </div>
    );
};

// --- UTILITY FUNCTIONS ---
const formatTime = (timestamp: any) => {
    if (!timestamp) return 'Just now';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
};

const logHistory = async (busNumber: string, action: string, details: string, userEmail: string) => {
    if (!busNumber) return;
    try { await addDoc(collection(db, "buses", busNumber, "history"), { action, details, user: userEmail, timestamp: serverTimestamp() }); } catch (err) { console.error("History log failed", err); }
};

const getBusSpecs = (num: string) => {
    const n = parseInt(num);
    const thirtyFt = [1951, 1958, 1959];
    const thirtyFiveFt = [1887, 1888, 1889, 1895, 1909, 1912, 1913, 1921, 1922, 1923, 1924, 1925, 1926, 1927, 1928, 1929, 1930, 1931, 1932, 1933, 1935, 2326, 2343];
    if (thirtyFt.includes(n)) return { length: "30'", type: "S" };
    if (thirtyFiveFt.includes(n)) return { length: "35'", type: "M" };
    return { length: "40'", type: "L" };
};

const calculateDaysOOS = (start: string) => {
    if (!start) return 0;
    const s = new Date(start);
    const now = new Date();
    return Math.max(0, Math.ceil((now.getTime() - s.getTime()) / (1000 * 3600 * 24)));
};

// --- MODULE 1: PERSONNEL MANAGER (FULL FEATURE) ---
const PersonnelManager = ({ showToast }: { showToast: (msg: string, type: 'success'|'error') => void }) => {
    const [personnel, setPersonnel] = useState<any[]>([]);
    const [viewMode, setViewMode] = useState<'dashboard' | 'log'>('dashboard');
    const [showAddModal, setShowAddModal] = useState(false);
    const [showIncidentModal, setShowIncidentModal] = useState(false);
    
    // Selection States
    const [selectedEmpId, setSelectedEmpId] = useState(''); // For Dropdown
    const [selectedEmp, setSelectedEmp] = useState<any>(null); // For Popup Profile
    
    // Forms & Filters
    const [newEmpName, setNewEmpName] = useState('');
    const [incData, setIncData] = useState({ type: 'Sick', date: '', count: 1, docReceived: false, supervisorReviewDate: '', notes: '' });
    const [rosterSearch, setRosterSearch] = useState('');
    const [logFilter, setLogFilter] = useState({ search: '', type: 'All', sort: 'desc' });

    useEffect(() => {
        const q = query(collection(db, "personnel"), orderBy("name"));
        return onSnapshot(q, (snap) => setPersonnel(snap.docs.map(d => ({ ...d.data(), id: d.id }))));
    }, []);

    // --- DATA PROCESSING ---
    const allIncidents = useMemo(() => {
        let logs: any[] = [];
        personnel.forEach(p => {
            if (p.incidents) {
                p.incidents.forEach((inc: any) => {
                    logs.push({ ...inc, employeeName: p.name, employeeId: p.id });
                });
            }
        });
        return logs;
    }, [personnel]);

    const stats = useMemo(() => {
        const typeCounts: {[key: string]: number} = {};
        const monthlyCounts: {[key: string]: {[key: string]: number}} = {};
        let totalOccurrences = 0;
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

        allIncidents.forEach(inc => {
            const c = parseInt(inc.count) || 1;
            totalOccurrences += c;
            typeCounts[inc.type] = (typeCounts[inc.type] || 0) + c;
            if (inc.date) {
                const dateObj = new Date(inc.date);
                const month = monthNames[dateObj.getMonth()];
                if (!monthlyCounts[month]) monthlyCounts[month] = { Total: 0, Sick: 0, FMLA: 0, "No Call/No Show": 0, "Other": 0 };
                
                if(inc.type === 'Sick' || inc.type === 'Late Reporting') monthlyCounts[month]['Sick'] += c;
                else if(inc.type === 'FMLA') monthlyCounts[month]['FMLA'] += c;
                else if(inc.type === 'No Call/No Show' || inc.type === 'Failure to Report') monthlyCounts[month]['No Call/No Show'] += c;
                else monthlyCounts[month]['Other'] += c;
                monthlyCounts[month].Total += c;
            }
        });
        // Sort roster by highest occurrences
        const topOffenders = [...personnel].sort((a,b) => (b.totalOccurrences || 0) - (a.totalOccurrences || 0));
        return { totalOccurrences, typeCounts, topOffenders, monthlyCounts, monthNames };
    }, [allIncidents, personnel]);

    // --- FILTERING ---
    const filteredLog = useMemo(() => {
        let logs = [...allIncidents];
        if (logFilter.search) logs = logs.filter(l => l.employeeName.toLowerCase().includes(logFilter.search.toLowerCase()));
        if (logFilter.type !== 'All') logs = logs.filter(l => l.type === logFilter.type);
        
        return logs.sort((a, b) => {
            const dateA = new Date(a.date).getTime();
            const dateB = new Date(b.date).getTime();
            return logFilter.sort === 'asc' ? dateA - dateB : dateB - dateA;
        });
    }, [allIncidents, logFilter]);

    const filteredRoster = useMemo(() => {
        if (!rosterSearch) return stats.topOffenders;
        return stats.topOffenders.filter(p => p.name.toLowerCase().includes(rosterSearch.toLowerCase()));
    }, [stats.topOffenders, rosterSearch]);

    const jumpToLog = (typeFilter: string = 'All') => {
        setLogFilter(prev => ({ ...prev, type: typeFilter, search: '' }));
        setViewMode('log');
    };

    // --- ACTIONS ---
    const handleAddEmployee = async (e: React.FormEvent) => {
        e.preventDefault();
        if(!newEmpName) return;
        try {
            await addDoc(collection(db, "personnel"), { name: newEmpName, totalOccurrences: 0, incidents: [], timestamp: serverTimestamp() });
            showToast(`Added ${newEmpName}`, 'success'); setNewEmpName(''); setShowAddModal(false);
        } catch(err) { showToast("Failed to add employee", 'error'); }
    };

    const handleLogIncident = async () => {
        const targetId = selectedEmp ? selectedEmp.id : selectedEmpId;
        if(!targetId) return showToast("Select an employee", 'error');
        try {
            const empRef = doc(db, "personnel", targetId);
            const newLog = {
                type: incData.type, date: incData.date || new Date().toISOString().split('T')[0],
                count: Number(incData.count), docReceived: incData.docReceived, supervisorReviewDate: incData.supervisorReviewDate, notes: incData.notes, loggedAt: new Date().toISOString()
            };
            await updateDoc(empRef, { totalOccurrences: increment(Number(incData.count)), incidents: arrayUnion(newLog) });
            showToast("Incident Saved", 'success'); setShowIncidentModal(false);
            setIncData({ type: 'Sick', date: '', count: 1, docReceived: false, supervisorReviewDate: '', notes: '' });
        } catch(err) { showToast("Failed to save", 'error'); }
    };

    const handleDeleteIncident = async (empId: string, incident: any) => {
        if(!confirm("Are you sure you want to permanently delete this incident record?")) return;
        try {
            const empRef = doc(db, "personnel", empId);
            const empSnap = await getDoc(empRef);
            if (!empSnap.exists()) return;
            const currentIncidents = empSnap.data().incidents || [];
            const updatedIncidents = currentIncidents.filter((i: any) => i.loggedAt !== incident.loggedAt);
            const newTotal = updatedIncidents.reduce((sum: number, i: any) => sum + (Number(i.count) || 0), 0);
            await updateDoc(empRef, { incidents: updatedIncidents, totalOccurrences: newTotal });
            showToast("Incident Deleted", 'success');
            if (selectedEmp && selectedEmp.id === empId) { setSelectedEmp({ ...selectedEmp, incidents: updatedIncidents, totalOccurrences: newTotal }); }
        } catch (err) { console.error(err); showToast("Delete Failed", 'error'); }
    };

    // --- WORD EXPORT (EXACT REPLICA - NO TABLES) ---
    const handleExportWord = () => {
        if(!selectedEmp) return;
        
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        
        const rollingIncidents = (selectedEmp.incidents || []).filter((inc:any) => {
            const d = new Date(inc.date);
            return d >= oneYearAgo;
        }).sort((a:any, b:any) => new Date(a.date).getTime() - new Date(b.date).getTime());
        
        let activePoints = 0;
        let incidentRows = "";
        
        rollingIncidents.forEach((inc: any, index: number) => {
            const points = parseInt(inc.count) || 0;
            activePoints += points;
            const d = new Date(inc.date);
            // Strict MM/DD/YYYY format
            const formattedDate = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
            
            // Using non-breaking spaces for tab-like layout instead of tables
            incidentRows += `<p style="margin-left: 80px; margin-bottom: 2px; font-family: 'Arial'; font-size: 11pt;">${index + 1}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${formattedDate}</p>`;
        });

        let disciplineLevel = "None";
        if(activePoints >= 3) disciplineLevel = "Verbal Warning";
        if(activePoints >= 4) disciplineLevel = "Written Warning";
        if(activePoints >= 5) disciplineLevel = "Final Written Warning";
        if(activePoints >= 6) disciplineLevel = "Discharge";

        // "Last, First" name format
        const nameParts = selectedEmp.name.split(' ');
        const formalName = nameParts.length > 1 ? `${nameParts[nameParts.length-1]}, ${nameParts[0]}` : selectedEmp.name;
        
        const today = new Date();
        const reportDate = `${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}/${today.getFullYear()}`;

        const header = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>Notice of Discipline</title><style>
            body { font-family: 'Arial', sans-serif; font-size: 11pt; line-height: 1.1; color: #000000; }
            p { margin-top: 4px; margin-bottom: 4px; font-family: 'Arial', sans-serif; font-size: 11pt; }
            .header-center { text-align: center; font-weight: bold; margin-bottom: 25px; margin-top: 20px; text-transform: uppercase; font-family: 'Arial'; }
            .right-align { text-align: right; }
            .bold { font-weight: bold; }
            .indent { margin-left: 40px; }
        </style></head><body>`;
        
        const content = `
            <br>
            <table style="width:100%; border:none; font-family: 'Arial'; font-size:11pt;">
                <tr>
                    <td style="width:60%;">TO: &nbsp; ${formalName}</td>
                    <td style="width:40%; text-align:right;">DATE: &nbsp; ${reportDate}</td>
                </tr>
            </table>
            
            <div class="header-center">
                <p>MARTA ATTENDANCE PROGRAM</p>
                <p>NOTICE OF DISCIPLINE</p>
            </div>
            
            <p>MARTA's Attendance Program states that an employee who accumulates excessive occurrences of absence within any twelve month period (rolling year) will be disciplined according to the following:</p>
            <br>
            <p class="indent" style="font-size:10pt;">Number of Occurrences&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Level of Discipline</p>
            <p class="indent" style="font-size:10pt;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;1-2&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;None</p>
            <p class="indent" style="font-size:10pt;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;3&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Verbal Warning</p>
            <p class="indent" style="font-size:10pt;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;4&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Written Warning</p>
            <p class="indent" style="font-size:10pt;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;5&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;* Final Written Warning</p>
            <p class="indent" style="font-size:10pt;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;6&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Discharge</p>
            <br>
            <p>My records indicate that you have accumulated <strong>${activePoints} occurrences</strong> during the past rolling twelve months. The Occurrences are as follows:</p>
            <br>
            <p class="indent" style="text-decoration: underline;">Occurrences</p>
            ${incidentRows || '<p class="indent">None recorded.</p>'}
            <br>
            <p>Therefore, in accordance with the schedule of progressive discipline, this is your <strong>${disciplineLevel}</strong> for excessive absenteeism under the rule.</p>
            <br>
            <p>Please be advised that your rate of absenteeism is not acceptable and YOUR corrective action is required. Additional occurrences will result in the progressive disciplinary action indicated above.</p>
            <br>
            <p>If you have a personal problem that is affecting your attendance, it is recommended that you call Humana, MARTA's Employee Assistance Program (EAP), at 1-800-448-4358. MARTA sincerely hopes that you will improve your attendance and that further discipline will not be necessary.</p>
            <br><br>
            <div style="text-align:center; border-top:1px solid #000; padding-top:5px; width:40%; margin:auto; font-weight:bold; font-family:'Arial'; font-size:11pt;">ACKNOWLEDGEMENT</div>
            <p>I acknowledge receipt of this Notice of Discipline and that I have been informed of the help available to me through MARTA's EAP and of potential for progressive discipline, up to and including discharge.</p>
            <br><br><br>
            
            <table style="width:100%; border:none; font-family: 'Arial'; font-size:11pt;">
                <tr>
                    <td style="width:45%; border-bottom:1px solid #000;">&nbsp;</td>
                    <td style="width:10%;"></td>
                    <td style="width:45%; border-bottom:1px solid #000;">&nbsp;</td>
                </tr>
                <tr>
                    <td>Date</td>
                    <td></td>
                    <td>Employee</td>
                </tr>
            </table>
            <br><br>
            <table style="width:100%; border:none; font-family: 'Arial'; font-size:11pt;">
                <tr>
                    <td style="width:45%; border-bottom:1px solid #000;">&nbsp;</td>
                    <td style="width:10%;"></td>
                    <td style="width:45%; border-bottom:1px solid #000;">&nbsp;</td>
                </tr>
                <tr>
                    <td>Date</td>
                    <td></td>
                    <td>Foreman/Supervisor/Superintendent</td>
                </tr>
            </table>
            <br><br>
            <table style="width:100%; border:none; font-family: 'Arial'; font-size:11pt;">
                <tr>
                    <td style="width:45%; border-bottom:1px solid #000;">&nbsp;</td>
                    <td style="width:10%;"></td>
                    <td style="width:45%; border-bottom:1px solid #000;">&nbsp;</td>
                </tr>
                <tr>
                    <td>Date</td>
                    <td></td>
                    <td>General Foreman/Manager/General Superintendent</td>
                </tr>
            </table>
        </body></html>`;

        const blob = new Blob(['\ufeff', header + content], { type: 'application/msword' });
        saveAs(blob, `${selectedEmp.name.replace(' ','_')}_Notice.doc`);
        showToast("Notice Generated", 'success');
    };

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col bg-slate-50">
            {/* TOP NAVIGATION BAR */}
            <div className="flex justify-between items-end mb-6 flex-wrap gap-2 px-1">
                <div><h2 className="text-3xl font-black text-[#002d72] italic uppercase tracking-tighter">Attendance Tracker</h2><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Incident Dashboard & Logs</p></div>
                <div className="flex gap-2 flex-wrap">
                    <div className="bg-white border rounded-lg p-1 flex">
                        <button onClick={()=>setViewMode('dashboard')} className={`px-4 py-1.5 text-[10px] font-black uppercase rounded transition-all ${viewMode==='dashboard'?'bg-[#002d72] text-white shadow':'text-slate-400 hover:text-[#002d72]'}`}>Dashboard</button>
                        <button onClick={()=>setViewMode('log')} className={`px-4 py-1.5 text-[10px] font-black uppercase rounded transition-all ${viewMode==='log'?'bg-[#002d72] text-white shadow':'text-slate-400 hover:text-[#002d72]'}`}>Master Log</button>
                    </div>
                    <button onClick={() => setShowIncidentModal(true)} className="px-6 py-2 bg-[#ef7c00] text-white rounded-lg font-black uppercase text-[10px] shadow-lg hover:bg-orange-600 transition-all">+ Log Incident</button>
                    <button onClick={() => setShowAddModal(true)} className="px-4 py-2 bg-slate-200 text-slate-600 rounded-lg font-black uppercase text-[10px] hover:bg-slate-300 transition-all">+ Emp</button>
                </div>
            </div>

            {/* EMPLOYEE DETAIL POPUP (WITH WORD EXPORT) */}
            {selectedEmp && (
                <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in zoom-in-95">
                    <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="p-6 border-b bg-slate-50 flex justify-between items-center">
                            <div>
                                <h3 className="text-2xl font-black text-[#002d72] uppercase">{selectedEmp.name}</h3>
                                <p className="text-xs font-bold text-slate-500">Total Occurrences: <span className="text-red-500">{selectedEmp.totalOccurrences || 0}</span></p>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={handleExportWord} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-black text-[10px] uppercase shadow hover:bg-blue-700 transition-colors">📄 Export Notice</button>
                                <button onClick={()=>setSelectedEmp(null)} className="text-2xl text-slate-300 hover:text-slate-500">✕</button>
                            </div>
                        </div>
                        <div className="p-6 overflow-y-auto">
                            <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100 mb-6">
                                <h4 className="text-[10px] font-black text-blue-800 uppercase tracking-widest mb-3">Log New Incident</h4>
                                <div className="grid grid-cols-2 gap-4 mb-3">
                                    <select className="p-2 border rounded font-bold text-xs text-black bg-white" value={incData.type} onChange={e=>setIncData({...incData, type:e.target.value})}><option>Sick</option><option>FMLA</option><option>Failure to Report</option><option>Late Reporting</option><option>NC/NS</option></select>
                                    <input type="number" className="p-2 border rounded font-bold text-xs text-black bg-white" placeholder="Count" value={incData.count} onChange={e=>setIncData({...incData, count:Number(e.target.value)})} />
                                </div>
                                <div className="flex gap-2 mb-3">
                                    <input type="date" className="p-2 border rounded font-bold text-xs flex-grow text-black bg-white" value={incData.date} onChange={e=>setIncData({...incData, date:e.target.value})} />
                                    <div className={`p-2 border rounded cursor-pointer font-bold text-xs flex items-center gap-2 ${incData.docReceived?'bg-green-100 border-green-200 text-green-700':'bg-white text-slate-400'}`} onClick={()=>setIncData({...incData, docReceived:!incData.docReceived})}><span>Doc?</span>{incData.docReceived && '✓'}</div>
                                </div>
                                <input className="w-full p-2 border rounded font-bold text-xs mb-3 text-black bg-white" placeholder="Notes..." value={incData.notes} onChange={e=>setIncData({...incData, notes:e.target.value})} />
                                <button onClick={handleLogIncident} className="w-full py-2 bg-[#002d72] text-white rounded font-black text-xs hover:bg-[#ef7c00]">Add Record</button>
                            </div>

                            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Incident History</h4>
                            <div className="border rounded-xl overflow-hidden overflow-x-auto">
                                <table className="w-full text-left text-xs min-w-[400px]">
                                    <thead className="bg-slate-50 border-b font-black text-slate-500"><tr><th className="p-3">Date</th><th className="p-3">Type</th><th className="p-3 text-center">Pts</th><th className="p-3">Notes</th><th className="p-3 text-center">Action</th></tr></thead>
                                    <tbody className="divide-y">
                                        {selectedEmp.incidents && selectedEmp.incidents.length > 0 ? selectedEmp.incidents.slice().reverse().map((inc: any, i: number) => {
                                            const isOld = (new Date().getTime() - new Date(inc.date).getTime()) / (1000 * 60 * 60 * 24) > 365;
                                            return (
                                                <tr key={i} className={isOld ? "bg-red-50 text-red-600 font-medium" : ""}>
                                                    <td className="p-3 font-mono">{inc.date} {isOld && <span className="text-[8px] font-black uppercase ml-1">(>1yr)</span>}</td>
                                                    <td className="p-3 font-bold text-black">{inc.type}</td>
                                                    <td className="p-3 text-center font-black text-black">{inc.count}</td>
                                                    <td className="p-3 italic truncate max-w-[150px] text-slate-600">{inc.notes}</td>
                                                    <td className="p-3 text-center"><button onClick={() => handleDeleteIncident(selectedEmp.id, inc)} className="text-red-400 hover:text-red-600 font-bold">🗑️</button></td>
                                                </tr>
                                            );
                                        }) : <tr><td colSpan={5} className="p-4 text-center italic text-slate-300">No history found.</td></tr>}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* DASHBOARD VIEW */}
            {viewMode === 'dashboard' && (
                <div className="space-y-6 overflow-y-auto pb-10">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div onClick={()=>jumpToLog('All')} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 cursor-pointer hover:border-[#002d72] hover:bg-blue-50 transition-all"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Occurrences</p><p className="text-4xl font-black text-[#002d72]">{stats.totalOccurrences}</p></div>
                        <div onClick={()=>jumpToLog('All')} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 cursor-pointer hover:border-[#002d72] hover:bg-blue-50 transition-all"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Employees Tracked</p><p className="text-4xl font-black text-slate-700">{personnel.length}</p></div>
                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Incidents by Type</p><div className="space-y-1">{Object.entries(stats.typeCounts).slice(0,3).map(([k,v]) => (<div key={k} onClick={()=>jumpToLog(k)} className="flex justify-between text-xs font-bold text-slate-600 cursor-pointer hover:text-[#ef7c00]"><span>{k}</span><span>{v}</span></div>))}</div></div>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden"><div className="p-4 border-b bg-slate-50"><h3 className="text-xs font-black text-[#002d72] uppercase tracking-widest">Monthly Incident Summary</h3></div><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-slate-400 font-black uppercase bg-white border-b"><tr><th className="p-3">Month</th><th className="p-3 text-right">Sick</th><th className="p-3 text-right">FMLA</th><th className="p-3 text-right">No Show</th><th className="p-3 text-right">Total</th></tr></thead><tbody className="divide-y divide-slate-50">{stats.monthNames.map(month => { const data = stats.monthlyCounts[month] || {}; if (!data.Total) return null; return (<tr key={month}><td className="p-3 font-bold text-slate-700">{month}</td><td className="p-3 text-right font-mono text-orange-600">{data['Sick'] || 0}</td><td className="p-3 text-right font-mono text-blue-600">{data['FMLA'] || 0}</td><td className="p-3 text-right font-mono text-red-600">{(data['No Call/No Show'] || 0) + (data['Failure to Report'] || 0)}</td><td className="p-3 text-right font-black text-slate-800">{data.Total || 0}</td></tr>); })}</tbody></table></div></div>
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden flex flex-col h-[400px]">
                            <div className="p-4 border-b bg-slate-50 flex justify-between items-center"><h3 className="text-xs font-black text-[#002d72] uppercase tracking-widest">Employee Roster</h3><input type="text" placeholder="Search Name..." className="text-xs p-1 border rounded w-32 font-bold text-black bg-white" value={rosterSearch} onChange={e=>setRosterSearch(e.target.value)} /></div>
                            <div className="overflow-y-auto flex-grow"><table className="w-full text-left text-xs"><thead className="text-slate-400 font-black uppercase bg-white border-b sticky top-0"><tr><th className="p-3">Employee Name</th><th className="p-3 text-right">Count</th></tr></thead><tbody className="divide-y divide-slate-50">{filteredRoster.map(emp => (<tr key={emp.id} onClick={() => setSelectedEmp(emp)} className="hover:bg-blue-50 transition-colors cursor-pointer"><td className="p-3 font-bold text-slate-700">{emp.name}</td><td className={`p-3 text-right font-black ${emp.totalOccurrences > 5 ? 'text-red-500' : 'text-slate-800'}`}>{emp.totalOccurrences}</td></tr>))}</tbody></table></div>
                        </div>
                    </div>
                </div>
            )}

            {viewMode === 'log' && (
                <div className="bg-white rounded-2xl shadow-lg border border-slate-200 flex-grow overflow-hidden flex flex-col">
                    <div className="p-4 border-b flex gap-4 bg-slate-50 flex-wrap">
                        <input className="p-2 border rounded font-bold text-xs flex-grow min-w-[150px] text-black bg-white" placeholder="Search Employee..." value={logFilter.search} onChange={e=>setLogFilter({...logFilter, search:e.target.value})} />
                        <select className="p-2 border rounded font-bold text-xs text-black bg-white" value={logFilter.type} onChange={e=>setLogFilter({...logFilter, type:e.target.value})}><option value="All">All Types</option><option>Sick</option><option>FMLA</option><option>No Call/No Show</option></select>
                        <select className="p-2 border rounded font-bold text-xs text-black bg-white" value={logFilter.sort} onChange={e=>setLogFilter({...logFilter, sort:e.target.value})}><option value="desc">Newest First</option><option value="asc">Oldest First</option></select>
                    </div>
                    <div className="overflow-x-auto flex-grow">
                        <div className="min-w-[700px] bg-slate-50 border-b p-3 grid grid-cols-12 gap-2 text-[9px] font-black uppercase text-slate-400 tracking-widest"><div className="col-span-3">Employee Name</div><div className="col-span-2">Incident Type</div><div className="col-span-2">Date</div><div className="col-span-1 text-center">Count</div><div className="col-span-1 text-center">Doc?</div><div className="col-span-2">Notes</div><div className="col-span-1 text-center">Action</div></div>
                        <div className="min-w-[700px] divide-y divide-slate-100">{filteredLog.length === 0 ? <div className="p-10 text-center text-slate-300 italic">No attendance records found.</div> : filteredLog.map((log, i) => (<div key={i} className="grid grid-cols-12 gap-2 p-3 items-center hover:bg-blue-50 transition-colors text-xs"><div className="col-span-3 font-bold text-[#002d72]">{log.employeeName}</div><div className="col-span-2 font-medium text-slate-600"><span className={`px-2 py-0.5 rounded text-[10px] uppercase font-black ${log.type==='Sick'?'bg-orange-100 text-orange-700':log.type==='FMLA'?'bg-blue-100 text-blue-700':'bg-red-100 text-red-700'}`}>{log.type}</span></div><div className="col-span-2 font-mono text-slate-500">{log.date}</div><div className="col-span-1 text-center font-black text-slate-800">{log.count}</div><div className="col-span-1 text-center text-slate-600">{log.docReceived ? '✅' : '❌'}</div><div className="col-span-2 text-slate-500 truncate italic">{log.notes || '-'}</div><div className="col-span-1 text-center"><button onClick={() => handleDeleteIncident(log.employeeId, log)} className="text-red-400 hover:text-red-600 font-bold">🗑️</button></div></div>))}</div>
                    </div>
                </div>
            )}

            {showAddModal && (<div className="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"><div className="bg-white p-6 rounded-2xl w-full max-w-sm"><h3 className="text-xl font-black text-[#002d72] mb-4">Add Employee</h3><input className="w-full p-3 border rounded mb-4 font-bold text-black bg-white" placeholder="Full Name (e.g. John Doe)" value={newEmpName} onChange={e=>setNewEmpName(e.target.value)} /><div className="flex gap-2"><button onClick={()=>setShowAddModal(false)} className="flex-1 py-3 bg-slate-100 rounded font-bold text-xs text-black">Cancel</button><button onClick={handleAddEmployee} className="flex-1 py-3 bg-[#002d72] text-white rounded font-bold text-xs">Add</button></div></div></div>)}
            {showIncidentModal && (<div className="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"><div className="bg-white p-8 rounded-2xl w-full max-w-md shadow-2xl"><h3 className="text-2xl font-black text-[#ef7c00] mb-6 uppercase">Log Attendance Incident</h3><label className="text-[10px] font-black text-slate-400 uppercase">Employee</label><select className="w-full p-3 border-2 rounded-lg font-bold mb-4 text-black bg-white" value={selectedEmpId} onChange={e=>setSelectedEmpId(e.target.value)}><option value="">-- Select Employee --</option>{personnel.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><div className="grid grid-cols-2 gap-4 mb-4"><div><label className="text-[10px] font-black text-slate-400 uppercase">Type</label><select className="w-full p-3 border-2 rounded-lg font-bold text-sm text-black bg-white" value={incData.type} onChange={e=>setIncData({...incData, type:e.target.value})}><option>Sick</option><option>FMLA</option><option>Failure to Report</option><option>Late Reporting</option><option>NC/NS</option></select></div><div><label className="text-[10px] font-black text-slate-400 uppercase">Occurrences</label><input type="number" className="w-full p-3 border-2 rounded-lg font-bold text-sm text-black bg-white" value={incData.count} onChange={e=>setIncData({...incData, count:Number(e.target.value)})} /></div></div><label className="text-[10px] font-black text-slate-400 uppercase">Date</label><input type="date" className="w-full p-3 border-2 rounded-lg font-bold mb-4 text-sm text-black bg-white" value={incData.date} onChange={e=>setIncData({...incData, date:e.target.value})} /><div className="flex items-center gap-3 mb-4 p-3 bg-blue-50 rounded-lg border border-blue-100 cursor-pointer" onClick={()=>setIncData({...incData, docReceived:!incData.docReceived})}><div className={`w-5 h-5 rounded border flex items-center justify-center ${incData.docReceived ? 'bg-blue-500 border-blue-500 text-white' : 'bg-white border-slate-300'}`}>{incData.docReceived && '✓'}</div><span className="text-xs font-bold text-blue-800">Documentation Received?</span></div><textarea className="w-full p-3 border-2 rounded-lg h-24 mb-6 font-medium text-sm text-black bg-white" placeholder="Additional notes..." value={incData.notes} onChange={e=>setIncData({...incData, notes:e.target.value})} /><div className="flex gap-4"><button onClick={()=>setShowIncidentModal(false)} className="w-1/3 py-3 bg-slate-100 rounded-xl font-black uppercase text-xs text-black">Cancel</button><button onClick={handleLogIncident} className="w-2/3 py-3 bg-[#002d72] text-white rounded-xl font-black uppercase text-xs shadow-lg hover:bg-blue-900">Save Record</button></div></div></div>)}
        </div>
    );
};

// --- MODULE 2: PARTS REGISTRY (Local Search) ---
const PartsInventory = ({ showToast }: { showToast: (msg: string, type: 'success'|'error') => void }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [displayLimit, setDisplayLimit] = useState(100);
    const [sortConfig, setSortConfig] = useState<{ key: 'partNumber' | 'name', direction: 'asc' | 'desc' }>({ key: 'name', direction: 'asc' });
    const [isLargeText, setIsLargeText] = useState(false);

    const filteredParts = useMemo(() => {
        let results = localParts;
        if (searchTerm) {
            const lowerSearch = searchTerm.toLowerCase();
            results = localParts.filter((p: any) => 
                (p.partNumber && String(p.partNumber).toLowerCase().includes(lowerSearch)) || 
                (p.name && String(p.name).toLowerCase().includes(lowerSearch))
            );
        }
        return [...results].sort((a: any, b: any) => {
            const valA = String(a[sortConfig.key] || '').toLowerCase();
            const valB = String(b[sortConfig.key] || '').toLowerCase();
            if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
            if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [searchTerm, sortConfig]);

    const visibleParts = filteredParts.slice(0, displayLimit);

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
        showToast(`Copied: ${text}`, 'success');
    };

    const handleSort = (key: 'partNumber' | 'name') => {
        setSortConfig(prev => ({
            key,
            direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
        }));
    };

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col relative">
            <div className="flex justify-between items-end mb-6 px-2">
                <div><h2 className="text-3xl font-black text-[#002d72] italic uppercase tracking-tighter leading-none">Parts Registry</h2><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2">Local Reference (Search {localParts.length.toLocaleString()} Items)</p></div>
                <div className="flex items-center gap-3 w-full max-w-lg"><button onClick={() => setIsLargeText(!isLargeText)} className={`h-12 w-12 flex items-center justify-center rounded-2xl border-2 font-black transition-all ${isLargeText ? 'bg-[#002d72] border-[#002d72] text-white' : 'bg-white border-slate-200 text-slate-400 hover:border-[#002d72] hover:text-[#002d72]'}`} title="Toggle Text Size">Aa</button><div className="relative flex-grow"><input type="text" placeholder="Search Part # or Description..." className="w-full p-4 pl-12 bg-white border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-[#002d72] transition-all shadow-sm text-black" value={searchTerm} onChange={e => { setSearchTerm(e.target.value); setDisplayLimit(100); }} /><span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl">🔍</span></div></div>
            </div>
            <div className="bg-white rounded-3xl shadow-xl border border-slate-100 flex-grow overflow-hidden flex flex-col relative"><div className="bg-[#002d72] grid grid-cols-12 gap-4 p-5 text-[10px] font-black uppercase text-white tracking-widest select-none"><div className="col-span-3 cursor-pointer hover:text-[#ef7c00] flex items-center gap-1" onClick={() => handleSort('partNumber')}>Part Number {sortConfig.key === 'partNumber' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</div><div className="col-span-8 cursor-pointer hover:text-[#ef7c00] flex items-center gap-1" onClick={() => handleSort('name')}>Description {sortConfig.key === 'name' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</div><div className="col-span-1 text-center">View</div></div><div className="overflow-y-auto flex-grow bg-slate-50/30 custom-scrollbar">{visibleParts.length === 0 ? <div className="p-20 text-center text-slate-300 italic font-bold">No results found.</div> : (<div className="divide-y divide-slate-100">{visibleParts.map((p: any, i: number) => (<div key={i} className="grid grid-cols-12 gap-4 p-4 hover:bg-white transition-all group items-center"><div onClick={() => handleCopy(p.partNumber)} className={`col-span-3 font-mono font-black text-[#002d72] bg-blue-50 w-fit rounded-lg cursor-pointer hover:bg-[#ef7c00] hover:text-white transition-all active:scale-95 shadow-sm ${isLargeText ? 'text-xl px-4 py-2' : 'text-sm px-3 py-1'}`} title="Click to Copy">{p.partNumber}</div><div className={`col-span-8 font-bold text-slate-600 uppercase flex items-center ${isLargeText ? 'text-lg leading-normal' : 'text-[11px] leading-tight'}`}>{p.name}</div><div className="col-span-1 flex justify-center"><a href={`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(p.name + " " + p.partNumber + " bus part")}`} target="_blank" rel="noopener noreferrer" className={`opacity-50 hover:opacity-100 hover:scale-125 transition-all text-[#002d72] no-underline ${isLargeText ? 'text-2xl' : 'text-lg'}`} title="Search on Google Images">👁️</a></div></div>))}</div>)}</div></div>
        </div>
    );
};

// --- MODULE 3: FLEET ANALYTICS ---
const StatusCharts = ({ buses }: { buses: any[] }) => {
    const statusCounts: {[key: string]: number} = { 'Active': 0, 'In Shop': 0, 'Engine': 0, 'Body Shop': 0, 'Vendor': 0, 'Brakes': 0, 'Safety': 0 };
    buses.forEach(b => { if (statusCounts[b.status] !== undefined) statusCounts[b.status]++; else statusCounts['Active']++; });
    const maxCount = Math.max(...Object.values(statusCounts), 1);
    const trendData = [...Array(7)].map((_, i) => {
        const d = new Date(); d.setDate(d.getDate() - (6 - i));
        const ds = d.toISOString().split('T')[0];
        return { label: ds.slice(5), count: buses.filter(b => b.oosStartDate === ds).length };
    });

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100"><h3 className="text-[10px] font-black text-[#002d72] uppercase tracking-widest mb-6">Status Breakdown</h3><div className="flex items-end gap-3 h-40">{Object.entries(statusCounts).map(([s, c]) => (<div key={s} className="flex-1 flex flex-col justify-end items-center group relative"><div className="absolute -top-6 text-[10px] font-bold text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity">{c}</div><div className={`w-full rounded-t-md transition-all duration-500 ${s==='Active'?'bg-green-500':s==='In Shop'?'bg-[#ef7c00]':'bg-red-500'}`} style={{ height: `${(c/maxCount)*100 || 2}%` }}></div><p className="text-[8px] font-black text-slate-400 uppercase mt-2 -rotate-45 origin-left translate-y-2 whitespace-nowrap">{s}</p></div>))}</div></div>
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100"><h3 className="text-[10px] font-black text-[#002d72] uppercase tracking-widest mb-6">7-Day Intake Trend</h3><div className="flex items-end gap-2 h-40">{trendData.map((d, i) => (<div key={i} className="flex-1 flex flex-col justify-end items-center group relative"><div className="absolute -top-6 text-[10px] font-bold text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity">{d.count}</div><div className="w-full bg-blue-100 hover:bg-[#002d72] rounded-t-sm transition-all" style={{ height: `${(d.count/Math.max(...trendData.map(t=>t.count),1))*100 || 2}%` }}></div><p className="text-[8px] font-bold text-slate-300 mt-2">{d.label}</p></div>))}</div></div>
        </div>
    );
};

const AnalyticsDashboard = ({ buses, showToast }: { buses: any[], showToast: (msg: string, type: 'success'|'error') => void }) => {
    const [shopQueens, setShopQueens] = useState<{number: string, count: number}[]>([]);
    const [isResetting, setIsResetting] = useState(false);
    useEffect(() => {
        const fetchRankings = async () => {
            const rankings: {number: string, count: number}[] = [];
            const sampleBuses = buses.slice(0, 50); 
            for (const bus of sampleBuses) {
                const hSnap = await getDocs(query(collection(db, "buses", bus.number, "history"), limit(20)));
                if (hSnap.size > 0) rankings.push({ number: bus.number, count: hSnap.size });
            }
            setShopQueens(rankings.sort((a,b) => b.count - a.count).slice(0, 5));
        };
        if(buses.length > 0) fetchRankings();
    }, [buses]);

    const handleResetMetrics = async () => {
        if(!confirm("⚠️ WARNING: This will WIPE ALL HISTORY logs for the entire fleet.")) return;
        setIsResetting(true);
        try {
            let deletedCount = 0;
            for (const bus of buses) {
                const hSnap = await getDocs(collection(db, "buses", bus.number, "history"));
                if (!hSnap.empty) { const batch = writeBatch(db); hSnap.docs.forEach(doc => batch.delete(doc.ref)); await batch.commit(); deletedCount += hSnap.size; }
            }
            showToast(`Analytics Reset Complete. Cleared ${deletedCount} records.`, 'success'); setShopQueens([]); 
        } catch (err) { console.error("Reset failed", err); showToast("Failed to reset records.", 'error'); }
        setIsResetting(false);
    };
    const avgOOS = buses.reduce((acc, b) => acc + (b.status !== 'Active' ? 1 : 0), 0);
    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Fleet Availability</p><p className="text-4xl font-black text-[#002d72] italic">{Math.round(((buses.length - avgOOS) / Math.max(buses.length, 1)) * 100)}%</p></div>
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Down Units</p><p className="text-4xl font-black text-red-500 italic">{avgOOS}</p></div>
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100"><div className="flex justify-between items-center mb-2"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Analytics Admin</p><button onClick={handleResetMetrics} disabled={isResetting} className="text-[9px] font-black text-red-400 hover:text-red-600 uppercase border border-red-100 rounded px-2 py-1 bg-red-50 disabled:opacity-50">{isResetting ? "..." : "Reset All Logs"}</button></div><div className="space-y-2">{shopQueens.map((queen, i) => (<div key={i} className="flex justify-between items-center text-xs border-b border-slate-50 pb-1"><span className="font-bold text-slate-700">#{queen.number}</span><span className="font-mono text-red-500">{queen.count} logs</span></div>))}</div></div>
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
    const copy = () => {
        const txt = report.map(r => `[Unit ${r.bus}] ${r.action}: ${r.details}`).join('\n');
        navigator.clipboard.writeText(`SHIFT REPORT - ${new Date().toLocaleDateString()}\n\n${txt}`);
        showToast("Report copied to clipboard!", 'success');
    };
    return (
        <div className="max-w-4xl mx-auto p-8 animate-in fade-in slide-in-from-bottom-4"><div className="flex justify-between items-center mb-8"><h2 className="text-3xl font-black text-[#002d72] uppercase italic italic">Shift Handover</h2><button onClick={copy} className="px-6 py-3 bg-[#002d72] text-white rounded-xl font-black uppercase text-xs shadow-lg hover:bg-[#ef7c00] transition-all transform active:scale-95">Copy Report</button></div><div className="space-y-4">{report.map((l, i) => (<div key={i} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex gap-6 items-center"><div className="w-16 h-16 bg-[#002d72]/5 rounded-xl flex items-center justify-center font-black text-[#002d72] text-lg">#{l.bus}</div><div className="flex-grow"><div className="flex justify-between mb-1"><span className="text-[10px] font-black text-[#ef7c00] uppercase">{l.action}</span><span className="text-[10px] font-bold text-slate-400">{formatTime(l.timestamp)}</span></div><p className="text-sm font-bold text-slate-700 whitespace-pre-wrap">{l.details}</p><p className="text-[9px] text-slate-400 mt-2 uppercase tracking-widest">{l.user}</p></div></div>))}</div></div>
    );
};

// --- COMPONENT: BUS DETAIL POPUP (WITH DELETE & RESET) ---
const BusDetailView = ({ bus, onClose, showToast }: { bus: any; onClose: () => void; showToast: (m:string, t:'success'|'error')=>void }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [historyLogs, setHistoryLogs] = useState<any[]>([]); 
    const [editData, setEditData] = useState({ status: bus.status || 'Active', location: bus.location || '', notes: bus.notes || '', oosStartDate: bus.oosStartDate || '', expectedReturnDate: bus.expectedReturnDate || '', actualReturnDate: bus.actualReturnDate || '' });
    useEffect(() => { if (showHistory) return onSnapshot(query(collection(db, "buses", bus.number, "history"), orderBy("timestamp", "desc")), (snap) => setHistoryLogs(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })))); }, [showHistory, bus.number]);
    const handleSave = async () => {
        try {
            const busRef = doc(db, "buses", bus.number);
            const currentSnap = await getDoc(busRef);
            const old = currentSnap.data() || {};
            let changes = [];
            if (old.status !== editData.status) changes.push(`STATUS: ${old.status} ➝ ${editData.status}`);
            if (old.notes !== editData.notes) changes.push(`NOTES: "${old.notes || ''}" ➝ "${editData.notes}"`);
            if (old.location !== editData.location) changes.push(`LOC: ${old.location || '—'} ➝ ${editData.location}`);
            await setDoc(busRef, { ...editData, timestamp: serverTimestamp() }, { merge: true });
            if (changes.length > 0) await logHistory(bus.number, "EDIT", changes.join('\n'), auth.currentUser?.email || 'Unknown');
            showToast(`Bus #${bus.number} updated`, 'success'); setIsEditing(false);
        } catch (err) { showToast("Save failed", 'error'); }
    };
    const handleDeleteLog = async (logId: string) => {
        if(!confirm("Are you sure you want to delete this log entry?")) return;
        try { await deleteDoc(doc(db, "buses", bus.number, "history", logId)); showToast("Log deleted", 'success'); } 
        catch(err) { showToast("Failed to delete log", 'error'); }
    };
    const handleResetBus = async () => {
        if(!confirm("⚠️ WARNING: This will clear ALL notes, locations, and dates for this bus and set it to 'Active'. Continue?")) return;
        try {
            const busRef = doc(db, "buses", bus.number);
            const resetData = { status: 'Active', location: '', notes: '', oosStartDate: '', expectedReturnDate: '', actualReturnDate: '', timestamp: serverTimestamp() };
            await setDoc(busRef, resetData, { merge: true });
            await logHistory(bus.number, "RESET", "Bus reset to default state.", auth.currentUser?.email || 'Unknown');
            showToast(`Bus #${bus.number} has been reset.`, 'success');
            onClose();
        } catch(err) { showToast("Reset failed.", 'error'); }
    };

    if (showHistory) return (<div className="bg-white p-6 rounded-xl shadow-2xl w-full max-w-lg h-[600px] flex flex-col animate-in zoom-in-95"><div className="flex justify-between items-center mb-4 border-b pb-4 font-black text-[#002d72] uppercase"><span>History: #{bus.number}</span><button onClick={()=>setShowHistory(false)} className="text-xs text-slate-400">Back</button></div><div className="flex-grow overflow-y-auto space-y-3">{historyLogs.map(l => (<div key={l.id} className="p-3 bg-slate-50 rounded-lg border border-slate-100 relative group"><div className="flex justify-between text-[8px] font-black uppercase text-slate-400 mb-1"><span>{l.action}</span><span>{formatTime(l.timestamp)}</span></div><p className="text-xs font-bold text-slate-700 whitespace-pre-wrap leading-tight">{l.details}</p><button onClick={() => handleDeleteLog(l.id)} className="absolute top-2 right-2 text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity text-xs font-bold">DELETE</button></div>))}</div></div>);
    if (isEditing) return (<div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-2xl animate-in zoom-in-95"><h3 className="text-2xl font-black text-[#002d72] mb-6 uppercase italic">Edit Bus #{bus.number}</h3><div className="grid grid-cols-2 gap-4 mb-4"><select className="p-3 bg-slate-50 border-2 rounded-lg font-bold text-black bg-white" value={editData.status} onChange={e=>setEditData({...editData, status:e.target.value})}><option value="Active">Ready</option><option value="On Hold">On Hold</option><option value="In Shop">In Shop</option><option value="Engine">Engine</option><option value="Body Shop">Body Shop</option><option value="Vendor">Vendor</option><option value="Brakes">Brakes</option><option value="Safety">Safety</option></select><input className="p-3 bg-slate-50 border-2 rounded-lg font-bold text-black bg-white" value={editData.location} onChange={e=>setEditData({...editData, location:e.target.value})} placeholder="Location" /></div><textarea className="w-full p-3 bg-slate-50 border-2 rounded-lg h-24 mb-4 font-bold text-black bg-white" value={editData.notes} onChange={e=>setEditData({...editData, notes:e.target.value})} placeholder="Maintenance Notes" /><div className="grid grid-cols-3 gap-4 mb-6 text-[9px] font-black uppercase text-slate-400"><div>OOS Date<input type="date" className="w-full p-2 border rounded mt-1 font-bold text-slate-900 bg-white" value={editData.oosStartDate} onChange={e=>setEditData({...editData, oosStartDate:e.target.value})} /></div><div>Exp Return<input type="date" className="w-full p-2 border rounded mt-1 font-bold text-slate-900 bg-white" value={editData.expectedReturnDate} onChange={e=>setEditData({...editData, expectedReturnDate:e.target.value})} /></div><div>Act Return<input type="date" className="w-full p-2 border rounded mt-1 font-bold text-slate-900 bg-white" value={editData.actualReturnDate} onChange={e=>setEditData({...editData, actualReturnDate:e.target.value})} /></div></div><div className="flex gap-4"><button onClick={()=>setIsEditing(false)} className="w-1/2 py-3 bg-slate-100 rounded-xl font-black uppercase text-xs text-black">Cancel</button><button onClick={handleSave} className="w-1/2 py-3 bg-[#002d72] text-white rounded-xl font-black uppercase text-xs shadow-lg">Save Changes</button></div></div>);
    return (
        <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-2xl animate-in zoom-in-95">
            <div className="flex justify-between items-start mb-6 border-b pb-4">
                <div><h3 className="text-4xl font-black text-[#002d72] italic uppercase">Bus #{bus.number}</h3><span className={`inline-block mt-2 px-3 py-1 rounded-full text-[10px] font-black uppercase ${bus.status==='Active'?'bg-green-100 text-green-700':'bg-red-100 text-red-700'}`}>{bus.status}</span></div>
                <div className="flex gap-2">
                    <button onClick={handleResetBus} className="text-red-400 text-xs font-black uppercase border border-red-100 bg-red-50 px-3 py-1 rounded hover:bg-red-500 hover:text-white transition-colors">Reset</button>
                    <button onClick={onClose} className="text-slate-400 text-2xl font-bold hover:text-slate-600 transition-colors">✕</button>
                </div>
            </div>
            <div className="bg-slate-50 p-4 rounded-xl mb-6"><p className="text-[10px] font-black uppercase text-slate-400 mb-2">Fault Details</p><p className="text-lg font-medium text-slate-800">{bus.notes || "No active faults."}</p></div>
            <div className="grid grid-cols-3 gap-4 mb-6"><div><p className="text-[9px] font-black uppercase text-slate-400">OOS Date</p><p className="text-xl font-black text-[#002d72]">{bus.oosStartDate || '--'}</p></div><div><p className="text-[9px] font-black uppercase text-slate-400">Exp Return</p><p className="text-xl font-black text-[#ef7c00]">{bus.expectedReturnDate || '--'}</p></div><div><p className="text-[9px] font-black uppercase text-slate-400">Act Return</p><p className="text-xl font-black text-green-600">{bus.actualReturnDate || '--'}</p></div></div>
            <div className="flex justify-between pt-6 border-t"><button onClick={()=>setShowHistory(true)} className="px-5 py-3 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black uppercase">📜 History</button><div className="flex gap-3"><button onClick={()=>setIsEditing(true)} className="px-8 py-3 bg-slate-100 text-[#002d72] rounded-lg text-[10px] font-black uppercase">Edit</button><button onClick={onClose} className="px-8 py-3 bg-[#002d72] text-white rounded-lg text-[10px] font-black uppercase">Close</button></div></div>
        </div>
    );
};

// --- COMPONENT: DATA ENTRY ---
const BusInputForm = ({ showToast }: { showToast: (m:string, t:'success'|'error')=>void }) => {
    const [formData, setFormData] = useState({ number: '', status: 'Active', location: '', notes: '', oosStartDate: '', expectedReturnDate: '', actualReturnDate: '' });
    const handleChange = (e: any) => setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const busRef = doc(db, "buses", formData.number); const busSnap = await getDoc(busRef);
        if (!busSnap.exists()) return showToast(`⛔ ACCESS DENIED: Bus #${formData.number} not in registry.`, 'error');
        const old = busSnap.data(); let changes = [];
        if (old.status !== formData.status) changes.push(`STATUS: ${old.status} ➝ ${formData.status}`);
        if (old.notes !== formData.notes) changes.push(`NOTES: "${old.notes || ''}" ➝ "${formData.notes}"`);
        if (old.oosStartDate !== formData.oosStartDate) changes.push(`OOS: ${old.oosStartDate || '—'} ➝ ${formData.oosStartDate}`);
        await setDoc(busRef, { ...formData, timestamp: serverTimestamp() }, { merge: true });
        if (changes.length > 0) await logHistory(formData.number, "UPDATE", changes.join('\n'), auth.currentUser?.email || 'Unknown');
        else await logHistory(formData.number, "UPDATE", "Routine Update via Terminal", auth.currentUser?.email || 'Unknown');
        showToast(`Bus #${formData.number} Updated`, 'success'); setFormData({ number: '', status: 'Active', location: '', notes: '', oosStartDate: '', expectedReturnDate: '', actualReturnDate: '' });
    };
    return (
        <div className="max-w-2xl mx-auto mt-10 p-8 bg-white rounded-2xl shadow-xl border-t-8 border-[#002d72] animate-in slide-in-from-bottom-4 duration-500"><h2 className="text-3xl font-black text-[#002d72] italic uppercase mb-8 text-center tracking-tighter">Data Entry Terminal</h2><form onSubmit={handleSubmit} className="space-y-6"><div className="grid grid-cols-2 gap-6"><input type="text" placeholder="Unit #" className="p-4 bg-slate-50 border-2 rounded-xl font-black text-[#002d72] outline-none focus:border-[#002d72] transition-colors bg-white" value={formData.number} onChange={handleChange} name="number" required /><select className="p-4 bg-slate-50 border-2 rounded-xl font-bold outline-none focus:border-[#002d72] transition-colors text-black bg-white" value={formData.status} onChange={handleChange} name="status"><option value="Active">Ready for Service</option><option value="On Hold">Maintenance Hold</option><option value="In Shop">In Shop</option><option value="Engine">Engine</option><option value="Body Shop">Body Shop</option><option value="Vendor">Vendor</option><option value="Brakes">Brakes</option><option value="Safety">Safety</option></select></div><input type="text" placeholder="Location" className="w-full p-4 bg-slate-50 border-2 rounded-xl outline-none focus:border-[#002d72] transition-colors text-black bg-white" value={formData.location} onChange={handleChange} name="location" /><textarea placeholder="Maintenance Notes" className="w-full p-4 bg-slate-50 border-2 rounded-xl h-24 outline-none focus:border-[#002d72] transition-colors text-black bg-white" value={formData.notes} onChange={handleChange} name="notes" /><div className="grid grid-cols-3 gap-4"><div><label className="text-[9px] font-black uppercase text-slate-400 block mb-1">OOS Date</label><input name="oosStartDate" type="date" className="w-full p-2 bg-slate-50 border-2 rounded-lg text-xs font-bold text-black bg-white" value={formData.oosStartDate} onChange={handleChange} /></div><div><label className="text-[9px] font-black uppercase text-slate-400 block mb-1">Exp Return</label><input name="expectedReturnDate" type="date" className="w-full p-2 bg-slate-50 border-2 rounded-lg text-xs font-bold text-black bg-white" value={formData.expectedReturnDate} onChange={handleChange} /></div><div><label className="text-[9px] font-black uppercase text-slate-400 block mb-1">Act Return</label><input name="actualReturnDate" type="date" className="w-full p-2 bg-slate-50 border-2 rounded-lg text-xs font-bold text-black bg-white" value={formData.actualReturnDate} onChange={handleChange} /></div></div><button className="w-full py-4 bg-[#002d72] hover:bg-[#ef7c00] text-white rounded-xl font-black uppercase tracking-widest transition-all transform active:scale-95 shadow-lg">Update Record</button></form></div>
    );
};

// --- MAIN APPLICATION ---
export default function FleetManager() {
  const [user, setUser] = useState<any>(null);
  const [view, setView] = useState<'inventory' | 'tracker' | 'input' | 'analytics' | 'handover' | 'parts' | 'personnel'>('inventory');
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
  
  // ADMIN CHECK: Add your emails here
  const isAdmin = user && (
      user.email === 'anetowestfield@gmail.com' || 
      user.email === 'supervisor@fleet.com' ||
      user.email === 'admin@admin.com'
  );

  const triggerToast = (msg: string, type: 'success' | 'error') => { setToast({ msg, type }); };

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
    if (sortConfig.key === 'daysOOS') { aV = calculateDaysOOS(a.oosStartDate); bV = calculateDaysOOS(b.oosStartDate); }
    if (aV < bV) return sortConfig.direction === 'asc' ? -1 : 1;
    if (aV > bV) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  const exportExcel = async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('OOS Detail');
    ws.columns = [{header:'Bus #',key:'number',width:10},{header:'Status',key:'status',width:15},{header:'Location',key:'location',width:15},{header:'Fault',key:'notes',width:30},{header:'OOS Start',key:'start',width:15}];
    buses.forEach(b => ws.addRow({number:b.number, status:b.status, location:b.location||'', notes:b.notes||'', start:b.oosStartDate||''}));
    const buf = await wb.xlsx.writeBuffer(); saveAs(new Blob([buf]), `Fleet_Status_Report.xlsx`);
    setToast({msg:"Excel Downloaded", type:'success'});
  };

  if (!user) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4 relative overflow-hidden">
      <form onSubmit={async e => { e.preventDefault(); try { await signInWithEmailAndPassword(auth, email, password); } catch(e){} }} className="bg-white p-10 rounded-2xl shadow-2xl w-full max-w-md border-t-[12px] border-[#ef7c00] relative z-10 animate-in fade-in zoom-in">
        <h2 className="text-4xl font-black text-[#002d72] italic mb-8 text-center leading-none uppercase">FLEET OPS</h2>
        <div className="space-y-4">
          <input className="w-full p-4 bg-slate-50 border-2 rounded-xl font-bold text-black" placeholder="supervisor@fleet.com" value={email} onChange={e=>setEmail(e.target.value)} required />
          <input className="w-full p-4 bg-slate-50 border-2 rounded-xl font-bold text-black" placeholder="password123" type="password" value={password} onChange={e=>setPassword(e.target.value)} required />
          <button className="w-full bg-[#002d72] text-white py-5 rounded-xl font-black uppercase tracking-widest hover:bg-[#ef7c00] transition-all transform active:scale-95 shadow-xl">Authorized Login</button>
        </div>
      </form>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-[#ef7c00] selection:text-white">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      {selectedBusDetail && (<div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200"><BusDetailView bus={selectedBusDetail} onClose={() => setSelectedBusDetail(null)} showToast={triggerToast} /></div>)}

      <nav className="bg-white/90 backdrop-blur-md border-b border-slate-200 sticky top-0 z-[1001] px-6 py-4 flex justify-between items-center shadow-sm overflow-x-auto">
        <div className="flex items-center gap-2"><div className="w-2 h-6 bg-[#002d72] rounded-full"></div><span className="font-black text-lg italic uppercase tracking-tighter text-[#002d72]">Fleet Manager</span></div>
        <div className="flex gap-4 items-center whitespace-nowrap">
          {['inventory', 'input', 'tracker', 'handover', 'parts'].concat(isAdmin ? ['analytics', 'personnel'] : []).map(v => (
            <button key={v} onClick={() => setView(v as any)} className={`text-[9px] font-black uppercase tracking-widest border-b-2 pb-1 transition-all ${view === v ? 'border-[#ef7c00] text-[#002d72]' : 'border-transparent text-slate-400 hover:text-[#002d72]'}`}>{v.replace('input', 'Data Entry').replace('parts', 'Parts List').replace('personnel', 'Personnel')}</button>
          ))}
          <button onClick={exportExcel} className="text-[#002d72] text-[10px] font-black uppercase hover:text-[#ef7c00]">Excel</button>
          <button onClick={() => signOut(auth)} className="text-red-500 text-[10px] font-black uppercase">Logout</button>
        </div>
      </nav>

      <main className="max-w-[1600px] mx-auto p-6">
        {view === 'tracker' ? <div className="h-[85vh] bg-white rounded-2xl shadow-sm border overflow-hidden relative"><BusTracker /></div> :
         view === 'input' ? <BusInputForm showToast={triggerToast} /> :
         view === 'analytics' ? (isAdmin ? <div className="animate-in fade-in duration-500"><StatusCharts buses={buses} /><AnalyticsDashboard buses={buses} showToast={triggerToast} /></div> : <div className="p-20 text-center text-red-500 font-black">ACCESS DENIED</div>) :
         view === 'handover' ? <ShiftHandover buses={buses} showToast={triggerToast} /> :
         view === 'parts' ? <PartsInventory showToast={triggerToast} /> :
         view === 'personnel' ? (isAdmin ? <PersonnelManager showToast={triggerToast} /> : <div className="p-20 text-center text-red-500 font-black">ACCESS DENIED</div>) : (
          <>
            <div className="grid grid-cols-4 gap-4 mb-8">{[{label:'Total Fleet',val:buses.length,c:'text-slate-900'},{label:'Ready',val:buses.filter(b=>b.status==='Active'||b.status==='In Shop').length,c:'text-green-600'},{label:'On Hold',val:buses.filter(b=>holdStatuses.includes(b.status)).length,c:'text-red-600'},{label:'In Shop',val:buses.filter(b=>b.status==='In Shop').length,c:'text-[#ef7c00]'}].map(m=>(<div key={m.label} onClick={()=>setActiveFilter(m.label)} className={`bg-white p-5 rounded-2xl shadow-sm border flex flex-col items-center cursor-pointer transition-all hover:scale-105 ${activeFilter===m.label?'border-[#002d72] bg-blue-50':'border-slate-100'}`}><p className="text-[8px] font-black uppercase text-slate-400 mb-1 tracking-widest">{m.label}</p><p className={`text-2xl font-black ${m.c}`}>{m.val}</p></div>))}</div>
            <div className="mb-6 flex justify-between items-end gap-4"><input type="text" placeholder="Search Unit #..." className="w-full max-w-md pl-4 pr-10 py-3 bg-white border border-slate-200 rounded-lg text-sm font-bold focus:border-[#002d72] outline-none shadow-sm text-black" value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} /><div className="bg-white border rounded-lg p-1 flex"><button onClick={()=>setInventoryMode('list')} className={`px-4 py-1.5 text-[10px] font-black uppercase rounded ${inventoryMode==='list'?'bg-[#002d72] text-white shadow-md':'text-slate-400'}`}>List</button><button onClick={()=>setInventoryMode('grid')} className={`px-4 py-1.5 text-[10px] font-black uppercase rounded ${inventoryMode==='grid'?'bg-[#002d72] text-white shadow-md':'text-slate-400'}`}>Grid</button></div></div>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden min-h-[500px]">
                {inventoryMode === 'list' ? (<><div className="grid grid-cols-10 gap-4 p-5 border-b bg-slate-50/50 text-[9px] font-black uppercase text-slate-400 tracking-widest"><div onClick={()=>requestSort('number')} className="cursor-pointer hover:text-[#002d72]">Unit #</div><div>Series</div><div>Status</div><div>Location</div><div className="col-span-2">Fault Preview</div><div>Exp Return</div><div>Act Return</div><div>Days OOS</div></div><div className="divide-y divide-slate-100">{sortedBuses.map(b => (<div key={b.docId} onClick={()=>setSelectedBusDetail(b)} className={`grid grid-cols-10 gap-4 p-5 items-center cursor-pointer hover:bg-slate-50 transition-all border-l-4 ${b.status==='Active'?'border-green-500':'border-red-500'}`}><div className="text-lg font-black text-[#002d72]">#{b.number}</div><div className="text-[9px] font-bold text-slate-400">{getBusSpecs(b.number).length}</div><div className={`text-[9px] font-black uppercase px-2 py-1 rounded-full w-fit ${b.status==='Active'?'bg-green-100 text-green-700':'bg-red-100 text-red-700'}`}>{b.status}</div><div className="text-xs font-bold text-slate-600">{b.location||'—'}</div><div className="col-span-2 text-xs font-bold text-slate-500 truncate italic">{b.notes||'No faults.'}</div><div className="text-xs font-bold text-slate-700">{b.expectedReturnDate||'—'}</div><div className="text-xs font-bold text-slate-700">{b.actualReturnDate||'—'}</div><div className="text-xs font-black text-red-600">{b.status!=='Active' ? `${calculateDaysOOS(b.oosStartDate)} days` : '—'}</div></div>))}</div></>) : (<div className="p-8 grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 gap-3">{sortedBuses.map(b => (<div key={b.docId} onClick={()=>setSelectedBusDetail(b)} className={`h-14 rounded-lg border-2 flex flex-col items-center justify-center cursor-pointer transition-all hover:scale-110 shadow-sm ${b.status==='Active'?'bg-green-50 border-green-200 text-green-800':'bg-red-50 border-red-200 text-red-800'}`}><span className="text-xs font-black italic">#{b.number}</span>{b.status!=='Active'&&<span className="text-[7px] font-bold uppercase opacity-60 leading-none">{b.status}</span>}</div>))}</div>)}
            </div>
          </>
        )}
      </main>
    </div>
  );
}