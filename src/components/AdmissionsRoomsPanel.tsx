import React, { useState } from 'react';
import { BedDouble, Plus } from 'lucide-react';
import { apiFetch } from '../api';
import type { Admission, Patient, Room, UserRole } from '../types';
import { StatusText } from './StatusText';

interface AdmissionsRoomsPanelProps {
  role: UserRole;
  rooms: Room[];
  admissions: Admission[];
  patients: Patient[];
  onRefresh: () => void;
}

export function AdmissionsRoomsPanel({
  role,
  rooms,
  admissions,
  patients,
  onRefresh,
}: AdmissionsRoomsPanelProps) {
  const [showAdmit, setShowAdmit] = useState(false);
  const [showAddRoom, setShowAddRoom] = useState(false);
  const [admitPatientId, setAdmitPatientId] = useState(
    patients[0] ? String(patients[0].patient_id) : ''
  );
  const [admitRoomId, setAdmitRoomId] = useState(rooms[0] ? String(rooms[0].room_id) : '');
  const [admitDate, setAdmitDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [admitNotes, setAdmitNotes] = useState('');

  const [newRoom, setNewRoom] = useState({
    room_number: '',
    room_type: 'General Ward' as Room['room_type'],
    bed_count: 2,
    daily_rate: 1000,
  });

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canManageAdmissions = role === 'reception' || role === 'admin';
  const isAdmin = role === 'admin';

  async function handleAdmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/api/admissions', {
        method: 'POST',
        body: JSON.stringify({
          patient_id: Number(admitPatientId),
          room_id: Number(admitRoomId),
          admission_date: admitDate,
          notes: admitNotes,
        }),
      });
      setShowAdmit(false);
      setAdmitNotes('');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Admission failed.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDischarge(admissionId: number) {
    setError(null);
    try {
      await apiFetch(`/api/admissions/${admissionId}/discharge`, { method: 'PATCH' });
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Discharge failed.');
    }
  }

  async function handleCreateRoom(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/api/rooms', {
        method: 'POST',
        body: JSON.stringify(newRoom),
      });
      setShowAddRoom(false);
      setNewRoom({ room_number: '', room_type: 'General Ward', bed_count: 2, daily_rate: 1000 });
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create room.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Admissions &amp; Room Allocation
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Monitor ward bed inventory, register inpatient admissions, and process discharges.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                setShowAddRoom(true);
                setError(null);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Add Room</span>
            </button>
          )}
          {canManageAdmissions && (
            <button
              type="button"
              onClick={() => {
                if (!admitPatientId && patients[0]) setAdmitPatientId(String(patients[0].patient_id));
                if (!admitRoomId && rooms[0]) setAdmitRoomId(String(rooms[0].room_id));
                setShowAdmit(true);
                setError(null);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-teal-700 rounded-md hover:bg-teal-800 whitespace-nowrap cursor-pointer"
            >
              <BedDouble className="w-4 h-4" aria-hidden="true" />
              <span>Admit Patient</span>
            </button>
          )}
        </div>
      </div>

      {error && !showAdmit && !showAddRoom && (
        <div className="px-4 py-2.5 bg-red-50 border border-red-200 rounded-md text-xs text-red-700 font-medium">
          {error}
        </div>
      )}

      {/* Room & Bed Inventory */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold text-slate-900">Room &amp; Bed Inventory</h2>
          <span className="text-xs text-slate-500">Live availability across wards</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                <th className="py-2.5 px-4">Room No.</th>
                <th className="py-2.5 px-4">Ward Type</th>
                <th className="py-2.5 px-4 text-right">Total Beds</th>
                <th className="py-2.5 px-4 text-right">Available Beds</th>
                <th className="py-2.5 px-4 text-right">Daily Rate</th>
                <th className="py-2.5 px-4">Occupancy State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {rooms.map((r) => (
                <tr key={r.room_id} className="hover:bg-slate-50/80">
                  <td className="py-3 px-4 font-mono tabular-nums font-semibold text-slate-900">
                    {r.room_number}
                  </td>
                  <td className="py-3 px-4 text-slate-700">{r.room_type}</td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                    {r.bed_count}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                    {r.available_beds}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                    ₹{r.daily_rate.toLocaleString('en-IN')}
                  </td>
                  <td className="py-3 px-4">
                    <StatusText status={r.available_beds > 0 ? 'Active' : 'Full'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Admission Records */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="font-display text-sm font-semibold text-slate-900">Admission &amp; Discharge Log</h2>
        </div>
        {admissions.length === 0 ? (
          <div className="p-8 text-sm text-slate-500">No admission records found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-3 px-4">Adm ID</th>
                  <th className="py-3 px-4">Patient</th>
                  <th className="py-3 px-4">Room / Ward</th>
                  <th className="py-3 px-4">Admitted</th>
                  <th className="py-3 px-4">Discharged</th>
                  <th className="py-3 px-4">Status</th>
                  {canManageAdmissions && <th className="py-3 px-4 text-right">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {admissions.map((adm) => (
                  <tr key={adm.admission_id} className="hover:bg-slate-50/80">
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-500">
                      #{adm.admission_id}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{adm.patient_name}</div>
                      <div className="font-mono tabular-nums text-xs text-slate-500">
                        {adm.patient_code}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-slate-900 font-mono tabular-nums">
                        Room {adm.room_number}
                      </div>
                      <div className="text-xs text-slate-500">{adm.room_type}</div>
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-700">
                      {adm.admission_date}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-700">
                      {adm.discharge_date || '—'}
                    </td>
                    <td className="py-3 px-4">
                      <StatusText status={adm.status} />
                    </td>
                    {canManageAdmissions && (
                      <td className="py-3 px-4 text-right">
                        {adm.status === 'Admitted' && (
                          <button
                            type="button"
                            onClick={() => handleDischarge(adm.admission_id)}
                            className="px-3 py-1 text-xs font-medium text-slate-700 border border-slate-300 rounded hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                          >
                            Discharge Patient
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Admit Patient Modal */}
      {showAdmit && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-md w-full p-6 space-y-4">
            <h2 className="font-display text-lg font-semibold text-slate-900">Admit Patient to Ward</h2>
            {error && (
              <div role="alert" className="px-3 py-2 bg-red-50 border border-red-200 rounded text-xs text-red-700 font-medium">
                {error}
              </div>
            )}
            <form onSubmit={handleAdmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Patient</label>
                <select
                  value={admitPatientId}
                  onChange={(e) => setAdmitPatientId(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
                >
                  {patients.map((p) => (
                    <option key={p.patient_id} value={p.patient_id}>
                      {p.name} ({p.patient_code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Assign Room / Bed
                </label>
                <select
                  value={admitRoomId}
                  onChange={(e) => setAdmitRoomId(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
                >
                  {rooms.map((r) => (
                    <option key={r.room_id} value={r.room_id}>
                      Room {r.room_number} · {r.room_type} ({r.available_beds}/{r.bed_count} beds free)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Admission Date</label>
                <input
                  type="date"
                  required
                  value={admitDate}
                  onChange={(e) => setAdmitDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Clinical Notes</label>
                <input
                  type="text"
                  value={admitNotes}
                  onChange={(e) => setAdmitNotes(e.target.value)}
                  placeholder="Ward instructions or reason for admission"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAdmit(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-md cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-medium text-white bg-teal-700 rounded-md hover:bg-teal-800 cursor-pointer"
                >
                  {submitting ? 'Admitting...' : 'Confirm Admission'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Room Modal */}
      {showAddRoom && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-md w-full p-6 space-y-4">
            <h2 className="font-display text-lg font-semibold text-slate-900">Add Hospital Room</h2>
            {error && (
              <div className="px-3 py-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                {error}
              </div>
            )}
            <form onSubmit={handleCreateRoom} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Room Number</label>
                <input
                  type="text"
                  required
                  value={newRoom.room_number}
                  onChange={(e) => setNewRoom({ ...newRoom, room_number: e.target.value })}
                  placeholder="e.g. 302"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Room Type</label>
                <select
                  value={newRoom.room_type}
                  onChange={(e) =>
                    setNewRoom({ ...newRoom, room_type: e.target.value as Room['room_type'] })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
                >
                  <option value="General Ward">General Ward</option>
                  <option value="Semi-Private">Semi-Private</option>
                  <option value="Private">Private</option>
                  <option value="ICU">ICU</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Bed Count</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={newRoom.bed_count}
                    onChange={(e) => setNewRoom({ ...newRoom, bed_count: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Daily Rate (₹)</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={newRoom.daily_rate}
                    onChange={(e) => setNewRoom({ ...newRoom, daily_rate: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md font-mono"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddRoom(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-md cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-medium text-white bg-teal-700 rounded-md hover:bg-teal-800 cursor-pointer"
                >
                  {submitting ? 'Saving...' : 'Create Room'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
