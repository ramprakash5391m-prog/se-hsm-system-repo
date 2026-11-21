export type UserRole = 'patient' | 'doctor' | 'reception' | 'billing' | 'admin';

export interface User {
  user_id: number;
  name: string;
  email: string;
  role: UserRole;
  created_at: string;
}

export interface Patient {
  patient_id: number;
  user_id: number;
  patient_code: string;
  name?: string;
  email?: string;
  date_of_birth: string;
  gender: string;
  address: string;
  phone: string;
  created_at?: string;
}

export interface Department {
  department_id: number;
  name: string;
  description: string;
  doctor_count?: number;
}

export interface DoctorSchedule {
  schedule_id: number;
  doctor_id: number;
  day_of_week: string;
  start_time: string;
  end_time: string;
}

export interface Doctor {
  doctor_id: number;
  user_id: number;
  department_id: number;
  department_name: string;
  name: string;
  email: string;
  qualification: string;
  experience: number;
  fee: number;
  status: 'Active' | 'On Leave' | 'Inactive';
  schedules: DoctorSchedule[];
}

export interface TimeSlot {
  time: string;
  available: boolean;
}

export interface Appointment {
  appointment_id: number;
  patient_id: number;
  doctor_id: number;
  patient_name: string;
  patient_code: string;
  doctor_name: string;
  qualification: string;
  department_name: string;
  consultation_fee: number;
  appointment_date: string;
  appointment_time: string;
  status: 'Confirmed' | 'Completed' | 'Cancelled';
  reason: string;
  diagnosis_notes: string;
  prescription_notes: string;
  created_at: string;
}

export interface Room {
  room_id: number;
  room_number: string;
  room_type: 'General Ward' | 'Semi-Private' | 'Private' | 'ICU';
  bed_count: number;
  available_beds: number;
  daily_rate: number;
}

export interface Admission {
  admission_id: number;
  patient_id: number;
  room_id: number;
  patient_code: string;
  patient_name: string;
  room_number: string;
  room_type: string;
  daily_rate: number;
  admission_date: string;
  discharge_date: string | null;
  status: 'Admitted' | 'Discharged';
  notes: string;
}

export interface Bill {
  bill_id: number;
  patient_id: number;
  admission_id: number | null;
  appointment_id: number | null;
  patient_code: string;
  patient_name: string;
  room_number: string | null;
  room_type: string | null;
  appointment_date: string | null;
  appointment_time: string | null;
  appointment_status: string | null;
  diagnosis_notes: string | null;
  doctor_name: string | null;
  consultation_fee: number;
  room_charge: number;
  medicine_charge: number;
  total: number;
  status: 'Pending' | 'Paid';
  patient_checking_completed: number | boolean;
  checked_at: string | null;
  created_at: string;
}

export interface CompletedCheckup {
  appointment_id: number;
  patient_id: number;
  doctor_id: number;
  patient_code: string;
  patient_name: string;
  doctor_name: string;
  department_name: string;
  appointment_date: string;
  appointment_time: string;
  status: string;
  reason: string;
  diagnosis_notes: string;
  prescription_notes: string;
  consultation_fee: number;
  bill_id: number | null;
  bill_status: 'Pending' | 'Paid' | null;
}

export interface DashboardMetric {
  label: string;
  value: string;
  detail: string;
}

export interface ReportsData {
  generated_at: string;
  appointments_by_department: Array<{
    department: string;
    total_appointments: number;
    confirmed: number;
    completed: number;
    cancelled: number;
  }>;
  room_occupancy: Array<{
    room_type: string;
    room_count: number;
    total_beds: number;
    available_beds: number;
    occupied_beds: number;
  }>;
  billing_summary: {
    bill_count: number;
    gross_billed: number;
    collected_amount: number;
    pending_amount: number;
    total_consultation: number;
    total_room_charges: number;
    total_medicine_charges: number;
  };
  admission_summary: {
    total_admissions: number;
    currently_admitted: number;
    discharged: number;
  };
}

export interface AuthSession {
  token: string;
  user: User;
  patient: Patient | null;
  doctor: Doctor | null;
}
