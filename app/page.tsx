"use client"; // This tells Next.js this is an interactive page
import React, { useState } from 'react';

export default function MartaInventory() {
  const [buses, setBuses] = useState([]);
  const [busNumber, setBusNumber] = useState('');
  const [status, setStatus] = useState('Active');
  const [notes, setNotes] = useState('');

  const addBus = (e) => {
    e.preventDefault();
    if (!busNumber) return; // Don't add if empty
    
    const newBus = { 
      id: Date.now(),
      number: busNumber, 
      status: status, 
      notes: notes 
    };
    
    setBuses([newBus, ...buses]);
    // Reset the form
    setBusNumber('');
    setNotes('');
  };

  return (
    <main className="p-8 max-w-4xl mx-auto font-sans">
      <header className="mb-10 border-b pb-4">
        <h1 className="text-3xl font-bold text-blue-700">MARTA Bus Inventory</h1>
        <p className="text-gray-500 text-sm">Superintendent Admin Console</p>
      </header>

      {/* ADMIN CONSOLE FORM */}
      <section className="bg-gray-50 p-6 rounded-xl border border-gray-200 mb-10">
        <h2 className="text-lg font-semibold mb-4 text-gray-700">Add New Bus</h2>
        <form onSubmit={addBus} className="flex flex-col gap-4 md:flex-row">
          <input 
            type="text"
            placeholder="Bus #"
            className="flex-1 p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            value={busNumber}
            onChange={(e) => setBusNumber(e.target.value)}
          />
          <select 
            className="p-3 border rounded-lg bg-white"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="Active">🟢 Active</option>
            <option value="On Hold">🔴 On Hold</option>
            <option value="In Shop">🔧 In Shop</option>
          </select>
          <input 
            type="text"
            placeholder="Add notes..."
            className="flex-2 p-3 border rounded-lg"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <button className="bg-blue-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-blue-700 transition">
            Add Bus
          </button>
        </form>
      </section>

      {/* INVENTORY LIST */}
      <div className="overflow-hidden rounded-xl border border-gray-200">
        <table className="w-full text-left bg-white">
          <thead className="bg-gray-100 text-gray-600 text-sm">
            <tr>
              <th className="p-4">Bus Number</th>
              <th className="p-4">Status</th>
              <th className="p-4">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {buses.length === 0 ? (
              <tr><td colSpan="3" className="p-8 text-center text-gray-400">No buses in inventory yet.</td></tr>
            ) : (
              buses.map((bus) => (
                <tr key={bus.id} className="hover:bg-gray-50">
                  <td className="p-4 font-bold text-blue-900">{bus.number}</td>
                  <td className="p-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      bus.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {bus.status}
                    </span>
                  </td>
                  <td className="p-4 text-gray-600">{bus.notes}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}