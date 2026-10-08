/* =========================================================
   Smart Classroom & AI Timetable Scheduler — script.js
   Full-Stack PostgreSQL + Supabase Integration
   ========================================================= */

/* ================================================================
   1. SUPABASE CLIENT & CONFIGURATION
   ================================================================ */

const SUPABASE_URL = "https://afvkkjaqjunqwhqstghb.supabase.co";
const SUPABASE_KEY = "sb_publishable_TE5WVpY_2VMXQYcGOVZRqg_U62mAMVT";

let _sbClient = null;

function sb() {
  if (!_sbClient) {
    if (typeof supabase === "undefined" || !supabase.createClient) {
      console.error("Supabase JS library not loaded.");
      return null;
    }
    _sbClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
  }
  return _sbClient;
}

/* ================================================================
   2. CONSTANTS & UTILITIES
   ================================================================ */

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const SLOTS = [
  "09:00 - 10:00",
  "10:00 - 11:00",
  "11:15 - 12:15",
  "01:00 - 02:00",
  "02:00 - 03:00"
];

const SUBJECT_POOL = [
  "Machine Learning",
  "Python Programming",
  "Java",
  "Database Systems",
  "Operating Systems",
  "Cloud Computing",
  "Cyber Security",
  "Software Engineering",
  "AI Lab",
  "Data Structures",
  "Computer Networks",
  "Web Development"
];

const KEYS = {
  theme: "sca_theme"
};

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function todayName() {
  const d = new Date().getDay();
  const map = { 1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday" };
  return map[d] || "Monday";
}

function todayIsoDate() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : "";
}

function setBtnLoading(btn, isLoading, loadingText = "Saving...", defaultText = "") {
  if (!btn) return;
  if (isLoading) {
    btn.dataset.originalText = btn.textContent;
    btn.textContent = loadingText;
    btn.disabled = true;
    btn.style.opacity = "0.7";
    btn.style.cursor = "not-allowed";
  } else {
    btn.textContent = defaultText || btn.dataset.originalText || "Submit";
    btn.disabled = false;
    btn.style.opacity = "";
    btn.style.cursor = "";
  }
}

/* ---------------- Toast Notifications ---------------- */

function toast(message, type = "info") {
  let stack = $("#toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "toast-stack";
    document.body.appendChild(stack);
  }
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  const icon = type === "success" ? "✅" : type === "error" ? "⚠️" : "ℹ️";
  el.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity .3s, transform .3s";
    el.style.opacity = "0";
    el.style.transform = "translateY(8px)";
    setTimeout(() => el.remove(), 300);
  }, 3400);
}

/* ---------------- Theme Toggle ---------------- */

function initTheme() {
  const saved = localStorage.getItem(KEYS.theme) || "light";
  document.documentElement.setAttribute("data-theme", saved);
  const btn = $("#themeToggle");
  if (btn) btn.textContent = saved === "dark" ? "☀️" : "🌙";
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem(KEYS.theme, next);
  const btn = $("#themeToggle");
  if (btn) btn.textContent = next === "dark" ? "☀️" : "🌙";
}

/* ================================================================
   3. IN-MEMORY APPLICATION STATE
   Loaded directly from Supabase PostgreSQL tables
   ================================================================ */

let _currentUser = null;
let _students = [];
let _teachers = [];
let _classrooms = [];
let _timetable = [];
let _notifications = [];

function getCurrentUser() {
  return _currentUser;
}

function renderUserChip() {
  const chip = $("#userChip");
  const logoutBtn = $("#logoutBtn");
  if (!chip) return;
  const user = getCurrentUser();
  if (user) {
    chip.style.display = "flex";
    const rollBit = user.role === "student" && user.rollno ? ` · ${user.rollno}` : "";
    chip.innerHTML = `<span class="dot">${(user.name || "U").charAt(0)}</span> ${user.name} · <span class="muted" style="margin-left:2px;">${capitalize(user.role)}${rollBit}</span>`;
    if (logoutBtn) logoutBtn.style.display = "inline-flex";
  } else {
    chip.style.display = "none";
    if (logoutBtn) logoutBtn.style.display = "none";
  }
}

/* ================================================================
   4. AUTHENTICATION & SESSION MANAGEMENT (Supabase Auth)
   ================================================================ */

async function fetchUserProfile(userId) {
  const client = sb();
  if (!client || !userId) return null;
  const { data, error } = await client
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (error) {
    console.warn("fetchUserProfile error:", error.message);
    return null;
  }
  return data;
}

async function requireAuth(allowedRoles) {
  const client = sb();
  if (!client) {
    toast("Database connection is not available.", "error");
    window.location.href = "login.html";
    return null;
  }

  const { data: { session }, error } = await client.auth.getSession();
  if (error || !session) {
    _currentUser = null;
    window.location.href = "login.html";
    return null;
  }

  const userId = session.user.id;
  let profile = await fetchUserProfile(userId);

  // If profile not yet created, build from user metadata
  const meta = session.user.user_metadata || {};
  if (!profile) {
    profile = {
      id: userId,
      full_name: meta.full_name || session.user.email.split("@")[0],
      email: session.user.email,
      role: meta.role || "student",
      roll_no: meta.rollno || "",
      department: meta.department || "Information Technology",
      semester: meta.semester || "1",
      division: meta.division || "A"
    };
  }

  _currentUser = {
    id: userId,
    name: profile.full_name,
    role: profile.role,
    email: profile.email || session.user.email,
    rollno: profile.roll_no || meta.rollno || "",
    dept: profile.department || meta.department || "Information Technology",
    sem: profile.semester || meta.semester || "1",
    div: profile.division || meta.division || "A"
  };

  renderUserChip();

  if (allowedRoles && !allowedRoles.includes(_currentUser.role)) {
    toast(`Access denied for role: ${_currentUser.role}`, "error");
    if (_currentUser.role === "admin") window.location.href = "admin.html";
    else if (_currentUser.role === "teacher") window.location.href = "teacher.html";
    else window.location.href = "student.html";
    return null;
  }

  return _currentUser;
}

async function logout() {
  const client = sb();
  if (client) {
    await client.auth.signOut().catch(() => {});
  }
  _currentUser = null;
  window.location.href = "login.html";
}

/* ---------------- Login Controller ---------------- */

function markField(fieldEl, invalid, message) {
  if (!fieldEl) return;
  const errEl = fieldEl.querySelector(".error");
  fieldEl.classList.toggle("invalid", invalid);
  if (errEl && message) errEl.textContent = message;
}

function handleRoleChange() {
  const roleEl = $("#role");
  if (!roleEl) return;
  const role = roleEl.value;
  const rollnoField = $("#rollnoField");
  if (rollnoField) rollnoField.style.display = role === "student" ? "block" : "none";
  if (role !== "student" && rollnoField) {
    markField(rollnoField, false);
    const rollnoInput = $("#rollno");
    if (rollnoInput) rollnoInput.value = "";
  }
  $$(".role-pick button").forEach(b => b.classList.toggle("active", b.dataset.role === role));
}

function selectRole(role) {
  const roleEl = $("#role");
  if (roleEl) roleEl.value = role;
  handleRoleChange();
  const roleField = $("#roleField");
  if (roleField) markField(roleField, false);
}

async function validateLogin() {
  const roleField = $("#roleField");
  const nameField = $("#nameField");
  const rollnoField = $("#rollnoField");
  const passField = $("#passField");
  const submitBtn = $("#loginSubmitBtn") || $("button[type='submit']");

  const role = ($("#role") || { value: "" }).value;
  const inputVal = (($("#name") || $("#email") || { value: "" }).value).trim();
  const rollno = (($("#rollno") || { value: "" }).value).trim();
  const password = (($("#password") || { value: "" }).value);

  let ok = true;

  if (roleField) {
    if (!role) {
      markField(roleField, true, "Please select a user type.");
      ok = false;
    } else {
      markField(roleField, false);
    }
  }

  if (nameField) {
    if (!inputVal || inputVal.length < 2) {
      markField(nameField, true, "Please enter your email or name.");
      ok = false;
    } else {
      markField(nameField, false);
    }
  }

  if (role === "student" && rollnoField) {
    if (!rollno) {
      markField(rollnoField, true, "Roll number cannot be empty.");
      ok = false;
    } else {
      markField(rollnoField, false);
    }
  }

  if (passField) {
    if (!password || password.length < 6) {
      markField(passField, true, "Password must be at least 6 characters.");
      ok = false;
    } else {
      markField(passField, false);
    }
  }

  if (!ok) {
    toast("Please fix the highlighted fields.", "error");
    return false;
  }

  const client = sb();
  if (!client) {
    toast("Supabase client is not initialized.", "error");
    return false;
  }

  setBtnLoading(submitBtn, true, "Signing in...", "🔐 Login");

  try {
    let emailToAuth = inputVal;

    // If input is not an email, lookup user email by name/roll_no
    if (!inputVal.includes("@")) {
      const { data: matchedProfile } = await client
        .from("profiles")
        .select("email, role")
        .or(`full_name.ilike.${inputVal},roll_no.eq.${rollno || inputVal}`)
        .limit(1)
        .maybeSingle();

      if (matchedProfile && matchedProfile.email) {
        emailToAuth = matchedProfile.email;
      } else {
        emailToAuth = `${inputVal.toLowerCase().replace(/\s+/g, "")}@smart.edu`;
      }
    }

    const { data, error } = await client.auth.signInWithPassword({
      email: emailToAuth,
      password: password
    });

    if (error) {
      toast("Authentication failed: " + error.message, "error");
      setBtnLoading(submitBtn, false, "", "🔐 Login");
      return false;
    }

    const userId = data.user.id;
    const profile = await fetchUserProfile(userId);
    const dbRole = profile ? profile.role : (data.user.user_metadata && data.user.user_metadata.role) || role;

    if (role && dbRole && role !== dbRole) {
      toast(`Role mismatch: Your account role is "${dbRole}", not "${role}".`, "error");
      await client.auth.signOut();
      setBtnLoading(submitBtn, false, "", "🔐 Login");
      return false;
    }

    _currentUser = {
      id: userId,
      name: profile ? profile.full_name : (data.user.user_metadata?.full_name || inputVal),
      role: dbRole,
      email: data.user.email,
      rollno: profile ? profile.roll_no : (data.user.user_metadata?.rollno || rollno)
    };

    toast(`Welcome back, ${_currentUser.name}!`, "success");

    setTimeout(() => {
      if (dbRole === "admin") window.location.href = "admin.html";
      else if (dbRole === "teacher") window.location.href = "teacher.html";
      else window.location.href = "student.html";
    }, 600);

  } catch (err) {
    console.error("Login exception:", err);
    toast("An unexpected error occurred during login.", "error");
    setBtnLoading(submitBtn, false, "", "🔐 Login");
  }

  return false;
}

/* ---------------- Registration Controller ---------------- */

function regHandleRoleChange() {
  const regRoleEl = $("#regRole");
  if (!regRoleEl) return;
  const role = regRoleEl.value;
  const rollnoField = $("#regRollnoField");
  if (rollnoField) rollnoField.style.display = role === "student" ? "block" : "none";
  if (role !== "student" && rollnoField) {
    markField(rollnoField, false);
    const ri = $("#regRollno");
    if (ri) ri.value = "";
  }
  $$(".role-pick button").forEach(b => b.classList.toggle("active", b.dataset.role === role));
}

function regSelectRole(role) {
  const el = $("#regRole");
  if (el) el.value = role;
  regHandleRoleChange();
  const rf = $("#regRoleField");
  if (rf) markField(rf, false);
}

async function validateRegistration() {
  const roleField = $("#regRoleField");
  const fnameField = $("#fnameField");
  const lnameField = $("#lnameField");
  const rollnoField = $("#regRollnoField");
  const passField = $("#regPassField");
  const emailField = $("#regEmailField");
  const mobileField = $("#mobileField");
  const addressField = $("#addressField");
  const submitBtn = $("#regSubmitBtn") || $("button[type='submit']");

  const role = ($("#regRole") || { value: "" }).value;
  const fname = (($("#fname") || { value: "" }).value).trim();
  const lname = (($("#lname") || { value: "" }).value).trim();
  const rollno = (($("#regRollno") || { value: "" }).value).trim();
  const password = (($("#regPassword") || { value: "" }).value);
  const email = (($("#regEmail") || { value: "" }).value).trim();
  const mobile = (($("#mobile") || { value: "" }).value).trim();
  const address = (($("#address") || { value: "" }).value).trim();

  const namePattern = /^[A-Za-z ]+$/;
  const emailPattern = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  const mobilePattern = /^[0-9]{10}$/;
  let ok = true;

  if (roleField) {
    if (!role) { markField(roleField, true); ok = false; }
    else markField(roleField, false);
  }
  if (fnameField) {
    if (!namePattern.test(fname) || fname.length < 2) { markField(fnameField, true); ok = false; }
    else markField(fnameField, false);
  }
  if (lnameField) {
    if (!lname) { markField(lnameField, true); ok = false; }
    else markField(lnameField, false);
  }
  if (role === "student" && rollnoField) {
    if (!rollno) { markField(rollnoField, true); ok = false; }
    else markField(rollnoField, false);
  }
  if (passField) {
    if (!password || password.length < 6) { markField(passField, true); ok = false; }
    else markField(passField, false);
  }
  if (emailField) {
    if (!emailPattern.test(email)) { markField(emailField, true); ok = false; }
    else markField(emailField, false);
  }
  if (mobileField) {
    if (!mobilePattern.test(mobile)) { markField(mobileField, true); ok = false; }
    else markField(mobileField, false);
  }
  if (addressField) {
    if (!address) { markField(addressField, true); ok = false; }
    else markField(addressField, false);
  }

  if (!ok) {
    toast("Please fix the highlighted fields.", "error");
    return false;
  }

  const client = sb();
  if (!client) {
    toast("Database client is not available.", "error");
    return false;
  }

  setBtnLoading(submitBtn, true, "Registering...", "📝 Register");

  const fullName = `${fname} ${lname}`;

  try {
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          role,
          rollno: role === "student" ? rollno : "",
          mobile,
          address,
          department: "Information Technology",
          semester: "1",
          division: "A"
        }
      }
    });

    if (error) {
      toast("Registration failed: " + error.message, "error");
      setBtnLoading(submitBtn, false, "", "📝 Register");
      return false;
    }

    // Direct insert fallbacks to guarantee instant table consistency
    if (data && data.user) {
      const uId = data.user.id;

      await client.from("profiles").upsert({
        id: uId,
        full_name: fullName,
        email,
        role,
        mobile,
        address,
        roll_no: role === "student" ? rollno : null,
        department: "Information Technology",
        semester: "1",
        division: "A"
      }).catch(() => {});

      if (role === "student" && rollno) {
        await client.from("students").upsert({
          user_id: uId,
          name: fullName,
          roll_no: rollno,
          dept: "Information Technology",
          sem: "1",
          div: "A"
        }, { onConflict: "roll_no" }).catch(() => {});
      } else if (role === "teacher") {
        await client.from("teachers").upsert({
          user_id: uId,
          name: fullName,
          email,
          subject: "—"
        }).catch(() => {});
      }
    }

    toast("🎉 Account registered successfully!", "success");
    const formEl = $("#registrationForm");
    if (formEl) formEl.reset();

    setTimeout(() => {
      if (role === "admin") window.location.href = "admin.html";
      else if (role === "teacher") window.location.href = "teacher.html";
      else window.location.href = "student.html";
    }, 700);

  } catch (err) {
    console.error("Registration error:", err);
    toast("An error occurred during registration.", "error");
    setBtnLoading(submitBtn, false, "", "📝 Register");
  }

  return false;
}

/* ================================================================
   5. DATABASE CRUD OPERATIONS (PostgreSQL via Supabase)
   ================================================================ */

/* ---------- Students ---------- */

async function fetchStudents() {
  const client = sb();
  if (!client) return [];
  const { data, error } = await client
    .from("students")
    .select("*")
    .order("name", { ascending: true });
  if (error) {
    console.error("fetchStudents:", error.message);
    return [];
  }
  return data || [];
}

async function dbInsertStudent(s) {
  const client = sb();
  if (!client) return null;
  const { data, error } = await client
    .from("students")
    .insert([{
      name: s.name,
      roll_no: s.roll_no || s.roll || "",
      dept: s.dept || "Information Technology",
      sem: String(s.sem || "1"),
      div: s.div || "A"
    }])
    .select()
    .single();
  if (error) {
    toast("Unable to save student: " + error.message, "error");
    return null;
  }
  return data;
}

async function dbUpdateStudent(id, s) {
  const client = sb();
  if (!client) return false;
  const { error } = await client
    .from("students")
    .update({
      name: s.name,
      roll_no: s.roll_no || s.roll || "",
      dept: s.dept || "Information Technology",
      sem: String(s.sem || "1"),
      div: s.div || "A"
    })
    .eq("id", id);
  if (error) {
    toast("Unable to update student: " + error.message, "error");
    return false;
  }
  return true;
}

async function dbDeleteStudent(id) {
  const client = sb();
  if (!client) return false;
  const { error } = await client.from("students").delete().eq("id", id);
  if (error) {
    toast("Unable to delete student: " + error.message, "error");
    return false;
  }
  return true;
}

/* ---------- Teachers ---------- */

async function fetchTeachers() {
  const client = sb();
  if (!client) return [];
  const { data, error } = await client
    .from("teachers")
    .select("*")
    .order("name", { ascending: true });
  if (error) {
    console.error("fetchTeachers:", error.message);
    return [];
  }
  return data || [];
}

async function dbInsertTeacher(t) {
  const client = sb();
  if (!client) return null;
  const { data, error } = await client
    .from("teachers")
    .insert([{
      name: t.name,
      subject: t.subject || "—",
      email: t.email || ""
    }])
    .select()
    .single();
  if (error) {
    toast("Unable to save teacher: " + error.message, "error");
    return null;
  }
  return data;
}

async function dbUpdateTeacher(id, t) {
  const client = sb();
  if (!client) return false;
  const { error } = await client
    .from("teachers")
    .update({
      name: t.name,
      subject: t.subject || "—",
      email: t.email || ""
    })
    .eq("id", id);
  if (error) {
    toast("Unable to update teacher: " + error.message, "error");
    return false;
  }
  return true;
}

async function dbDeleteTeacher(id) {
  const client = sb();
  if (!client) return false;
  const { error } = await client.from("teachers").delete().eq("id", id);
  if (error) {
    toast("Unable to delete teacher: " + error.message, "error");
    return false;
  }
  return true;
}

/* ---------- Classrooms ---------- */

async function fetchClassrooms() {
  const client = sb();
  if (!client) return [];
  const { data, error } = await client
    .from("classrooms")
    .select("*")
    .order("room", { ascending: true });
  if (error) {
    console.error("fetchClassrooms:", error.message);
    return [];
  }
  return data || [];
}

async function dbInsertClassroom(r) {
  const client = sb();
  if (!client) return null;
  const { data, error } = await client
    .from("classrooms")
    .insert([{
      room: r.room,
      capacity: Number(r.capacity) || 60,
      smartboard: Boolean(r.smartboard),
      projector: Boolean(r.projector),
      wifi: Boolean(r.wifi),
      ac: Boolean(r.ac),
      status: r.status || "Available"
    }])
    .select()
    .single();
  if (error) {
    toast("Unable to save classroom: " + error.message, "error");
    return null;
  }
  return data;
}

async function dbUpdateClassroom(id, r) {
  const client = sb();
  if (!client) return false;
  const { error } = await client
    .from("classrooms")
    .update({
      room: r.room,
      capacity: Number(r.capacity) || 60,
      smartboard: Boolean(r.smartboard),
      projector: Boolean(r.projector),
      wifi: Boolean(r.wifi),
      ac: Boolean(r.ac),
      status: r.status || "Available"
    })
    .eq("id", id);
  if (error) {
    toast("Unable to update classroom: " + error.message, "error");
    return false;
  }
  return true;
}

async function dbDeleteClassroom(id) {
  const client = sb();
  if (!client) return false;
  const { error } = await client.from("classrooms").delete().eq("id", id);
  if (error) {
    toast("Unable to delete classroom: " + error.message, "error");
    return false;
  }
  return true;
}

/* ---------- Timetable ---------- */

async function fetchTimetable() {
  const client = sb();
  if (!client) return [];
  const { data, error } = await client
    .from("timetable")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) {
    console.error("fetchTimetable:", error.message);
    return [];
  }
  return data || [];
}

async function dbInsertTimetable(entry) {
  const client = sb();
  if (!client) return null;

  const tRec = _teachers.find(t => t.name === entry.teacher);
  const rRec = _classrooms.find(r => r.room === entry.room);
  const user = getCurrentUser();

  const { data, error } = await client
    .from("timetable")
    .insert([{
      day: entry.day,
      time: entry.time,
      subject: entry.subject,
      teacher: entry.teacher,
      teacher_id: tRec ? tRec.id : null,
      room: entry.room,
      classroom_id: rRec ? rRec.id : null,
      sem: String(entry.sem || "5"),
      div: entry.div || "A",
      created_by: user ? user.id : null
    }])
    .select()
    .single();

  if (error) {
    toast(error.message, "error");
    return null;
  }
  return data;
}

async function dbUpdateTimetable(id, entry) {
  const client = sb();
  if (!client) return false;

  const tRec = _teachers.find(t => t.name === entry.teacher);
  const rRec = _classrooms.find(r => r.room === entry.room);

  const { error } = await client
    .from("timetable")
    .update({
      day: entry.day,
      time: entry.time,
      subject: entry.subject,
      teacher: entry.teacher,
      teacher_id: tRec ? tRec.id : null,
      room: entry.room,
      classroom_id: rRec ? rRec.id : null,
      sem: String(entry.sem || "5"),
      div: entry.div || "A"
    })
    .eq("id", id);

  if (error) {
    toast(error.message, "error");
    return false;
  }
  return true;
}

async function dbDeleteTimetable(id) {
  const client = sb();
  if (!client) return false;
  const { error } = await client.from("timetable").delete().eq("id", id);
  if (error) {
    toast("Unable to delete lecture: " + error.message, "error");
    return false;
  }
  return true;
}

/* ---------- Notifications ---------- */

async function fetchNotifications(teacherName) {
  const client = sb();
  if (!client) return [];
  let q = client.from("notifications").select("*").order("created_at", { ascending: false });
  if (teacherName) {
    q = q.eq("teacher", teacherName);
  }
  const { data, error } = await q;
  if (error) {
    console.error("fetchNotifications:", error.message);
    return [];
  }
  return data || [];
}

async function dbInsertNotification(teacherName, message) {
  const client = sb();
  if (!client) return null;
  const tRec = _teachers.find(t => t.name === teacherName);
  const { data, error } = await client
    .from("notifications")
    .insert([{
      teacher: teacherName,
      teacher_id: tRec ? tRec.id : null,
      message,
      read: false
    }])
    .select()
    .single();
  if (error) {
    console.error("dbInsertNotification error:", error.message);
    return null;
  }
  return data;
}

async function dbMarkNotificationsRead(teacherName) {
  const client = sb();
  if (!client) return false;
  const { error } = await client
    .from("notifications")
    .update({ read: true })
    .eq("teacher", teacherName)
    .eq("read", false);
  if (error) {
    console.error("dbMarkNotificationsRead:", error.message);
    return false;
  }
  return true;
}

async function dbDeleteNotifications(teacherName) {
  const client = sb();
  if (!client) return false;
  const { error } = await client
    .from("notifications")
    .delete()
    .eq("teacher", teacherName);
  if (error) {
    console.error("dbDeleteNotifications:", error.message);
    return false;
  }
  return true;
}

/* ---------- Attendance ---------- */

async function fetchStudentAttendance(studentId, rollNo) {
  const client = sb();
  if (!client) return [];
  let q = client.from("attendance").select("*, timetable(*)");
  if (studentId) q = q.eq("student_id", studentId);
  const { data, error } = await q;
  if (error) {
    console.error("fetchStudentAttendance error:", error.message);
    return [];
  }
  return data || [];
}

async function fetchLectureAttendance(timetableId, date) {
  const client = sb();
  if (!client || !timetableId) return [];
  const { data, error } = await client
    .from("attendance")
    .select("*")
    .eq("timetable_id", timetableId)
    .eq("attendance_date", date);
  if (error) {
    console.error("fetchLectureAttendance error:", error.message);
    return [];
  }
  return data || [];
}

async function dbSaveAttendanceRecords(records) {
  const client = sb();
  if (!client || !records.length) return false;
  const { error } = await client
    .from("attendance")
    .upsert(records, { onConflict: "student_id,timetable_id,attendance_date" });
  if (error) {
    toast("Unable to save attendance: " + error.message, "error");
    return false;
  }
  return true;
}

/* ================================================================
   6. GLOBAL DATA LOADER & REALTIME SUBSCRIPTIONS
   ================================================================ */

async function loadAllData() {
  const [s, t, c, tt] = await Promise.all([
    fetchStudents(),
    fetchTeachers(),
    fetchClassrooms(),
    fetchTimetable()
  ]);
  _students = s;
  _teachers = t;
  _classrooms = c;
  _timetable = tt;
}

function initRealtimeSubscriptions() {
  const client = sb();
  if (!client) return;

  client
    .channel("smart_classroom_realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "classrooms" },
      async () => {
        _classrooms = await fetchClassrooms();
        const page = document.body.dataset.page;
        if (page === "admin") renderClassrooms();
        if (page === "teacher") renderClassroomStatusReadOnly("teacherClassroomStatus");
        if (page === "student") renderClassroomStatusReadOnly("studentClassroomStatus");
        renderDashboardStats();
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "timetable" },
      async () => {
        _timetable = await fetchTimetable();
        const page = document.body.dataset.page;
        if (page === "admin") renderAdminTimetable();
        if (page === "teacher") renderTeacherLectures();
        if (page === "student") { renderStudentTimetable(); searchStudentTimetable(); }
        if (page === "timetable") renderFullTimetable();
        renderDashboardStats();
      }
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications" },
      async (payload) => {
        const user = getCurrentUser();
        if (user && payload.new && payload.new.teacher === user.name) {
          _notifications = await fetchNotifications(user.name);
          renderTeacherNotifications();
          toast(`🔔 New notification: ${payload.new.message}`, "info");
        }
      }
    )
    .subscribe();
}

/* ================================================================
   7. TIMETABLE CONFLICT CHECKING ENGINE
   ================================================================ */

function checkTimetableConflict(day, time, room, teacherName, sem, div, excludeId = null) {
  // 1. Room Conflict
  const roomConflict = _timetable.find(t =>
    t.id !== excludeId &&
    t.day === day &&
    t.time === time &&
    t.room.toLowerCase() === room.toLowerCase()
  );
  if (roomConflict) {
    return `Room conflict: ${room} is already booked on ${day} at ${time}.`;
  }

  // 2. Teacher Conflict
  const teacherConflict = _timetable.find(t =>
    t.id !== excludeId &&
    t.day === day &&
    t.time === time &&
    t.teacher.toLowerCase() === teacherName.toLowerCase()
  );
  if (teacherConflict) {
    return `Teacher conflict: ${teacherName} is already scheduled during ${time} on ${day}.`;
  }

  // 3. Division Conflict
  const divConflict = _timetable.find(t =>
    t.id !== excludeId &&
    t.day === day &&
    t.time === time &&
    String(t.sem) === String(sem) &&
    t.div.toUpperCase() === div.toUpperCase()
  );
  if (divConflict) {
    return `Division conflict: Semester ${sem} Division ${div} already has a lecture on ${day} at ${time}.`;
  }

  return null;
}

/* ================================================================
   8. AI TIMETABLE GENERATOR ENGINE
   ================================================================ */

async function generateAITimetable(scopeTeacherOnly = false) {
  const user = getCurrentUser();
  const rooms = _classrooms.map(r => r.room);
  const teacherName = (user && user.role === "teacher") ? user.name : null;

  if (!rooms.length) {
    toast("Please add at least one classroom before generating a timetable.", "error");
    return;
  }

  if (!_teachers.length && !scopeTeacherOnly) {
    toast("Please add at least one teacher before generating a timetable.", "error");
    return;
  }

  if (!scopeTeacherOnly) {
    const confirmed = confirm(
      "⚡ Generate Full-College AI Timetable?\n\nThis will generate a conflict-free schedule for the college and update PostgreSQL. Existing lectures will be replaced."
    );
    if (!confirmed) return;
  }

  const client = sb();
  if (!client) {
    toast("Supabase client not connected.", "error");
    return;
  }

  const btn = scopeTeacherOnly ? $("button.gold") : $("#regenerateBtn");
  setBtnLoading(btn, true, "🤖 Generating...", "Generate AI Timetable");

  try {
    let workingTT = [..._timetable];

    if (scopeTeacherOnly && teacherName) {
      // Remove current teacher's lectures from DB first
      const myLectures = workingTT.filter(t => t.teacher === teacherName);
      for (const lec of myLectures) {
        await dbDeleteTimetable(lec.id);
      }
      workingTT = workingTT.filter(t => t.teacher !== teacherName);
    } else {
      // Full college wipe
      for (const lec of workingTT) {
        await dbDeleteTimetable(lec.id);
      }
      workingTT = [];
    }

    const newEntries = [];

    for (const day of DAYS) {
      for (const time of SLOTS) {
        const bookedRooms = new Set(
          workingTT.filter(t => t.day === day && t.time === time).map(t => t.room)
        );
        const bookedTeachers = new Set(
          workingTT.filter(t => t.day === day && t.time === time).map(t => t.teacher)
        );
        const bookedDivs = new Set(
          workingTT.filter(t => t.day === day && t.time === time).map(t => `${t.sem}_${t.div}`)
        );

        const availableRooms = rooms.filter(r => !bookedRooms.has(r));
        if (!availableRooms.length) continue;

        let teacher = teacherName;
        if (!teacher) {
          const availTeachers = _teachers.filter(t => !bookedTeachers.has(t.name));
          if (!availTeachers.length) continue;
          teacher = availTeachers[Math.floor(Math.random() * availTeachers.length)].name;
        } else {
          if (bookedTeachers.has(teacher)) continue;
        }

        const room = availableRooms[Math.floor(Math.random() * availableRooms.length)];
        const subject = SUBJECT_POOL[Math.floor(Math.random() * SUBJECT_POOL.length)];
        const sem = "5";
        const div = "A";

        if (bookedDivs.has(`${sem}_${div}`)) continue;

        const entry = { day, time, subject, teacher, room, sem, div };
        newEntries.push(entry);
        workingTT.push({ ...entry, id: "tmp_" + uid() });
      }
    }

    // Insert new conflict-free entries into PostgreSQL
    for (const item of newEntries) {
      const inserted = await dbInsertTimetable(item);
      if (inserted) {
        workingTT.push(inserted);
      }
    }

    // Refresh memory
    _timetable = await fetchTimetable();

    toast("✅ AI Timetable generated successfully with 0 conflicts!", "success");

    if (!scopeTeacherOnly && user && user.role === "admin") {
      for (const t of _teachers) {
        await dbInsertNotification(
          t.name,
          "An admin regenerated the full-college AI timetable. Please review your updated schedule."
        );
      }
    }

    // Refresh UI
    renderTeacherLectures();
    renderTeacherNotifications();
    renderFullTimetable();
    renderStudentTimetable();
    renderAdminTimetable();

  } catch (err) {
    console.error("AI Generation error:", err);
    toast("Failed to generate AI timetable: " + err.message, "error");
  } finally {
    setBtnLoading(btn, false, "", scopeTeacherOnly ? "🤖 Generate My AI Timetable" : "⚡ Generate Full-College Timetable");
  }
}

/* ================================================================
   9. ADMIN DASHBOARD CONTROLLER
   ================================================================ */

let editingStudentId = null;
let editingTeacherId = null;
let editingRoomId = null;
let editingAdminLectureId = null;

function renderDashboardStats() {
  const today = todayName();
  const setStat = (id, val) => {
    const el = $(id);
    if (el) el.textContent = val;
  };
  setStat("#statStudents", _students.length);
  setStat("#statTeachers", _teachers.length);
  setStat("#statClassrooms", _classrooms.length);
  setStat("#statToday", _timetable.filter(t => t.day === today).length);
}

/* ---------- Admin: Students CRUD ---------- */

function renderStudents() {
  const tbody = $("#studentsBody");
  if (!tbody) return;
  tbody.innerHTML = _students.length
    ? ""
    : `<tr class="empty-row"><td colspan="6">No students registered yet.</td></tr>`;
  _students.forEach(s => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${s.name}</td>
      <td>${s.roll_no || s.roll || ""}</td>
      <td>${s.dept || "—"}</td>
      <td>${s.sem || "—"}</td>
      <td>${s.div || "—"}</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" title="Edit" onclick="editStudent('${s.id}')">✏️</button>
          <button class="icon-btn del" title="Delete" onclick="deleteStudent('${s.id}')">🗑️</button>
        </div>
      </td>`;
    tbody.appendChild(tr);
  });
}

async function saveStudent() {
  const name = ($("#studentName") || { value: "" }).value.trim();
  const roll = ($("#studentRoll") || { value: "" }).value.trim();
  const dept = ($("#studentDept") || { value: "Information Technology" }).value.trim() || "Information Technology";
  const sem = ($("#studentSem") || { value: "1" }).value;
  const div = ($("#studentDiv") || { value: "A" }).value;
  const btn = $("#studentSubmitBtn");

  if (!/^[A-Za-z ]+$/.test(name) || name.length < 2) {
    toast("Enter a valid student name (letters only, min 2 chars).", "error");
    return;
  }
  if (!roll) {
    toast("Roll number is required.", "error");
    return;
  }

  setBtnLoading(btn, true, "Saving...", editingStudentId ? "💾 Save Changes" : "➕ Add Student");

  if (editingStudentId) {
    const ok = await dbUpdateStudent(editingStudentId, { name, roll_no: roll, dept, sem, div });
    if (ok) {
      const idx = _students.findIndex(s => s.id === editingStudentId);
      if (idx > -1) _students[idx] = { ..._students[idx], name, roll_no: roll, dept, sem, div };
      toast("Student updated successfully.", "success");
      clearStudentForm();
    }
  } else {
    const dup = _students.find(s => (s.roll_no || s.roll) === roll);
    if (dup) {
      toast("A student with this roll number already exists.", "error");
      setBtnLoading(btn, false, "", "➕ Add Student");
      return;
    }
    const created = await dbInsertStudent({ name, roll_no: roll, dept, sem, div });
    if (created) {
      _students.push(created);
      toast("Student added successfully.", "success");
      clearStudentForm();
    }
  }

  setBtnLoading(btn, false, "", "➕ Add Student");
  renderStudents();
  renderDashboardStats();
}

function editStudent(id) {
  const s = _students.find(x => x.id === id);
  if (!s) return;
  editingStudentId = id;
  const set = (sel, val) => { const el = $(sel); if (el) el.value = val; };
  set("#studentName", s.name);
  set("#studentRoll", s.roll_no || s.roll || "");
  set("#studentDept", s.dept || "");
  set("#studentSem", s.sem || "1");
  set("#studentDiv", s.div || "A");
  const btn = $("#studentSubmitBtn");
  if (btn) btn.textContent = "💾 Save Changes";
  const el = $("#studentName");
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function deleteStudent(id) {
  if (!confirm("Are you sure you want to delete this student record?")) return;
  const ok = await dbDeleteStudent(id);
  if (ok) {
    _students = _students.filter(s => s.id !== id);
    renderStudents();
    renderDashboardStats();
    toast("Student removed successfully.", "info");
  }
}

function clearStudentForm() {
  ["#studentName", "#studentRoll", "#studentDept"].forEach(sel => {
    const el = $(sel); if (el) el.value = "";
  });
  editingStudentId = null;
  const btn = $("#studentSubmitBtn");
  if (btn) btn.textContent = "➕ Add Student";
}

/* ---------- Admin: Teachers CRUD ---------- */

function renderTeachers() {
  const tbody = $("#teachersBody");
  if (!tbody) return;
  tbody.innerHTML = _teachers.length
    ? ""
    : `<tr class="empty-row"><td colspan="3">No teachers registered yet.</td></tr>`;
  _teachers.forEach(t => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${t.name}</td>
      <td>${t.subject || "—"}</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" title="Edit" onclick="editTeacher('${t.id}')">✏️</button>
          <button class="icon-btn del" title="Delete" onclick="deleteTeacher('${t.id}')">🗑️</button>
        </div>
      </td>`;
    tbody.appendChild(tr);
  });
  populateAdminTimetableSelectors();
}

async function saveTeacher() {
  const name = ($("#teacherName") || { value: "" }).value.trim();
  const subject = ($("#teacherSubject") || { value: "" }).value.trim();
  const btn = $("#teacherSubmitBtn");

  if (!/^[A-Za-z .]+$/.test(name) || name.length < 2) {
    toast("Enter a valid teacher name.", "error");
    return;
  }
  if (!subject) {
    toast("Subject is required.", "error");
    return;
  }

  setBtnLoading(btn, true, "Saving...", editingTeacherId ? "💾 Save Changes" : "➕ Add Teacher");

  if (editingTeacherId) {
    const ok = await dbUpdateTeacher(editingTeacherId, { name, subject });
    if (ok) {
      const idx = _teachers.findIndex(t => t.id === editingTeacherId);
      if (idx > -1) _teachers[idx] = { ..._teachers[idx], name, subject };
      toast("Teacher updated successfully.", "success");
      clearTeacherForm();
    }
  } else {
    const dup = _teachers.find(t => t.name.toLowerCase() === name.toLowerCase());
    if (dup) {
      toast("A teacher with this name already exists.", "error");
      setBtnLoading(btn, false, "", "➕ Add Teacher");
      return;
    }
    const created = await dbInsertTeacher({ name, subject });
    if (created) {
      _teachers.push(created);
      toast("Teacher added successfully.", "success");
      clearTeacherForm();
    }
  }

  setBtnLoading(btn, false, "", "➕ Add Teacher");
  renderTeachers();
  renderDashboardStats();
}

function editTeacher(id) {
  const t = _teachers.find(x => x.id === id);
  if (!t) return;
  editingTeacherId = id;
  const set = (sel, val) => { const el = $(sel); if (el) el.value = val; };
  set("#teacherName", t.name);
  set("#teacherSubject", t.subject || "");
  const btn = $("#teacherSubmitBtn");
  if (btn) btn.textContent = "💾 Save Changes";
  const el = $("#teacherName");
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function deleteTeacher(id) {
  if (!confirm("Are you sure you want to delete this teacher record?")) return;
  const ok = await dbDeleteTeacher(id);
  if (ok) {
    _teachers = _teachers.filter(t => t.id !== id);
    renderTeachers();
    renderDashboardStats();
    toast("Teacher removed successfully.", "info");
  }
}

function clearTeacherForm() {
  ["#teacherName", "#teacherSubject"].forEach(sel => {
    const el = $(sel); if (el) el.value = "";
  });
  editingTeacherId = null;
  const btn = $("#teacherSubmitBtn");
  if (btn) btn.textContent = "➕ Add Teacher";
}

/* ---------- Admin: Classrooms CRUD ---------- */

function badge(bool) {
  return `<span class="badge ${bool ? 'on' : 'off'}">${bool ? 'Yes' : 'No'}</span>`;
}

function renderClassrooms() {
  const tbody = $("#classroomsBody");
  const cardsWrap = $("#classroomCards");

  if (tbody) {
    tbody.innerHTML = _classrooms.length
      ? ""
      : `<tr class="empty-row"><td colspan="8">No classrooms added yet.</td></tr>`;
    _classrooms.forEach(r => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.room}</td>
        <td>${r.capacity}</td>
        <td>${badge(r.smartboard)}</td>
        <td>${badge(r.projector)}</td>
        <td>${badge(r.wifi)}</td>
        <td>${badge(r.ac)}</td>
        <td><span class="badge ${r.status === 'Available' ? 'available' : 'occupied'}">${r.status}</span></td>
        <td>
          <div class="row-actions">
            <button class="icon-btn" title="Toggle Status" onclick="toggleRoomStatus('${r.id}')">🔁</button>
            <button class="icon-btn" title="Edit" onclick="editRoom('${r.id}')">✏️</button>
            <button class="icon-btn del" title="Delete" onclick="deleteRoom('${r.id}')">🗑️</button>
          </div>
        </td>`;
      tbody.appendChild(tr);
    });
  }

  if (cardsWrap) {
    cardsWrap.innerHTML = "";
    _classrooms.forEach(r => {
      const div = document.createElement("div");
      div.className = "card punched";
      div.innerHTML = `
        <h3>🏫 ${r.room} <span class="badge ${r.status === 'Available' ? 'available' : 'occupied'}" style="margin-left:auto;">${r.status}</span></h3>
        <p class="muted">Capacity: ${r.capacity} students</p>
        <div class="tag-row">
          <span class="badge ${r.smartboard ? 'on' : 'off'}">🖥️ Smart Board</span>
          <span class="badge ${r.projector ? 'on' : 'off'}">📽️ Projector</span>
          <span class="badge ${r.wifi ? 'on' : 'off'}">📶 WiFi</span>
          <span class="badge ${r.ac ? 'on' : 'off'}">❄️ AC</span>
        </div>`;
      cardsWrap.appendChild(div);
    });
  }

  populateAdminTimetableSelectors();
}

async function saveRoom() {
  const room = ($("#roomName") || { value: "" }).value.trim();
  const capacity = parseInt(($("#roomCapacity") || { value: "0" }).value, 10) || 0;
  const smartboard = ($("#roomSmartboard") || { checked: false }).checked;
  const projector = ($("#roomProjector") || { checked: false }).checked;
  const wifi = ($("#roomWifi") || { checked: false }).checked;
  const ac = ($("#roomAc") || { checked: false }).checked;
  const status = ($("#roomStatus") || { value: "Available" }).value;
  const btn = $("#roomSubmitBtn");

  if (!room) { toast("Classroom name is required.", "error"); return; }
  if (capacity <= 0) { toast("Please enter a valid room capacity.", "error"); return; }

  setBtnLoading(btn, true, "Saving...", editingRoomId ? "💾 Save Changes" : "➕ Add Classroom");

  if (editingRoomId) {
    const ok = await dbUpdateClassroom(editingRoomId, { room, capacity, smartboard, projector, wifi, ac, status });
    if (ok) {
      const idx = _classrooms.findIndex(r => r.id === editingRoomId);
      if (idx > -1) _classrooms[idx] = { ..._classrooms[idx], room, capacity, smartboard, projector, wifi, ac, status };
      toast("Classroom updated successfully.", "success");
      clearRoomForm();
    }
  } else {
    const dup = _classrooms.find(r => r.room.toLowerCase() === room.toLowerCase());
    if (dup) {
      toast("A classroom with this name already exists.", "error");
      setBtnLoading(btn, false, "", "➕ Add Classroom");
      return;
    }
    const created = await dbInsertClassroom({ room, capacity, smartboard, projector, wifi, ac, status });
    if (created) {
      _classrooms.push(created);
      toast("Classroom added successfully.", "success");
      clearRoomForm();
    }
  }

  setBtnLoading(btn, false, "", "➕ Add Classroom");
  renderClassrooms();
  renderDashboardStats();
}

function editRoom(id) {
  const r = _classrooms.find(x => x.id === id);
  if (!r) return;
  editingRoomId = id;
  const set = (sel, val) => { const el = $(sel); if (el) el.value = val; };
  set("#roomName", r.room);
  set("#roomCapacity", r.capacity);
  set("#roomStatus", r.status);
  const setCk = (sel, val) => { const el = $(sel); if (el) el.checked = val; };
  setCk("#roomSmartboard", r.smartboard);
  setCk("#roomProjector", r.projector);
  setCk("#roomWifi", r.wifi);
  setCk("#roomAc", r.ac);
  const btn = $("#roomSubmitBtn");
  if (btn) btn.textContent = "💾 Save Changes";
  const el = $("#roomName");
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function toggleRoomStatus(id) {
  const r = _classrooms.find(x => x.id === id);
  if (!r) return;
  const newStatus = r.status === "Available" ? "Occupied" : "Available";
  const ok = await dbUpdateClassroom(id, { ...r, status: newStatus });
  if (ok) {
    r.status = newStatus;
    renderClassrooms();
    toast(`Room ${r.room} marked as ${newStatus}.`, "info");
  }
}

async function deleteRoom(id) {
  if (!confirm("Are you sure you want to remove this classroom?")) return;
  const ok = await dbDeleteClassroom(id);
  if (ok) {
    _classrooms = _classrooms.filter(r => r.id !== id);
    renderClassrooms();
    renderDashboardStats();
    toast("Classroom removed successfully.", "info");
  }
}

function clearRoomForm() {
  const set = (sel, val) => { const el = $(sel); if (el) el.value = val; };
  set("#roomName", "");
  set("#roomCapacity", "");
  set("#roomStatus", "Available");
  ["#roomSmartboard", "#roomProjector", "#roomWifi", "#roomAc"].forEach(sel => {
    const el = $(sel); if (el) el.checked = false;
  });
  editingRoomId = null;
  const btn = $("#roomSubmitBtn");
  if (btn) btn.textContent = "➕ Add Classroom";
}

/* ---------- Admin: Full Timetable Management ---------- */

function populateAdminTimetableSelectors() {
  const teacherSel = $("#ttTeacher");
  const roomSel = $("#ttRoom");
  if (!teacherSel || !roomSel) return;

  const teacherNames = Array.from(new Set(_teachers.map(t => t.name))).filter(Boolean);
  teacherSel.innerHTML = teacherNames.length
    ? teacherNames.map(n => `<option value="${n}">${n}</option>`).join("")
    : `<option value="">No teachers registered yet</option>`;

  roomSel.innerHTML = _classrooms.length
    ? _classrooms.map(r => `<option value="${r.room}">${r.room}</option>`).join("")
    : `<option value="">Add a classroom first</option>`;
}

async function adminSaveLecture() {
  const subject = ($("#ttSubject") || { value: "" }).value.trim();
  const teacher = ($("#ttTeacher") || { value: "" }).value;
  const room = ($("#ttRoom") || { value: "" }).value;
  const day = ($("#ttDay") || { value: "Monday" }).value;
  const time = ($("#ttTime") || { value: "" }).value;
  const sem = ($("#ttSem") || { value: "5" }).value;
  const btn = $("#ttSubmitBtn");

  if (!subject) { toast("Please enter a subject.", "error"); return; }
  if (!teacher) { toast("Please select a teacher.", "error"); return; }
  if (!room) { toast("Please select a classroom.", "error"); return; }

  const clash = checkTimetableConflict(day, time, room, teacher, sem, "A", editingAdminLectureId);
  if (clash) {
    toast(clash, "error");
    return;
  }

  setBtnLoading(btn, true, "Saving...", editingAdminLectureId ? "💾 Save Changes" : "➕ Add Lecture");

  if (editingAdminLectureId) {
    const original = _timetable.find(t => t.id === editingAdminLectureId);
    const ok = await dbUpdateTimetable(editingAdminLectureId, { day, time, subject, teacher, room, sem, div: "A" });
    if (ok) {
      const idx = _timetable.findIndex(t => t.id === editingAdminLectureId);
      if (idx > -1) _timetable[idx] = { ..._timetable[idx], day, time, subject, teacher, room, sem, div: "A" };

      if (original) {
        await dbInsertNotification(
          original.teacher,
          `Admin updated your "${original.subject}" lecture (${original.day}, ${original.time}). It is now "${subject}" on ${day} at ${time} in ${room}.`
        );
        if (teacher !== original.teacher) {
          await dbInsertNotification(
            teacher,
            `Admin assigned you a new lecture: "${subject}" on ${day} at ${time} in ${room}.`
          );
        }
      }

      toast("Lecture updated and teacher notified.", "success");
      editingAdminLectureId = null;
      if (btn) btn.textContent = "➕ Add Lecture";
      const el = $("#ttSubject"); if (el) el.value = "";
    }
  } else {
    const created = await dbInsertTimetable({ day, time, subject, teacher, room, sem, div: "A" });
    if (created) {
      _timetable.push(created);
      await dbInsertNotification(
        teacher,
        `Admin scheduled a new lecture for you: "${subject}" on ${day} at ${time} in ${room}.`
      );
      toast("Lecture added and teacher notified.", "success");
      const el = $("#ttSubject"); if (el) el.value = "";
    }
  }

  setBtnLoading(btn, false, "", "➕ Add Lecture");
  renderAdminTimetable();
  renderDashboardStats();
}

function adminEditLecture(id) {
  const t = _timetable.find(x => x.id === id);
  if (!t) return;
  editingAdminLectureId = id;
  const set = (sel, val) => { const el = $(sel); if (el) el.value = val; };
  set("#ttSubject", t.subject);
  set("#ttTeacher", t.teacher);
  set("#ttRoom", t.room);
  set("#ttDay", t.day);
  set("#ttTime", t.time);
  set("#ttSem", t.sem);
  const btn = $("#ttSubmitBtn");
  if (btn) btn.textContent = "💾 Save Changes";
  const el = $("#ttSubject");
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function adminDeleteLecture(id) {
  const t = _timetable.find(x => x.id === id);
  if (!t) return;
  if (!confirm(`Remove ${t.subject} (${t.day}, ${t.time}) from ${t.teacher}'s schedule?`)) return;
  const ok = await dbDeleteTimetable(id);
  if (ok) {
    _timetable = _timetable.filter(x => x.id !== id);
    await dbInsertNotification(
      t.teacher,
      `Admin removed your "${t.subject}" lecture on ${t.day} at ${t.time}.`
    );
    if (editingAdminLectureId === id) {
      editingAdminLectureId = null;
      const btn = $("#ttSubmitBtn");
      if (btn) btn.textContent = "➕ Add Lecture";
    }
    renderAdminTimetable();
    renderDashboardStats();
    toast("Lecture removed and teacher notified.", "info");
  }
}

function renderAdminTimetable() {
  const tbody = $("#adminTimetableBody");
  if (!tbody) return;
  const rows = _timetable.slice().sort((a, b) =>
    DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || SLOTS.indexOf(a.time) - SLOTS.indexOf(b.time)
  );
  tbody.innerHTML = rows.length
    ? ""
    : `<tr class="empty-row"><td colspan="7">No lectures scheduled yet.</td></tr>`;
  rows.forEach(t => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${t.day}</td>
      <td>${t.time}</td>
      <td>${t.subject}</td>
      <td>${t.teacher}</td>
      <td>${t.room}</td>
      <td>Sem ${t.sem}</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" title="Edit" onclick="adminEditLecture('${t.id}')">✏️</button>
          <button class="icon-btn del" title="Delete" onclick="adminDeleteLecture('${t.id}')">🗑️</button>
        </div>
      </td>`;
    tbody.appendChild(tr);
  });
}

/* ================================================================
   10. TEACHER DASHBOARD CONTROLLER
   ================================================================ */

let editingLectureId = null;

function renderClassroomStatusReadOnly(containerId) {
  const wrap = $("#" + containerId);
  if (!wrap) return;
  wrap.innerHTML = _classrooms.length ? "" : `<p class="muted">No classrooms have been added yet.</p>`;
  _classrooms.forEach(r => {
    const div = document.createElement("div");
    div.className = "card punched";
    div.innerHTML = `
      <h3>🏫 ${r.room} <span class="badge ${r.status === 'Available' ? 'available' : 'occupied'}" style="margin-left:auto;">${r.status}</span></h3>
      <p class="muted">Capacity: ${r.capacity} students</p>
      <div class="tag-row">
        <span class="badge ${r.smartboard ? 'on' : 'off'}">🖥️ Smart Board</span>
        <span class="badge ${r.projector ? 'on' : 'off'}">📽️ Projector</span>
        <span class="badge ${r.wifi ? 'on' : 'off'}">📶 WiFi</span>
        <span class="badge ${r.ac ? 'on' : 'off'}">❄️ AC</span>
      </div>`;
    wrap.appendChild(div);
  });
}

function renderTeacherNotifications() {
  const list = $("#notificationsList");
  if (!list) return;
  const user = getCurrentUser();
  if (!user) return;
  const mine = _notifications.filter(n => n.teacher === user.name);
  const unread = mine.filter(n => !n.read).length;

  const badgeEl = $("#unreadBadge");
  if (badgeEl) {
    badgeEl.style.display = unread ? "inline-flex" : "none";
    badgeEl.textContent = `${unread} new`;
  }

  list.innerHTML = mine.length
    ? ""
    : `<p class="muted">No notifications yet. You will receive an alert here when an admin updates your lectures.</p>`;

  mine.forEach(n => {
    const div = document.createElement("div");
    div.className = "notice";
    if (!n.read) div.style.borderLeftColor = "var(--accent-3)";
    const when = new Date(n.created_at || Date.now()).toLocaleString();
    div.innerHTML = `${n.read ? "" : "<b>● New — </b>"}${n.message} <div class="muted" style="margin-top:4px; font-size:.75rem;">${when}</div>`;
    list.appendChild(div);
  });
}

async function markNotificationsRead() {
  const user = getCurrentUser();
  if (!user) return;
  await dbMarkNotificationsRead(user.name);
  _notifications = _notifications.map(n => ({ ...n, read: true }));
  renderTeacherNotifications();
  toast("All notifications marked as read.", "info");
}

function populateTeacherRoomDropdown() {
  const roomSel = $("#room");
  if (!roomSel) return;
  roomSel.innerHTML = _classrooms.length
    ? _classrooms.map(r => `<option value="${r.room}">${r.room}</option>`).join("")
    : `<option value="">Add a classroom in Admin first</option>`;
}

async function saveLecture() {
  const user = getCurrentUser();
  if (!user) return;

  const subject = ($("#subject") || { value: "" }).value.trim();
  const sem = ($("#lecSem") || { value: "5" }).value;
  const div = ($("#lecDiv") || { value: "A" }).value;
  const room = ($("#room") || { value: "" }).value;
  const day = ($("#lecDay") || { value: "Monday" }).value;
  const time = ($("#time") || { value: "" }).value;
  const btn = $("#lectureSubmitBtn");

  if (!subject) { toast("Please enter a subject name.", "error"); return; }
  if (!room) { toast("Please select a classroom.", "error"); return; }

  const clash = checkTimetableConflict(day, time, room, user.name, sem, div, editingLectureId);
  if (clash) {
    toast(clash, "error");
    return;
  }

  setBtnLoading(btn, true, "Scheduling...", editingLectureId ? "💾 Save Changes" : "📌 Add to Timetable");

  if (editingLectureId) {
    const original = _timetable.find(t => t.id === editingLectureId);
    if (!original || original.teacher !== user.name) {
      toast("You are only authorized to edit your own lectures.", "error");
      setBtnLoading(btn, false, "", "📌 Add to Timetable");
      return;
    }

    const ok = await dbUpdateTimetable(editingLectureId, { day, time, subject, teacher: user.name, room, sem, div });
    if (ok) {
      const idx = _timetable.findIndex(t => t.id === editingLectureId);
      if (idx > -1) _timetable[idx] = { ..._timetable[idx], day, time, subject, room, sem, div };
      toast("Lecture updated successfully.", "success");
      editingLectureId = null;
      if (btn) btn.textContent = "📌 Add to Timetable";
      const el = $("#subject"); if (el) el.value = "";
    }
  } else {
    const created = await dbInsertTimetable({ day, time, subject, teacher: user.name, room, sem, div });
    if (created) {
      _timetable.push(created);
      toast("Lecture scheduled successfully!", "success");
      const el = $("#subject"); if (el) el.value = "";
    }
  }

  setBtnLoading(btn, false, "", "📌 Add to Timetable");
  renderTeacherLectures();
  populateTeacherAttendanceLectures();
}

function editLecture(id) {
  const user = getCurrentUser();
  const lecture = _timetable.find(t => t.id === id);
  if (!lecture || lecture.teacher !== user.name) {
    toast("You can only edit your own lectures.", "error");
    return;
  }
  editingLectureId = id;
  const set = (sel, val) => { const el = $(sel); if (el) el.value = val; };
  set("#subject", lecture.subject);
  set("#lecSem", lecture.sem);
  set("#lecDiv", lecture.div);
  set("#room", lecture.room);
  set("#lecDay", lecture.day);
  set("#time", lecture.time);
  const btn = $("#lectureSubmitBtn");
  if (btn) btn.textContent = "💾 Save Changes";
  const el = $("#subject");
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function deleteLecture(id) {
  const user = getCurrentUser();
  const lecture = _timetable.find(t => t.id === id);
  if (!lecture || lecture.teacher !== user.name) {
    toast("You can only delete your own lectures.", "error");
    return;
  }
  if (!confirm(`Delete ${lecture.subject} (${lecture.day} ${lecture.time})?`)) return;
  const ok = await dbDeleteTimetable(id);
  if (ok) {
    _timetable = _timetable.filter(t => t.id !== id);
    if (editingLectureId === id) {
      editingLectureId = null;
      const btn = $("#lectureSubmitBtn");
      if (btn) btn.textContent = "📌 Add to Timetable";
    }
    renderTeacherLectures();
    populateTeacherAttendanceLectures();
    toast("Lecture removed from timetable.", "info");
  }
}

function renderTeacherLectures() {
  const tbody = $("#lectureBody");
  if (!tbody) return;
  const user = getCurrentUser();
  if (!user) return;
  const rows = _timetable.filter(t => t.teacher === user.name);
  tbody.innerHTML = rows.length
    ? ""
    : `<tr class="empty-row"><td colspan="7">No lectures scheduled yet. Add one above or click Generate My AI Timetable.</td></tr>`;
  rows.forEach(t => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${t.day}</td>
      <td>${t.time}</td>
      <td>${t.subject}</td>
      <td>${t.room}</td>
      <td>Sem ${t.sem}</td>
      <td>${t.div || "A"}</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" title="Edit" onclick="editLecture('${t.id}')">✏️</button>
          <button class="icon-btn del" title="Delete" onclick="deleteLecture('${t.id}')">🗑️</button>
        </div>
      </td>`;
    tbody.appendChild(tr);
  });
}

/* ---------- Teacher: Attendance Marking ---------- */

function populateTeacherAttendanceLectures() {
  const sel = $("#attLectureSelect");
  const dateInput = $("#attDate");
  if (!sel) return;
  if (dateInput && !dateInput.value) {
    dateInput.value = todayIsoDate();
  }
  const user = getCurrentUser();
  if (!user) return;
  const myLecs = _timetable.filter(t => t.teacher === user.name);
  sel.innerHTML = myLecs.length
    ? myLecs.map(l => `<option value="${l.id}">${l.subject} (${l.day} ${l.time}) — Sem ${l.sem} ${l.div}</option>`).join("")
    : `<option value="">No lectures scheduled</option>`;
  loadStudentsForAttendance();
}

async function loadStudentsForAttendance() {
  const tbody = $("#attendanceStudentList");
  const sel = $("#attLectureSelect");
  const dateInput = $("#attDate");
  if (!tbody || !sel) return;

  const ttId = sel.value;
  const date = dateInput ? dateInput.value : todayIsoDate();

  if (!ttId) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="4">No lecture selected.</td></tr>`;
    return;
  }

  const lecture = _timetable.find(t => t.id === ttId);
  const matchingStudents = _students.filter(s =>
    (!lecture.sem || String(s.sem) === String(lecture.sem)) &&
    (!lecture.div || s.div.toUpperCase() === lecture.div.toUpperCase())
  );

  if (!matchingStudents.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="4">No students enrolled in Semester ${lecture ? lecture.sem : "—"} Division ${lecture ? lecture.div : "—"}.</td></tr>`;
    return;
  }

  const existingRecords = await fetchLectureAttendance(ttId, date);
  const statusMap = {};
  existingRecords.forEach(r => {
    statusMap[r.student_id] = r.status;
  });

  tbody.innerHTML = "";
  matchingStudents.forEach(s => {
    const curStatus = statusMap[s.id] || "present";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><b>${s.roll_no || s.roll || ""}</b></td>
      <td>${s.name}</td>
      <td>${s.dept || "—"} / ${s.div || "A"}</td>
      <td>
        <label style="margin-right:12px; cursor:pointer;">
          <input type="radio" name="att_${s.id}" value="present" ${curStatus === "present" ? "checked" : ""}> Present
        </label>
        <label style="cursor:pointer; color:var(--accent-3);">
          <input type="radio" name="att_${s.id}" value="absent" ${curStatus === "absent" ? "checked" : ""}> Absent
        </label>
      </td>`;
    tbody.appendChild(tr);
  });
}

async function saveClassAttendance() {
  const sel = $("#attLectureSelect");
  const dateInput = $("#attDate");
  const btn = $("#saveAttendanceBtn");
  if (!sel || !sel.value) {
    toast("Please select a lecture to mark attendance.", "error");
    return;
  }

  const ttId = sel.value;
  const date = dateInput ? dateInput.value : todayIsoDate();
  const lecture = _timetable.find(t => t.id === ttId);

  const matchingStudents = _students.filter(s =>
    (!lecture.sem || String(s.sem) === String(lecture.sem)) &&
    (!lecture.div || s.div.toUpperCase() === lecture.div.toUpperCase())
  );

  if (!matchingStudents.length) {
    toast("No students to submit attendance for.", "error");
    return;
  }

  setBtnLoading(btn, true, "Saving...", "💾 Submit Attendance");

  const records = [];
  matchingStudents.forEach(s => {
    const selectedRadio = $(`input[name="att_${s.id}"]:checked`);
    const status = selectedRadio ? selectedRadio.value : "present";
    records.push({
      student_id: s.id,
      timetable_id: ttId,
      attendance_date: date,
      status
    });
  });

  const ok = await dbSaveAttendanceRecords(records);
  setBtnLoading(btn, false, "", "💾 Submit Attendance");

  if (ok) {
    toast(`Attendance saved for ${records.length} students on ${date}.`, "success");
  }
}

/* ================================================================
   11. STUDENT DASHBOARD CONTROLLER
   ================================================================ */

async function renderStudentAttendanceStats() {
  const user = getCurrentUser();
  if (!user) return;

  const bar = $("#studentAttendanceBar");
  const sub = $("#studentAttendanceSub");
  const warning = $("#attendanceWarning");
  if (!bar || !sub) return;

  const studentRec = _students.find(s =>
    (user.rollno && (s.roll_no === user.rollno || s.roll === user.rollno)) ||
    s.name === user.name
  );

  const sId = studentRec ? studentRec.id : null;
  const records = await fetchStudentAttendance(sId, user.rollno);

  const total = records.length;
  const present = records.filter(r => r.status === "present").length;
  const pct = total > 0 ? Math.round((present / total) * 100) : 100;

  bar.style.width = `${pct}%`;
  bar.textContent = `${pct}%`;
  sub.textContent = total > 0
    ? `Based on ${present} of ${total} recorded classes attended this semester.`
    : `No classes recorded yet this semester (100% baseline).`;

  if (warning) {
    if (total > 0 && pct < 75) {
      warning.style.display = "block";
      warning.textContent = `⚠️ Warning: Your attendance is currently ${pct}% (below mandatory 75% requirement).`;
    } else {
      warning.style.display = "none";
    }
  }
}

function renderStudentTimetable() {
  const tbody = $("#studentTodayBody");
  if (!tbody) return;
  const user = getCurrentUser();
  const day = todayName();
  const lbl = $("#todayLabel");
  if (lbl) lbl.textContent = day;

  let rows = _timetable.filter(t => t.day === day);
  if (user && user.sem) {
    rows = rows.filter(t => !t.sem || String(t.sem) === String(user.sem));
  }
  rows.sort((a, b) => SLOTS.indexOf(a.time) - SLOTS.indexOf(b.time));

  tbody.innerHTML = rows.length
    ? ""
    : `<tr class="empty-row"><td colspan="3">No lectures scheduled for today.</td></tr>`;

  rows.forEach(t => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${t.time}</td><td>${t.subject}</td><td>${t.room}</td>`;
    tbody.appendChild(tr);
  });
}

function searchStudentTimetable() {
  const q = (($("#studentSearch") || { value: "" }).value).trim().toLowerCase();
  const tbody = $("#studentSearchBody");
  if (!tbody) return;

  const rows = _timetable.filter(t =>
    t.subject.toLowerCase().includes(q) ||
    t.day.toLowerCase().includes(q) ||
    t.teacher.toLowerCase().includes(q) ||
    t.room.toLowerCase().includes(q)
  );

  tbody.innerHTML = rows.length
    ? ""
    : `<tr class="empty-row"><td colspan="5">No matching classes found.</td></tr>`;

  rows.forEach(t => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${t.day}</td><td>${t.time}</td><td>${t.subject}</td><td>${t.teacher}</td><td>${t.room}</td>`;
    tbody.appendChild(tr);
  });
}

/* ================================================================
   12. FULL TIMETABLE PAGE CONTROLLER
   ================================================================ */

function renderFullTimetable(filter) {
  const grid = $("#fullTimetableGrid");
  if (!grid) return;
  const query = (filter || "").trim().toLowerCase();

  let html = `<div class="tt-cell head">Time</div>`;
  DAYS.forEach(d => { html += `<div class="tt-cell head">${d}</div>`; });

  SLOTS.forEach(time => {
    html += `<div class="tt-cell time">${time}</div>`;
    DAYS.forEach(day => {
      const entry = _timetable.find(t => t.day === day && t.time === time);
      if (!entry) {
        html += `<div class="tt-cell slot empty">Free</div>`;
        return;
      }
      const matches = query && (
        entry.subject.toLowerCase().includes(query) ||
        entry.teacher.toLowerCase().includes(query) ||
        entry.room.toLowerCase().includes(query) ||
        day.toLowerCase().includes(query)
      );
      html += `
        <div class="tt-cell slot ${matches ? 'match' : ''}">
          <span class="subj">${entry.subject}</span>
          <span class="meta">${entry.teacher} · ${entry.room}</span>
        </div>`;
    });
  });

  grid.innerHTML = html;
}

function searchFullTimetable() {
  const q = ($("#ttSearch") || { value: "" }).value;
  renderFullTimetable(q);
}

/* ================================================================
   13. HERO MINI TIMETABLE ANIMATION
   ================================================================ */

function renderMiniTimetable() {
  const grid = $("#miniGrid");
  if (!grid) return;
  const shortDays = ["MON", "TUE", "WED", "THU", "FRI"];
  let html = `<div class="cell head">TIME</div>`;
  shortDays.forEach(d => { html += `<div class="cell head">${d}</div>`; });
  for (let r = 0; r < 4; r++) {
    html += `<div class="cell">P${r + 1}</div>`;
    for (let c = 0; c < 5; c++) html += `<div class="cell" data-r="${r}" data-c="${c}">·</div>`;
  }
  grid.innerHTML = html;
  const cells = $$(".cell[data-r]", grid);
  let i = 0;
  const fill = () => {
    if (i >= cells.length) return;
    const cell = cells[i];
    if (Math.random() < 0.8) {
      cell.textContent = SUBJECT_POOL[Math.floor(Math.random() * SUBJECT_POOL.length)].split(" ")[0];
      cell.classList.add("filled");
    }
    i++;
    setTimeout(fill, 80);
  };
  fill();
}

/* ================================================================
   14. ACTIVE NAVIGATION & NOTIFICATION BELL
   ================================================================ */

function markActiveNav() {
  const page = document.body.dataset.page;
  $$(".nav-links a").forEach(a => {
    if (a.dataset.nav === page) a.classList.add("active");
  });
}

/* ================================================================
   15. APPLICATION LIFECYCLE DISPATCHER
   ================================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  initTheme();
  markActiveNav();

  const themeBtn = $("#themeToggle");
  if (themeBtn) themeBtn.addEventListener("click", toggleTheme);

  const page = document.body.dataset.page;

  // Initialize Realtime Sync
  initRealtimeSubscriptions();

  /* ---------- HOME PAGE ---------- */
  if (page === "home") {
    renderMiniTimetable();
    const client = sb();
    if (client) {
      const { data: { session } } = await client.auth.getSession();
      if (session) {
        const user = await fetchUserProfile(session.user.id);
        const role = user ? user.role : (session.user.user_metadata?.role || "student");
        const dashBtn = $("#dashboardBtn");
        if (dashBtn) {
          dashBtn.style.display = "inline-flex";
          dashBtn.setAttribute(
            "href",
            role === "admin" ? "admin.html" : role === "teacher" ? "teacher.html" : "student.html"
          );
        }
        if (role === "teacher") {
          const bell = $("#notifBell");
          const dot = $("#notifDot");
          if (bell) bell.style.display = "inline-flex";
          fetchNotifications(user ? user.full_name : "").then(notes => {
            const unread = notes.filter(n => !n.read).length;
            if (dot) dot.style.display = unread > 0 ? "block" : "none";
          });
        }
      }
    }
  }

  /* ---------- LOGIN PAGE ---------- */
  if (page === "login") {
    const client = sb();
    if (client) {
      const { data: { session } } = await client.auth.getSession().catch(() => ({ data: { session: null } }));
      if (session) {
        const profile = await fetchUserProfile(session.user.id);
        const role = profile ? profile.role : (session.user.user_metadata?.role || "student");
        if (role === "admin") window.location.href = "admin.html";
        else if (role === "teacher") window.location.href = "teacher.html";
        else window.location.href = "student.html";
      }
    }
  }

  /* ---------- ADMIN PAGE ---------- */
  if (page === "admin") {
    const user = await requireAuth(["admin"]);
    if (!user) return;
    const nd = $("#adminNameDisplay");
    if (nd) nd.textContent = user.name;

    await loadAllData();
    renderDashboardStats();
    renderStudents();
    renderTeachers();
    renderClassrooms();
    renderAdminTimetable();
  }

  /* ---------- TEACHER PAGE ---------- */
  if (page === "teacher") {
    const user = await requireAuth(["teacher"]);
    if (!user) return;
    const nd = $("#teacherNameDisplay"); if (nd) nd.textContent = user.name;
    const pn = $("#profileName"); if (pn) pn.textContent = user.name;

    await loadAllData();
    populateTeacherRoomDropdown();
    _notifications = await fetchNotifications(user.name);

    renderTeacherLectures();
    renderTeacherNotifications();
    populateTeacherAttendanceLectures();
    renderClassroomStatusReadOnly("teacherClassroomStatus");
  }

  /* ---------- STUDENT PAGE ---------- */
  if (page === "student") {
    const user = await requireAuth(["student"]);
    if (!user) return;
    const nd = $("#studentNameDisplay"); if (nd) nd.textContent = user.name;
    const pn = $("#profileName"); if (pn) pn.textContent = user.name;
    const pr = $("#profileRoll"); if (pr) pr.textContent = user.rollno || "—";

    await loadAllData();
    renderStudentTimetable();
    searchStudentTimetable();
    renderStudentAttendanceStats();
    renderClassroomStatusReadOnly("studentClassroomStatus");
  }

  /* ---------- TIMETABLE PAGE ---------- */
  if (page === "timetable") {
    await loadAllData();
    const client = sb();
    if (client) {
      const { data: { session } } = await client.auth.getSession();
      if (session) {
        const user = await fetchUserProfile(session.user.id);
        _currentUser = user;
        renderUserChip();
        const btn = $("#regenerateBtn");
        if (btn && user && user.role === "admin") {
          btn.style.display = "inline-flex";
          const hint = $("#editHint");
          if (hint) {
            hint.textContent = "You're signed in as admin — regenerating rebuilds the entire college schedule and notifies teachers.";
          }
        }
      }
    }
    renderFullTimetable();
  }

  /* ---------- NOTIFICATIONS PAGE ---------- */
  if (page === "notifications") {
    const user = await requireAuth(["teacher"]);
    if (!user) return;
    _notifications = await fetchNotifications(user.name);
    if (typeof renderLog === "function") {
      renderLog("all");
    }
  }
});
