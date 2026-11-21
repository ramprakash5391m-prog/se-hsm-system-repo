import React, { useEffect, useState } from 'react';
import { Download, ShieldAlert, Plus, Trash2 } from 'lucide-react';
import { apiFetch } from '../api';
import type { Department, ReportsData, User, UserRole } from '../types';

interface AdminReportsPanelProps {
  mode: 'admin' | 'reports';
  role: UserRole;
  departments: Department[];
  onDepartmentsUpdated: () => void;
}

export function AdminReportsPanel({
  mode,
  role,
  departments,
  onDepartmentsUpdated,
}: AdminReportsPanelProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [reports, setReports] = useState<ReportsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [deptName, setDeptName] = useState('');
  const [deptDesc, setDeptDesc] = useState('');
  const [newUser, setNewUser] = useState({
    name: '',
    email: '',
    password: 'User123!',
    role: 'doctor' as UserRole,
    department_id: departments[0] ? String(departments[0].department_id) : '',
    qualification: 'MBBS, MD',
    experience: '5',
    fee: '500',
  });

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      if (mode === 'admin') {
        const res = await apiFetch<{ users: User[] }>('/api/admin/users');
        setUsers(res.users);
      } else {
        const res = await apiFetch<ReportsData>('/api/reports');
        setReports(res);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Access denied.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [mode]);

  async function handleCreateDepartment(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/api/departments', {
        method: 'POST',
        body: JSON.stringify({ name: deptName, description: deptDesc }),
      });
      setDeptName('');
      setDeptDesc('');
      onDepartmentsUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create department.');
    }
  }

  async function handleDeleteDepartment(id: number) {
    setError(null);
    try {
      await apiFetch(`/api/departments/${id}`, { method: 'DELETE' });
      onDepartmentsUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete department.');
    }
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          ...newUser,
          department_id: newUser.department_id ? Number(newUser.department_id) : undefined,
          experience: Number(newUser.experience),
          fee: Number(newUser.fee),
        }),
      });
      setNewUser({
        ...newUser,
        name: '',
        email: '',
      });
      await loadData();
      onDepartmentsUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user.');
    }
  }

  async function handleRoleChange(userId: number, updatedRole: UserRole) {
    setError(null);
    try {
      await apiFetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: updatedRole }),
      });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role.');
    }
  }

  function exportReportCsv() {
    if (!reports) return;
    const rows = [
      ['Section', 'Metric', 'Value1', 'Value2', 'Value3'],
      ...reports.appointments_by_department.map((d) => [
        'Appointments by Department',
        d.department,
        `Total: ${d.total_appointments}`,
        `Confirmed: ${d.confirmed}`,
        `Completed: ${d.completed}`,
      ]),
      ...reports.room_occupancy.map((r) => [
        'Room Occupancy',
        r.room_type,
        `Total Beds: ${r.total_beds}`,
        `Occupied: ${r.occupied_beds}`,
        `Available: ${r.available_beds}`,
      ]),
      [
        'Billing Summary',
        'Revenue',
        `Gross: INR ${reports.billing_summary.gross_billed}`,
        `Collected: INR ${reports.billing_summary.collected_amount}`,
        `Pending: INR ${reports.billing_summary.pending_amount}`,
      ],
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `medcore-hospital-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // TC13 Access Denied Guard
  if (error && ((mode === 'admin' && role !== 'admin') || (mode === 'reports' && role !== 'admin' && role !== 'billing'))) {
    return (
      <div className="bg-white border border-red-200 rounded-lg p-8 max-w-xl">
        <div className="flex items-start gap-3">
          <ShieldAlert className="w-6 h-6 text-red-700 shrink-0" aria-hidden="true" />
          <div>
            <h1 className="font-display text-lg font-semibold text-red-800">Access Denied (403)</h1>
            <p className="text-sm text-red-700 mt-1">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-6 text-sm text-slate-500">
        Loading {mode === 'admin' ? 'administration console' : 'hospital reports'}...
      </div>
    );
  }

  if (mode === 'reports' && reports) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900">Hospital Reports</h1>
            <p className="text-sm text-slate-600 mt-1">
              Aggregated SQLite operational summary · Generated {reports.generated_at}
            </p>
          </div>
          <button
            type="button"
            onClick={exportReportCsv}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-teal-700 rounded-md hover:bg-teal-800 whitespace-nowrap cursor-pointer"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            <span>Export CSV</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="text-xs text-slate-500">Gross Billed Revenue</div>
            <div className="font-mono tabular-nums text-2xl font-semibold text-slate-900 mt-2">
              ₹{reports.billing_summary.gross_billed.toLocaleString('en-IN')}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {reports.billing_summary.bill_count} total invoices
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="text-xs text-slate-500">Collected Amount</div>
            <div className="font-mono tabular-nums text-2xl font-semibold text-emerald-700 mt-2">
              ₹{reports.billing_summary.collected_amount.toLocaleString('en-IN')}
            </div>
            <div className="text-xs text-slate-500 mt-1">Settled bills</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="text-xs text-slate-500">Pending Receivables</div>
            <div className="font-mono tabular-nums text-2xl font-semibold text-amber-700 mt-2">
              ₹{reports.billing_summary.pending_amount.toLocaleString('en-IN')}
            </div>
            <div className="text-xs text-slate-500 mt-1">Awaiting settlement</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="text-xs text-slate-500">Inpatient Admissions</div>
            <div className="font-mono tabular-nums text-2xl font-semibold text-slate-900 mt-2">
              {reports.admission_summary.currently_admitted} Active
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {reports.admission_summary.discharged} discharged · {reports.admission_summary.total_admissions} total
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="font-display text-sm font-semibold text-slate-900">
                Appointments by Department
              </h2>
            </div>
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-4">Department</th>
                  <th className="py-2.5 px-4 text-right">Total</th>
                  <th className="py-2.5 px-4 text-right">Confirmed</th>
                  <th className="py-2.5 px-4 text-right">Completed</th>
                  <th className="py-2.5 px-4 text-right">Cancelled</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reports.appointments_by_department.map((row) => (
                  <tr key={row.department}>
                    <td className="py-3 px-4 font-medium text-slate-900">{row.department}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{row.total_appointments}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-700">{row.confirmed}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">{row.completed}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-red-700">{row.cancelled}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="font-display text-sm font-semibold text-slate-900">
                Room &amp; Bed Occupancy Summary
              </h2>
            </div>
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-4">Ward Type</th>
                  <th className="py-2.5 px-4 text-right">Rooms</th>
                  <th className="py-2.5 px-4 text-right">Total Beds</th>
                  <th className="py-2.5 px-4 text-right">Occupied</th>
                  <th className="py-2.5 px-4 text-right">Available</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reports.room_occupancy.map((row) => (
                  <tr key={row.room_type}>
                    <td className="py-3 px-4 font-medium text-slate-900">{row.room_type}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{row.room_count}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{row.total_beds}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-amber-700">{row.occupied_beds}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-700">{row.available_beds}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-5">
        <h1 className="font-display text-2xl font-bold text-slate-900">
          Departments, Accounts &amp; Roles
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Administrator workspace for managing hospital departments, staff/doctor accounts, and role permissions.
        </p>
      </div>

      {error && (
        <div className="px-4 py-2.5 bg-red-50 border border-red-200 rounded-md text-xs text-red-700 font-medium">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Departments */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <h2 className="font-display text-sm font-semibold text-slate-900 border-b border-slate-200 pb-3">
            Hospital Departments
          </h2>
          <form onSubmit={handleCreateDepartment} className="space-y-2.5">
            <input
              type="text"
              required
              value={deptName}
              onChange={(e) => setDeptName(e.target.value)}
              placeholder="Department name (e.g. Dermatology)"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
            <input
              type="text"
              value={deptDesc}
              onChange={(e) => setDeptDesc(e.target.value)}
              placeholder="Short clinical description"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-teal-700 rounded-md hover:bg-teal-800 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Add Department</span>
            </button>
          </form>

          <div className="divide-y divide-slate-100">
            {departments.map((d) => (
              <div key={d.department_id} className="py-3 flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    {d.name}{' '}
                    <span className="font-mono text-xs text-slate-500">
                      ({d.doctor_count ?? 0} doctors)
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">{d.description}</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteDepartment(d.department_id)}
                  aria-label={`Delete ${d.name}`}
                  className="text-slate-400 hover:text-red-600 cursor-pointer shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Users & Roles */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 space-y-5">
          <h2 className="font-display text-sm font-semibold text-slate-900 border-b border-slate-200 pb-3">
            Create Staff / Doctor / Patient Account
          </h2>
          <form onSubmit={handleCreateUser} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              required
              value={newUser.name}
              onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
              placeholder="Full Name"
              className="px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
            <input
              type="email"
              required
              value={newUser.email}
              onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
              placeholder="Email Address"
              className="px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
            <input
              type="password"
              required
              value={newUser.password}
              onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
              placeholder="Initial Password"
              className="px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
            <select
              value={newUser.role}
              onChange={(e) => setNewUser({ ...newUser, role: e.target.value as UserRole })}
              className="px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
            >
              <option value="doctor">Doctor</option>
              <option value="reception">Reception Staff</option>
              <option value="billing">Billing Staff</option>
              <option value="admin">Administrator</option>
              <option value="patient">Patient</option>
            </select>

            {newUser.role === 'doctor' && (
              <>
                <select
                  value={newUser.department_id}
                  onChange={(e) => setNewUser({ ...newUser, department_id: e.target.value })}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
                >
                  {departments.map((d) => (
                    <option key={d.department_id} value={d.department_id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={newUser.qualification}
                  onChange={(e) => setNewUser({ ...newUser, qualification: e.target.value })}
                  placeholder="Qualification"
                  className="px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </>
            )}

            <button
              type="submit"
              className="sm:col-span-2 py-2 px-4 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 cursor-pointer"
            >
              Create Account
            </button>
          </form>

          <div className="border-t border-slate-200 pt-4 overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-2 px-3">User</th>
                  <th className="py-2 px-3">Email</th>
                  <th className="py-2 px-3">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u.user_id}>
                    <td className="py-2.5 px-3 font-medium text-slate-900">{u.name}</td>
                    <td className="py-2.5 px-3 text-xs text-slate-600">{u.email}</td>
                    <td className="py-2.5 px-3">
                      <select
                        aria-label={`Role for ${u.name}`}
                        value={u.role}
                        onChange={(e) => handleRoleChange(u.user_id, e.target.value as UserRole)}
                        className="px-2 py-1 text-xs border border-slate-300 rounded bg-white"
                      >
                        <option value="patient">patient</option>
                        <option value="doctor">doctor</option>
                        <option value="reception">reception</option>
                        <option value="billing">billing</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
