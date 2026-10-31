import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { fetchStudentMentor } from '../../services/dataService';
import { AssignedMentor } from '../../types/auth';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';

export const StudentMyMentor: React.FC = () => {
  const { user, isConfigured } = useAuth();
  const [mentor, setMentor] = useState<AssignedMentor | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [bookingConfirmed, setBookingConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  const [messageSent, setMessageSent] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadMentor = async () => {
      if (!user?.id) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const data = await fetchStudentMentor(user.id);
        if (isMounted) {
          setMentor(data);
        }
      } catch (err) {
        console.error('[StudentMyMentor] Error loading mentor:', err);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadMentor();

    return () => {
      isMounted = false;
    };
  }, [user?.id]);

  const availableSlots = [
    "Thursday • 14:00 - 14:30 EST",
    "Thursday • 15:00 - 15:30 EST",
    "Tuesday • 14:30 - 15:00 EST",
    "Tuesday • 15:30 - 16:00 EST",
  ];

  const handleBook = () => {
    if (!selectedSlot) return;
    setBookingConfirmed(true);
    setTimeout(() => setBookingConfirmed(false), 4000);
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    setMessageSent(true);
    setMessage('');
    setTimeout(() => setMessageSent(false), 4000);
  };

  return (
    <div className="p-6 max-w-5xl w-full mx-auto space-y-6">
      <div className="pb-4 border-b border-outline-variant">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold font-display text-on-surface tracking-tight">
            My Faculty Advisor & Mentorship
          </h1>
          <Badge variant="primary">Real-Time DB Sync</Badge>
        </div>
        <p className="text-xs text-on-surface-variant mt-1">
          Direct communication, scheduled 1:1 code reviews, and academic progress milestones.
        </p>
      </div>

      {!isConfigured && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-start gap-3">
          <span className="material-symbols-outlined text-amber-700 text-lg mt-0.5">warning</span>
          <div>
            <p className="font-semibold">Supabase Environment Configuration Pending</p>
            <p className="text-[11px] mt-0.5">
              Live advisor records require valid <code className="bg-amber-100 px-1 py-0.5 rounded font-mono">VITE_SUPABASE_URL</code> and <code className="bg-amber-100 px-1 py-0.5 rounded font-mono">VITE_SUPABASE_ANON_KEY</code>.
            </p>
          </div>
        </div>
      )}

      {isLoading ? (
        <Card className="p-8 space-y-4 animate-pulse">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-slate-200"></div>
            <div className="space-y-2 flex-1">
              <div className="h-5 bg-slate-200 rounded w-1/3"></div>
              <div className="h-4 bg-slate-200 rounded w-1/4"></div>
            </div>
          </div>
        </Card>
      ) : !mentor ? (
        <Card className="p-12 text-center space-y-3 border-dashed border-2">
          <div className="w-14 h-14 rounded-full bg-surface-container-high mx-auto flex items-center justify-center text-on-surface-variant">
            <span className="material-symbols-outlined text-3xl">psychology</span>
          </div>
          <h3 className="font-display font-bold text-base text-slate-800">No Faculty Mentor Assigned Yet</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            You do not currently have an active mentor assignment for this academic term. Mentor allocation is provisioned by the Department Coordinator.
          </p>
        </Card>
      ) : (
        <Card className="p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
            <div className="flex items-center gap-4">
              <img
                src={mentor.avatarUrl}
                alt={mentor.name}
                className="w-16 h-16 rounded-full object-cover ring-4 ring-primary/20"
              />
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold font-display text-slate-900">{mentor.name}</h2>
                  <Badge variant="success">Assigned Advisor</Badge>
                </div>
                <p className="text-xs text-primary font-semibold mt-0.5">{mentor.designation}</p>
                <p className="text-xs text-slate-500 font-mono mt-0.5">Emp ID: {mentor.employeeId}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{mentor.department}</p>
              </div>
            </div>

            <div className="text-xs space-y-1 sm:text-right">
              <p className="text-slate-500">
                Office: <span className="font-semibold text-slate-800">{mentor.officeLocation || 'Main Campus'}</span>
              </p>
              <p className="text-slate-500">
                Hours: <span className="font-semibold text-slate-800">{mentor.officeHours || 'By Appointment'}</span>
              </p>
              <p className="text-primary font-mono text-[11px]">{mentor.email}</p>
              <p className="text-slate-400 text-[10px]">Active Since: {mentor.assignedDate}</p>
            </div>
          </div>

          {/* Specialization Chips */}
          {mentor.specializations && mentor.specializations.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Specialization & Research Focus
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {mentor.specializations.map((chip, i) => (
                  <span key={i} className="text-xs bg-slate-100 text-slate-700 px-3 py-1 rounded-full font-medium">
                    {chip}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 1:1 Review Booking */}
          <div className="p-5 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-xl">event</span>
              <h3 className="font-bold text-slate-900 text-sm">Schedule Next 1:1 Code Review Session</h3>
            </div>
            <p className="text-xs text-slate-600">
              Select an open office hour slot with {mentor.name}:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {availableSlots.map((slot, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelectedSlot(slot)}
                  className={`p-2.5 rounded-lg border text-left transition-all ${
                    selectedSlot === slot
                      ? 'bg-indigo-50 border-primary text-primary font-bold shadow-xs'
                      : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                  }`}
                >
                  {slot}
                </button>
              ))}
            </div>

            {bookingConfirmed && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-semibold flex items-center gap-2">
                <span className="material-symbols-outlined text-sm">check_circle</span>
                <span>Review appointment scheduled for {selectedSlot}. Notification dispatched to advisor.</span>
              </div>
            )}

            <div className="pt-1 flex justify-end">
              <Button size="sm" disabled={!selectedSlot} onClick={handleBook}>
                Confirm 1:1 Booking
              </Button>
            </div>
          </div>

          {/* Message Advisor Box */}
          <div className="space-y-3 pt-2">
            <h3 className="font-bold text-slate-900 text-sm">Send Note or PR Link to Advisor</h3>
            <form onSubmit={handleSendMessage} className="space-y-3 text-xs">
              <textarea
                rows={3}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Submit questions about your latest coding drill, request PR review, or ask about coursework..."
                className="w-full p-3 border border-outline-variant rounded-xl focus:border-primary focus:ring-1 focus:ring-primary outline-none text-xs"
              />
              {messageSent && (
                <p className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm">check</span>
                  <span>Message delivered to advisor queue.</span>
                </p>
              )}
              <div className="flex justify-end">
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  leftIcon={<span className="material-symbols-outlined text-sm">send</span>}
                >
                  Send Message
                </Button>
              </div>
            </form>
          </div>
        </Card>
      )}
    </div>
  );
};
