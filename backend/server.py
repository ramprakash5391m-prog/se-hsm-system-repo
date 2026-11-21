import json
import os
import re
import sqlite3
from datetime import datetime, timedelta
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Optional
from urllib.parse import parse_qs, urlparse

from auth import create_token, hash_password, verify_password, verify_token
from db import get_connection, init_db


def _generate_slots(start_str: str, end_str: str, step_minutes: int = 30) -> list[str]:
    slots: list[str] = []
    start_dt = datetime.strptime(start_str, "%H:%M")
    end_dt = datetime.strptime(end_str, "%H:%M")
    cur = start_dt
    while cur < end_dt:
        slots.append(cur.strftime("%H:%M"))
        cur += timedelta(minutes=step_minutes)
    return slots


def _next_patient_code(conn: sqlite3.Connection) -> str:
    rows = conn.execute("SELECT patient_code FROM patients").fetchall()
    max_num = 1000
    for row in rows:
        match = re.search(r"(\d+)$", row["patient_code"] or "")
        if match:
            max_num = max(max_num, int(match.group(1)))
    return f"P{max_num + 1}"


class HMSRequestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: Any) -> None:
        pass

    def _send_json(self, status: int, data: Any) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        if not raw.strip():
            return {}
        return json.loads(raw)

    def _current_user(self) -> Optional[dict[str, Any]]:
        auth_header = self.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return None
        token = auth_header[7:].strip()
        payload = verify_token(token)
        if not payload:
            return None
        conn = get_connection()
        try:
            row = conn.execute(
                "SELECT user_id, name, email, role, created_at FROM users WHERE user_id = ?",
                (payload["user_id"],),
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def _require_auth(self, allowed_roles: Optional[list[str]] = None) -> Optional[dict[str, Any]]:
        user = self._current_user()
        if not user:
            self._send_json(HTTPStatus.UNAUTHORIZED, {"error": "Authentication required."})
            return None
        if allowed_roles and user["role"] not in allowed_roles:
            self._send_json(
                HTTPStatus.FORBIDDEN,
                {"error": f"Access denied. Required role: {', '.join(allowed_roles)}."},
            )
            return None
        return user

    def _get_patient_for_user(self, conn: sqlite3.Connection, user_id: int) -> Optional[dict[str, Any]]:
        row = conn.execute("SELECT * FROM patients WHERE user_id = ?", (user_id,)).fetchone()
        return dict(row) if row else None

    def _get_doctor_for_user(self, conn: sqlite3.Connection, user_id: int) -> Optional[dict[str, Any]]:
        row = conn.execute("SELECT * FROM doctors WHERE user_id = ?", (user_id,)).fetchone()
        return dict(row) if row else None

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        try:
            if path == "/api/health":
                self._send_json(HTTPStatus.OK, {"status": "ok", "engine": "python3-sqlite"})
                return

            if path == "/api/auth/me":
                user = self._require_auth()
                if not user:
                    return
                conn = get_connection()
                try:
                    patient = self._get_patient_for_user(conn, user["user_id"])
                    doctor = self._get_doctor_for_user(conn, user["user_id"])
                    self._send_json(HTTPStatus.OK, {"user": user, "patient": patient, "doctor": doctor})
                finally:
                    conn.close()
                return

            if path == "/api/dashboard":
                user = self._require_auth()
                if not user:
                    return
                self._handle_dashboard(user)
                return

            if path == "/api/departments":
                user = self._require_auth()
                if not user:
                    return
                conn = get_connection()
                try:
                    rows = conn.execute(
                        """
                        SELECT d.*, COUNT(doc.doctor_id) AS doctor_count
                        FROM departments d
                        LEFT JOIN doctors doc ON doc.department_id = d.department_id
                        GROUP BY d.department_id
                        ORDER BY d.name
                        """
                    ).fetchall()
                    self._send_json(HTTPStatus.OK, {"departments": [dict(r) for r in rows]})
                finally:
                    conn.close()
                return

            if path == "/api/doctors":
                user = self._require_auth()
                if not user:
                    return
                self._handle_list_doctors(query)
                return

            m_slots = re.fullmatch(r"/api/doctors/(\d+)/slots", path)
            if m_slots:
                user = self._require_auth()
                if not user:
                    return
                self._handle_doctor_slots(int(m_slots.group(1)), query, user)
                return

            if path == "/api/patients":
                user = self._require_auth(["patient", "doctor", "reception", "billing", "admin"])
                if not user:
                    return
                self._handle_list_patients(user, query)
                return

            if path == "/api/appointments":
                user = self._require_auth()
                if not user:
                    return
                self._handle_list_appointments(user, query)
                return

            if path == "/api/rooms":
                user = self._require_auth()
                if not user:
                    return
                conn = get_connection()
                try:
                    rows = conn.execute("SELECT * FROM rooms ORDER BY room_number").fetchall()
                    self._send_json(HTTPStatus.OK, {"rooms": [dict(r) for r in rows]})
                finally:
                    conn.close()
                return

            if path == "/api/admissions":
                user = self._require_auth()
                if not user:
                    return
                self._handle_list_admissions(user)
                return

            if path == "/api/bills":
                user = self._require_auth()
                if not user:
                    return
                self._handle_list_bills(user)
                return

            if path == "/api/billing/completed-checkups":
                user = self._require_auth(["billing", "reception", "admin"])
                if not user:
                    return
                self._handle_completed_checkups()
                return

            if path == "/api/admin/users":
                user = self._require_auth(["admin"])
                if not user:
                    return
                conn = get_connection()
                try:
                    rows = conn.execute(
                        "SELECT user_id, name, email, role, created_at FROM users ORDER BY user_id DESC"
                    ).fetchall()
                    self._send_json(HTTPStatus.OK, {"users": [dict(r) for r in rows]})
                finally:
                    conn.close()
                return

            if path == "/api/reports":
                user = self._require_auth(["admin", "billing"])
                if not user:
                    return
                self._handle_reports()
                return

            self._send_json(HTTPStatus.NOT_FOUND, {"error": "Endpoint not found."})
        except Exception as exc:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        try:
            data = self._read_json()

            if path == "/api/auth/login":
                self._handle_login(data)
                return

            if path == "/api/auth/register":
                self._handle_register(data)
                return

            if path == "/api/departments":
                user = self._require_auth(["admin"])
                if not user:
                    return
                name = (data.get("name") or "").strip()
                desc = (data.get("description") or "").strip()
                if not name:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Department name is required."})
                    return
                conn = get_connection()
                try:
                    cur = conn.execute(
                        "INSERT INTO departments (name, description) VALUES (?, ?)",
                        (name, desc),
                    )
                    conn.commit()
                    row = conn.execute(
                        "SELECT * FROM departments WHERE department_id = ?", (cur.lastrowid,)
                    ).fetchone()
                    self._send_json(HTTPStatus.CREATED, {"department": dict(row)})
                except sqlite3.IntegrityError:
                    self._send_json(HTTPStatus.CONFLICT, {"error": "Department already exists."})
                finally:
                    conn.close()
                return

            m_sched = re.fullmatch(r"/api/doctors/(\d+)/schedules", path)
            if m_sched:
                user = self._require_auth(["doctor", "admin"])
                if not user:
                    return
                self._handle_add_schedule(int(m_sched.group(1)), data, user)
                return

            if path == "/api/patients":
                user = self._require_auth(["reception", "admin"])
                if not user:
                    return
                self._handle_create_patient(data)
                return

            if path == "/api/appointments":
                user = self._require_auth(["patient", "reception", "admin"])
                if not user:
                    return
                self._handle_create_appointment(data, user)
                return

            if path == "/api/rooms":
                user = self._require_auth(["admin"])
                if not user:
                    return
                self._handle_create_room(data)
                return

            if path == "/api/admissions":
                user = self._require_auth(["reception", "admin"])
                if not user:
                    return
                self._handle_create_admission(data)
                return

            if path == "/api/bills":
                user = self._require_auth(["billing", "reception", "admin"])
                if not user:
                    return
                self._handle_create_bill(data)
                return

            if path == "/api/admin/users":
                user = self._require_auth(["admin"])
                if not user:
                    return
                self._handle_admin_create_user(data)
                return

            self._send_json(HTTPStatus.NOT_FOUND, {"error": "Endpoint not found."})
        except json.JSONDecodeError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON payload."})
        except Exception as exc:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})

    def do_PUT(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        try:
            data = self._read_json()

            m_dept = re.fullmatch(r"/api/departments/(\d+)", path)
            if m_dept:
                user = self._require_auth(["admin"])
                if not user:
                    return
                dept_id = int(m_dept.group(1))
                name = (data.get("name") or "").strip()
                desc = (data.get("description") or "").strip()
                if not name:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Department name is required."})
                    return
                conn = get_connection()
                try:
                    conn.execute(
                        "UPDATE departments SET name = ?, description = ? WHERE department_id = ?",
                        (name, desc, dept_id),
                    )
                    conn.commit()
                    row = conn.execute(
                        "SELECT * FROM departments WHERE department_id = ?", (dept_id,)
                    ).fetchone()
                    self._send_json(HTTPStatus.OK, {"department": dict(row)})
                finally:
                    conn.close()
                return

            m_pat = re.fullmatch(r"/api/patients/(\d+)", path)
            if m_pat:
                user = self._require_auth(["patient", "reception", "admin"])
                if not user:
                    return
                self._handle_update_patient(int(m_pat.group(1)), data, user)
                return

            m_doc = re.fullmatch(r"/api/doctors/(\d+)", path)
            if m_doc:
                user = self._require_auth(["doctor", "admin"])
                if not user:
                    return
                self._handle_update_doctor(int(m_doc.group(1)), data, user)
                return

            m_room = re.fullmatch(r"/api/rooms/(\d+)", path)
            if m_room:
                user = self._require_auth(["admin"])
                if not user:
                    return
                self._handle_update_room(int(m_room.group(1)), data)
                return

            self._send_json(HTTPStatus.NOT_FOUND, {"error": "Endpoint not found."})
        except json.JSONDecodeError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON payload."})
        except Exception as exc:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})

    def do_PATCH(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        try:
            data = self._read_json()

            m_appt = re.fullmatch(r"/api/appointments/(\d+)", path)
            if m_appt:
                user = self._require_auth(["patient", "doctor", "reception", "admin"])
                if not user:
                    return
                self._handle_update_appointment(int(m_appt.group(1)), data, user)
                return

            m_dis = re.fullmatch(r"/api/admissions/(\d+)/discharge", path)
            if m_dis:
                user = self._require_auth(["reception", "admin"])
                if not user:
                    return
                self._handle_discharge_admission(int(m_dis.group(1)))
                return

            m_bill = re.fullmatch(r"/api/bills/(\d+)", path)
            if m_bill:
                user = self._require_auth(["billing", "reception", "admin"])
                if not user:
                    return
                bill_id = int(m_bill.group(1))
                conn = get_connection()
                try:
                    existing = conn.execute("SELECT * FROM bills WHERE bill_id = ?", (bill_id,)).fetchone()
                    if not existing:
                        self._send_json(HTTPStatus.NOT_FOUND, {"error": "Bill not found."})
                        return

                    new_status = existing["status"]
                    if "status" in data and data.get("status") is not None:
                        if user["role"] not in ("billing", "admin"):
                            self._send_json(HTTPStatus.FORBIDDEN, {"error": "Only billing or admin staff can update payment status."})
                            return
                        candidate = str(data.get("status")).strip()
                        if candidate not in ("Pending", "Paid"):
                            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Status must be Pending or Paid."})
                            return
                        new_status = candidate

                    new_checking = existing["patient_checking_completed"]
                    new_checked_at = existing["checked_at"]
                    if "patient_checking_completed" in data and data.get("patient_checking_completed") is not None:
                        checking_bool = bool(data.get("patient_checking_completed"))
                        new_checking = 1 if checking_bool else 0
                        new_checked_at = datetime.utcnow().isoformat(timespec="seconds") if checking_bool else None

                    conn.execute(
                        "UPDATE bills SET status = ?, patient_checking_completed = ?, checked_at = ? WHERE bill_id = ?",
                        (new_status, new_checking, new_checked_at, bill_id),
                    )
                    conn.commit()
                    row = self._fetch_bill_by_id(conn, bill_id)
                    self._send_json(HTTPStatus.OK, {"bill": dict(row)})
                finally:
                    conn.close()
                return

            m_user = re.fullmatch(r"/api/admin/users/(\d+)", path)
            if m_user:
                user = self._require_auth(["admin"])
                if not user:
                    return
                role = (data.get("role") or "").strip()
                if role not in ("patient", "doctor", "reception", "billing", "admin"):
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid role."})
                    return
                conn = get_connection()
                try:
                    conn.execute(
                        "UPDATE users SET role = ? WHERE user_id = ?",
                        (role, int(m_user.group(1))),
                    )
                    conn.commit()
                    row = conn.execute(
                        "SELECT user_id, name, email, role, created_at FROM users WHERE user_id = ?",
                        (int(m_user.group(1)),),
                    ).fetchone()
                    self._send_json(HTTPStatus.OK, {"user": dict(row)})
                finally:
                    conn.close()
                return

            self._send_json(HTTPStatus.NOT_FOUND, {"error": "Endpoint not found."})
        except json.JSONDecodeError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON payload."})
        except Exception as exc:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        try:
            m_sched = re.fullmatch(r"/api/schedules/(\d+)", path)
            if m_sched:
                user = self._require_auth(["doctor", "admin"])
                if not user:
                    return
                sched_id = int(m_sched.group(1))
                conn = get_connection()
                try:
                    sched = conn.execute(
                        "SELECT * FROM doctor_schedules WHERE schedule_id = ?", (sched_id,)
                    ).fetchone()
                    if not sched:
                        self._send_json(HTTPStatus.NOT_FOUND, {"error": "Schedule entry not found."})
                        return
                    if user["role"] == "doctor":
                        doc = self._get_doctor_for_user(conn, user["user_id"])
                        if not doc or doc["doctor_id"] != sched["doctor_id"]:
                            self._send_json(HTTPStatus.FORBIDDEN, {"error": "Cannot modify another doctor's schedule."})
                            return
                    conn.execute("DELETE FROM doctor_schedules WHERE schedule_id = ?", (sched_id,))
                    conn.commit()
                    self._send_json(HTTPStatus.OK, {"deleted": sched_id})
                finally:
                    conn.close()
                return

            m_dept = re.fullmatch(r"/api/departments/(\d+)", path)
            if m_dept:
                user = self._require_auth(["admin"])
                if not user:
                    return
                dept_id = int(m_dept.group(1))
                conn = get_connection()
                try:
                    doc_count = conn.execute(
                        "SELECT COUNT(*) AS c FROM doctors WHERE department_id = ?", (dept_id,)
                    ).fetchone()["c"]
                    if doc_count > 0:
                        self._send_json(
                            HTTPStatus.CONFLICT,
                            {"error": "Cannot delete department with assigned doctors."},
                        )
                        return
                    conn.execute("DELETE FROM departments WHERE department_id = ?", (dept_id,))
                    conn.commit()
                    self._send_json(HTTPStatus.OK, {"deleted": dept_id})
                finally:
                    conn.close()
                return

            self._send_json(HTTPStatus.NOT_FOUND, {"error": "Endpoint not found."})
        except Exception as exc:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})

    # ---- Handlers ----

    def _handle_login(self, data: dict[str, Any]) -> None:
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""
        if not email or not password:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Email and password are required."})
            return

        conn = get_connection()
        try:
            row = conn.execute("SELECT * FROM users WHERE lower(email) = ?", (email,)).fetchone()
            if not row or not verify_password(password, row["password_hash"]):
                self._send_json(HTTPStatus.UNAUTHORIZED, {"error": "Invalid email or password."})
                return
            user = {
                "user_id": row["user_id"],
                "name": row["name"],
                "email": row["email"],
                "role": row["role"],
                "created_at": row["created_at"],
            }
            patient = self._get_patient_for_user(conn, user["user_id"])
            doctor = self._get_doctor_for_user(conn, user["user_id"])
            token = create_token(user)
            self._send_json(HTTPStatus.OK, {"token": token, "user": user, "patient": patient, "doctor": doctor})
        finally:
            conn.close()

    def _handle_register(self, data: dict[str, Any]) -> None:
        name = (data.get("name") or "").strip()
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""
        dob = (data.get("date_of_birth") or "").strip()
        gender = (data.get("gender") or "").strip()
        address = (data.get("address") or "").strip()
        phone = (data.get("phone") or "").strip()

        if not name or not email or len(password) < 6:
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"error": "Name, valid email, and password (at least 6 characters) are required."},
            )
            return

        conn = get_connection()
        try:
            now = datetime.utcnow().isoformat(timespec="seconds")
            pw_hash = hash_password(password)
            cur = conn.execute(
                "INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, 'patient', ?)",
                (name, email, pw_hash, now),
            )
            user_id = cur.lastrowid
            patient_code = _next_patient_code(conn)
            pcur = conn.execute(
                """
                INSERT INTO patients (user_id, patient_code, date_of_birth, gender, address, phone)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (user_id, patient_code, dob, gender, address, phone),
            )
            conn.commit()
            user = {
                "user_id": user_id,
                "name": name,
                "email": email,
                "role": "patient",
                "created_at": now,
            }
            patient = dict(
                conn.execute("SELECT * FROM patients WHERE patient_id = ?", (pcur.lastrowid,)).fetchone()
            )
            token = create_token(user)
            self._send_json(HTTPStatus.CREATED, {"token": token, "user": user, "patient": patient, "doctor": None})
        except sqlite3.IntegrityError:
            conn.rollback()
            self._send_json(HTTPStatus.CONFLICT, {"error": "An account with this email already exists."})
        finally:
            conn.close()

    def _handle_dashboard(self, user: dict[str, Any]) -> None:
        conn = get_connection()
        try:
            role = user["role"]
            if role == "patient":
                patient = self._get_patient_for_user(conn, user["user_id"])
                pid = patient["patient_id"] if patient else -1
                upcoming = conn.execute(
                    "SELECT COUNT(*) AS c FROM appointments WHERE patient_id = ? AND status = 'Confirmed'",
                    (pid,),
                ).fetchone()["c"]
                completed = conn.execute(
                    "SELECT COUNT(*) AS c FROM appointments WHERE patient_id = ? AND status = 'Completed'",
                    (pid,),
                ).fetchone()["c"]
                active_adm = conn.execute(
                    "SELECT COUNT(*) AS c FROM admissions WHERE patient_id = ? AND status = 'Admitted'",
                    (pid,),
                ).fetchone()["c"]
                pending_bill = conn.execute(
                    "SELECT COALESCE(SUM(total), 0) AS s FROM bills WHERE patient_id = ? AND status = 'Pending'",
                    (pid,),
                ).fetchone()["s"]
                self._send_json(
                    HTTPStatus.OK,
                    {
                        "metrics": [
                            {"label": "Confirmed Appointments", "value": str(upcoming), "detail": "Scheduled visits"},
                            {"label": "Completed Consultations", "value": str(completed), "detail": "Recorded notes"},
                            {"label": "Active Admissions", "value": str(active_adm), "detail": "Inpatient stay"},
                            {"label": "Pending Balance", "value": f"₹{pending_bill:,.0f}", "detail": "Outstanding bills"},
                        ]
                    },
                )
            elif role == "doctor":
                doctor = self._get_doctor_for_user(conn, user["user_id"])
                did = doctor["doctor_id"] if doctor else -1
                confirmed = conn.execute(
                    "SELECT COUNT(*) AS c FROM appointments WHERE doctor_id = ? AND status = 'Confirmed'",
                    (did,),
                ).fetchone()["c"]
                completed = conn.execute(
                    "SELECT COUNT(*) AS c FROM appointments WHERE doctor_id = ? AND status = 'Completed'",
                    (did,),
                ).fetchone()["c"]
                schedules = conn.execute(
                    "SELECT COUNT(*) AS c FROM doctor_schedules WHERE doctor_id = ?", (did,)
                ).fetchone()["c"]
                unique_patients = conn.execute(
                    "SELECT COUNT(DISTINCT patient_id) AS c FROM appointments WHERE doctor_id = ?", (did,)
                ).fetchone()["c"]
                self._send_json(
                    HTTPStatus.OK,
                    {
                        "metrics": [
                            {"label": "Upcoming Appointments", "value": str(confirmed), "detail": "Awaiting consultation"},
                            {"label": "Completed Consultations", "value": str(completed), "detail": "Updated records"},
                            {"label": "Patients Treated", "value": str(unique_patients), "detail": "Unique cases"},
                            {"label": "Schedule Windows", "value": str(schedules), "detail": "Active weekly blocks"},
                        ]
                    },
                )
            else:
                total_patients = conn.execute("SELECT COUNT(*) AS c FROM patients").fetchone()["c"]
                active_appts = conn.execute(
                    "SELECT COUNT(*) AS c FROM appointments WHERE status = 'Confirmed'"
                ).fetchone()["c"]
                avail_beds = conn.execute("SELECT COALESCE(SUM(available_beds), 0) AS s FROM rooms").fetchone()["s"]
                total_beds = conn.execute("SELECT COALESCE(SUM(bed_count), 0) AS s FROM rooms").fetchone()["s"]
                pending_revenue = conn.execute(
                    "SELECT COALESCE(SUM(total), 0) AS s FROM bills WHERE status = 'Pending'"
                ).fetchone()["s"]
                collected_revenue = conn.execute(
                    "SELECT COALESCE(SUM(total), 0) AS s FROM bills WHERE status = 'Paid'"
                ).fetchone()["s"]
                if role == "billing":
                    self._send_json(
                        HTTPStatus.OK,
                        {
                            "metrics": [
                                {"label": "Collected Revenue", "value": f"₹{collected_revenue:,.0f}", "detail": "Settled invoices"},
                                {"label": "Pending Receivables", "value": f"₹{pending_revenue:,.0f}", "detail": "Awaiting payment"},
                                {"label": "Registered Patients", "value": str(total_patients), "detail": "Active profiles"},
                                {"label": "Active Admissions", "value": str(total_beds - avail_beds), "detail": "Occupied inpatient beds"},
                            ]
                        },
                    )
                else:
                    self._send_json(
                        HTTPStatus.OK,
                        {
                            "metrics": [
                                {"label": "Registered Patients", "value": str(total_patients), "detail": "Total patient records"},
                                {"label": "Confirmed Appointments", "value": str(active_appts), "detail": "Scheduled consultations"},
                                {"label": "Available Beds", "value": f"{avail_beds} / {total_beds}", "detail": "Across all wards"},
                                {"label": "Pending Billing", "value": f"₹{pending_revenue:,.0f}", "detail": "Open invoices"},
                            ]
                        },
                    )
        finally:
            conn.close()

    def _handle_list_doctors(self, query: dict[str, list[str]]) -> None:
        dept_id = (query.get("department_id") or [""])[0].strip()
        search = (query.get("search") or [""])[0].strip().lower()
        status = (query.get("status") or [""])[0].strip()

        conn = get_connection()
        try:
            sql = """
                SELECT doc.*, u.name, u.email, dep.name AS department_name
                FROM doctors doc
                JOIN users u ON u.user_id = doc.user_id
                JOIN departments dep ON dep.department_id = doc.department_id
                WHERE 1=1
            """
            params: list[Any] = []
            if dept_id:
                sql += " AND doc.department_id = ?"
                params.append(int(dept_id))
            if status:
                sql += " AND doc.status = ?"
                params.append(status)
            if search:
                sql += " AND (lower(u.name) LIKE ? OR lower(dep.name) LIKE ? OR lower(doc.qualification) LIKE ?)"
                like = f"%{search}%"
                params.extend([like, like, like])
            sql += " ORDER BY u.name"
            doctors = [dict(r) for r in conn.execute(sql, params).fetchall()]
            for doc in doctors:
                scheds = conn.execute(
                    "SELECT * FROM doctor_schedules WHERE doctor_id = ? ORDER BY schedule_id",
                    (doc["doctor_id"],),
                ).fetchall()
                doc["schedules"] = [dict(s) for s in scheds]
            self._send_json(HTTPStatus.OK, {"doctors": doctors})
        finally:
            conn.close()

    def _handle_doctor_slots(self, doctor_id: int, query: dict[str, list[str]], user: dict[str, Any]) -> None:
        date_str = (query.get("date") or [""])[0].strip()
        if not date_str:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Query parameter 'date' (YYYY-MM-DD) is required."})
            return
        try:
            dt = datetime.strptime(date_str, "%Y-%m-%d")
        except ValueError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid date format. Use YYYY-MM-DD."})
            return

        day_name = dt.strftime("%A")
        conn = get_connection()
        try:
            doc = conn.execute("SELECT * FROM doctors WHERE doctor_id = ?", (doctor_id,)).fetchone()
            if not doc:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "Doctor not found."})
                return
            if doc["status"] != "Active":
                self._send_json(HTTPStatus.OK, {"date": date_str, "day_of_week": day_name, "slots": [], "doctor_status": doc["status"]})
                return

            scheds = conn.execute(
                "SELECT * FROM doctor_schedules WHERE doctor_id = ? AND day_of_week = ? ORDER BY start_time",
                (doctor_id, day_name),
            ).fetchall()

            booked_rows = conn.execute(
                """
                SELECT appointment_time, patient_id
                FROM appointments
                WHERE doctor_id = ? AND appointment_date = ? AND status != 'Cancelled'
                """,
                (doctor_id, date_str),
            ).fetchall()
            booked_times = {r["appointment_time"] for r in booked_rows}

            slots = []
            seen = set()
            for s in scheds:
                for t in _generate_slots(s["start_time"], s["end_time"]):
                    if t not in seen:
                        seen.add(t)
                        slots.append({"time": t, "available": t not in booked_times})

            self._send_json(
                HTTPStatus.OK,
                {"date": date_str, "day_of_week": day_name, "doctor_status": doc["status"], "slots": slots},
            )
        finally:
            conn.close()

    def _handle_add_schedule(self, doctor_id: int, data: dict[str, Any], user: dict[str, Any]) -> None:
        day_of_week = (data.get("day_of_week") or "").strip()
        start_time = (data.get("start_time") or "").strip()
        end_time = (data.get("end_time") or "").strip()
        valid_days = {"Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"}
        if day_of_week not in valid_days or not start_time or not end_time or start_time >= end_time:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Valid day_of_week, start_time, and end_time (start < end) are required."})
            return

        conn = get_connection()
        try:
            if user["role"] == "doctor":
                doc = self._get_doctor_for_user(conn, user["user_id"])
                if not doc or doc["doctor_id"] != doctor_id:
                    self._send_json(HTTPStatus.FORBIDDEN, {"error": "Cannot edit another doctor's schedule."})
                    return
            cur = conn.execute(
                "INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)",
                (doctor_id, day_of_week, start_time, end_time),
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM doctor_schedules WHERE schedule_id = ?", (cur.lastrowid,)
            ).fetchone()
            self._send_json(HTTPStatus.CREATED, {"schedule": dict(row)})
        finally:
            conn.close()

    def _handle_update_doctor(self, doctor_id: int, data: dict[str, Any], user: dict[str, Any]) -> None:
        conn = get_connection()
        try:
            doc = conn.execute("SELECT * FROM doctors WHERE doctor_id = ?", (doctor_id,)).fetchone()
            if not doc:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "Doctor not found."})
                return
            if user["role"] == "doctor":
                self_doc = self._get_doctor_for_user(conn, user["user_id"])
                if not self_doc or self_doc["doctor_id"] != doctor_id:
                    self._send_json(HTTPStatus.FORBIDDEN, {"error": "Cannot modify another doctor's profile."})
                    return

            qualification = (data.get("qualification") if data.get("qualification") is not None else doc["qualification"]).strip()
            experience = int(data.get("experience") if data.get("experience") is not None else doc["experience"])
            fee = float(data.get("fee") if data.get("fee") is not None else doc["fee"])
            status = (data.get("status") or doc["status"]).strip()
            department_id = int(data.get("department_id") if data.get("department_id") is not None else doc["department_id"])

            if status not in ("Active", "On Leave", "Inactive"):
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid doctor status."})
                return

            conn.execute(
                """
                UPDATE doctors
                SET department_id = ?, qualification = ?, experience = ?, fee = ?, status = ?
                WHERE doctor_id = ?
                """,
                (department_id, qualification, experience, fee, status, doctor_id),
            )
            conn.commit()
            updated = conn.execute(
                """
                SELECT doc.*, u.name, u.email, dep.name AS department_name
                FROM doctors doc
                JOIN users u ON u.user_id = doc.user_id
                JOIN departments dep ON dep.department_id = doc.department_id
                WHERE doc.doctor_id = ?
                """,
                (doctor_id,),
            ).fetchone()
            self._send_json(HTTPStatus.OK, {"doctor": dict(updated)})
        finally:
            conn.close()

    def _handle_list_patients(self, user: dict[str, Any], query: dict[str, list[str]]) -> None:
        search = (query.get("search") or [""])[0].strip().lower()
        conn = get_connection()
        try:
            sql = """
                SELECT p.*, u.name, u.email, u.created_at
                FROM patients p
                JOIN users u ON u.user_id = p.user_id
                WHERE 1=1
            """
            params: list[Any] = []
            if user["role"] == "patient":
                sql += " AND p.user_id = ?"
                params.append(user["user_id"])
            elif user["role"] == "doctor":
                doc = self._get_doctor_for_user(conn, user["user_id"])
                did = doc["doctor_id"] if doc else -1
                sql += " AND p.patient_id IN (SELECT DISTINCT patient_id FROM appointments WHERE doctor_id = ?)"
                params.append(did)

            if search:
                sql += " AND (lower(u.name) LIKE ? OR lower(p.patient_code) LIKE ? OR lower(u.email) LIKE ?)"
                like = f"%{search}%"
                params.extend([like, like, like])
            sql += " ORDER BY p.patient_id DESC"
            rows = conn.execute(sql, params).fetchall()
            self._send_json(HTTPStatus.OK, {"patients": [dict(r) for r in rows]})
        finally:
            conn.close()

    def _handle_create_patient(self, data: dict[str, Any]) -> None:
        name = (data.get("name") or "").strip()
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or "Patient123!"
        dob = (data.get("date_of_birth") or "").strip()
        gender = (data.get("gender") or "").strip()
        address = (data.get("address") or "").strip()
        phone = (data.get("phone") or "").strip()

        if not name or not email:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Patient name and email are required."})
            return

        conn = get_connection()
        try:
            now = datetime.utcnow().isoformat(timespec="seconds")
            cur = conn.execute(
                "INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, 'patient', ?)",
                (name, email, hash_password(password), now),
            )
            uid = cur.lastrowid
            code = _next_patient_code(conn)
            pcur = conn.execute(
                "INSERT INTO patients (user_id, patient_code, date_of_birth, gender, address, phone) VALUES (?, ?, ?, ?, ?, ?)",
                (uid, code, dob, gender, address, phone),
            )
            conn.commit()
            row = conn.execute(
                """
                SELECT p.*, u.name, u.email, u.created_at
                FROM patients p JOIN users u ON u.user_id = p.user_id
                WHERE p.patient_id = ?
                """,
                (pcur.lastrowid,),
            ).fetchone()
            self._send_json(HTTPStatus.CREATED, {"patient": dict(row)})
        except sqlite3.IntegrityError:
            conn.rollback()
            self._send_json(HTTPStatus.CONFLICT, {"error": "Email already registered."})
        finally:
            conn.close()

    def _handle_update_patient(self, patient_id: int, data: dict[str, Any], user: dict[str, Any]) -> None:
        conn = get_connection()
        try:
            pat = conn.execute("SELECT * FROM patients WHERE patient_id = ?", (patient_id,)).fetchone()
            if not pat:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "Patient not found."})
                return
            if user["role"] == "patient" and pat["user_id"] != user["user_id"]:
                self._send_json(HTTPStatus.FORBIDDEN, {"error": "Cannot modify another patient's profile."})
                return

            dob = (data.get("date_of_birth") if data.get("date_of_birth") is not None else pat["date_of_birth"]).strip()
            gender = (data.get("gender") if data.get("gender") is not None else pat["gender"]).strip()
            address = (data.get("address") if data.get("address") is not None else pat["address"]).strip()
            phone = (data.get("phone") if data.get("phone") is not None else pat["phone"]).strip()
            name = (data.get("name") or "").strip()

            conn.execute(
                "UPDATE patients SET date_of_birth = ?, gender = ?, address = ?, phone = ? WHERE patient_id = ?",
                (dob, gender, address, phone, patient_id),
            )
            if name:
                conn.execute("UPDATE users SET name = ? WHERE user_id = ?", (name, pat["user_id"]))
            conn.commit()
            updated = conn.execute(
                "SELECT p.*, u.name, u.email FROM patients p JOIN users u ON u.user_id = p.user_id WHERE p.patient_id = ?",
                (patient_id,),
            ).fetchone()
            self._send_json(HTTPStatus.OK, {"patient": dict(updated)})
        finally:
            conn.close()

    def _handle_list_appointments(self, user: dict[str, Any], query: dict[str, list[str]]) -> None:
        status_filter = (query.get("status") or [""])[0].strip()
        conn = get_connection()
        try:
            sql = """
                SELECT a.*,
                       pu.name AS patient_name, p.patient_code,
                       du.name AS doctor_name, doc.qualification, doc.fee AS consultation_fee,
                       dep.name AS department_name
                FROM appointments a
                JOIN patients p ON p.patient_id = a.patient_id
                JOIN users pu ON pu.user_id = p.user_id
                JOIN doctors doc ON doc.doctor_id = a.doctor_id
                JOIN users du ON du.user_id = doc.user_id
                JOIN departments dep ON dep.department_id = doc.department_id
                WHERE 1=1
            """
            params: list[Any] = []
            if user["role"] == "patient":
                pat = self._get_patient_for_user(conn, user["user_id"])
                sql += " AND a.patient_id = ?"
                params.append(pat["patient_id"] if pat else -1)
            elif user["role"] == "doctor":
                doc = self._get_doctor_for_user(conn, user["user_id"])
                sql += " AND a.doctor_id = ?"
                params.append(doc["doctor_id"] if doc else -1)

            if status_filter:
                sql += " AND a.status = ?"
                params.append(status_filter)

            sql += " ORDER BY a.appointment_date DESC, a.appointment_time DESC"
            rows = conn.execute(sql, params).fetchall()
            self._send_json(HTTPStatus.OK, {"appointments": [dict(r) for r in rows]})
        finally:
            conn.close()

    def _handle_create_appointment(self, data: dict[str, Any], user: dict[str, Any]) -> None:
        doctor_id = data.get("doctor_id")
        appointment_date = (data.get("appointment_date") or "").strip()
        appointment_time = (data.get("appointment_time") or "").strip()
        reason = (data.get("reason") or "").strip()

        if not doctor_id or not appointment_date or not appointment_time:
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"error": "Doctor, appointment date, and appointment time are required."},
            )
            return

        try:
            dt = datetime.strptime(appointment_date, "%Y-%m-%d")
        except ValueError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid appointment date format (YYYY-MM-DD)."})
            return

        conn = get_connection()
        try:
            conn.execute("BEGIN IMMEDIATE")
            if user["role"] == "patient":
                pat = self._get_patient_for_user(conn, user["user_id"])
                if not pat:
                    conn.rollback()
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Patient profile not found."})
                    return
                patient_id = pat["patient_id"]
            else:
                patient_id = data.get("patient_id")
                if not patient_id:
                    conn.rollback()
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "patient_id is required."})
                    return

            doc = conn.execute("SELECT * FROM doctors WHERE doctor_id = ?", (int(doctor_id),)).fetchone()
            if not doc or doc["status"] != "Active":
                conn.rollback()
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Selected doctor is not currently available."})
                return

            # Validate doctor schedule covers requested time
            day_name = dt.strftime("%A")
            scheds = conn.execute(
                "SELECT * FROM doctor_schedules WHERE doctor_id = ? AND day_of_week = ?",
                (int(doctor_id), day_name),
            ).fetchall()
            valid_slots = set()
            for s in scheds:
                valid_slots.update(_generate_slots(s["start_time"], s["end_time"]))
            if appointment_time not in valid_slots:
                conn.rollback()
                self._send_json(
                    HTTPStatus.BAD_REQUEST,
                    {"error": f"Selected slot {appointment_time} is outside the doctor's {day_name} schedule."},
                )
                return

            # Check conflict (TC07)
            conflict = conn.execute(
                """
                SELECT appointment_id FROM appointments
                WHERE doctor_id = ? AND appointment_date = ? AND appointment_time = ? AND status != 'Cancelled'
                """,
                (int(doctor_id), appointment_date, appointment_time),
            ).fetchone()
            if conflict:
                conn.rollback()
                self._send_json(
                    HTTPStatus.CONFLICT,
                    {"error": f"Slot {appointment_time} on {appointment_date} is already occupied. Please select another available slot."},
                )
                return

            now = datetime.utcnow().isoformat(timespec="seconds")
            cur = conn.execute(
                """
                INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status, reason, created_at)
                VALUES (?, ?, ?, ?, 'Confirmed', ?, ?)
                """,
                (int(patient_id), int(doctor_id), appointment_date, appointment_time, reason, now),
            )
            conn.commit()
            row = conn.execute(
                """
                SELECT a.*,
                       pu.name AS patient_name, p.patient_code,
                       du.name AS doctor_name, doc.qualification, doc.fee AS consultation_fee,
                       dep.name AS department_name
                FROM appointments a
                JOIN patients p ON p.patient_id = a.patient_id
                JOIN users pu ON pu.user_id = p.user_id
                JOIN doctors doc ON doc.doctor_id = a.doctor_id
                JOIN users du ON du.user_id = doc.user_id
                JOIN departments dep ON dep.department_id = doc.department_id
                WHERE a.appointment_id = ?
                """,
                (cur.lastrowid,),
            ).fetchone()
            self._send_json(HTTPStatus.CREATED, {"appointment": dict(row)})
        except sqlite3.IntegrityError:
            conn.rollback()
            self._send_json(
                HTTPStatus.CONFLICT,
                {"error": "Selected appointment slot is already occupied."},
            )
        finally:
            conn.close()

    def _handle_update_appointment(self, appointment_id: int, data: dict[str, Any], user: dict[str, Any]) -> None:
        conn = get_connection()
        try:
            appt = conn.execute("SELECT * FROM appointments WHERE appointment_id = ?", (appointment_id,)).fetchone()
            if not appt:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "Appointment not found."})
                return

            new_status = (data.get("status") or appt["status"]).strip()
            if new_status not in ("Confirmed", "Completed", "Cancelled"):
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid appointment status."})
                return

            if user["role"] == "patient":
                pat = self._get_patient_for_user(conn, user["user_id"])
                if not pat or pat["patient_id"] != appt["patient_id"]:
                    self._send_json(HTTPStatus.FORBIDDEN, {"error": "Cannot modify another patient's appointment."})
                    return
                if new_status != "Cancelled":
                    self._send_json(HTTPStatus.FORBIDDEN, {"error": "Patients may only cancel appointments."})
                    return
                conn.execute("UPDATE appointments SET status = 'Cancelled' WHERE appointment_id = ?", (appointment_id,))
            elif user["role"] == "doctor":
                doc = self._get_doctor_for_user(conn, user["user_id"])
                if not doc or doc["doctor_id"] != appt["doctor_id"]:
                    self._send_json(HTTPStatus.FORBIDDEN, {"error": "Cannot update another doctor's consultation."})
                    return
                diag = (data.get("diagnosis_notes") if data.get("diagnosis_notes") is not None else appt["diagnosis_notes"]).strip()
                rx = (data.get("prescription_notes") if data.get("prescription_notes") is not None else appt["prescription_notes"]).strip()
                conn.execute(
                    "UPDATE appointments SET status = ?, diagnosis_notes = ?, prescription_notes = ? WHERE appointment_id = ?",
                    (new_status, diag, rx, appointment_id),
                )
            else:
                diag = (data.get("diagnosis_notes") if data.get("diagnosis_notes") is not None else appt["diagnosis_notes"]).strip()
                rx = (data.get("prescription_notes") if data.get("prescription_notes") is not None else appt["prescription_notes"]).strip()
                conn.execute(
                    "UPDATE appointments SET status = ?, diagnosis_notes = ?, prescription_notes = ? WHERE appointment_id = ?",
                    (new_status, diag, rx, appointment_id),
                )

            conn.commit()
            row = conn.execute(
                """
                SELECT a.*,
                       pu.name AS patient_name, p.patient_code,
                       du.name AS doctor_name, doc.qualification, doc.fee AS consultation_fee,
                       dep.name AS department_name
                FROM appointments a
                JOIN patients p ON p.patient_id = a.patient_id
                JOIN users pu ON pu.user_id = p.user_id
                JOIN doctors doc ON doc.doctor_id = a.doctor_id
                JOIN users du ON du.user_id = doc.user_id
                JOIN departments dep ON dep.department_id = doc.department_id
                WHERE a.appointment_id = ?
                """,
                (appointment_id,),
            ).fetchone()
            self._send_json(HTTPStatus.OK, {"appointment": dict(row)})
        finally:
            conn.close()

    def _handle_create_room(self, data: dict[str, Any]) -> None:
        room_number = (data.get("room_number") or "").strip()
        room_type = (data.get("room_type") or "").strip()
        bed_count = int(data.get("bed_count") or 0)
        daily_rate = float(data.get("daily_rate") or 1000.0)
        if not room_number or room_type not in ("General Ward", "Semi-Private", "Private", "ICU") or bed_count <= 0:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Valid room_number, room_type, and bed_count > 0 are required."})
            return
        conn = get_connection()
        try:
            cur = conn.execute(
                "INSERT INTO rooms (room_number, room_type, bed_count, available_beds, daily_rate) VALUES (?, ?, ?, ?, ?)",
                (room_number, room_type, bed_count, bed_count, daily_rate),
            )
            conn.commit()
            row = conn.execute("SELECT * FROM rooms WHERE room_id = ?", (cur.lastrowid,)).fetchone()
            self._send_json(HTTPStatus.CREATED, {"room": dict(row)})
        except sqlite3.IntegrityError:
            self._send_json(HTTPStatus.CONFLICT, {"error": "Room number already exists."})
        finally:
            conn.close()

    def _handle_update_room(self, room_id: int, data: dict[str, Any]) -> None:
        conn = get_connection()
        try:
            room = conn.execute("SELECT * FROM rooms WHERE room_id = ?", (room_id,)).fetchone()
            if not room:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "Room not found."})
                return
            room_type = (data.get("room_type") or room["room_type"]).strip()
            daily_rate = float(data.get("daily_rate") if data.get("daily_rate") is not None else room["daily_rate"])
            bed_count = int(data.get("bed_count") if data.get("bed_count") is not None else room["bed_count"])
            occupied = room["bed_count"] - room["available_beds"]
            if bed_count < occupied:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": f"Cannot reduce bed count below currently occupied beds ({occupied})."})
                return
            available_beds = bed_count - occupied
            conn.execute(
                "UPDATE rooms SET room_type = ?, bed_count = ?, available_beds = ?, daily_rate = ? WHERE room_id = ?",
                (room_type, bed_count, available_beds, daily_rate, room_id),
            )
            conn.commit()
            row = conn.execute("SELECT * FROM rooms WHERE room_id = ?", (room_id,)).fetchone()
            self._send_json(HTTPStatus.OK, {"room": dict(row)})
        finally:
            conn.close()

    def _handle_list_admissions(self, user: dict[str, Any]) -> None:
        conn = get_connection()
        try:
            sql = """
                SELECT adm.*, p.patient_code, u.name AS patient_name,
                       r.room_number, r.room_type, r.daily_rate
                FROM admissions adm
                JOIN patients p ON p.patient_id = adm.patient_id
                JOIN users u ON u.user_id = p.user_id
                JOIN rooms r ON r.room_id = adm.room_id
                WHERE 1=1
            """
            params: list[Any] = []
            if user["role"] == "patient":
                pat = self._get_patient_for_user(conn, user["user_id"])
                sql += " AND adm.patient_id = ?"
                params.append(pat["patient_id"] if pat else -1)
            sql += " ORDER BY adm.admission_id DESC"
            rows = conn.execute(sql, params).fetchall()
            self._send_json(HTTPStatus.OK, {"admissions": [dict(r) for r in rows]})
        finally:
            conn.close()

    def _handle_create_admission(self, data: dict[str, Any]) -> None:
        patient_id = data.get("patient_id")
        room_id = data.get("room_id")
        admission_date = (data.get("admission_date") or datetime.now().date().isoformat()).strip()
        notes = (data.get("notes") or "").strip()

        if not patient_id or not room_id:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Patient and room are required."})
            return

        conn = get_connection()
        try:
            conn.execute("BEGIN IMMEDIATE")
            room = conn.execute("SELECT * FROM rooms WHERE room_id = ?", (int(room_id),)).fetchone()
            if not room:
                conn.rollback()
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "Selected room not found."})
                return
            # TC09: Reject assignment if room is fully occupied
            if room["available_beds"] <= 0:
                conn.rollback()
                self._send_json(
                    HTTPStatus.CONFLICT,
                    {"error": f"Room {room['room_number']} ({room['room_type']}) is fully occupied. Assignment rejected."},
                )
                return

            cur = conn.execute(
                "INSERT INTO admissions (patient_id, room_id, admission_date, status, notes) VALUES (?, ?, ?, 'Admitted', ?)",
                (int(patient_id), int(room_id), admission_date, notes),
            )
            conn.execute(
                "UPDATE rooms SET available_beds = available_beds - 1 WHERE room_id = ?",
                (int(room_id),),
            )
            conn.commit()
            row = conn.execute(
                """
                SELECT adm.*, p.patient_code, u.name AS patient_name,
                       r.room_number, r.room_type, r.daily_rate
                FROM admissions adm
                JOIN patients p ON p.patient_id = adm.patient_id
                JOIN users u ON u.user_id = p.user_id
                JOIN rooms r ON r.room_id = adm.room_id
                WHERE adm.admission_id = ?
                """,
                (cur.lastrowid,),
            ).fetchone()
            self._send_json(HTTPStatus.CREATED, {"admission": dict(row)})
        finally:
            conn.close()

    def _handle_discharge_admission(self, admission_id: int) -> None:
        conn = get_connection()
        try:
            conn.execute("BEGIN IMMEDIATE")
            adm = conn.execute("SELECT * FROM admissions WHERE admission_id = ?", (admission_id,)).fetchone()
            if not adm:
                conn.rollback()
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "Admission record not found."})
                return
            if adm["status"] == "Discharged":
                conn.rollback()
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Patient is already discharged."})
                return

            discharge_date = datetime.now().date().isoformat()
            conn.execute(
                "UPDATE admissions SET status = 'Discharged', discharge_date = ? WHERE admission_id = ?",
                (discharge_date, admission_id),
            )
            conn.execute(
                "UPDATE rooms SET available_beds = MIN(bed_count, available_beds + 1) WHERE room_id = ?",
                (adm["room_id"],),
            )
            conn.commit()
            row = conn.execute(
                """
                SELECT adm.*, p.patient_code, u.name AS patient_name,
                       r.room_number, r.room_type, r.daily_rate
                FROM admissions adm
                JOIN patients p ON p.patient_id = adm.patient_id
                JOIN users u ON u.user_id = p.user_id
                JOIN rooms r ON r.room_id = adm.room_id
                WHERE adm.admission_id = ?
                """,
                (admission_id,),
            ).fetchone()
            self._send_json(HTTPStatus.OK, {"admission": dict(row)})
        finally:
            conn.close()

    def _fetch_bill_by_id(self, conn: sqlite3.Connection, bill_id: int) -> Optional[sqlite3.Row]:
        return conn.execute(
            """
            SELECT b.*, p.patient_code, u.name AS patient_name,
                   r.room_number, r.room_type,
                   a.appointment_date, a.appointment_time, a.status AS appointment_status,
                   a.diagnosis_notes, du.name AS doctor_name
            FROM bills b
            JOIN patients p ON p.patient_id = b.patient_id
            JOIN users u ON u.user_id = p.user_id
            LEFT JOIN admissions adm ON adm.admission_id = b.admission_id
            LEFT JOIN rooms r ON r.room_id = adm.room_id
            LEFT JOIN appointments a ON a.appointment_id = b.appointment_id
            LEFT JOIN doctors doc ON doc.doctor_id = a.doctor_id
            LEFT JOIN users du ON du.user_id = doc.user_id
            WHERE b.bill_id = ?
            """,
            (bill_id,),
        ).fetchone()

    def _handle_completed_checkups(self) -> None:
        conn = get_connection()
        try:
            rows = conn.execute(
                """
                SELECT a.appointment_id, a.patient_id, a.doctor_id, a.appointment_date,
                       a.appointment_time, a.status, a.reason, a.diagnosis_notes, a.prescription_notes,
                       p.patient_code, pu.name AS patient_name,
                       du.name AS doctor_name, dep.name AS department_name,
                       doc.fee AS consultation_fee,
                       (SELECT b.bill_id FROM bills b WHERE b.appointment_id = a.appointment_id ORDER BY b.bill_id DESC LIMIT 1) AS bill_id,
                       (SELECT b.status FROM bills b WHERE b.appointment_id = a.appointment_id ORDER BY b.bill_id DESC LIMIT 1) AS bill_status
                FROM appointments a
                JOIN patients p ON p.patient_id = a.patient_id
                JOIN users pu ON pu.user_id = p.user_id
                JOIN doctors doc ON doc.doctor_id = a.doctor_id
                JOIN users du ON du.user_id = doc.user_id
                JOIN departments dep ON dep.department_id = doc.department_id
                WHERE a.status = 'Completed'
                ORDER BY a.appointment_date DESC, a.appointment_time DESC
                """
            ).fetchall()
            self._send_json(HTTPStatus.OK, {"checkups": [dict(r) for r in rows]})
        finally:
            conn.close()

    def _handle_list_bills(self, user: dict[str, Any]) -> None:
        conn = get_connection()
        try:
            sql = """
                SELECT b.*, p.patient_code, u.name AS patient_name,
                       r.room_number, r.room_type,
                       a.appointment_date, a.appointment_time, a.status AS appointment_status,
                       a.diagnosis_notes, du.name AS doctor_name
                FROM bills b
                JOIN patients p ON p.patient_id = b.patient_id
                JOIN users u ON u.user_id = p.user_id
                LEFT JOIN admissions adm ON adm.admission_id = b.admission_id
                LEFT JOIN rooms r ON r.room_id = adm.room_id
                LEFT JOIN appointments a ON a.appointment_id = b.appointment_id
                LEFT JOIN doctors doc ON doc.doctor_id = a.doctor_id
                LEFT JOIN users du ON du.user_id = doc.user_id
                WHERE 1=1
            """
            params: list[Any] = []
            if user["role"] == "patient":
                pat = self._get_patient_for_user(conn, user["user_id"])
                sql += " AND b.patient_id = ?"
                params.append(pat["patient_id"] if pat else -1)
            sql += " ORDER BY b.bill_id DESC"
            rows = conn.execute(sql, params).fetchall()
            self._send_json(HTTPStatus.OK, {"bills": [dict(r) for r in rows]})
        finally:
            conn.close()

    def _handle_create_bill(self, data: dict[str, Any]) -> None:
        patient_id = data.get("patient_id")
        admission_id = data.get("admission_id") or None
        appointment_id = data.get("appointment_id") or None
        checking_completed = bool(data.get("patient_checking_completed", False))
        try:
            consultation_fee = float(data.get("consultation_fee") or 0)
            room_charge = float(data.get("room_charge") or 0)
            medicine_charge = float(data.get("medicine_charge") or 0)
        except (TypeError, ValueError):
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Bill charges must be valid numbers."})
            return

        if not patient_id or consultation_fee < 0 or room_charge < 0 or medicine_charge < 0:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Valid patient and non-negative charges are required."})
            return

        total = round(consultation_fee + room_charge + medicine_charge, 2)
        now = datetime.utcnow().isoformat(timespec="seconds")
        checked_at = now if checking_completed else None

        conn = get_connection()
        try:
            if appointment_id:
                appt = conn.execute("SELECT status FROM appointments WHERE appointment_id = ?", (int(appointment_id),)).fetchone()
                if appt and appt["status"] == "Completed":
                    checking_completed = True
                    checked_at = now

            cur = conn.execute(
                """
                INSERT INTO bills (
                    patient_id, admission_id, appointment_id,
                    consultation_fee, room_charge, medicine_charge,
                    total, status, patient_checking_completed, checked_at, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?)
                """,
                (
                    int(patient_id),
                    int(admission_id) if admission_id else None,
                    int(appointment_id) if appointment_id else None,
                    consultation_fee,
                    room_charge,
                    medicine_charge,
                    total,
                    1 if checking_completed else 0,
                    checked_at,
                    now,
                ),
            )
            conn.commit()
            row = self._fetch_bill_by_id(conn, cur.lastrowid)
            self._send_json(HTTPStatus.CREATED, {"bill": dict(row)})
        finally:
            conn.close()

    def _handle_admin_create_user(self, data: dict[str, Any]) -> None:
        name = (data.get("name") or "").strip()
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""
        role = (data.get("role") or "").strip()

        if not name or not email or len(password) < 6 or role not in ("patient", "doctor", "reception", "billing", "admin"):
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Name, valid email, password (>=6 chars), and valid role are required."})
            return

        conn = get_connection()
        try:
            now = datetime.utcnow().isoformat(timespec="seconds")
            cur = conn.execute(
                "INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
                (name, email, hash_password(password), role, now),
            )
            uid = cur.lastrowid
            if role == "patient":
                code = _next_patient_code(conn)
                conn.execute(
                    "INSERT INTO patients (user_id, patient_code, date_of_birth, gender, address, phone) VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        uid,
                        code,
                        (data.get("date_of_birth") or "").strip(),
                        (data.get("gender") or "").strip(),
                        (data.get("address") or "").strip(),
                        (data.get("phone") or "").strip(),
                    ),
                )
            elif role == "doctor":
                dept_id = data.get("department_id")
                if not dept_id:
                    first_dept = conn.execute("SELECT department_id FROM departments ORDER BY department_id LIMIT 1").fetchone()
                    dept_id = first_dept["department_id"] if first_dept else None
                if not dept_id:
                    conn.rollback()
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "At least one department is required before adding a doctor."})
                    return
                dcur = conn.execute(
                    "INSERT INTO doctors (user_id, department_id, qualification, experience, fee, status) VALUES (?, ?, ?, ?, ?, 'Active')",
                    (
                        uid,
                        int(dept_id),
                        (data.get("qualification") or "MBBS, MD").strip(),
                        int(data.get("experience") or 5),
                        float(data.get("fee") or 500.0),
                    ),
                )
                doc_id = dcur.lastrowid
                for day in ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]:
                    conn.execute(
                        "INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time) VALUES (?, ?, '09:00', '13:00')",
                        (doc_id, day),
                    )

            conn.commit()
            row = conn.execute(
                "SELECT user_id, name, email, role, created_at FROM users WHERE user_id = ?", (uid,)
            ).fetchone()
            self._send_json(HTTPStatus.CREATED, {"user": dict(row)})
        except sqlite3.IntegrityError:
            conn.rollback()
            self._send_json(HTTPStatus.CONFLICT, {"error": "Email address already exists."})
        finally:
            conn.close()

    def _handle_reports(self) -> None:
        conn = get_connection()
        try:
            appt_by_dept = [
                dict(r)
                for r in conn.execute(
                    """
                    SELECT dep.name AS department,
                           COUNT(a.appointment_id) AS total_appointments,
                           SUM(CASE WHEN a.status = 'Confirmed' THEN 1 ELSE 0 END) AS confirmed,
                           SUM(CASE WHEN a.status = 'Completed' THEN 1 ELSE 0 END) AS completed,
                           SUM(CASE WHEN a.status = 'Cancelled' THEN 1 ELSE 0 END) AS cancelled
                    FROM departments dep
                    LEFT JOIN doctors doc ON doc.department_id = dep.department_id
                    LEFT JOIN appointments a ON a.doctor_id = doc.doctor_id
                    GROUP BY dep.department_id
                    ORDER BY total_appointments DESC, dep.name
                    """
                ).fetchall()
            ]
            room_occupancy = [
                dict(r)
                for r in conn.execute(
                    """
                    SELECT room_type,
                           COUNT(*) AS room_count,
                           SUM(bed_count) AS total_beds,
                           SUM(available_beds) AS available_beds,
                           SUM(bed_count - available_beds) AS occupied_beds
                    FROM rooms
                    GROUP BY room_type
                    ORDER BY room_type
                    """
                ).fetchall()
            ]
            billing_summary = dict(
                conn.execute(
                    """
                    SELECT COUNT(*) AS bill_count,
                           COALESCE(SUM(total), 0) AS gross_billed,
                           COALESCE(SUM(CASE WHEN status = 'Paid' THEN total ELSE 0 END), 0) AS collected_amount,
                           COALESCE(SUM(CASE WHEN status = 'Pending' THEN total ELSE 0 END), 0) AS pending_amount,
                           COALESCE(SUM(consultation_fee), 0) AS total_consultation,
                           COALESCE(SUM(room_charge), 0) AS total_room_charges,
                           COALESCE(SUM(medicine_charge), 0) AS total_medicine_charges
                    FROM bills
                    """
                ).fetchone()
            )
            admission_summary = dict(
                conn.execute(
                    """
                    SELECT COUNT(*) AS total_admissions,
                           SUM(CASE WHEN status = 'Admitted' THEN 1 ELSE 0 END) AS currently_admitted,
                           SUM(CASE WHEN status = 'Discharged' THEN 1 ELSE 0 END) AS discharged
                    FROM admissions
                    """
                ).fetchone()
            )
            self._send_json(
                HTTPStatus.OK,
                {
                    "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "appointments_by_department": appt_by_dept,
                    "room_occupancy": room_occupancy,
                    "billing_summary": billing_summary,
                    "admission_summary": admission_summary,
                },
            )
        finally:
            conn.close()


def main() -> None:
    init_db()
    port = int(os.environ.get("PYTHON_PORT", "5001"))
    server = ThreadingHTTPServer(("127.0.0.1", port), HMSRequestHandler)
    print(f"Python HMS API listening on http://127.0.0.1:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
