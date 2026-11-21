import os
import sqlite3
from datetime import datetime, timedelta
from auth import hash_password

DB_PATH = os.environ.get("HMS_DB_PATH", os.path.join(os.path.dirname(__file__), "hms.db"))


def get_connection() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=15.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_db() -> None:
    conn = get_connection()
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('patient', 'doctor', 'reception', 'billing', 'admin')),
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS departments (
                department_id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                description TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS patients (
                patient_id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
                patient_code TEXT NOT NULL UNIQUE,
                date_of_birth TEXT NOT NULL DEFAULT '',
                gender TEXT NOT NULL DEFAULT '',
                address TEXT NOT NULL DEFAULT '',
                phone TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS doctors (
                doctor_id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
                department_id INTEGER NOT NULL REFERENCES departments(department_id) ON DELETE RESTRICT,
                qualification TEXT NOT NULL DEFAULT '',
                experience INTEGER NOT NULL DEFAULT 0,
                fee REAL NOT NULL DEFAULT 500.0,
                status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active', 'On Leave', 'Inactive'))
            );

            CREATE TABLE IF NOT EXISTS doctor_schedules (
                schedule_id INTEGER PRIMARY KEY AUTOINCREMENT,
                doctor_id INTEGER NOT NULL REFERENCES doctors(doctor_id) ON DELETE CASCADE,
                day_of_week TEXT NOT NULL CHECK(day_of_week IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS appointments (
                appointment_id INTEGER PRIMARY KEY AUTOINCREMENT,
                patient_id INTEGER NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
                doctor_id INTEGER NOT NULL REFERENCES doctors(doctor_id) ON DELETE CASCADE,
                appointment_date TEXT NOT NULL,
                appointment_time TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'Confirmed' CHECK(status IN ('Confirmed', 'Completed', 'Cancelled')),
                reason TEXT NOT NULL DEFAULT '',
                diagnosis_notes TEXT NOT NULL DEFAULT '',
                prescription_notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_active_appointment_slot
            ON appointments(doctor_id, appointment_date, appointment_time)
            WHERE status != 'Cancelled';

            CREATE TABLE IF NOT EXISTS rooms (
                room_id INTEGER PRIMARY KEY AUTOINCREMENT,
                room_number TEXT NOT NULL UNIQUE,
                room_type TEXT NOT NULL CHECK(room_type IN ('General Ward', 'Semi-Private', 'Private', 'ICU')),
                bed_count INTEGER NOT NULL CHECK(bed_count > 0),
                available_beds INTEGER NOT NULL CHECK(available_beds >= 0),
                daily_rate REAL NOT NULL DEFAULT 1000.0
            );

            CREATE TABLE IF NOT EXISTS admissions (
                admission_id INTEGER PRIMARY KEY AUTOINCREMENT,
                patient_id INTEGER NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
                room_id INTEGER NOT NULL REFERENCES rooms(room_id) ON DELETE RESTRICT,
                admission_date TEXT NOT NULL,
                discharge_date TEXT,
                status TEXT NOT NULL DEFAULT 'Admitted' CHECK(status IN ('Admitted', 'Discharged')),
                notes TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS bills (
                bill_id INTEGER PRIMARY KEY AUTOINCREMENT,
                patient_id INTEGER NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
                admission_id INTEGER REFERENCES admissions(admission_id) ON DELETE SET NULL,
                appointment_id INTEGER REFERENCES appointments(appointment_id) ON DELETE SET NULL,
                consultation_fee REAL NOT NULL DEFAULT 0.0,
                room_charge REAL NOT NULL DEFAULT 0.0,
                medicine_charge REAL NOT NULL DEFAULT 0.0,
                total REAL NOT NULL DEFAULT 0.0,
                status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending', 'Paid')),
                patient_checking_completed INTEGER NOT NULL DEFAULT 0,
                checked_at TEXT,
                created_at TEXT NOT NULL
            );
            """
        )

        # Safe migration for existing databases
        bill_cols = {row["name"] for row in conn.execute("PRAGMA table_info(bills)").fetchall()}
        if "appointment_id" not in bill_cols:
            conn.execute("ALTER TABLE bills ADD COLUMN appointment_id INTEGER REFERENCES appointments(appointment_id) ON DELETE SET NULL")
        if "patient_checking_completed" not in bill_cols:
            conn.execute("ALTER TABLE bills ADD COLUMN patient_checking_completed INTEGER NOT NULL DEFAULT 0")
        if "checked_at" not in bill_cols:
            conn.execute("ALTER TABLE bills ADD COLUMN checked_at TEXT")

        existing = conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]
        if existing == 0:
            _seed_data(conn)
        conn.commit()
    finally:
        conn.close()


def _seed_data(conn: sqlite3.Connection) -> None:
    now = datetime.utcnow().isoformat(timespec="seconds")
    today = datetime.now().date()
    tomorrow = (today + timedelta(days=1)).isoformat()
    today_str = today.isoformat()
    yesterday = (today - timedelta(days=1)).isoformat()

    # 1. Departments
    departments = [
        ("Cardiology", "Heart rhythm disorders, interventional cardiology, and preventive cardiac care."),
        ("Orthopedics", "Joint reconstruction, spine care, sports injury rehabilitation, and trauma."),
        ("Neurology", "Stroke unit, epilepsy clinic, neuromuscular diagnostics, and headache care."),
        ("Pediatrics", "Neonatal wellness, pediatric immunizations, and adolescent medicine."),
        ("General Medicine", "Primary adult diagnostics, chronic disease management, and preventive health."),
    ]
    conn.executemany("INSERT INTO departments (name, description) VALUES (?, ?)", departments)

    # 2. Users (covering all 5 primary roles from the report)
    users_seed = [
        ("Dr. Kavita Menon", "admin@hms.local", hash_password("Admin123!"), "admin", now),
        ("Priya Nair", "reception@hms.local", hash_password("Reception123!"), "reception", now),
        ("Suresh Iyer", "billing@hms.local", hash_password("Billing123!"), "billing", now),
        ("Dr. Rahul Kumar", "rahul.kumar@hms.local", hash_password("Doctor123!"), "doctor", now),
        ("Dr. Ananya Sharma", "ananya.sharma@hms.local", hash_password("Doctor123!"), "doctor", now),
        ("Dr. Vikram Desai", "vikram.desai@hms.local", hash_password("Doctor123!"), "doctor", now),
        ("Dr. Meera Patel", "meera.patel@hms.local", hash_password("Doctor123!"), "doctor", now),
        ("Arjun Verma", "arjun.verma@hms.local", hash_password("Patient123!"), "patient", now),
        ("Sneha Reddy", "sneha.reddy@hms.local", hash_password("Patient123!"), "patient", now),
        ("Rohan Kapoor", "rohan.kapoor@hms.local", hash_password("Patient123!"), "patient", now),
    ]
    conn.executemany(
        "INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
        users_seed,
    )

    def uid(email: str) -> int:
        return conn.execute("SELECT user_id FROM users WHERE email = ?", (email,)).fetchone()["user_id"]

    def did(name: str) -> int:
        return conn.execute("SELECT department_id FROM departments WHERE name = ?", (name,)).fetchone()["department_id"]

    # 3. Doctors
    doctors_seed = [
        (uid("rahul.kumar@hms.local"), did("Cardiology"), "MD, DM (Cardiology)", 12, 500.0, "Active"),
        (uid("ananya.sharma@hms.local"), did("Orthopedics"), "MS (Orthopedics)", 9, 600.0, "Active"),
        (uid("vikram.desai@hms.local"), did("Neurology"), "MD, DM (Neurology)", 14, 750.0, "Active"),
        (uid("meera.patel@hms.local"), did("Pediatrics"), "MD (Pediatrics)", 7, 450.0, "Active"),
    ]
    conn.executemany(
        "INSERT INTO doctors (user_id, department_id, qualification, experience, fee, status) VALUES (?, ?, ?, ?, ?, ?)",
        doctors_seed,
    )

    # 4. Doctor Schedules (All weekdays + Saturday so testing any date works cleanly)
    doc_ids = [row["doctor_id"] for row in conn.execute("SELECT doctor_id FROM doctors ORDER BY doctor_id").fetchall()]
    days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    schedules_seed = []
    for doc_id in doc_ids:
        for d in days:
            schedules_seed.append((doc_id, d, "09:00", "13:00"))
            if d != "Sunday":
                schedules_seed.append((doc_id, d, "14:30", "17:30"))
    conn.executemany(
        "INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)",
        schedules_seed,
    )

    # 5. Patients
    patients_seed = [
        (uid("arjun.verma@hms.local"), "P1001", "1994-05-18", "Male", "42 Indiranagar, Bengaluru", "+91 98450 11223"),
        (uid("sneha.reddy@hms.local"), "P1002", "1989-11-04", "Female", "18 Jubilee Hills, Hyderabad", "+91 98490 44556"),
        (uid("rohan.kapoor@hms.local"), "P1003", "1978-02-22", "Male", "7 Bandra West, Mumbai", "+91 98201 77889"),
    ]
    conn.executemany(
        "INSERT INTO patients (user_id, patient_code, date_of_birth, gender, address, phone) VALUES (?, ?, ?, ?, ?, ?)",
        patients_seed,
    )

    # 6. Rooms (Note Room 202 has 0 available beds so TC09 full-room rejection is immediately testable!)
    rooms_seed = [
        ("101", "General Ward", 4, 3, 800.0),
        ("102", "General Ward", 4, 4, 800.0),
        ("201", "Semi-Private", 2, 1, 1500.0),
        ("202", "Private", 1, 0, 2500.0),
        ("301", "Private", 1, 1, 2500.0),
        ("ICU-1", "ICU", 2, 1, 4500.0),
    ]
    conn.executemany(
        "INSERT INTO rooms (room_number, room_type, bed_count, available_beds, daily_rate) VALUES (?, ?, ?, ?, ?)",
        rooms_seed,
    )

    # 7. Appointments
    appointments_seed = [
        (1, 1, today_str, "10:30", "Confirmed", "Routine cardiac checkup and ECG review", "", "", now),
        (2, 2, tomorrow, "11:00", "Confirmed", "Right knee ligament pain follow-up", "", "", now),
        (3, 1, yesterday, "09:30", "Completed", "Mild hypertension evaluation", "Stage 1 Hypertension — stable on lifestyle review", "Amlodipine 5mg once daily after breakfast for 30 days", now),
        (1, 2, yesterday, "15:00", "Completed", "Shoulder mobility assessment", "Mild rotator cuff strain — physiotherapy advised", "Ibuprofen 400mg as needed after meals", now),
    ]
    conn.executemany(
        """
        INSERT INTO appointments
        (patient_id, doctor_id, appointment_date, appointment_time, status, reason, diagnosis_notes, prescription_notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        appointments_seed,
    )

    # 8. Admissions (matching the occupied beds above: Room 101 -> 1 used, Room 201 -> 1 used, Room 202 -> 1 used, ICU-1 -> 1 used)
    admissions_seed = [
        (1, 3, yesterday, None, "Admitted", "Post-cardiac observation in Semi-Private Room 201"),
        (2, 4, today_str, None, "Admitted", "Orthopedic recovery suite — Room 202 (fully occupied)"),
        (3, 1, yesterday, today_str, "Discharged", "Short observation stay completed cleanly"),
    ]
    conn.executemany(
        "INSERT INTO admissions (patient_id, room_id, admission_date, discharge_date, status, notes) VALUES (?, ?, ?, ?, ?, ?)",
        admissions_seed,
    )

    # 9. Bills (including the exact ₹500 + ₹1,500 + ₹750 = ₹2,750 illustrative calculation from Section 4.6)
    bills_seed = [
        (1, 1, None, 500.0, 1500.0, 750.0, 2750.0, "Pending", 0, None, now),
        (3, 3, 3, 500.0, 800.0, 420.0, 1720.0, "Paid", 1, now, now),
    ]
    conn.executemany(
        """
        INSERT INTO bills
        (patient_id, admission_id, appointment_id, consultation_fee, room_charge, medicine_charge, total, status, patient_checking_completed, checked_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        bills_seed,
    )
