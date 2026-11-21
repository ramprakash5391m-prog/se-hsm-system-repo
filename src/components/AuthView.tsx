import React, { useState } from 'react';
import { ShieldCheck, Stethoscope, CalendarCheck, Receipt, Building2 } from 'lucide-react';
import { apiFetch } from '../api';
import type { AuthSession } from '../types';

interface AuthViewProps {
  onSuccess: (session: AuthSession) => void;
}

const DEMO_ACCOUNTS = [
  { role: 'Patient', name: 'Arjun Verma', email: 'arjun.verma@hms.local', pass: 'Patient123!' },
  { role: 'Doctor', name: 'Dr. Rahul Kumar', email: 'rahul.kumar@hms.local', pass: 'Doctor123!' },
  { role: 'Reception', name: 'Priya Nair', email: 'reception@hms.local', pass: 'Reception123!' },
  { role: 'Billing', name: 'Suresh Iyer', email: 'billing@hms.local', pass: 'Billing123!' },
  { role: 'Administrator', name: 'Dr. Kavita Menon', email: 'admin@hms.local', pass: 'Admin123!' },
];

export function AuthView({ onSuccess }: AuthViewProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('arjun.verma@hms.local');
  const [password, setPassword] = useState('Patient123!');
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState('Male');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'login') {
        const res = await apiFetch<AuthSession>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
        onSuccess(res);
      } else {
        const res = await apiFetch<AuthSession>('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            name,
            email,
            password,
            date_of_birth: dob,
            gender,
            phone,
            address,
          }),
        });
        onSuccess(res);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  }

  function applyDemoAccount(acc: (typeof DEMO_ACCOUNTS)[number]) {
    setMode('login');
    setEmail(acc.email);
    setPassword(acc.pass);
    setError(null);
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-8">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            MedCore HMS
          </span>
          <nav className="hidden md:flex items-center gap-6 text-sm text-slate-600">
            <span className="whitespace-nowrap shrink-0">Patient Portal</span>
            <span className="whitespace-nowrap shrink-0">Doctor Scheduling</span>
            <span className="whitespace-nowrap shrink-0">Admissions &amp; Wards</span>
            <span className="whitespace-nowrap shrink-0">Billing &amp; Reports</span>
          </nav>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setError(null);
              }}
              className="px-4 py-2 text-xs font-medium text-white bg-teal-700 rounded-md hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {mode === 'login' ? 'Register Patient' : 'Back to Sign In'}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
        <section className="lg:col-span-7 space-y-8 pt-2">
          <div className="space-y-3">
            <p className="text-xs font-medium text-teal-700 tracking-wide">
              Centralized Hospital Operations Platform · Python 3 &amp; SQLite
            </p>
            <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 text-balance">
              Clinical scheduling, inpatient admissions, and billing in one unified system.
            </h1>
            <p className="text-base text-slate-600 max-w-2xl leading-relaxed">
              Role-scoped access for patients, doctors, reception coordinators, billing officers, and hospital
              administrators with real-time slot conflict checks and bed inventory tracking.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-200 pt-6">
            <div className="flex items-start gap-3 p-4 bg-white border border-slate-200 rounded-lg">
              <CalendarCheck className="w-5 h-5 text-teal-700 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Conflict-Free Appointments</h2>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Real-time 30-minute slot validation against doctor schedules prevents double-booked consultations.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-4 bg-white border border-slate-200 rounded-lg">
              <Building2 className="w-5 h-5 text-teal-700 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Room &amp; Bed Allocation</h2>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Atomic bed availability checks block assignments to full wards and release beds upon discharge.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-4 bg-white border border-slate-200 rounded-lg">
              <Stethoscope className="w-5 h-5 text-teal-700 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Doctor Consultations</h2>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Clinicians manage availability windows, review patient visits, and record diagnosis notes.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-4 bg-white border border-slate-200 rounded-lg">
              <Receipt className="w-5 h-5 text-teal-700 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Itemized Billing &amp; Reports</h2>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Computes consultation, room, and medicine totals with printable invoices and CSV hospital reports.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-teal-700 shrink-0" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-slate-900">Quick Stakeholder Access</h2>
              </div>
              <span className="text-xs text-slate-500">Click any role to populate sign-in fields</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  onClick={() => applyDemoAccount(acc)}
                  className="text-left px-3 py-2.5 border border-slate-200 rounded-md hover:border-teal-600 hover:bg-teal-50/40 transition-colors cursor-pointer"
                >
                  <div className="text-xs font-semibold text-slate-900">{acc.role}</div>
                  <div className="text-xs text-slate-500 truncate mt-0.5">{acc.name}</div>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-6 sm:p-8 space-y-6">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`flex-1 py-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`flex-1 py-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                mode === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Patient Registration
            </button>
          </div>

          <div>
            <h2 className="font-display text-xl font-semibold text-slate-900">
              {mode === 'login' ? 'Sign in to MedCore HMS' : 'Create Patient Account'}
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              {mode === 'login'
                ? 'Enter your hospital credentials to access your role workspace.'
                : 'Register as a new patient to search doctors and book appointments.'}
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="px-3.5 py-2.5 bg-red-50 border border-red-200 rounded-md text-xs text-red-700 font-medium"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label htmlFor="reg-name" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Full Name
                </label>
                <input
                  id="reg-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Meenakshi Rao"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
                />
              </div>
            )}

            <div>
              <label htmlFor="auth-email" className="block text-xs font-medium text-slate-700 mb-1.5">
                Email Address
              </label>
              <input
                id="auth-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@hms.local"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
              />
            </div>

            <div>
              <label htmlFor="auth-password" className="block text-xs font-medium text-slate-700 mb-1.5">
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
              />
            </div>

            {mode === 'register' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="reg-dob" className="block text-xs font-medium text-slate-700 mb-1.5">
                      Date of Birth
                    </label>
                    <input
                      id="reg-dob"
                      type="date"
                      value={dob}
                      onChange={(e) => setDob(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                  <div>
                    <label htmlFor="reg-gender" className="block text-xs font-medium text-slate-700 mb-1.5">
                      Gender
                    </label>
                    <select
                      id="reg-gender"
                      value={gender}
                      onChange={(e) => setGender(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-600"
                    >
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label htmlFor="reg-phone" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Phone Number
                  </label>
                  <input
                    id="reg-phone"
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 98000 00000"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
                <div>
                  <label htmlFor="reg-address" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Residential Address
                  </label>
                  <input
                    id="reg-address"
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Street, City"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 text-sm font-medium text-white bg-teal-700 rounded-md hover:bg-teal-800 disabled:opacity-60 transition-colors cursor-pointer"
            >
              {loading ? 'Processing...' : mode === 'login' ? 'Sign In' : 'Register Patient Account'}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
