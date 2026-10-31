import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

// Route Guards
import { ProtectedRoute } from './ProtectedRoute';
import { RoleBasedRoute } from './RoleBasedRoute';

// Layouts
import { MentorLayout } from '../components/layout/MentorLayout';
import { StudentLayout } from '../components/layout/StudentLayout';
import { AdminLayout } from '../components/layout/AdminLayout';

// Auth Features
import { Login } from '../features/auth/Login';
import { ForgotPassword } from '../features/auth/ForgotPassword';

// Mentor Features
import { MentorDashboard } from '../features/mentor/Dashboard';
import { MentorMentees } from '../features/mentor/Mentees';
import { MentorAssessments } from '../features/mentor/Assessments';
import { MentorReports } from '../features/mentor/Reports';
import { MentorLearning } from '../features/mentor/Learning';
import { MentorRankings } from '../features/mentor/Rankings';
import { MentorCoding } from '../features/mentor/Coding';
import { MentorSettings } from '../features/mentor/Settings';

// Student Features
import { StudentDashboard } from '../features/student/Dashboard';
import { StudentAssessments } from '../features/student/Assessments';
import { StudentReports } from '../features/student/Reports';
import { StudentLearning } from '../features/student/Learning';
import { StudentCertificates } from '../features/student/Certificates';
import { StudentCoding } from '../features/student/Coding';
import { StudentRankings } from '../features/student/Rankings';
import { StudentMyMentor } from '../features/student/MyMentor';
import { StudentSettings } from '../features/student/Settings';

// Admin Features
import { AdminDashboard } from '../features/admin/Dashboard';
import { AdminStudents } from '../features/admin/Students';
import { AdminMentors } from '../features/admin/Mentors';
import { AdminAllocation } from '../features/admin/Allocation';
import { AdminAcademic } from '../features/admin/Academic';
import { AdminSettings } from '../features/admin/Settings';

// Shared
import { NotFound } from '../features/shared/NotFound';

export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      {/* Root redirects to Login */}
      <Route path="/" element={<Navigate to="/login" replace />} />

      {/* Public Auth Routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />

      {/* Protected Routes: Session Required */}
      <Route element={<ProtectedRoute />}>
        {/* Mentor Workspace: Strictly mentor & admin roles */}
        <Route element={<RoleBasedRoute allowedRoles={['mentor', 'admin']} />}>
          <Route path="/mentor" element={<MentorLayout />}>
            <Route index element={<Navigate to="/mentor/dashboard" replace />} />
            <Route path="dashboard" element={<MentorDashboard />} />
            <Route path="mentees" element={<MentorMentees />} />
            <Route path="assessments" element={<MentorAssessments />} />
            <Route path="reports" element={<MentorReports />} />
            <Route path="learning" element={<MentorLearning />} />
            <Route path="rankings" element={<MentorRankings />} />
            <Route path="coding" element={<MentorCoding />} />
            <Route path="settings" element={<MentorSettings />} />
          </Route>
        </Route>

        {/* Student Workspace: Strictly student & admin roles */}
        <Route element={<RoleBasedRoute allowedRoles={['student', 'admin']} />}>
          <Route path="/student" element={<StudentLayout />}>
            <Route index element={<Navigate to="/student/dashboard" replace />} />
            <Route path="dashboard" element={<StudentDashboard />} />
            <Route path="assessments" element={<StudentAssessments />} />
            <Route path="reports" element={<StudentReports />} />
            <Route path="learning" element={<StudentLearning />} />
            <Route path="certificates" element={<StudentCertificates />} />
            <Route path="coding" element={<StudentCoding />} />
            <Route path="rankings" element={<StudentRankings />} />
            <Route path="mentor" element={<StudentMyMentor />} />
            <Route path="settings" element={<StudentSettings />} />
          </Route>
        </Route>

        {/* Admin Workspace: Strictly admin role */}
        <Route element={<RoleBasedRoute allowedRoles={['admin']} />}>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Navigate to="/admin/dashboard" replace />} />
            <Route path="dashboard" element={<AdminDashboard />} />
            <Route path="students" element={<AdminStudents />} />
            <Route path="mentors" element={<AdminMentors />} />
            <Route path="allocation" element={<AdminAllocation />} />
            <Route path="academic" element={<AdminAcademic />} />
            <Route path="settings" element={<AdminSettings />} />
          </Route>
        </Route>
      </Route>

      {/* 404 Catch-All */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};
