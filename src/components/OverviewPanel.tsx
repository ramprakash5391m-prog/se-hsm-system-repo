import type { Admission, Appointment, Bill, DashboardMetric, UserRole } from '../types';
import { StatusText } from './StatusText';

interface OverviewPanelProps {
  role: UserRole;
  userName: string;
  metrics: DashboardMetric[];
  appointments: Appointment[];
  admissions: Admission[];
  bills: Bill[];
  onNavigate: (tab: string) => void;
}

export function OverviewPanel({
  role,
  userName,
  metrics,
  appointments,
  admissions,
  bills,
  onNavigate,
}: OverviewPanelProps) {
  const recentAppointments = appointments.slice(0, 5);
  const activeAdmissions = admissions.filter((a) => a.status === 'Admitted').slice(0, 5);
  const recentBills = bills.slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Welcome back, {userName}
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Operational overview for your {role} workspace · Live records from SQLite database.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {(role === 'patient' || role === 'reception') && (
            <button
              type="button"
              onClick={() => onNavigate('doctors')}
              className="px-4 py-2 text-xs font-medium text-white bg-teal-700 rounded-md hover:bg-teal-800 transition-colors whitespace-nowrap cursor-pointer"
            >
              Book Appointment
            </button>
          )}
          {role === 'doctor' && (
            <button
              type="button"
              onClick={() => onNavigate('appointments')}
              className="px-4 py-2 text-xs font-medium text-white bg-teal-700 rounded-md hover:bg-teal-800 transition-colors whitespace-nowrap cursor-pointer"
            >
              Review Consultations
            </button>
          )}
          {role === 'billing' && (
            <button
              type="button"
              onClick={() => onNavigate('billing')}
              className="px-4 py-2 text-xs font-medium text-white bg-teal-700 rounded-md hover:bg-teal-800 transition-colors whitespace-nowrap cursor-pointer"
            >
              Generate Bill
            </button>
          )}
          {role === 'admin' && (
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="px-4 py-2 text-xs font-medium text-white bg-teal-700 rounded-md hover:bg-teal-800 transition-colors whitespace-nowrap cursor-pointer"
            >
              View Hospital Reports
            </button>
          )}
        </div>
      </div>

      {/* 4-Column Tabular KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((m) => (
          <div key={m.label} className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="text-xs font-medium text-slate-500">{m.label}</div>
            <div className="font-mono tabular-nums text-2xl font-semibold text-slate-900 mt-2">
              {m.value}
            </div>
            <div className="text-xs text-slate-500 mt-1">{m.detail}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Appointments Queue */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Recent Appointments
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('appointments')}
              className="text-xs font-medium text-teal-700 hover:underline whitespace-nowrap cursor-pointer"
            >
              View All
            </button>
          </div>
          {recentAppointments.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">No appointments recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                    <th className="py-2.5 px-4">Patient</th>
                    <th className="py-2.5 px-4">Doctor</th>
                    <th className="py-2.5 px-4">Date &amp; Time</th>
                    <th className="py-2.5 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {recentAppointments.map((a) => (
                    <tr key={a.appointment_id} className="hover:bg-slate-50/80">
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">{a.patient_name}</div>
                        <div className="font-mono tabular-nums text-xs text-slate-500">{a.patient_code}</div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-slate-900">{a.doctor_name}</div>
                        <div className="text-xs text-slate-500">{a.department_name}</div>
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-700 whitespace-nowrap">
                        {a.appointment_date} · {a.appointment_time}
                      </td>
                      <td className="py-3 px-4">
                        <StatusText status={a.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Side: Active Admissions or Recent Bills depending on role */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
            <h2 className="font-display text-sm font-semibold text-slate-900">
              {role === 'billing' ? 'Recent Invoices' : 'Active Inpatient Admissions'}
            </h2>
            <button
              type="button"
              onClick={() => onNavigate(role === 'billing' ? 'billing' : 'admissions')}
              className="text-xs font-medium text-teal-700 hover:underline whitespace-nowrap cursor-pointer"
            >
              Manage
            </button>
          </div>
          {role === 'billing' ? (
            recentBills.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">No invoices generated yet.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {recentBills.map((b) => (
                  <div key={b.bill_id} className="px-5 py-3.5 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-slate-900">
                        {b.patient_name} <span className="font-mono text-xs text-slate-500">({b.patient_code})</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        Bill #{b.bill_id} · {b.room_number ? `Room ${b.room_number}` : 'Outpatient'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono tabular-nums text-sm font-semibold text-slate-900">
                        ₹{b.total.toLocaleString('en-IN')}
                      </div>
                      <StatusText status={b.status} />
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : activeAdmissions.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">No active inpatient admissions.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {activeAdmissions.map((adm) => (
                <div key={adm.admission_id} className="px-5 py-3.5 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-slate-900">
                      {adm.patient_name} <span className="font-mono text-xs text-slate-500">({adm.patient_code})</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Room {adm.room_number} · {adm.room_type} · Admitted {adm.admission_date}
                    </div>
                  </div>
                  <StatusText status={adm.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
