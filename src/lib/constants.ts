// Centralized Application Identity & Configuration (Temporary name configurable here)
export const APP_CONFIG = {
  name: "MentorBridge",
  shortName: "CSE MentorNet",
  department: "Department of Computer Science & Engineering",
  institution: "College of Engineering & Technology",
  accreditation: "ABET Accredited Program • Criterion 3 & 5 Compliance",
  academicYear: "AY 2024–25 • Semester VI (Spring)",
  activeSprint: "Sprint 8 of 14",
  systemStatus: "SSO Gateway Active",
  supportEmail: "sysadmin@cse.edu",
  helpdeskRoom: "Turing Hall, Room 304B",
  helpdeskExt: "x4892 (CSE-TECH)",
  helpdeskHours: "08:30 – 17:00 EST (M-F)",
  version: "0.1.0-alpha (Phase 1 Prototype)",
} as const;

export const ROLES = {
  MENTOR: 'mentor',
  STUDENT: 'student',
  ADMIN: 'admin',
} as const;

export type UserRole = typeof ROLES[keyof typeof ROLES];

