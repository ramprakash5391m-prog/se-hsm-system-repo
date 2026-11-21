import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Stethoscope,
  CalendarClock,
  Users,
  BedDouble,
  Receipt,
  Building2,
  BarChart3,
  LogOut,
} from 'lucide-react';
import { apiFetch, getStoredToken, setStoredToken } from './api';
import { AuthView } from './components/AuthView';
import { OverviewPanel } from './components/OverviewPanel';
import { DoctorsBookingPanel } from './components/DoctorsBookingPanel';
import { AppointmentsPanel } from './components/AppointmentsPanel';
import { PatientsPanel } from './components/PatientsPanel';
import { AdmissionsRoomsPanel } from './components/AdmissionsRoomsPanel';
import { BillingPanel } from './components/BillingPanel';
import { AdminReportsPanel } from './components/AdminReportsPanel';
import type {
  Admission,
  Appointment,
  AuthSession,
  Bill,
  DashboardMetric,
  Department,
  Doctor,
  Patient,
  Room,
  UserRole,
} from './types';

interface NavItem {
  id: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, roles: ['patient', 'doctor', 'reception', 'billing', 'admin'] },
  { id: 'doctors', label: 'Doctors & Slots', icon: Stethoscope, roles: ['patient', 'doctor', 'reception', 'admin'] },
  { id: 'appointments', label: 'Appointments', icon: CalendarClock, roles: ['patient', 'doctor', 'reception', 'admin'] },
  { id: 'patients', label: 'Patients', icon: Users, roles: ['patient', 'doctor', 'reception', 'admin'] },
  { id: 'admissions', label: 'Rooms & Admissions', icon: BedDouble, roles: ['patient', 'reception', 'admin'] },
  { id: 'billing', label: 'Billing & Invoices', icon: Receipt, roles: ['patient', 'reception', 'billing', 'admin'] },
  { id: 'admin', label: 'Users & Departments', icon: Building2, roles: ['admin'] },
  { id: 'reports', label: 'Hospital Reports', icon: BarChart3, roles: ['billing', 'admin'] },
];

const ROLE_LABELS: Record<UserRole, string> = {
  patient: 'Patient',
  doctor: 'Doctor',
  reception: 'Reception Staff',
  billing: 'Billing Staff',
  admin: 'Administrator',
};

export default function App() {
  const [session, setSession] = useState<Omit<AuthSession, 'token'> | null>(null);
  const [booting, setBooting] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  const [metrics, setMetrics] = useState<DashboardMetric[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);

  async function loadWorkspaceData() {
    try {
      const [dashRes, deptRes, apptRes, patRes, roomRes, admRes, billRes] = await Promise.all([
        apiFetch<{ metrics: DashboardMetric[] }>('/api/dashboard'),
        apiFetch<{ departments: Department[] }>('/api/departments'),
        apiFetch<{ appointments: Appointment[] }>('/api/appointments'),
        apiFetch<{ patients: Patient[] }>('/api/patients'),
        apiFetch<{ rooms: Room[] }>('/api/rooms'),
        apiFetch<{ admissions: Admission[] }>('/api/admissions'),
        apiFetch<{ bills: Bill[] }>('/api/bills'),
      ]);
      setMetrics(dashRes.metrics);
      setDepartments(deptRes.departments);
      setAppointments(apptRes.appointments);
      setPatients(patRes.patients);
      setRooms(roomRes.rooms);
      setAdmissions(admRes.admissions);
      setBills(billRes.bills);
    } catch {
      // handled per request
    }
  }

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setBooting(false);
      return;
    }
    apiFetch<{ user: AuthSession['user']; patient: Patient | null; doctor: Doctor | null }>(
      '/api/auth/me'
    )
      .then((res) => {
        setSession(res);
        return loadWorkspaceData();
      })
      .catch(() => {
        setStoredToken(null);
        setSession(null);
      })
      .finally(() => setBooting(false));
  }, []);

  function handleAuthSuccess(auth: AuthSession) {
    setStoredToken(auth.token);
    setSession({ user: auth.user, patient: auth.patient, doctor: auth.doctor });
    setActiveTab('overview');
    loadWorkspaceData();
  }

  function handleLogout() {
    setStoredToken(null);
    setSession(null);
    setActiveTab('overview');
  }

  if (booting) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-600">
        Initializing MedCore HMS...
      </div>
    );
  }

  if (!session) {
    return <AuthView onSuccess={handleAuthSuccess} />;
  }

  const role = session.user.role;
  const visibleNav = NAV_ITEMS.filter((item) => item.roles.includes(role));
  const currentNav = NAV_ITEMS.find((item) => item.id === activeTab) || visibleNav[0];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* 240px Sidebar Navigation */}
      <aside className="w-full lg:w-60 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col shrink-0 no-print">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between lg:block">
          <span className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
            MedCore HMS
          </span>
          <span className="text-xs text-slate-500 lg:hidden">{ROLE_LABELS[role]}</span>
        </div>

        <nav className="p-3 flex lg:flex-col gap-1 overflow-x-auto flex-1">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer text-left ${
                  active
                    ? 'bg-teal-50 text-teal-800 font-semibold'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 hidden lg:block space-y-3">
          <div>
            <div className="text-xs font-semibold text-slate-900 truncate">{session.user.name}</div>
            <div className="text-xs text-slate-500 mt-0.5">{ROLE_LABELS[role]}</div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Workspace */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between gap-8 no-print">
          <div className="text-xs text-slate-500 whitespace-nowrap truncate">
            <span>MedCore HMS</span>
            <span className="mx-2" aria-hidden="true">/</span>
            <span className="font-medium text-slate-900">{currentNav?.label}</span>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <span className="hidden sm:inline text-xs text-slate-500 whitespace-nowrap">
              {session.user.email} · {ROLE_LABELS[role]}
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="lg:hidden px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 max-w-7xl w-full mx-auto">
          {activeTab === 'overview' && (
            <OverviewPanel
              role={role}
              userName={session.user.name}
              metrics={metrics}
              appointments={appointments}
              admissions={admissions}
              bills={bills}
              onNavigate={setActiveTab}
            />
          )}

          {activeTab === 'doctors' && (
            <DoctorsBookingPanel
              role={role}
              currentDoctor={session.doctor}
              departments={departments}
              patients={patients}
              onAppointmentBooked={loadWorkspaceData}
              onDoctorsUpdated={loadWorkspaceData}
            />
          )}

          {activeTab === 'appointments' && (
            <AppointmentsPanel
              role={role}
              appointments={appointments}
              onRefresh={loadWorkspaceData}
            />
          )}

          {activeTab === 'patients' && (
            <PatientsPanel
              role={role}
              patients={patients}
              onRefresh={loadWorkspaceData}
            />
          )}

          {activeTab === 'admissions' && (
            <AdmissionsRoomsPanel
              role={role}
              rooms={rooms}
              admissions={admissions}
              patients={patients}
              onRefresh={loadWorkspaceData}
            />
          )}

          {activeTab === 'billing' && (
            <BillingPanel
              role={role}
              bills={bills}
              patients={patients}
              admissions={admissions}
              onRefresh={loadWorkspaceData}
            />
          )}

          {activeTab === 'admin' && (
            <AdminReportsPanel
              mode="admin"
              role={role}
              departments={departments}
              onDepartmentsUpdated={loadWorkspaceData}
            />
          )}

          {activeTab === 'reports' && (
            <AdminReportsPanel
              mode="reports"
              role={role}
              departments={departments}
              onDepartmentsUpdated={loadWorkspaceData}
            />
          )}
        </main>
      </div>
    </div>
  );
}
