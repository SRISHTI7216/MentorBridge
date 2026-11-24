import { supabaseAdmin, isSupabaseAdminConfigured } from '../lib/supabaseAdmin.js';

const MIN_QUESTION_RESPONSES = 5;

export function summarizeAssessmentAttempts(attempts: any[], totalMarks: number, passingMarks: number, released: boolean) {
  const submitted = attempts.filter(attempt => ['submitted', 'evaluated'].includes(attempt.status) && !!attempt.submitted_at);
  const evaluated = released ? submitted.filter(attempt => attempt.is_evaluated === true) : [];
  const scores = evaluated.map(attempt => Number(attempt.total_score || 0));
  const percentages = scores.map(score => totalMarks > 0 ? Number((score * 100 / totalMarks).toFixed(2)) : null).filter((score): score is number => score !== null);
  const passCount = evaluated.filter(attempt => Number(attempt.total_score || 0) >= passingMarks).length;
  const failCount = evaluated.length - passCount;
  return {
    totalAttempts: attempts.length,
    uniqueStudents: new Set(attempts.map(attempt => attempt.student_id)).size,
    completedAttempts: submitted.length,
    inProgressAttempts: attempts.filter(attempt => attempt.status === 'in_progress').length,
    evaluatedAttempts: evaluated.length,
    averageScore: scores.length ? Number((scores.reduce((a,b) => a+b,0)/scores.length).toFixed(2)) : null,
    highestScore: scores.length ? Math.max(...scores) : null,
    lowestScore: scores.length ? Math.min(...scores) : null,
    averagePercentage: percentages.length ? Number((percentages.reduce((a,b) => a+b,0)/percentages.length).toFixed(2)) : null,
    highestPercentage: percentages.length ? Math.max(...percentages) : null,
    lowestPercentage: percentages.length ? Math.min(...percentages) : null,
    passCount: released ? passCount : null,
    failCount: released ? failCount : null,
    passRate: evaluated.length ? Number((passCount * 100 / evaluated.length).toFixed(2)) : null,
    failRate: evaluated.length ? Number((failCount * 100 / evaluated.length).toFixed(2)) : null,
  };
}

const isValidSubmittedAttempt = (attempt: any) => ['submitted', 'evaluated'].includes(attempt.status) && !!attempt.submitted_at;
const isEvaluatedSubmittedAttempt = (attempt: any) => isValidSubmittedAttempt(attempt) && attempt.is_evaluated === true;

/** Highest attempt_number wins; started_at breaks ties. Used for module averages and student trends. */
export function selectLatestEvaluatedAttempt(attempts: any[]) {
  return attempts.filter(isEvaluatedSubmittedAttempt)
    .sort((a, b) => Number(b.attempt_number || 0) - Number(a.attempt_number || 0)
      || Date.parse(b.started_at || '') - Date.parse(a.started_at || ''))[0] || null;
}

export class MentorAssessmentAnalyticsStore {
  constructor(private readonly dbOverride?: any) {}

  private db() {
    if (this.dbOverride) return this.dbOverride;
    if (!isSupabaseAdminConfigured() || !supabaseAdmin) throw new Error('Supabase database connection is not configured on the server.');
    return supabaseAdmin;
  }

  async getAssessmentReport(assessmentId: string, actorId: string, isAdmin = false) {
    const db = this.db();
    const { data: assessment, error: assessmentError } = await db.from('assessments')
      .select('id,mentor_id,title,subject,topic,total_marks,passing_marks,status,is_results_published')
      .eq('id', assessmentId).maybeSingle();
    if (assessmentError) throw assessmentError;
    if (!assessment || (!isAdmin && assessment.mentor_id !== actorId)) return null;

    const [{ data: assignments, error: assignmentError }, { data: links, error: linkError }] = await Promise.all([
      db.from('mentor_assignments').select('student_id').eq('mentor_id', assessment.mentor_id).eq('is_active', true),
      db.from('module_assessment_links').select('module_id,learning_modules(id,name,code)').eq('assessment_id', assessmentId),
    ]);
    if (assignmentError) throw assignmentError;
    if (linkError) throw linkError;
    const activeMenteeIds: string[] = [...new Set<string>((assignments || []).map((row: any) => row.student_id))];
    const moduleIds: string[] = [...new Set<string>((links || []).map((row: any) => row.module_id))];
    if (!activeMenteeIds.length) return this.emptyReport(assessment, moduleIds);

    let moduleLinks: any[] = [];
    let moduleAssessments: any[] = [];
    let moduleAttempts: any[] = [];
    let eligibleByModule = new Map<string, Set<string>>();
    let linkedModuleIdsByAssessment = new Map<string, Set<string>>();
    let students = activeMenteeIds;
    if (moduleIds.length) {
      const { data: linkedRows, error: moduleLinksError } = await db.from('module_assessment_links')
        .select('module_id,assessment_id').in('module_id', moduleIds);
      if (moduleLinksError) throw moduleLinksError;
      moduleLinks = linkedRows || [];
      const linkedAssessmentIds: string[] = [...new Set<string>(moduleLinks.map((link: any) => link.assessment_id))];
      for (const link of moduleLinks) {
        const ids = linkedModuleIdsByAssessment.get(link.assessment_id) || new Set<string>();
        ids.add(link.module_id); linkedModuleIdsByAssessment.set(link.assessment_id, ids);
      }
      const [{ data: modules, error: modulesError }, { data: enrollments, error: enrollmentsError }, { data: moduleAssignments, error: moduleAssignmentsError }, { data: assessmentRows, error: assessmentRowsError }] = await Promise.all([
        db.from('learning_modules').select('id,status').in('id', moduleIds),
        db.from('student_module_enrollments').select('id,module_id,student_id,assignment_id,enrollment_type,status').in('module_id', moduleIds).in('student_id', activeMenteeIds),
        db.from('module_assignments').select('id,module_id,student_id,status').in('module_id', moduleIds).in('student_id', activeMenteeIds).in('status', ['assigned','completed']),
        db.from('assessments').select('id,title,total_marks,passing_marks,is_results_published').in('id', linkedAssessmentIds),
      ]);
      if (modulesError) throw modulesError;
      if (enrollmentsError) throw enrollmentsError;
      if (moduleAssignmentsError) throw moduleAssignmentsError;
      if (assessmentRowsError) throw assessmentRowsError;
      moduleAssessments = assessmentRows || [];
      const publishedModules = new Set((modules || []).filter((module: any) => module.status === 'published').map((module: any) => module.id));
      const assignmentById = new Map((moduleAssignments || []).map((row: any) => [row.id, row]));
      for (const enrollment of enrollments || []) {
        if (!publishedModules.has(enrollment.module_id) || !['in_progress','completed'].includes(enrollment.status)) continue;
        let eligible = false;
        if (enrollment.enrollment_type === 'institutional_common') {
          eligible = enrollment.assignment_id == null;
        } else if (enrollment.enrollment_type === 'assigned' && enrollment.assignment_id) {
          const assignment: any = assignmentById.get(enrollment.assignment_id);
          eligible = !!assignment && assignment.module_id === enrollment.module_id && assignment.student_id === enrollment.student_id
            && ((enrollment.status === 'in_progress' && assignment.status === 'assigned')
              || (enrollment.status === 'completed' && ['assigned','completed'].includes(assignment.status)));
        }
        if (eligible) {
          const ids = eligibleByModule.get(enrollment.module_id) || new Set<string>();
          ids.add(enrollment.student_id); eligibleByModule.set(enrollment.module_id, ids);
        }
      }
      const targetModuleIds = new Set<string>(moduleIds);
      const targetEligible = new Set<string>();
      for (const moduleId of targetModuleIds) for (const studentId of eligibleByModule.get(moduleId) || []) targetEligible.add(studentId);
      students = activeMenteeIds.filter(studentId => targetEligible.has(studentId));
    } else {
      // Legacy assessments retain explicit student/cohort assignment semantics.
      const [{ data: legacyAssignments, error: legacyError }, { data: details, error: detailsError }] = await Promise.all([
        db.from('assessment_assignments').select('student_id,cohort_id').eq('assessment_id', assessmentId),
        db.from('student_details').select('profile_id,cohort_id').in('profile_id', activeMenteeIds),
      ]);
      if (legacyError) throw legacyError;
      if (detailsError) throw detailsError;
      const cohortByStudent = new Map((details || []).map((row: any) => [row.profile_id, row.cohort_id]));
      const eligibleLegacy = new Set((legacyAssignments || []).filter((row: any) => row.cohort_id == null || row.cohort_id === cohortByStudent.get(row.student_id)).map((row: any) => row.student_id));
      students = activeMenteeIds.filter(studentId => eligibleLegacy.has(studentId));
    }
    if (!students.length) return this.emptyReport(assessment, moduleIds);

    const { data: attempts, error: attemptError } = await db.from('assessment_attempts')
      .select('id,student_id,attempt_number,status,submitted_at,started_at,total_score,is_evaluated')
      .eq('assessment_id', assessmentId).in('student_id', students).order('attempt_number', { ascending: true });
    if (attemptError) throw attemptError;
    const rows = attempts || [];
    let modulePerformance: any[] = [];
    let moduleTrends = new Map<string, any[]>();
    if (moduleIds.length) {
      const linkedIds = [...new Set(moduleLinks.map((link: any) => link.assessment_id))];
      if (linkedIds.length) {
        const { data: attemptRows, error: moduleAttemptsError } = await db.from('assessment_attempts')
          .select('assessment_id,student_id,attempt_number,started_at,status,submitted_at,total_score,is_evaluated')
          .in('assessment_id', linkedIds).in('student_id', activeMenteeIds);
        if (moduleAttemptsError) throw moduleAttemptsError;
        moduleAttempts = attemptRows || [];
        const releasedAssessments = (moduleAssessments || []).filter((item: any) => item.is_results_published);
        for (const studentId of students) {
          const trend = releasedAssessments.flatMap((item: any) => {
            const assessmentModuleIds = linkedModuleIdsByAssessment.get(item.id) || new Set<string>();
            const studentEligible = [...assessmentModuleIds].some(moduleId => eligibleByModule.get(moduleId)?.has(studentId));
            if (!studentEligible) return [];
            const latest = selectLatestEvaluatedAttempt((moduleAttempts || []).filter((attempt: any) => attempt.assessment_id === item.id && attempt.student_id === studentId));
            return latest && Number(item.total_marks) > 0 ? [{ assessmentId: item.id, title: item.title, percentage: Number((Number(latest.total_score || 0) * 100 / Number(item.total_marks)).toFixed(2)) }] : [];
          });
          moduleTrends.set(studentId, trend);
        }
        modulePerformance = moduleLinks.filter((link: any, index: number, all: any[]) => all.findIndex((item: any) => item.module_id === link.module_id) === index).map((link: any) => {
          const ids = new Set((moduleLinks || []).filter((item: any) => item.module_id === link.module_id).map((item: any) => item.assessment_id));
          const moduleScores = releasedAssessments.filter((item: any) => ids.has(item.id)).flatMap((item: any) => {
            const eligibleStudents = eligibleByModule.get(link.module_id) || new Set<string>();
            return [...eligibleStudents].map(studentId => selectLatestEvaluatedAttempt(moduleAttempts.filter((attempt: any) => attempt.assessment_id === item.id && attempt.student_id === studentId)))
              .filter((attempt: any) => attempt && Number(item.total_marks) > 0)
              .map((attempt: any) => Number((Number(attempt.total_score || 0) * 100 / Number(item.total_marks)).toFixed(2)));
          });
          return { moduleId: link.module_id, assessmentCount: [...ids].length, releasedScoreCount: moduleScores.length, averagePercentage: moduleScores.length ? Number((moduleScores.reduce((a: number,b: number) => a+b,0)/moduleScores.length).toFixed(2)) : null };
        });
      }
    }
    const validSubmitted = rows.filter((attempt: any) => ['submitted', 'evaluated'].includes(attempt.status) && !!attempt.submitted_at);
    const released = assessment.is_results_published === true;
    const evaluated = released ? validSubmitted.filter((attempt: any) => attempt.is_evaluated === true) : [];
    const passThreshold = Number(assessment.passing_marks || 0);
    const scorePercent = (attempt: any) => Number(assessment.total_marks) > 0 ? Number((Number(attempt.total_score || 0) * 100 / Number(assessment.total_marks)).toFixed(2)) : null;
    const metrics = summarizeAssessmentAttempts(rows, Number(assessment.total_marks), passThreshold, released);
    const historiesByStudent = new Map<string, any[]>();
    for (const attempt of rows) {
      const current = historiesByStudent.get(attempt.student_id) || [];
      current.push({ attemptNumber: attempt.attempt_number, status: attempt.status, startedAt: attempt.started_at, submittedAt: attempt.submitted_at,
        ...(released && attempt.is_evaluated && ['submitted', 'evaluated'].includes(attempt.status) && !!attempt.submitted_at ? { score: Number(attempt.total_score || 0), percentage: scorePercent(attempt), passed: Number(attempt.total_score || 0) >= passThreshold } : {}) });
      historiesByStudent.set(attempt.student_id, current);
    }
    const { data: profiles, error: profileError } = await db.from('profiles').select('id,name').in('id', students);
    if (profileError) throw profileError;
    const names = new Map((profiles || []).map((profile: any) => [profile.id, profile.name]));
    const studentReports = students.map(studentId => {
      const own = rows.filter((attempt: any) => attempt.student_id === studentId);
      const latest = released ? selectLatestEvaluatedAttempt(own) : null;
      return { studentId, name: names.get(studentId) || 'Student', attemptCount: own.length,
        submissionStatus: own.some((attempt: any) => attempt.status === 'in_progress') ? 'in_progress' : own.some(isValidSubmittedAttempt) ? 'submitted' : own.some((attempt: any) => attempt.status === 'abandoned') ? 'abandoned' : 'not_started',
        history: historiesByStudent.get(studentId) || [], moduleTrend: moduleTrends.get(studentId) || [],
        ...(latest ? { score: Number(latest.total_score || 0), percentage: scorePercent(latest), passed: Number(latest.total_score || 0) >= passThreshold } : {}) };
    });
    const questionAnalysis = released ? await this.getQuestionAnalysis(db, assessmentId, validSubmitted.map((attempt: any) => attempt.id)) : [];
    const moduleRows = (links || []).map((row: any) => Array.isArray(row.learning_modules) ? row.learning_modules[0] : row.learning_modules).filter(Boolean);
    return {
      assessment: { id: assessment.id, title: assessment.title, subject: assessment.subject, topic: assessment.topic, status: assessment.status, resultsReleased: released },
      attemptSelectionRule: 'latest_evaluated_submitted_attempt_per_student_per_assessment (highest attempt_number; started_at breaks ties)',
      modules: moduleRows.map((module: any) => ({ ...module, ...(modulePerformance.find((item: any) => item.moduleId === module.id) || { assessmentCount: 0, releasedScoreCount: 0, averagePercentage: null }) })),
      overview: { ...metrics,
        completionRate: students.length ? Number((new Set(validSubmitted.map((attempt: any) => attempt.student_id)).size * 100 / students.length).toFixed(2)) : 0 },
      students: studentReports, questions: questionAnalysis,
    };
  }

  private async getQuestionAnalysis(db: any, assessmentId: string, attemptIds: string[]) {
    if (!attemptIds.length) return [];
    const { data: questions, error: questionError } = await db.from('assessment_questions')
      .select('id,question_order,question_type,marks,generation_difficulty,generation_cognitive_level,generation_topic')
      .eq('assessment_id', assessmentId).is('removed_at', null).order('question_order');
    if (questionError) throw questionError;
    const { data: answers, error: answerError } = await db.from('assessment_answers').select('question_id,attempt_id,is_correct')
      .in('attempt_id', attemptIds);
    if (answerError) throw answerError;
    const grouped = new Map<string, any[]>();
    for (const answer of answers || []) {
      const group = grouped.get(answer.question_id) || [];
      group.push(answer); grouped.set(answer.question_id, group);
    }
    return (questions || []).map((question: any) => {
      const responses = (grouped.get(question.id) || []).filter((answer: any) => answer.is_correct !== null);
      if (responses.length < MIN_QUESTION_RESPONSES) return { questionOrder: question.question_order, responseCount: responses.length, sufficientData: false };
      const incorrect = responses.filter((answer: any) => answer.is_correct === false).length;
      return { questionOrder: question.question_order, responseCount: responses.length, sufficientData: true,
        incorrectCount: incorrect, correctRate: Number(((responses.length - incorrect) * 100 / responses.length).toFixed(2)),
        difficulty: question.generation_difficulty || null, cognitiveLevel: question.generation_cognitive_level || null,
        topic: question.generation_topic || null };
    });
  }

  private emptyReport(assessment: any, moduleIds: string[]) {
    return { assessment: { id: assessment.id, title: assessment.title, subject: assessment.subject, topic: assessment.topic, status: assessment.status, resultsReleased: assessment.is_results_published === true },
      attemptSelectionRule: 'latest_evaluated_submitted_attempt_per_student_per_assessment (highest attempt_number; started_at breaks ties)',
      modules: moduleIds.map(id => ({ id })), overview: { totalAttempts: 0, uniqueStudents: 0, completedAttempts: 0, inProgressAttempts: 0, evaluatedAttempts: 0, averageScore: null, highestScore: null, lowestScore: null, averagePercentage: null, highestPercentage: null, lowestPercentage: null, passCount: assessment.is_results_published ? 0 : null, failCount: assessment.is_results_published ? 0 : null, passRate: null, failRate: null, completionRate: 0 }, students: [], questions: [] };
  }
}

export const mentorAssessmentAnalyticsStore = new MentorAssessmentAnalyticsStore();
