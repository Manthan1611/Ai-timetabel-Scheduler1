-- =========================================================
-- Smart Classroom & AI Timetable Scheduler — schema.sql
-- PostgreSQL Schema for Supabase (Idempotent / Safe to Re-run)
-- =========================================================

-- Enable pgcrypto for UUID generation if needed
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------
-- 1. PROFILES TABLE
-- Stores authenticated user's application-level information.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE,
  role TEXT NOT NULL CHECK(role IN ('admin', 'teacher', 'student')),
  mobile TEXT,
  address TEXT,
  roll_no TEXT,
  department TEXT DEFAULT 'Information Technology',
  semester TEXT DEFAULT '1',
  division TEXT DEFAULT 'A',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------
-- 2. STUDENTS TABLE
-- Stores student directory records.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  roll_no TEXT UNIQUE NOT NULL,
  dept TEXT DEFAULT 'Information Technology',
  sem TEXT DEFAULT '1',
  div TEXT DEFAULT 'A',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------
-- 3. TEACHERS TABLE
-- Stores teacher directory records.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT,
  subject TEXT DEFAULT '—',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------
-- 4. CLASSROOMS TABLE
-- Stores classroom facilities, capacity and live status.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.classrooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room TEXT UNIQUE NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 60,
  smartboard BOOLEAN DEFAULT FALSE,
  projector BOOLEAN DEFAULT FALSE,
  wifi BOOLEAN DEFAULT FALSE,
  ac BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'Available' CHECK(status IN ('Available', 'Occupied')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------
-- 5. TIMETABLE TABLE
-- Stores college timetable slots.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.timetable (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day TEXT NOT NULL CHECK(day IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday')),
  time TEXT NOT NULL CHECK(time IN ('09:00 - 10:00', '10:00 - 11:00', '11:15 - 12:15', '01:00 - 02:00', '02:00 - 03:00')),
  subject TEXT NOT NULL,
  teacher TEXT NOT NULL,
  teacher_id UUID REFERENCES public.teachers(id) ON DELETE SET NULL,
  room TEXT NOT NULL,
  classroom_id UUID REFERENCES public.classrooms(id) ON DELETE SET NULL,
  sem TEXT DEFAULT '5',
  div TEXT DEFAULT 'A',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------
-- 6. ATTENDANCE TABLE
-- Tracks student attendance per lecture and date.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
  timetable_id UUID REFERENCES public.timetable(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL CHECK(status IN ('present', 'absent')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_student_lecture_date UNIQUE (student_id, timetable_id, attendance_date)
);

-- ---------------------------------------------------------
-- 7. NOTIFICATIONS TABLE
-- Stores teacher-facing notifications for timetable changes.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher TEXT NOT NULL,
  teacher_id UUID REFERENCES public.teachers(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------
-- 8. INDEXES FOR PERFORMANCE
-- ---------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_timetable_day_time ON public.timetable(day, time);
CREATE INDEX IF NOT EXISTS idx_timetable_room ON public.timetable(room);
CREATE INDEX IF NOT EXISTS idx_timetable_teacher ON public.timetable(teacher);
CREATE INDEX IF NOT EXISTS idx_timetable_sem_div ON public.timetable(sem, div);
CREATE INDEX IF NOT EXISTS idx_attendance_student ON public.attendance(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_timetable ON public.attendance(timetable_id);
CREATE INDEX IF NOT EXISTS idx_notifications_teacher ON public.notifications(teacher);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications(teacher, read);

-- ---------------------------------------------------------
-- 9. SERVER-SIDE TIMETABLE CONFLICT VALIDATION FUNCTION & TRIGGER
-- Ensures no room, teacher, or division clash can ever bypass UI.
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_timetable_conflict()
RETURNS TRIGGER AS $$
BEGIN
  -- 1. Check Room Conflict
  IF EXISTS (
    SELECT 1 FROM public.timetable
    WHERE day = NEW.day
      AND time = NEW.time
      AND room = NEW.room
      AND (NEW.id IS NULL OR id <> NEW.id)
  ) THEN
    RAISE EXCEPTION 'Room conflict: Room "%" is already booked on % at %.', NEW.room, NEW.day, NEW.time;
  END IF;

  -- 2. Check Teacher Conflict
  IF EXISTS (
    SELECT 1 FROM public.timetable
    WHERE day = NEW.day
      AND time = NEW.time
      AND teacher = NEW.teacher
      AND (NEW.id IS NULL OR id <> NEW.id)
  ) THEN
    RAISE EXCEPTION 'Teacher conflict: "%" is already scheduled on % at %.', NEW.teacher, NEW.day, NEW.time;
  END IF;

  -- 3. Check Division Conflict
  IF EXISTS (
    SELECT 1 FROM public.timetable
    WHERE day = NEW.day
      AND time = NEW.time
      AND sem = NEW.sem
      AND div = NEW.div
      AND (NEW.id IS NULL OR id <> NEW.id)
  ) THEN
    RAISE EXCEPTION 'Division conflict: Semester % Division % already has a lecture on % at %.', NEW.sem, NEW.div, NEW.day, NEW.time;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_timetable_conflict ON public.timetable;
CREATE TRIGGER trg_validate_timetable_conflict
BEFORE INSERT OR UPDATE ON public.timetable
FOR EACH ROW EXECUTE FUNCTION public.validate_timetable_conflict();

-- ---------------------------------------------------------
-- 10. AUTH TRIGGER: handle_new_user()
-- Automatically creates profile & student/teacher record upon signup.
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_role TEXT;
  v_full_name TEXT;
  v_mobile TEXT;
  v_address TEXT;
  v_rollno TEXT;
  v_dept TEXT;
  v_sem TEXT;
  v_div TEXT;
BEGIN
  v_role      := COALESCE(NEW.raw_user_meta_data->>'role', 'student');
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1));
  v_mobile    := NEW.raw_user_meta_data->>'mobile';
  v_address   := NEW.raw_user_meta_data->>'address';
  v_rollno    := NEW.raw_user_meta_data->>'rollno';
  v_dept      := COALESCE(NEW.raw_user_meta_data->>'department', 'Information Technology');
  v_sem       := COALESCE(NEW.raw_user_meta_data->>'semester', '1');
  v_div       := COALESCE(NEW.raw_user_meta_data->>'division', 'A');

  -- Insert profile
  INSERT INTO public.profiles (id, full_name, email, role, mobile, address, roll_no, department, semester, division)
  VALUES (NEW.id, v_full_name, NEW.email, v_role, v_mobile, v_address, v_rollno, v_dept, v_sem, v_div)
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    role = EXCLUDED.role,
    mobile = EXCLUDED.mobile,
    address = EXCLUDED.address,
    roll_no = EXCLUDED.roll_no;

  -- If Student, create/sync students table record
  IF v_role = 'student' AND v_rollno IS NOT NULL AND v_rollno <> '' THEN
    INSERT INTO public.students (user_id, name, roll_no, dept, sem, div)
    VALUES (NEW.id, v_full_name, v_rollno, v_dept, v_sem, v_div)
    ON CONFLICT (roll_no) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      name = EXCLUDED.name,
      dept = EXCLUDED.dept,
      sem = EXCLUDED.sem,
      div = EXCLUDED.div;
  END IF;

  -- If Teacher, create/sync teachers table record
  IF v_role = 'teacher' THEN
    IF NOT EXISTS (SELECT 1 FROM public.teachers WHERE email = NEW.email OR name = v_full_name) THEN
      INSERT INTO public.teachers (user_id, name, email, subject)
      VALUES (NEW.id, v_full_name, NEW.email, COALESCE(NEW.raw_user_meta_data->>'subject', '—'));
    ELSE
      UPDATE public.teachers
      SET user_id = NEW.id, email = NEW.email
      WHERE email = NEW.email OR name = v_full_name;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------
-- 11. ROW LEVEL SECURITY (RLS) POLICIES
-- ---------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classrooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timetable ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Helper function: check if caller is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function: get caller role
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  RETURN v_role;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Profiles Policies
DROP POLICY IF EXISTS "Public & Authenticated can view profiles" ON public.profiles;
CREATE POLICY "Public & Authenticated can view profiles"
  ON public.profiles FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Admin full manage profiles" ON public.profiles;
CREATE POLICY "Admin full manage profiles"
  ON public.profiles FOR ALL
  USING (public.is_admin());

-- Students Policies
DROP POLICY IF EXISTS "Anyone can view students" ON public.students;
CREATE POLICY "Anyone can view students"
  ON public.students FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admin manage students" ON public.students;
CREATE POLICY "Admin manage students"
  ON public.students FOR ALL
  USING (public.is_admin() OR auth.role() = 'anon');

DROP POLICY IF EXISTS "Authenticated users insert student on register" ON public.students;
CREATE POLICY "Authenticated users insert student on register"
  ON public.students FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Students update own record" ON public.students;
CREATE POLICY "Students update own record"
  ON public.students FOR UPDATE
  USING (user_id = auth.uid() OR public.is_admin());

-- Teachers Policies
DROP POLICY IF EXISTS "Anyone can view teachers" ON public.teachers;
CREATE POLICY "Anyone can view teachers"
  ON public.teachers FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admin manage teachers" ON public.teachers;
CREATE POLICY "Admin manage teachers"
  ON public.teachers FOR ALL
  USING (public.is_admin() OR auth.role() = 'anon');

DROP POLICY IF EXISTS "Teachers can update own record" ON public.teachers;
CREATE POLICY "Teachers can update own record"
  ON public.teachers FOR UPDATE
  USING (user_id = auth.uid() OR public.is_admin());

-- Classrooms Policies
DROP POLICY IF EXISTS "Anyone can view classrooms" ON public.classrooms;
CREATE POLICY "Anyone can view classrooms"
  ON public.classrooms FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admin manage classrooms" ON public.classrooms;
CREATE POLICY "Admin manage classrooms"
  ON public.classrooms FOR ALL
  USING (public.is_admin() OR auth.role() = 'anon');

-- Timetable Policies
DROP POLICY IF EXISTS "Anyone can view timetable" ON public.timetable;
CREATE POLICY "Anyone can view timetable"
  ON public.timetable FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admin full timetable manage" ON public.timetable;
CREATE POLICY "Admin full timetable manage"
  ON public.timetable FOR ALL
  USING (public.is_admin() OR auth.role() = 'anon');

DROP POLICY IF EXISTS "Teachers can insert lectures" ON public.timetable;
CREATE POLICY "Teachers can insert lectures"
  ON public.timetable FOR INSERT
  WITH CHECK (
    public.is_admin() OR
    public.get_user_role() = 'teacher' OR
    auth.role() = 'anon'
  );

DROP POLICY IF EXISTS "Teachers can update own lectures" ON public.timetable;
CREATE POLICY "Teachers can update own lectures"
  ON public.timetable FOR UPDATE
  USING (
    public.is_admin() OR
    teacher = (SELECT full_name FROM public.profiles WHERE id = auth.uid()) OR
    created_by = auth.uid() OR
    auth.role() = 'anon'
  );

DROP POLICY IF EXISTS "Teachers can delete own lectures" ON public.timetable;
CREATE POLICY "Teachers can delete own lectures"
  ON public.timetable FOR DELETE
  USING (
    public.is_admin() OR
    teacher = (SELECT full_name FROM public.profiles WHERE id = auth.uid()) OR
    created_by = auth.uid() OR
    auth.role() = 'anon'
  );

-- Attendance Policies
DROP POLICY IF EXISTS "Anyone authenticated can view attendance" ON public.attendance;
CREATE POLICY "Anyone authenticated can view attendance"
  ON public.attendance FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Teachers and Admin can mark attendance" ON public.attendance;
CREATE POLICY "Teachers and Admin can mark attendance"
  ON public.attendance FOR ALL
  USING (
    public.is_admin() OR
    public.get_user_role() = 'teacher' OR
    auth.role() = 'anon'
  );

-- Notifications Policies
DROP POLICY IF EXISTS "Teachers can view own notifications" ON public.notifications;
CREATE POLICY "Teachers can view own notifications"
  ON public.notifications FOR SELECT
  USING (
    public.is_admin() OR
    teacher = (SELECT full_name FROM public.profiles WHERE id = auth.uid()) OR
    auth.role() = 'anon'
  );

DROP POLICY IF EXISTS "Admins and teachers can insert notifications" ON public.notifications;
CREATE POLICY "Admins and teachers can insert notifications"
  ON public.notifications FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Teachers can update (mark read) own notifications" ON public.notifications;
CREATE POLICY "Teachers can update (mark read) own notifications"
  ON public.notifications FOR UPDATE
  USING (
    public.is_admin() OR
    teacher = (SELECT full_name FROM public.profiles WHERE id = auth.uid()) OR
    auth.role() = 'anon'
  );

DROP POLICY IF EXISTS "Teachers can delete (clear) own notifications" ON public.notifications;
CREATE POLICY "Teachers can delete (clear) own notifications"
  ON public.notifications FOR DELETE
  USING (
    public.is_admin() OR
    teacher = (SELECT full_name FROM public.profiles WHERE id = auth.uid()) OR
    auth.role() = 'anon'
  );

-- ---------------------------------------------------------
-- 12. REALTIME PUBLICATION ENABLEMENT (Safe Block)
-- ---------------------------------------------------------
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.timetable;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.classrooms;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.students;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.teachers;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ---------------------------------------------------------
-- 13. SEED DEFAULT DATA
-- (Classrooms, initial sample teachers & students if not existing)
-- ---------------------------------------------------------
INSERT INTO public.classrooms (room, capacity, smartboard, projector, wifi, ac, status) VALUES
  ('Room 101', 60, true, true, true, true, 'Available'),
  ('Room 102', 60, true, true, true, false, 'Available'),
  ('Room 203', 45, false, true, true, true, 'Available'),
  ('Lab A', 30, true, true, true, true, 'Occupied'),
  ('Lab B', 30, true, true, true, false, 'Available'),
  ('Seminar Hall', 120, true, true, true, true, 'Available')
ON CONFLICT (room) DO NOTHING;

INSERT INTO public.teachers (name, subject, email) VALUES
  ('Dr. Sanjay Rao', 'Machine Learning', 'sanjay.rao@college.edu'),
  ('Prof. Ananya Sen', 'Python Programming', 'ananya.sen@college.edu'),
  ('Dr. Rajesh Verma', 'Operating Systems', 'rajesh.verma@college.edu'),
  ('Prof. Meera Kulkarni', 'Database Systems', 'meera.k@college.edu')
ON CONFLICT DO NOTHING;

INSERT INTO public.students (name, roll_no, dept, sem, div) VALUES
  ('Aarav Mehta', '24IT001', 'Information Technology', '5', 'A'),
  ('Riya Sharma', '24IT002', 'Information Technology', '5', 'A'),
  ('Rohan Gupta', '24IT003', 'Information Technology', '5', 'A'),
  ('Sneha Patil', '24IT004', 'Information Technology', '5', 'A')
ON CONFLICT (roll_no) DO NOTHING;
