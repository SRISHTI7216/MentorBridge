# MentorBridge — CSE Mentor–Mentee Development Platform

A college-level Computer Science & Engineering development and mentorship platform connecting faculty advisors with student cohorts for continuous ABET performance tracking, weekly code reviews, technical learning modules, and placement preparation.

## Stack Overview
- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS
- **Design System:** Stitch MCP **Academic Nexus** (Plus Jakarta Sans, Inter, JetBrains Mono, Indigo/Sky/Emerald palettes)
- **Backend API:** Node.js, Express, TypeScript (`server/`)
- **Database & Auth (Phase 2):** Supabase PostgreSQL, Supabase Auth
- **AI Engine (Phase 2):** OpenRouter API through backend

---

## Implemented Architecture & Routes (Phase 1)

### Common Authentication
- `/login` — Institutional SAML/SSO Authentication with role switcher (Student, Faculty Mentor, Coordinator), interactive state engine (Default, Active, Validation Error, Loading), and pipeline infographic.
- `/forgot-password` — Account Recovery & Password Reset gate with 3-stage progress indicators and campus helpdesk directory.

### Faculty Mentor Routes (`/mentor/*`)
- `/mentor/dashboard` — Faculty overview with 4 KPI metrics, weekly performance trajectory SVG chart, competency breakdown bars, and targeted support queue.
- `/mentor/mentees` — Mentee cohort directory with status filtering (Excelling, On Track, Needs Attention), DSA scores, attendance, and 1:1 review logs.
- `/mentor/assessments` — Assessment & rubric management with rubrics, cohort submission statistics, and assessment authoring dialog.
- `/mentor/reports` — ABET Criterion 3 outcome analytics, psychometric distribution bell curve, and report export simulation.
- `/mentor/learning` — Curricular learning modules and weekly sprint milestones.
- `/mentor/rankings` — Standardized cohort standings and leaderboard.
- `/mentor/coding` — Coding practice problem sheets, acceptance rates, and GitSync review tools.
- `/mentor/settings` — Faculty advisor profile, office hours, and notification channels.

### Student Routes (`/student/*`)
- `/student/dashboard` — Student development dashboard with sprint tracking, pending deliverables, and DSA placement breakdown (Easy/Medium/Hard).
- `/student/assessments` — My Assessments list and proctored examination interface preview modal.
- `/student/reports` — Personal academic and skill radar matrices mapped against ABET standards.
- `/student/learning` — Technical learning curriculum with lesson progress.
- `/student/certificates` — Institutional certificate gallery with cryptographic verification gate.
- `/student/coding` — Online coding practice IDE with language selector, problem description, code editor, and test case execution console.
- `/student/rankings` — Batch leaderboard and tier standings (Gold/Platinum).
- `/student/mentor` — Advisor profile card, 1:1 office hours slot booking, and messaging.
- `/student/settings` — Student profile, GitHub and LeetCode handle linkage, and notification alerts.

### System Routes
- `/` — Automatic redirect to `/login`
- `*` — Themed 404 Not Found error page with direct links back to portal gates.

---

## Getting Started

### Install Dependencies
```bash
npm install
```

### Run Frontend Development Server
```bash
npm run dev
```

### Run Express Backend API
```bash
npm run server:dev
```

### Typecheck & Build
```bash
npm run lint
npm run build
```

