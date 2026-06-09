-- SQL Migration Script for MRDU Portal
-- Run this script in the Supabase SQL Editor (https://supabase.com)

-- 1. Create marketplace table
CREATE TABLE IF NOT EXISTS public.marketplace (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  price NUMERIC NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  image TEXT,
  "sellerRollNumber" TEXT NOT NULL,
  contact TEXT NOT NULL,
  "isAvailable" BOOLEAN DEFAULT true,
  "createdAt" BIGINT DEFAULT extract(epoch from now()) * 1000
);

-- 2. Create courses table
CREATE TABLE IF NOT EXISTS public.courses (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  price NUMERIC DEFAULT 0,
  content TEXT[] DEFAULT '{}',
  "instructorRollNumber" TEXT NOT NULL,
  "createdAt" BIGINT DEFAULT extract(epoch from now()) * 1000,
  contact TEXT
);

-- 3. Create enrollments table
CREATE TABLE IF NOT EXISTS public.enrollments (
  "courseId" TEXT NOT NULL,
  "studentRollNumber" TEXT NOT NULL,
  "enrolledAt" BIGINT DEFAULT extract(epoch from now()) * 1000,
  PRIMARY KEY ("courseId", "studentRollNumber")
);

-- 4. Create promotions (Campus Feed) table
CREATE TABLE IF NOT EXISTS public.promotions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  "eventDate" TEXT,
  image TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" BIGINT DEFAULT extract(epoch from now()) * 1000,
  contact TEXT
);

-- 5. Create services table
CREATE TABLE IF NOT EXISTS public.services (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  price NUMERIC NOT NULL,
  category TEXT NOT NULL,
  "providerRollNumber" TEXT NOT NULL,
  contact TEXT NOT NULL,
  "isAvailable" BOOLEAN DEFAULT true,
  "createdAt" BIGINT DEFAULT extract(epoch from now()) * 1000
);

-- 6. Create requests table
CREATE TABLE IF NOT EXISTS public.requests (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  contact TEXT NOT NULL,
  "requireApproval" BOOLEAN DEFAULT true,
  "requestedBy" TEXT NOT NULL,
  "createdAt" BIGINT DEFAULT extract(epoch from now()) * 1000,
  "isActive" BOOLEAN DEFAULT true,
  "isResolved" BOOLEAN DEFAULT false
);

-- 7. Create contact_requests table
CREATE TABLE IF NOT EXISTS public.contact_requests (
  id TEXT PRIMARY KEY,
  "targetId" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "itemName" TEXT NOT NULL,
  "buyerRollNumber" TEXT NOT NULL,
  "sellerRollNumber" TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  "createdAt" BIGINT DEFAULT extract(epoch from now()) * 1000
);

-- Enable Row Level Security (RLS) on all tables
ALTER TABLE public.marketplace ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_requests ENABLE ROW LEVEL SECURITY;

-- Configure permissive RLS Policies (Allows all reads and writes for authorized frontend users)
CREATE POLICY "Allow all select" ON public.marketplace FOR SELECT USING (true);
CREATE POLICY "Allow all insert" ON public.marketplace FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update" ON public.marketplace FOR UPDATE USING (true);
CREATE POLICY "Allow all delete" ON public.marketplace FOR DELETE USING (true);

CREATE POLICY "Allow all select" ON public.courses FOR SELECT USING (true);
CREATE POLICY "Allow all insert" ON public.courses FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update" ON public.courses FOR UPDATE USING (true);
CREATE POLICY "Allow all delete" ON public.courses FOR DELETE USING (true);

CREATE POLICY "Allow all select" ON public.enrollments FOR SELECT USING (true);
CREATE POLICY "Allow all insert" ON public.enrollments FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update" ON public.enrollments FOR UPDATE USING (true);
CREATE POLICY "Allow all delete" ON public.enrollments FOR DELETE USING (true);

CREATE POLICY "Allow all select" ON public.promotions FOR SELECT USING (true);
CREATE POLICY "Allow all insert" ON public.promotions FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update" ON public.promotions FOR UPDATE USING (true);
CREATE POLICY "Allow all delete" ON public.promotions FOR DELETE USING (true);

CREATE POLICY "Allow all select" ON public.services FOR SELECT USING (true);
CREATE POLICY "Allow all insert" ON public.services FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update" ON public.services FOR UPDATE USING (true);
CREATE POLICY "Allow all delete" ON public.services FOR DELETE USING (true);

CREATE POLICY "Allow all select" ON public.requests FOR SELECT USING (true);
CREATE POLICY "Allow all insert" ON public.requests FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update" ON public.requests FOR UPDATE USING (true);
CREATE POLICY "Allow all delete" ON public.requests FOR DELETE USING (true);

CREATE POLICY "Allow all select" ON public.contact_requests FOR SELECT USING (true);
CREATE POLICY "Allow all insert" ON public.contact_requests FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update" ON public.contact_requests FOR UPDATE USING (true);
CREATE POLICY "Allow all delete" ON public.contact_requests FOR DELETE USING (true);
