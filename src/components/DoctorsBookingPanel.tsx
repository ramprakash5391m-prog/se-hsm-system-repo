import React, { useEffect, useState } from 'react';
import { Search, Calendar, Plus, Trash2 } from 'lucide-react';
import { apiFetch } from '../api';
import type { Department, Doctor, Patient, TimeSlot, UserRole } from '../types';
import { StatusText } from './StatusText';

interface DoctorsBookingPanelProps {
  role: UserRole;
  currentDoctor: Doctor | null;
  departments: Department[];
  patients: Patient[];
  onAppointmentBooked: () => void;
  onDoctorsUpdated: () => void;
}

export function DoctorsBookingPanel({
  role,
  currentDoctor,
  departments,
  patients,
  onAppointmentBooked,
  onDoctorsUpdated,
}: DoctorsBookingPanelProps) {
  const [selectedDeptId, setSelectedDeptId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);

  // Booking drawer / selected doctor state
  const [bookingDoctor, setBookingDoctor] = useState<Doctor | null>(null);
  const [bookingDate, setBookingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [slotsDay, setSlotsDay] = useState('');
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string>('');
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [reason, setReason] = useState('');
  const [bookMessage, setBookMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [bookingSubmitting, setBookingSubmitting] = useState(false);

  // Schedule editor for Doctors & Admins
  const [scheduleDocId, setScheduleDocId] = useState<number | null>(
    currentDoctor ? currentDoctor.doctor_id : null
  );
  const [schedDay, setSchedDay] = useState('Monday');
  const [schedStart, setSchedStart] = useState('09:00');
  const [schedEnd, setSchedEnd] = useState('13:00');
  const [schedError, setSchedError] = useState<string | null>(null);

  async function fetchDoctors() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedDeptId) params.set('department_id', selectedDeptId);
      if (search.trim()) params.set('search', search.trim());
      const res = await apiFetch<{ doctors: Doctor[] }>(`/api/doctors?${params.toString()}`);
      setDoctors(res.doctors);
      if (role === 'doctor' && currentDoctor) {
        setScheduleDocId(currentDoctor.doctor_id);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchDoctors();
  }, [selectedDeptId]);

  useEffect(() => {
    if (patients.length > 0 && !selectedPatientId) {
      setSelectedPatientId(String(patients[0].patient_id));
    }
  }, [patients]);

  async function loadSlots(doctorId: number, dateStr: string) {
    setSlotsLoading(true);
    setSelectedSlot('');
    setBookMessage(null);
    try {
      const res = await apiFetch<{ slots: TimeSlot[]; day_of_week: string }>(
        `/api/doctors/${doctorId}/slots?date=${encodeURIComponent(dateStr)}`
      );
      setSlots(res.slots);
      setSlotsDay(res.day_of_week);
    } catch (err) {
      setBookMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to load schedule slots.',
      });
    } finally {
      setSlotsLoading(false);
    }
  }

  function handleSelectDoctor(doc: Doctor) {
    setBookingDoctor(doc);
    setBookMessage(null);
    loadSlots(doc.doctor_id, bookingDate);
  }

  async function handleBook(e: React.FormEvent) {
    e.preventDefault();
    if (!bookingDoctor || !selectedSlot) return;
    setBookingSubmitting(true);
    setBookMessage(null);
    try {
      await apiFetch('/api/appointments', {
        method: 'POST',
        body: JSON.stringify({
          doctor_id: bookingDoctor.doctor_id,
          patient_id: role === 'patient' ? undefined : Number(selectedPatientId),
          appointment_date: bookingDate,
          appointment_time: selectedSlot,
          reason,
        }),
      });
      setBookMessage({
        type: 'success',
        text: `Appointment confirmed with ${bookingDoctor.name} on ${bookingDate} at ${selectedSlot}.`,
      });
      setReason('');
      await loadSlots(bookingDoctor.doctor_id, bookingDate);
      onAppointmentBooked();
    } catch (err) {
      setBookMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Booking failed.',
      });
    } finally {
      setBookingSubmitting(false);
    }
  }

  async function handleAddSchedule(e: React.FormEvent) {
    e.preventDefault();
    if (!scheduleDocId) return;
    setSchedError(null);
    try {
      await apiFetch(`/api/doctors/${scheduleDocId}/schedules`, {
        method: 'POST',
        body: JSON.stringify({
          day_of_week: schedDay,
          start_time: schedStart,
          end_time: schedEnd,
        }),
      });
      await fetchDoctors();
      onDoctorsUpdated();
    } catch (err) {
      setSchedError(err instanceof Error ? err.message : 'Failed to add schedule.');
    }
  }

  async function handleDeleteSchedule(scheduleId: number) {
    try {
      await apiFetch(`/api/schedules/${scheduleId}`, { method: 'DELETE' });
      await fetchDoctors();
      onDoctorsUpdated();
    } catch (err) {
      setSchedError(err instanceof Error ? err.message : 'Failed to remove schedule.');
    }
  }

  async function handleToggleDoctorStatus(doc: Doctor, status: Doctor['status']) {
    try {
      await apiFetch(`/api/doctors/${doc.doctor_id}`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      await fetchDoctors();
      onDoctorsUpdated();
    } catch {
      // handled silently
    }
  }

  const canBook = role === 'patient' || role === 'reception' || role === 'admin';
  const managedDoctor = doctors.find((d) => d.doctor_id === scheduleDocId) || null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Doctors &amp; Appointment Slots
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Search specialists by department, inspect live slot availability, or configure weekly schedules.
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          fetchDoctors();
        }}
        className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col md:flex-row items-stretch md:items-center gap-3"
      >
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by doctor name, specialization, or qualification..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
        </div>
        <select
          aria-label="Filter by department"
          value={selectedDeptId}
          onChange={(e) => setSelectedDeptId(e.target.value)}
          className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-600"
        >
          <option value="">All Departments</option>
          {departments.map((d) => (
            <option key={d.department_id} value={d.department_id}>
              {d.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap cursor-pointer"
        >
          Search Doctors
        </button>
      </form>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Doctor Directory */}
        <div className="lg:col-span-7 space-y-3">
          {loading ? (
            <div className="bg-white border border-slate-200 rounded-lg p-6 text-sm text-slate-500">
              Loading doctors...
            </div>
          ) : doctors.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-lg p-6 text-sm text-slate-500">
              No doctors match your department or search query.
            </div>
          ) : (
            doctors.map((doc) => {
              const isSelected = bookingDoctor?.doctor_id === doc.doctor_id;
              return (
                <div
                  key={doc.doctor_id}
                  className={`bg-white border rounded-lg p-5 transition-colors ${
                    isSelected ? 'border-teal-700 ring-1 ring-teal-700' : 'border-slate-200'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="font-display text-base font-semibold text-slate-900">
                          {doc.name}
                        </h3>
                        <StatusText status={doc.status} />
                      </div>
                      <div className="text-xs text-slate-600 mt-1">
                        {doc.department_name} · {doc.qualification} ·{' '}
                        <span className="font-mono tabular-nums">{doc.experience} yrs exp</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-2">
                        Consultation Fee:{' '}
                        <span className="font-mono tabular-nums font-semibold text-slate-900">
                          ₹{doc.fee.toLocaleString('en-IN')}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {canBook && (
                        <button
                          type="button"
                          onClick={() => handleSelectDoctor(doc)}
                          disabled={doc.status !== 'Active'}
                          className="px-3.5 py-2 text-xs font-medium text-white bg-teal-700 rounded-md hover:bg-teal-800 disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer"
                        >
                          {isSelected ? 'Viewing Slots' : 'View Available Slots'}
                        </button>
                      )}
                      {(role === 'admin' || (role === 'doctor' && currentDoctor?.doctor_id === doc.doctor_id)) && (
                        <button
                          type="button"
                          onClick={() => setScheduleDocId(doc.doctor_id)}
                          className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap cursor-pointer"
                        >
                          Manage Schedule
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right Column: Slot Booking OR Schedule Manager */}
        <div className="lg:col-span-5 space-y-6">
          {canBook && (
            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
                <Calendar className="w-4 h-4 text-teal-700 shrink-0" aria-hidden="true" />
                <h2 className="font-display text-sm font-semibold text-slate-900">
                  {bookingDoctor ? `Book with ${bookingDoctor.name}` : 'Select a Doctor to Book'}
                </h2>
              </div>

              {!bookingDoctor ? (
                <p className="text-xs text-slate-500 leading-relaxed">
                  Choose any active specialist on the left and click &ldquo;View Available Slots&rdquo; to inspect
                  open 30-minute consultation times and confirm an appointment.
                </p>
              ) : (
                <form onSubmit={handleBook} className="space-y-4">
                  {role !== 'patient' && (
                    <div>
                      <label htmlFor="book-patient" className="block text-xs font-medium text-slate-700 mb-1">
                        Select Patient
                      </label>
                      <select
                        id="book-patient"
                        value={selectedPatientId}
                        onChange={(e) => setSelectedPatientId(e.target.value)}
                        required
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-600"
                      >
                        {patients.map((p) => (
                          <option key={p.patient_id} value={p.patient_id}>
                            {p.name} ({p.patient_code})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <label htmlFor="book-date" className="block text-xs font-medium text-slate-700 mb-1">
                      Appointment Date
                    </label>
                    <input
                      id="book-date"
                      type="date"
                      required
                      value={bookingDate}
                      onChange={(e) => {
                        setBookingDate(e.target.value);
                        loadSlots(bookingDoctor.doctor_id, e.target.value);
                      }}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-600 font-mono tabular-nums"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium text-slate-700">
                        Available Slots {slotsDay ? `(${slotsDay})` : ''}
                      </span>
                      <span className="text-xs text-slate-500">Grayed slots are occupied</span>
                    </div>

                    {slotsLoading ? (
                      <div className="text-xs text-slate-500 py-3">Checking schedule...</div>
                    ) : slots.length === 0 ? (
                      <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                        No consultation schedule configured for {slotsDay}.
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        {slots.map((slot) => {
                          const active = selectedSlot === slot.time;
                          return (
                            <button
                              key={slot.time}
                              type="button"
                              disabled={!slot.available}
                              onClick={() => setSelectedSlot(slot.time)}
                              className={`py-2 px-2 text-xs font-mono tabular-nums rounded-md border transition-colors ${
                                !slot.available
                                  ? 'bg-slate-100 text-slate-400 border-slate-200 line-through cursor-not-allowed'
                                  : active
                                    ? 'bg-teal-700 text-white border-teal-700 cursor-pointer'
                                    : 'bg-white text-slate-800 border-slate-300 hover:border-teal-600 cursor-pointer'
                              }`}
                            >
                              {slot.time}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div>
                    <label htmlFor="book-reason" className="block text-xs font-medium text-slate-700 mb-1">
                      Visit Reason / Symptoms
                    </label>
                    <input
                      id="book-reason"
                      type="text"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Brief reason for visit"
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  {bookMessage && (
                    <div
                      role="status"
                      className={`px-3 py-2 rounded-md text-xs font-medium border ${
                        bookMessage.type === 'success'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : 'bg-red-50 text-red-700 border-red-200'
                      }`}
                    >
                      {bookMessage.text}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={!selectedSlot || bookingSubmitting}
                    className="w-full py-2.5 px-4 text-xs font-medium text-white bg-teal-700 rounded-md hover:bg-teal-800 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    {bookingSubmitting
                      ? 'Confirming...'
                      : selectedSlot
                        ? `Confirm Appointment (${selectedSlot})`
                        : 'Select an Available Slot'}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* Doctor / Admin Weekly Schedule Editor */}
          {(role === 'doctor' || role === 'admin') && managedDoctor && (
            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-3">
                <div>
                  <h2 className="font-display text-sm font-semibold text-slate-900">
                    Schedule: {managedDoctor.name}
                  </h2>
                  <p className="text-xs text-slate-500">{managedDoctor.department_name}</p>
                </div>
                <select
                  aria-label="Doctor availability status"
                  value={managedDoctor.status}
                  onChange={(e) =>
                    handleToggleDoctorStatus(managedDoctor, e.target.value as Doctor['status'])
                  }
                  className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                >
                  <option value="Active">Active</option>
                  <option value="On Leave">On Leave</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>

              {schedError && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                  {schedError}
                </div>
              )}

              <form onSubmit={handleAddSchedule} className="grid grid-cols-3 gap-2">
                <select
                  aria-label="Day of week"
                  value={schedDay}
                  onChange={(e) => setSchedDay(e.target.value)}
                  className="col-span-3 sm:col-span-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
                >
                  {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(
                    (d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    )
                  )}
                </select>
                <input
                  type="time"
                  aria-label="Start time"
                  value={schedStart}
                  onChange={(e) => setSchedStart(e.target.value)}
                  className="px-2 py-1.5 text-xs border border-slate-300 rounded-md font-mono"
                />
                <input
                  type="time"
                  aria-label="End time"
                  value={schedEnd}
                  onChange={(e) => setSchedEnd(e.target.value)}
                  className="px-2 py-1.5 text-xs border border-slate-300 rounded-md font-mono"
                />
                <button
                  type="submit"
                  className="col-span-3 inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Add Schedule Window</span>
                </button>
              </form>

              <div className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
                {managedDoctor.schedules.map((s) => (
                  <div key={s.schedule_id} className="py-2 flex items-center justify-between text-xs">
                    <span className="text-slate-800 font-medium">{s.day_of_week}</span>
                    <div className="flex items-center gap-3">
                      <span className="font-mono tabular-nums text-slate-600">
                        {s.start_time} – {s.end_time}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteSchedule(s.schedule_id)}
                        aria-label={`Remove ${s.day_of_week} schedule`}
                        className="text-slate-400 hover:text-red-600 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
