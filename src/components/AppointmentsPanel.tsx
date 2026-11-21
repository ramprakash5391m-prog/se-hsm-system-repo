import React, { useState } from 'react';
import { apiFetch } from '../api';
import type { Appointment, UserRole } from '../types';
import { StatusText } from './StatusText';

interface AppointmentsPanelProps {
  role: UserRole;
  appointments: Appointment[];
  onRefresh: () => void;
}

export function AppointmentsPanel({ role, appointments, onRefresh }: AppointmentsPanelProps) {
  const [filter, setFilter] = useState<'ALL' | 'Confirmed' | 'Completed' | 'Cancelled'>('ALL');
  const [editingAppt, setEditingAppt] = useState<Appointment | null>(null);
  const [statusValue, setStatusValue] = useState<Appointment['status']>('Completed');
  const [diagnosis, setDiagnosis] = useState('');
  const [prescription, setPrescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const filtered =
    filter === 'ALL' ? appointments : appointments.filter((a) => a.status === filter);

  async function handleCancel(apptId: number) {
    setError(null);
    try {
      await apiFetch(`/api/appointments/${apptId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'Cancelled' }),
      });
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to cancel appointment.');
    }
  }

  function openConsultModal(appt: Appointment) {
    setEditingAppt(appt);
    setStatusValue(appt.status === 'Confirmed' ? 'Completed' : appt.status);
    setDiagnosis(appt.diagnosis_notes || '');
    setPrescription(appt.prescription_notes || '');
    setError(null);
  }

  async function handleSaveConsult(e: React.FormEvent) {
    e.preventDefault();
    if (!editingAppt) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/appointments/${editingAppt.appointment_id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: statusValue,
          diagnosis_notes: diagnosis,
          prescription_notes: prescription,
        }),
      });
      setEditingAppt(null);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update consultation.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Appointments</h1>
          <p className="text-sm text-slate-600 mt-1">
            View scheduled visits, cancel pending bookings, or record doctor consultation notes.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0">
          {(['ALL', 'Confirmed', 'Completed', 'Cancelled'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilter(tab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                filter === tab
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab === 'ALL' ? 'All' : tab}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="px-4 py-2.5 bg-red-50 border border-red-200 rounded-md text-xs text-red-700 font-medium">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-sm text-slate-500">
            No appointments match the selected filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-3 px-4">ID</th>
                  <th className="py-3 px-4">Patient</th>
                  <th className="py-3 px-4">Doctor &amp; Dept</th>
                  <th className="py-3 px-4">Date &amp; Slot</th>
                  <th className="py-3 px-4">Reason / Notes</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((a) => (
                  <tr key={a.appointment_id} className="hover:bg-slate-50/80 align-top">
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-500">
                      #{a.appointment_id}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{a.patient_name}</div>
                      <div className="font-mono tabular-nums text-xs text-slate-500">
                        {a.patient_code}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-slate-900">{a.doctor_name}</div>
                      <div className="text-xs text-slate-500">{a.department_name}</div>
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-700 whitespace-nowrap">
                      {a.appointment_date} · {a.appointment_time}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 max-w-xs">
                      <div>{a.reason || 'General consultation'}</div>
                      {a.diagnosis_notes && (
                        <div className="mt-1 text-slate-800">
                          <span className="font-semibold">Dx:</span> {a.diagnosis_notes}
                        </div>
                      )}
                      {a.prescription_notes && (
                        <div className="mt-0.5 text-slate-700">
                          <span className="font-semibold">Rx:</span> {a.prescription_notes}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <StatusText status={a.status} />
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        {(role === 'doctor' || role === 'admin') && (
                          <button
                            type="button"
                            onClick={() => openConsultModal(a)}
                            className="px-2.5 py-1 text-xs font-medium text-teal-700 border border-teal-200 rounded hover:bg-teal-50 cursor-pointer"
                          >
                            Update Consultation
                          </button>
                        )}
                        {a.status === 'Confirmed' && (role === 'patient' || role === 'reception' || role === 'admin') && (
                          <button
                            type="button"
                            onClick={() => handleCancel(a.appointment_id)}
                            className="px-2.5 py-1 text-xs font-medium text-red-700 border border-red-200 rounded hover:bg-red-50 cursor-pointer"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Doctor Consultation Update Modal */}
      {editingAppt && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-lg w-full p-6 space-y-4">
            <div className="border-b border-slate-200 pb-3">
              <h2 className="font-display text-lg font-semibold text-slate-900">
                Update Consultation · {editingAppt.patient_name} ({editingAppt.patient_code})
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {editingAppt.appointment_date} at {editingAppt.appointment_time} · {editingAppt.doctor_name}
              </p>
            </div>

            <form onSubmit={handleSaveConsult} className="space-y-4">
              <div>
                <label htmlFor="consult-status" className="block text-xs font-medium text-slate-700 mb-1">
                  Consultation Status
                </label>
                <select
                  id="consult-status"
                  value={statusValue}
                  onChange={(e) => setStatusValue(e.target.value as Appointment['status'])}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
                >
                  <option value="Confirmed">Confirmed</option>
                  <option value="Completed">Completed</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
              </div>
              <div>
                <label htmlFor="consult-dx" className="block text-xs font-medium text-slate-700 mb-1">
                  Diagnosis Notes
                </label>
                <textarea
                  id="consult-dx"
                  rows={2}
                  value={diagnosis}
                  onChange={(e) => setDiagnosis(e.target.value)}
                  placeholder="Clinical observations and diagnosis..."
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label htmlFor="consult-rx" className="block text-xs font-medium text-slate-700 mb-1">
                  Prescription Notes
                </label>
                <textarea
                  id="consult-rx"
                  rows={2}
                  value={prescription}
                  onChange={(e) => setPrescription(e.target.value)}
                  placeholder="Medication dosage and follow-up instructions..."
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingAppt(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-xs font-medium text-white bg-teal-700 rounded-md hover:bg-teal-800 disabled:opacity-60 cursor-pointer"
                >
                  {saving ? 'Saving...' : 'Save Consultation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
