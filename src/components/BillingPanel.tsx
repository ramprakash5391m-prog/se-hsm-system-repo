import React, { useEffect, useState } from 'react';
import { Printer, Receipt, Stethoscope } from 'lucide-react';
import { apiFetch } from '../api';
import type { Admission, Bill, CompletedCheckup, Patient, UserRole } from '../types';
import { StatusText } from './StatusText';

interface BillingPanelProps {
  role: UserRole;
  bills: Bill[];
  patients: Patient[];
  admissions: Admission[];
  onRefresh: () => void;
}

export function BillingPanel({
  role,
  bills,
  patients,
  admissions,
  onRefresh,
}: BillingPanelProps) {
  const [viewTab, setViewTab] = useState<'invoices' | 'checkups'>('invoices');
  const [checkups, setCheckups] = useState<CompletedCheckup[]>([]);
  const [showGenerate, setShowGenerate] = useState(false);
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);

  const [patientId, setPatientId] = useState(patients[0] ? String(patients[0].patient_id) : '');
  const [admissionId, setAdmissionId] = useState('');
  const [appointmentId, setAppointmentId] = useState('');
  const [consultationFee, setConsultationFee] = useState('500');
  const [roomCharge, setRoomCharge] = useState('1500');
  const [medicineCharge, setMedicineCharge] = useState('750');
  const [checkingCompleted, setCheckingCompleted] = useState(true);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canGenerate = role === 'billing' || role === 'reception' || role === 'admin';
  const canToggleStatus = role === 'billing' || role === 'admin';

  async function loadCompletedCheckups() {
    if (!canGenerate) return;
    try {
      const res = await apiFetch<{ checkups: CompletedCheckup[] }>('/api/billing/completed-checkups');
      setCheckups(res.checkups);
    } catch {
      // handled gracefully
    }
  }

  useEffect(() => {
    loadCompletedCheckups();
  }, [bills, role]);

  const patientAdmissions = admissions.filter((a) => String(a.patient_id) === patientId);
  const unbilledCheckupsCount = checkups.filter((c) => !c.bill_id).length;
  const previewTotal =
    (Number(consultationFee) || 0) + (Number(roomCharge) || 0) + (Number(medicineCharge) || 0);

  function openGenerateForCheckup(checkup?: CompletedCheckup) {
    setError(null);
    if (checkup) {
      setPatientId(String(checkup.patient_id));
      setAppointmentId(String(checkup.appointment_id));
      const activeAdm = admissions.find(
        (a) => a.patient_id === checkup.patient_id && a.status === 'Admitted'
      );
      setAdmissionId(activeAdm ? String(activeAdm.admission_id) : '');
      setConsultationFee(String(checkup.consultation_fee));
      setRoomCharge(activeAdm ? String(activeAdm.daily_rate) : '0');
      setMedicineCharge('0');
      setCheckingCompleted(true);
    } else {
      if (!patientId && patients[0]) setPatientId(String(patients[0].patient_id));
      setAppointmentId('');
      setAdmissionId('');
      setConsultationFee('500');
      setRoomCharge('1500');
      setMedicineCharge('750');
      setCheckingCompleted(true);
    }
    setShowGenerate(true);
  }

  function handleSelectCheckupInModal(apptIdStr: string) {
    setAppointmentId(apptIdStr);
    if (!apptIdStr) return;
    const match = checkups.find((c) => String(c.appointment_id) === apptIdStr);
    if (match) {
      setPatientId(String(match.patient_id));
      setConsultationFee(String(match.consultation_fee));
      setCheckingCompleted(true);
    }
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/api/bills', {
        method: 'POST',
        body: JSON.stringify({
          patient_id: Number(patientId),
          admission_id: admissionId ? Number(admissionId) : null,
          appointment_id: appointmentId ? Number(appointmentId) : null,
          consultation_fee: Number(consultationFee) || 0,
          room_charge: Number(roomCharge) || 0,
          medicine_charge: Number(medicineCharge) || 0,
          patient_checking_completed: checkingCompleted,
        }),
      });
      setShowGenerate(false);
      onRefresh();
      await loadCompletedCheckups();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate bill.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateBill(
    billId: number,
    payload: { status?: 'Paid' | 'Pending'; patient_checking_completed?: boolean }
  ) {
    setError(null);
    try {
      await apiFetch(`/api/bills/${billId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update bill.');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-5 no-print">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Billing &amp; Invoices</h1>
          <p className="text-sm text-slate-600 mt-1">
            Bill completed patient checkups, track checking completion status, update payments, and print invoices.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0 flex-wrap">
          {canGenerate && (
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setViewTab('invoices')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  viewTab === 'invoices'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Invoices ({bills.length})
              </button>
              <button
                type="button"
                onClick={() => setViewTab('checkups')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  viewTab === 'checkups'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Completed Checkups ({unbilledCheckupsCount} unbilled)
              </button>
            </div>
          )}

          {canGenerate && (
            <button
              type="button"
              onClick={() => openGenerateForCheckup()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-teal-700 rounded-md hover:bg-teal-800 whitespace-nowrap cursor-pointer"
            >
              <Receipt className="w-4 h-4" aria-hidden="true" />
              <span>Generate Bill</span>
            </button>
          )}
        </div>
      </div>

      {error && !showGenerate && (
        <div className="px-4 py-2.5 bg-red-50 border border-red-200 rounded-md text-xs text-red-700 font-medium no-print">
          {error}
        </div>
      )}

      {/* Completed Patient Checkups Queue */}
      {viewTab === 'checkups' && canGenerate && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden no-print">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Stethoscope className="w-4 h-4 text-teal-700 shrink-0" aria-hidden="true" />
              <h2 className="font-display text-sm font-semibold text-slate-900">
                Patients with Completed Doctor Checkups
              </h2>
            </div>
            <span className="text-xs text-slate-500">
              Auto-populates consultation fee on bill generation
            </span>
          </div>
          {checkups.length === 0 ? (
            <div className="p-8 text-sm text-slate-500">
              No completed consultations ready for billing yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                    <th className="py-3 px-4">Patient</th>
                    <th className="py-3 px-4">Doctor &amp; Dept</th>
                    <th className="py-3 px-4">Checkup Date</th>
                    <th className="py-3 px-4">Clinical Summary</th>
                    <th className="py-3 px-4 text-right">Consult Fee</th>
                    <th className="py-3 px-4">Checkup State</th>
                    <th className="py-3 px-4 text-right">Billing Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {checkups.map((c) => (
                    <tr key={c.appointment_id} className="hover:bg-slate-50/80 align-top">
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">{c.patient_name}</div>
                        <div className="font-mono tabular-nums text-xs text-slate-500">
                          {c.patient_code}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-slate-900">{c.doctor_name}</div>
                        <div className="text-xs text-slate-500">{c.department_name}</div>
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-700 whitespace-nowrap">
                        {c.appointment_date} · {c.appointment_time}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 max-w-xs">
                        {c.diagnosis_notes || c.reason || 'Consultation completed'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-medium text-slate-900">
                        ₹{c.consultation_fee.toLocaleString('en-IN')}
                      </td>
                      <td className="py-3 px-4">
                        <StatusText status="Checking Completed" />
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {c.bill_id ? (
                          <span className="font-mono tabular-nums text-xs text-slate-600">
                            Billed #{c.bill_id} · {c.bill_status}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openGenerateForCheckup(c)}
                            className="px-3 py-1.5 text-xs font-medium text-white bg-teal-700 rounded hover:bg-teal-800 cursor-pointer"
                          >
                            Bill Checkup
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Invoices & Bills Table */}
      {viewTab === 'invoices' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden no-print">
          {bills.length === 0 ? (
            <div className="p-8 text-sm text-slate-500">No bills recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                    <th className="py-3 px-4">Bill ID</th>
                    <th className="py-3 px-4">Patient</th>
                    <th className="py-3 px-4">Patient Checking</th>
                    <th className="py-3 px-4 text-right">Consultation</th>
                    <th className="py-3 px-4 text-right">Room</th>
                    <th className="py-3 px-4 text-right">Medicine</th>
                    <th className="py-3 px-4 text-right">Total</th>
                    <th className="py-3 px-4">Payment</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {bills.map((b) => {
                    const isChecked = Boolean(b.patient_checking_completed);
                    return (
                      <tr key={b.bill_id} className="hover:bg-slate-50/80">
                        <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600">
                          #{b.bill_id}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-900">{b.patient_name}</div>
                          <div className="font-mono tabular-nums text-xs text-slate-500">
                            {b.patient_code}
                            {b.room_number ? ` · Room ${b.room_number}` : ''}
                            {b.doctor_name ? ` · ${b.doctor_name}` : ''}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <StatusText
                            status={isChecked ? 'Checking Completed' : 'In Checkup'}
                          />
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-700">
                          ₹{b.consultation_fee.toLocaleString('en-IN')}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-700">
                          ₹{b.room_charge.toLocaleString('en-IN')}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-700">
                          ₹{b.medicine_charge.toLocaleString('en-IN')}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                          ₹{b.total.toLocaleString('en-IN')}
                        </td>
                        <td className="py-3 px-4">
                          <StatusText status={b.status} />
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setSelectedBill(b)}
                              className="px-2.5 py-1 text-xs font-medium text-slate-700 border border-slate-300 rounded hover:bg-slate-50 cursor-pointer"
                            >
                              View Invoice
                            </button>
                            {canGenerate && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleUpdateBill(b.bill_id, {
                                    patient_checking_completed: !isChecked,
                                  })
                                }
                                className="px-2.5 py-1 text-xs font-medium text-slate-700 border border-slate-300 rounded hover:bg-slate-50 cursor-pointer"
                              >
                                {isChecked ? 'Reopen Checkup' : 'Mark Checking Completed'}
                              </button>
                            )}
                            {canToggleStatus && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleUpdateBill(b.bill_id, {
                                    status: b.status === 'Paid' ? 'Pending' : 'Paid',
                                  })
                                }
                                className="px-2.5 py-1 text-xs font-medium text-teal-700 border border-teal-200 rounded hover:bg-teal-50 cursor-pointer"
                              >
                                {b.status === 'Paid' ? 'Mark Pending' : 'Mark Paid'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Generate Bill Modal */}
      {showGenerate && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4 no-print">
          <div className="bg-white border border-slate-200 rounded-lg max-w-md w-full p-6 space-y-4">
            <h2 className="font-display text-lg font-semibold text-slate-900">Generate Patient Bill</h2>
            {error && (
              <div className="px-3 py-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                {error}
              </div>
            )}
            <form onSubmit={handleGenerate} className="space-y-3">
              {checkups.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Completed Patient Checkup (Optional)
                  </label>
                  <select
                    value={appointmentId}
                    onChange={(e) => handleSelectCheckupInModal(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
                  >
                    <option value="">Manual / Custom Bill</option>
                    {checkups.map((c) => (
                      <option key={c.appointment_id} value={c.appointment_id}>
                        {c.patient_name} ({c.patient_code}) · {c.doctor_name} · ₹{c.consultation_fee}
                        {c.bill_id ? ` [Billed #${c.bill_id}]` : ' [Ready]'}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Patient</label>
                <select
                  value={patientId}
                  onChange={(e) => {
                    setPatientId(e.target.value);
                    setAdmissionId('');
                  }}
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
                  Linked Admission (Optional)
                </label>
                <select
                  value={admissionId}
                  onChange={(e) => setAdmissionId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
                >
                  <option value="">Outpatient / No Admission</option>
                  {patientAdmissions.map((a) => (
                    <option key={a.admission_id} value={a.admission_id}>
                      Adm #{a.admission_id} · Room {a.room_number} ({a.status})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Consultation (₹)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    required
                    value={consultationFee}
                    onChange={(e) => setConsultationFee(e.target.value)}
                    className="w-full px-2.5 py-2 text-sm border border-slate-300 rounded-md font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Room Charge (₹)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    required
                    value={roomCharge}
                    onChange={(e) => setRoomCharge(e.target.value)}
                    className="w-full px-2.5 py-2 text-sm border border-slate-300 rounded-md font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Medicine (₹)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    required
                    value={medicineCharge}
                    onChange={(e) => setMedicineCharge(e.target.value)}
                    className="w-full px-2.5 py-2 text-sm border border-slate-300 rounded-md font-mono"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2.5 py-1.5 text-xs font-medium text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checkingCompleted}
                  onChange={(e) => setCheckingCompleted(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                />
                <span>Patient Checking Completed</span>
              </label>

              <div className="bg-slate-50 border border-slate-200 rounded-md px-4 py-3 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600">Calculated Total</span>
                <span className="font-mono tabular-nums text-lg font-bold text-slate-900">
                  ₹{previewTotal.toLocaleString('en-IN')}
                </span>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowGenerate(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-md cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-medium text-white bg-teal-700 rounded-md hover:bg-teal-800 cursor-pointer"
                >
                  {submitting ? 'Generating...' : 'Create Bill'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Printable Invoice Modal */}
      {selectedBill && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-lg w-full p-8 space-y-6">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4">
              <div>
                <div className="font-display text-lg font-bold text-slate-900">MedCore HMS</div>
                <div className="text-xs text-slate-500 mt-0.5">Hospital Tax &amp; Clinical Invoice</div>
              </div>
              <div className="text-right font-mono tabular-nums">
                <div className="text-sm font-semibold text-slate-900">Invoice #{selectedBill.bill_id}</div>
                <div className="text-xs text-slate-500">{selectedBill.created_at.slice(0, 10)}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <div className="text-slate-500">Billed Patient</div>
                <div className="font-semibold text-slate-900 mt-0.5">{selectedBill.patient_name}</div>
                <div className="font-mono text-slate-600">{selectedBill.patient_code}</div>
                {selectedBill.doctor_name && (
                  <div className="text-slate-500 mt-1">
                    Consulted: {selectedBill.doctor_name} ({selectedBill.appointment_date})
                  </div>
                )}
              </div>
              <div className="text-right space-y-2">
                <div>
                  <div className="text-slate-500">Payment Status</div>
                  <div className="mt-0.5 flex justify-end">
                    <StatusText status={selectedBill.status} />
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Patient Checking</div>
                  <div className="mt-0.5 flex justify-end">
                    <StatusText
                      status={
                        selectedBill.patient_checking_completed
                          ? 'Checking Completed'
                          : 'In Checkup'
                      }
                    />
                  </div>
                </div>
              </div>
            </div>

            <table className="w-full text-sm border-t border-b border-slate-200">
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="py-2.5 text-slate-700">Consultation Fee</td>
                  <td className="py-2.5 text-right font-mono tabular-nums text-slate-900">
                    ₹{selectedBill.consultation_fee.toLocaleString('en-IN')}
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 text-slate-700">
                    Room Charge {selectedBill.room_number ? `(Room ${selectedBill.room_number})` : ''}
                  </td>
                  <td className="py-2.5 text-right font-mono tabular-nums text-slate-900">
                    ₹{selectedBill.room_charge.toLocaleString('en-IN')}
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 text-slate-700">Medicine / Other Charges</td>
                  <td className="py-2.5 text-right font-mono tabular-nums text-slate-900">
                    ₹{selectedBill.medicine_charge.toLocaleString('en-IN')}
                  </td>
                </tr>
                <tr className="bg-slate-50 font-semibold">
                  <td className="py-3 text-slate-900">Total Bill</td>
                  <td className="py-3 text-right font-mono tabular-nums text-base text-slate-900">
                    ₹{selectedBill.total.toLocaleString('en-IN')}
                  </td>
                </tr>
              </tbody>
            </table>

            <div className="flex items-center justify-end gap-2 no-print">
              <button
                type="button"
                onClick={() => setSelectedBill(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-md cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-teal-700 rounded-md hover:bg-teal-800 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Print Invoice</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
